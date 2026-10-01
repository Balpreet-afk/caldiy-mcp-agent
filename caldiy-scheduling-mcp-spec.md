# Technical Spec: `caldiy-scheduling-mcp`

Build ONLY an MCP server that sits in front of a self-hosted **Cal.diy** instance and lets an AI agent schedule meetings under deterministic, owner-defined policy. No agent, no dashboard, no email service, no chat channels, no LLM provider code. The MCP server is a policy-enforcing gateway; Cal.diy is the single source of truth for calendar data.

---

## 0. Ground rules for the implementer

1. Cal.diy is mandatory. All calendar reads/writes go through the **Cal.diy API v2** (HTTP). Never touch Cal.diy's database.
2. Do not guess endpoint shapes. Before writing the client, read the OpenAPI/Swagger docs of the running instance (`{CAL_API_URL}/docs`) and the `apps/api/v2` source in the `calcom/cal.diy` repo. Pin the `cal-api-version` header per endpoint group. Generate or hand-write a typed client from what you actually find, and put the findings in `docs/caldiy-api-notes.md`.
3. The LLM never decides policy. Every write tool calls the policy engine (pure deterministic code) before touching Cal.diy.
4. Cal.diy already emails attendees on book/reschedule/cancel. **This server sends no email.**
5. Anything that can't be verified against Cal.diy (e.g. booking metadata support, seat/reservation behaviour) must be isolated behind an interface and noted in `docs/caldiy-api-notes.md`.

## 1. Stack

- TypeScript (strict), Node 20+, ESM
- `@modelcontextprotocol/sdk` (official), `zod` for all schemas
- `better-sqlite3` for local state (audit log, priorities, plans, approvals)
- `yaml` for policy file, `pino` for logs, `vitest` + `msw` for tests
- Transports: **stdio** (default, for Antigravity/local) and **Streamable HTTP** (optional, bearer-token protected). Do not implement legacy SSE.

## 2. Architecture

```
LLM client (Antigravity / any MCP client)
        │  MCP (stdio | streamable HTTP)
        ▼
┌─────────────────────────────────────────┐
│ MCP Server                              │
│  tool registry (profile: public|owner)  │
│  → input validation (zod)               │
│  → authz / profile check                │
│  → rate limit                           │
│  → Policy Engine (deterministic)        │
│  → Planner (displacement, alt slots)    │
│  → Cal.diy client (API v2)              │
│  → Audit log (SQLite)                   │
└───────────────┬─────────────────────────┘
                ▼
            Cal.diy API v2  →  Cal.diy Postgres (untouched)
```

### Tool profiles (important)

One server, two profiles chosen at startup via `MCP_PROFILE`:

- `public` — exposed to the client-facing conversation agent. Sees availability only. Cannot read owner meeting details, change priorities, change policy or approve anything.
- `owner` — for the owner's own agent/CLI. Full detail, priority edits, approvals.

A client-facing LLM must never be able to call owner tools. Tools not in the active profile are not registered at all.

## 3. Environment variables

```
CAL_API_URL=            # self-hosted API v2 base URL (NOT api.cal.com)
CAL_API_KEY=            # owner's Cal.diy API key
CAL_API_VERSION_*=      # per-endpoint-group cal-api-version values, defaults in code
MCP_PROFILE=public|owner
MCP_TRANSPORT=stdio|http
MCP_HTTP_PORT=3333
MCP_HTTP_BEARER_TOKEN=  # required if transport=http (compare in constant time)
POLICY_FILE=./policy.yaml
DATA_DIR=./data         # SQLite lives here
DRY_RUN=false           # true: plan + audit, never write to Cal.diy
NOTIFY_WEBHOOK_URL=     # optional; owner notifications POSTed here
```

Secrets only from env. Never log them. Fail fast on missing/invalid config.

## 4. Priority model

Enum: `CRITICAL(0) > HIGH(1) > NORMAL(2) > LOW(3)`.

- Priority belongs to the **booking**, stored in SQLite `meeting_priority(booking_uid, priority, source, reason, updated_at)`. `source` ∈ `rule | owner`.
- Default priority is derived by **rules** in `policy.yaml` (match on event-type slug, attendee email domain, attendee email, title regex). Owner can override per booking via `owner` profile tool. Rules never come from the caller or from email text.
- Callers on the `public` profile cannot choose their own priority. `book_meeting` computes it from rules.
- Bookings with no stored priority get rule-derived priority on first read; unmatched → `default_priority` from policy (default `NORMAL`).

## 5. Policy file (`policy.yaml`) — validated with zod at startup

```yaml
autonomy_level: 3            # 0 suggest only, 1 book after confirm, 2 auto-book,
                             # 3 negotiate+book, 4 +displace lower-priority meetings
timezone: Asia/Kolkata
working_hours:               # used by slot finder + alternative slot picker
  mon-fri: ["10:00-18:00"]
default_priority: NORMAL
priority_rules:
  - match: { attendee_domain: "kodev.studio" }   priority: LOW
  - match: { event_type_slug: "client-call" }    priority: HIGH
displacement:
  # requested priority → existing priority → decision: auto | approval | deny
  matrix:
    HIGH:     { LOW: auto, NORMAL: approval, HIGH: deny, CRITICAL: deny }
    CRITICAL: { LOW: auto, NORMAL: approval, HIGH: approval, CRITICAL: deny }
    NORMAL:   { LOW: approval }
    LOW:      {}
  max_displacements_per_plan: 1
  max_displacements_per_day: 3
  min_notice_hours: 24           # never move a meeting starting sooner than this
  protect_external_attendees: true   # meetings with non-owner-domain attendees → at least "approval"
  max_reschedules_per_booking: 2
  alt_slot_search_days: 7
  alt_slot_strategy: earliest    # deterministic; server picks, LLM does not
cancel: deny                     # deny | approval | auto
public:
  expose_titles: false           # public profile never sees titles/attendees
  allow_self_reschedule: true
  allow_self_cancel: true
limits:
  tool_calls_per_minute: 30
  bookings_per_day_per_attendee: 3
approval_ttl_minutes: 60
plan_ttl_minutes: 5
```

Autonomy gate runs first: level 0 → write tools return `{status:"suggestion_only"}`; level 1 → require `confirmed: true` flag from the human-facing side (see §7); levels 2–3 → book; level 4 → displacement permitted subject to matrix.

## 6. Why plans: the availability-vs-conflict problem

Cal.diy's slots endpoint only returns FREE slots. A booked 15:00 slot is simply absent, so "conflict detected → compare priority" can never happen from slot queries alone. The server therefore does its own conflict discovery:

1. Fetch the owner's bookings (owner-level API read) for the requested window.
2. Compute `free_slots` (from Cal.diy slots) and `displaceable_slots` = slots occupied by exactly one booking whose priority the requested priority may displace under the matrix, ignoring protections that fail (min notice, external attendees, reschedule cap, daily cap).
3. `find_slots` returns both lists. `displaceable_slots` entries are **opaque** to public callers: just `{start, end, requires: "none"|"approval"}`, never who/what is there.

## 7. Two-phase writes (plan → execute)

All state-changing multi-step operations use plans so the model can't skip validation and so races are caught.

1. `plan_booking(...)` → server validates, runs policy, builds ordered steps, stores plan in SQLite with TTL, returns:
```json
{
  "plan_id": "pln_...",
  "expires_at": "...",
  "steps": [
    {"op":"reschedule","booking_ref":"b1","to":"..."},
    {"op":"book","start":"...","event_type":"..."}
  ],
  "policy": {"decision":"auto|approval_required|denied","rule":"HIGH>LOW auto","reasons":[...]},
  "autonomy_gate":"ok|needs_confirmation|suggestion_only"
}
```
2. `execute_plan(plan_id, confirmed?)`:
   - reject if expired, already executed, or policy/config hash changed
   - re-fetch slots/bookings and **re-validate every step** (slot still free, target booking unchanged)
   - if decision is `approval_required` and no approved approval record → return `approval_required` with `approval_id`; do not act
   - execute as a **saga**: reschedule displaced booking first (frees slot) → create new booking. If a later step fails, run compensation (move displaced booking back) and audit both outcomes. Cal.diy has no cross-call transaction; document this limitation.
   - idempotent: same `plan_id` executed twice returns the first result
3. Simple bookings with no displacement still go `plan_booking` → `execute_plan`, or via `book_meeting` which is a thin wrapper doing both when decision is `auto` and autonomy allows.

Alternative slot for a displaced meeting is chosen by the server (earliest free slot within working hours and `alt_slot_search_days`, same event type, same duration). If none exists the plan is `denied` with reason `no_alternative_slot`.

## 8. MCP tools

All tool outputs are structured JSON (use `structuredContent` + a short text summary). All times ISO 8601 with offset; accept IANA tz where input is local.

### `public` profile

| Tool | Purpose |
|---|---|
| `get_owner_info` | Owner display name, timezone, bookable event types (id, slug, duration). No private data. |
| `find_slots` | Input: event_type, date range, optional time-of-day window, optional `requester_context` (email/domain, used only for rule-based priority). Returns `free_slots` and opaque `displaceable_slots`. Max range 14 days. |
| `plan_booking` | See §7. Priority is computed server-side. |
| `execute_plan` | See §7. |
| `book_meeting` | Wrapper for non-displacing bookings. Fails with `slot_unavailable` rather than silently displacing. |
| `get_booking_status` | Input: `booking_uid` + `attendee_email` (must match). Returns time, status only. |
| `reschedule_own_booking` / `cancel_own_booking` | Require uid + matching attendee email; obey policy (`allow_self_*`, notice rules, reschedule cap). |

### `owner` profile (everything above, plus)

| Tool | Purpose |
|---|---|
| `get_schedule` | Full bookings with titles/attendees for a range. Free text from attendees is returned only inside an `untrusted` field (see §10). |
| `get_booking` | Single booking, full detail. |
| `get_meeting_priority` / `set_meeting_priority` | Read/override priority (`source=owner`). |
| `get_policy` | Effective policy (secrets omitted). Read-only; policy changes happen by editing the file and restarting/reloading. |
| `check_policy` | Dry-evaluate an action (`book|reschedule|displace|cancel`) with given priorities. Pure function, no side effects. |
| `list_approvals` / `approve_action` / `reject_action` | Approval queue. Approving binds to a specific `plan_id` + plan hash; any change to the plan invalidates the approval. |
| `list_audit` | Query audit log by time/booking/action. |

Approvals are **never** exposed on the `public` profile. If the same LLM can approve its own requests, approvals are meaningless.

Do NOT implement: `email.*`, `negotiation.*`, `owner.notify` as LLM tools, raw SQL, raw Cal.diy passthrough. Negotiation state lives in the client agent; the MCP server stays stateless apart from plans/approvals/audit.

## 9. Audit log (SQLite, append-only)

Table `audit_log`: `id, ts, profile, client_name, client_version, conversation_id (optional, caller-supplied, untrusted), tool, action_type, booking_uid, plan_id, input_hash, old_value, new_value, policy_decision, policy_rule, status, error, dry_run`.

- The server cannot know which model is calling; record MCP `clientInfo` and optional caller-supplied `conversation_id`, not "model_name".
- Every tool call is logged, including denials and validation failures.
- Optional: hash-chain each row (`prev_hash`) for tamper evidence.
- Redact secrets and attendee free text beyond a length cap.

## 10. Security requirements

- **Prompt injection:** attendee-controlled strings (names, notes, titles, descriptions) are untrusted data. Return them only in a field named `untrusted`, length-capped, control chars stripped, never concatenated into tool descriptions or status messages. No tool accepts free-text instructions that alter policy. Policy comes only from the file.
- **Capability limits:** no tool parameter can raise priority, bypass autonomy gate, skip plan validation, or target arbitrary booking uids without identity binding on the public profile.
- **Privacy:** public profile returns no titles, attendee lists, locations, meeting links or other bookings' details. `displaceable_slots` is opaque.
- **Auth:** stdio inherits local trust; HTTP requires bearer token (constant-time compare), binds to localhost by default, validates `Origin`. Document how to front it with OAuth 2.1 per the MCP authorization spec for remote multi-user use. Not required for v1.
- **Validation:** zod on every input; reject unknown fields; cap string lengths, date ranges, array sizes.
- **Rate limiting:** per-process token bucket per tool and per attendee email.
- **Idempotency:** write tools accept optional `idempotency_key`; dedupe in SQLite.
- **Fail closed:** any policy/config parse error, Cal.diy error, or ambiguity → deny and audit.
- **Dry run:** `DRY_RUN=true` executes planning + audit but skips all Cal.diy writes.

## 11. Cal.diy client requirements

- Typed wrapper in `src/caldiy/`, one function per endpoint used: event types, slots, create booking, list/get bookings, reschedule, cancel, (optional) slot reservation, user/schedule info.
- Timeouts (10s), retry with backoff on 429/5xx for **reads only**; writes are not blind-retried (use idempotency + re-read to confirm).
- Map Cal.diy errors to a small internal error taxonomy: `slot_unavailable, not_found, auth_failed, rate_limited, upstream_error`.
- Check whether booking `metadata` is writable/readable; if yes, mirror priority there as a convenience, but SQLite remains authoritative.

## 12. Optional owner notifications

If `NOTIFY_WEBHOOK_URL` is set, POST a JSON event after any executed plan, displacement, denial of note, or approval request: `{type, ts, summary, plan_id, booking_uids}`. Fire-and-forget with retry queue in SQLite. No email, no templates.

## 13. Project structure

```
caldiy-scheduling-mcp/
├── src/
│   ├── index.ts              # bootstrap, transport selection
│   ├── server.ts             # tool registration by profile
│   ├── config.ts             # env + policy.yaml loading (zod)
│   ├── tools/                # one file per tool
│   ├── policy/               # engine.ts, matrix.ts, rules.ts (pure, no I/O)
│   ├── planner/              # conflict discovery, displacement, alt-slot picker, saga
│   ├── caldiy/               # API client + types + error mapping
│   ├── store/                # sqlite, migrations, audit, plans, approvals, priorities
│   ├── security/             # sanitize, ratelimit, auth
│   └── notify/               # webhook outbox
├── test/
├── policy.example.yaml
├── docs/caldiy-api-notes.md
├── Dockerfile
├── package.json
└── README.md
```

## 14. Testing (required)

- **Policy engine:** table-driven tests covering the full priority × priority × autonomy matrix, min-notice, external-attendee protection, daily caps, cancel policy.
- **Planner:** conflict discovery, displaceable-slot computation, alt-slot picker (working hours, timezone/DST edges), no-alternative case.
- **Saga:** failure after step 1 triggers compensation; double execute is idempotent; stale plan rejected; slot taken between plan and execute rejected.
- **Security:** injection strings in booking title/notes never alter tool output structure; public profile never leaks private fields; public profile has no owner tools; approval bound to plan hash.
- **Cal.diy client:** msw-mocked integration tests. Plus one opt-in e2e suite against a real local Cal.diy (`E2E=1`).
- **MCP contract:** spin up server via SDK client in-process, list tools per profile, call each tool with valid/invalid input.

## 15. Deliverables / acceptance criteria

1. `npm run build && npm test` pass.
2. `docker compose` file that runs the MCP server alongside an existing Cal.diy URL (do not bundle Cal.diy itself; document `CAL_API_URL` setup).
3. README with: Antigravity/MCP client config snippet for stdio, env table, how to generate the Cal.diy API key, how to run in each profile, policy file guide.
4. Demo script reproducing: free-slot booking; HIGH request displacing a LOW meeting (auto); HIGH request hitting NORMAL (approval required → owner approves → executes); CRITICAL target (denied); stale-slot race.
5. `docs/caldiy-api-notes.md` listing the exact endpoints, versions and any unverified assumptions.

## 16. Out of scope (do not build)

AI agent / conversation logic, LLM provider abstraction, email send/receive, WhatsApp/chat channels, owner dashboard, multi-tenant SaaS, Cal.diy deployment itself, MCP OAuth server.
