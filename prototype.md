# Prototype Plan — caldiy-scheduling-mcp

> **Goal:** `npm run build && npm test` pass. MCP server runs in stdio mode.
> Booking, displacement (auto + approval), and policy engine work end-to-end
> against a real or mocked Cal.diy instance.

---

## Scope

Prototype = full spec §1–§14 minus:
- HTTP transport (stdio only)
- Webhook notify flush (enqueue only)
- `reschedule_own_booking` / `cancel_own_booking` (stub, not gated)

---

## Step 1 — Verify build baseline

```bash
cd caldiy-scheduling-mcp
npm install
npm run build
```

Fix any TypeScript errors in existing scaffold. Target: zero errors, zero
unimplemented functions blocking compile.

**Done when:** `tsc` exits 0.

---

## Step 2 — Cal.diy API discovery

Read Cal.diy v2 API docs at `CAL_API_URL/docs` (or the public OpenAPI).
Record findings in `docs/caldiy-api-notes.md`.

Endpoints needed (minimum set):
| Method | Path | Used for |
|--------|------|----------|
| GET | `/v2/event-types` | `get_owner_info` |
| GET | `/v2/slots` | `find_slots` |
| GET | `/v2/bookings` | owner schedule, conflict discovery |
| GET | `/v2/bookings/:uid` | `get_booking`, status check |
| POST | `/v2/bookings` | `book_meeting`, saga create |
| PATCH | `/v2/bookings/:uid/reschedule` | saga reschedule displaced |
| DELETE | `/v2/bookings/:uid` | saga cancel |
| GET | `/v2/me` | timezone, user info |

Document: exact request/response shapes, required headers (`cal-api-version`),
error formats, whether `metadata` is writable.

**Done when:** `docs/caldiy-api-notes.md` has one verified example per endpoint.

---

## Step 3 — Implement `CalDiyClient`

File: `src/caldiy/client.ts`

Implement all methods listed in Step 2. Rules:
- `Authorization: Bearer <CAL_API_KEY>` on every request
- `cal-api-version: YYYY-MM-DD` header pinned per endpoint group
- 10 s `AbortController` timeout
- Retry on 429/5xx for reads only (3 attempts, exponential backoff)
- Map errors to `CalDiyError` taxonomy: `slot_unavailable | not_found | auth_failed | rate_limited | upstream_error`

Also fill `src/caldiy/types.ts`: `EventType`, `Slot`, `Booking`, `Schedule`,
`UserInfo` — derive shapes from Step 2 notes.

**Done when:** MSW mock tests in `test/caldiy.test.ts` pass for each method
(happy path + mapped errors).

---

## Step 4 — Implement policy engine

File: `src/policy/engine.ts`

Three exports:
1. `resolvePriority(policy, params)` — applies `priority_rules` in order, falls
   back to `default_priority`. Returns `Priority`.
2. `evaluateDisplacement(policy, requester, target)` — looks up
   `displacement.matrix[requester][target]`. Returns `"auto" | "approval" |
   "deny"`.
3. `checkAutonomyGate(policy, autonomyLevel, decision, confirmedByHuman)` —
   maps level + decision to `"ok" | "needs_confirmation" | "suggestion_only"`.

Policy file already validated by `config.ts` (zod). Engine functions are **pure
— no I/O**.

Priority enum (from spec §5): `LOW < NORMAL < HIGH < CRITICAL`.

**Done when:** table-driven unit tests in `test/policy.test.ts` cover:
- Full 4×4 displacement matrix
- All `autonomy_level` 0–4 paths
- `priority_rules` order and fallback

---

## Step 5 — Implement planner

File: `src/planner/index.ts`

### `findSlots(client, config, params)`

1. Call `client.getSlots(eventTypeSlug, dateFrom, dateTo)` → raw free slots.
2. Call `client.getBookings({ dateFrom, dateTo })` → owner bookings.
3. For each occupied slot, call `evaluateDisplacement`. If result ≠ `"deny"`,
   classify as `DisplacableSlot` (opaque — no owner/title info).
4. Return `{ free_slots, displaceable_slots }`.

### `buildPlan(client, config, params)`

1. Resolve requester priority via `resolvePriority`.
2. Check if requested `start` is free → direct book step.
3. If occupied → evaluate displacement → if denied, return denied plan.
4. If auto/approval → find alt slot for displaced meeting
   (`alt_slot_strategy: earliest`, within working hours, `alt_slot_search_days`).
5. Build `PlanStep[]`, assign `plan_id` (UUID), set `expires_at` = now +
   `plan_ttl_minutes`.
6. Persist plan + policy snapshot + `config_hash` to SQLite `plans` table.
7. Return `Plan`.

### `executePlan(client, config, planId, confirmed?)`

1. Load plan from SQLite. Reject if expired, already executed, or `config_hash`
   mismatch.
2. If `policy.decision === "approval_required"`: check `approvals` table for a
   valid approval matching `plan_id` + `plan_hash`. If missing → return
   `approval_required`.
3. If `autonomy_gate === "needs_confirmation"` and `!confirmed` → return
   `needs_confirmation`.
4. Re-fetch slots/bookings to validate steps still valid (stale-slot check).
5. Execute saga:
   - Step A: reschedule displaced booking to alt slot (if any).
   - Step B: create new booking.
   - On Step B failure → compensate: reschedule displaced back to original slot.
6. Mark plan `executed` in SQLite.
7. Enqueue notify event.
8. Return `{ status: "executed", result }`.

**Done when:** unit tests in `test/planner.test.ts` cover:
- Free slot → direct book
- Occupied + `auto` displacement → saga executes
- Occupied + `approval_required` → blocks at execute
- Step B failure → compensation runs
- Stale slot → rejected
- Expired plan → rejected

---

## Step 6 — Implement public tools

File: `src/tools/public.ts`

Wire each `server.tool(...)` call. Use zod schemas already defined. Log every
call to audit_log via store helper.

| Tool | Core call |
|------|-----------|
| `get_owner_info` | `client.getEventTypes()` + `client.getUserInfo()` |
| `find_slots` | `planner.findSlots(...)` |
| `plan_booking` | `planner.buildPlan(...)` |
| `execute_plan` | `planner.executePlan(...)` |
| `book_meeting` | `buildPlan` + `executePlan` in one call; fail on `slot_unavailable` |
| `get_booking_status` | `client.getBooking(uid)` — verify `attendee_email` matches |
| `reschedule_own_booking` | `client.rescheduleBooking(...)` — check `allow_self_reschedule`, notice rule |
| `cancel_own_booking` | `client.cancelBooking(...)` — check `allow_self_cancel` |

Security rules per tool:
- No private data in responses (no title, attendee list, location, link).
- `displaceable_slots` opaque: only `start`, `end`, `requires` fields.
- Attendee-supplied strings only in `untrusted` field after `sanitizeUntrusted()`.
- Rate-limit every call via `RateLimiter`.

**Done when:** MCP contract test (`test/mcp.test.ts`) spins up server in-process,
lists public tools, calls each with valid and invalid input.

---

## Step 7 — Implement owner tools

File: `src/tools/owner.ts`

| Tool | Core call |
|------|-----------|
| `get_schedule` | `client.getBookings(range)` — attendee free text in `untrusted` |
| `get_booking` | `client.getBooking(uid)` |
| `get_meeting_priority` | SQLite `meeting_priority` lookup |
| `set_meeting_priority` | INSERT/REPLACE `meeting_priority` with `source=owner` |
| `get_policy` | Return effective policy (secrets omitted) |
| `check_policy` | `evaluateDisplacement` + `checkAutonomyGate` — pure, no side effects |
| `list_approvals` | SELECT from `approvals` WHERE status=pending |
| `approve_action` | Verify `plan_hash` matches stored plan. INSERT approval. |
| `reject_action` | UPDATE approval status=rejected |
| `list_audit` | SELECT from `audit_log` with time/booking/action filters |

**Approvals never appear on public profile.** Assert in MCP contract test.

**Done when:** owner profile MCP contract test passes for each tool.

---

## Step 8 — Audit logging

Add store helper `src/store/audit.ts`:

```ts
function logAudit(db, fields: Partial<AuditRow>): void
```

Call from every tool handler (success and failure). Log denials and validation
failures too.

**Done when:** after each tool call in tests, `SELECT * FROM audit_log` contains
the expected row.

---

## Step 9 — Config & policy loading

File: `src/config.ts` (already scaffolded — complete it):

1. Validate all env vars with zod. Fail fast on missing required vars.
2. Load + parse `POLICY_FILE` with `yaml` + zod. Fail fast on schema errors.
3. Export `Config` type + `loadConfig()`.

**Done when:** `config.test.ts` verifies missing env → throws, bad YAML → throws,
valid config → correct typed object.

---

## Step 10 — End-to-end smoke test (DRY_RUN=true)

Create `test/e2e.test.ts` (opt-in, `E2E=1`). Start server via `StdioServerTransport`. Send MCP messages over stdin/stdout pipe:

1. `get_owner_info` → returns event types.
2. `find_slots` for next 7 days → returns slots list.
3. `plan_booking` for a free slot → plan returned.
4. `execute_plan` with plan_id → `status: executed` (dry run, no Cal.diy write).
5. `plan_booking` for an occupied (mocked) slot → `approval_required`.
6. `approve_action` (owner profile) → approval stored.
7. `execute_plan` again → `status: executed`.

**Done when:** `E2E=1 npm test` passes against a local Cal.diy or MSW mock.

---

## Step 11 — Demo script

Create `scripts/demo.sh`:

Reproduces all 5 acceptance scenarios from spec §15 using `mcp-cli` or a
minimal Node script piping JSON-RPC over stdio:

1. Free-slot booking
2. HIGH displacing LOW (auto)
3. HIGH hitting NORMAL (approval → owner approves → executes)
4. CRITICAL target (denied)
5. Stale-slot race (plan created, slot stolen, execute rejected)

---

## Step 12 — Docker

Create `docker-compose.yml`:

```yaml
services:
  mcp-public:
    build: ./caldiy-scheduling-mcp
    environment:
      MCP_PROFILE: public
      CAL_API_URL: ${CAL_API_URL}
      CAL_API_KEY: ${CAL_API_KEY}
      POLICY_FILE: /data/policy.yaml
      DATA_DIR: /data
    volumes:
      - ./policy.yaml:/data/policy.yaml:ro
      - mcp-data:/data
    stdin_open: true
    tty: true

volumes:
  mcp-data:
```

---

## Execution order

```
Step 1  Build baseline         ~30 min   unblocked
Step 2  API discovery          ~1 h      unblocked
Step 3  CalDiyClient           ~2 h      needs Step 2
Step 4  Policy engine          ~1 h      unblocked
Step 5  Planner                ~3 h      needs Steps 3, 4
Step 6  Public tools           ~2 h      needs Step 5
Step 7  Owner tools            ~1.5 h    needs Steps 5, 6
Step 8  Audit logging          ~30 min   needs Steps 6, 7
Step 9  Config loading         ~30 min   unblocked
Step 10 E2E smoke              ~1 h      needs all above
Step 11 Demo script            ~1 h      needs Step 10
Step 12 Docker                 ~30 min   needs Step 1
```

Steps 1, 2, 4, 9 can run in parallel. Steps 3, 5–8 are sequential.
Total wall-clock with one person: ~2 days.

---

## Acceptance gate

```bash
cd caldiy-scheduling-mcp
npm run build   # zero errors
npm test        # all unit + MCP contract tests green
E2E=1 npm test  # smoke test green (requires local Cal.diy or MSW)
```

All 5 demo scenarios in `scripts/demo.sh` produce expected output.
