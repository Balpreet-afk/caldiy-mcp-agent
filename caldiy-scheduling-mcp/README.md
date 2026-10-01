# caldiy-scheduling-mcp

> **Status:** Production-ready implementation complete. All unit, integration, and MCP contract tests passing.

An MCP server that acts as a deterministic, policy-enforcing gateway in front of a self-hosted [Cal.diy](https://github.com/calcom/cal.diy) instance. It allows client-facing and owner AI agents to discover slots, plan bookings, resolve displacement, execute saga transactions with compensation, and enforce owner priority policies.

No agent logic. No email. No dashboard. Cal.diy is the single source of truth.

---

## Features

- **Strict Profile Isolation**:
  - `public` profile: Free and opaque displaceable slots, plan creation, execution, booking status verification (bound to attendee email). Zero exposure of owner meeting titles, attendees, or approval queues.
  - `owner` profile: Full schedule inspection, booking priority overrides, dry-run policy evaluation, approval queue management, and tamper-evident audit log querying.
- **Deterministic Policy Engine**: Pure rules matching attendee domain, email, event type, or title regex. Full priority matrix evaluation (`CRITICAL > HIGH > NORMAL > LOW`).
- **Two-Phase Saga with Compensation**: Validates slot availability, reschedules displaced meetings, and books new events. Automatically compensates (rolls back) if downstream operations fail.
- **Security & Prompt Injection Protection**: Strips control characters, caps attendee strings, and returns them strictly inside `untrusted` fields.
- **Append-only SQLite Store**: Stores immutable audit logs, plans with TTL, approval queues, and booking priorities.

---

## Quick Start

```bash
cd caldiy-scheduling-mcp
npm install
npm run build
npm test
```

### Running the Demo
```bash
./scripts/demo.sh
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CAL_API_URL` | ✅ | `http://localhost:5555` | Base URL of your Cal.diy API v2 |
| `CAL_API_KEY` | ✅ | — | Owner API key from Cal.diy settings |
| `MCP_PROFILE` | ✅ | `public` | Active profile: `public` or `owner` |
| `MCP_TRANSPORT` | | `stdio` | Transport protocol: `stdio` or `http` |
| `MCP_HTTP_PORT` | | `3333` | HTTP port (if `MCP_TRANSPORT=http`) |
| `MCP_HTTP_BEARER_TOKEN` | if http | — | Constant-time verified bearer token for HTTP |
| `POLICY_FILE` | | `./policy.yaml` | Path to policy configuration YAML |
| `DATA_DIR` | | `./data` | SQLite storage directory |
| `DRY_RUN` | | `false` | Plan + audit without writing to Cal.diy |
| `NOTIFY_WEBHOOK_URL` | | — | Outbox webhook endpoint for owner notifications |

---

## Generating a Cal.diy API Key

1. Open your Cal.diy Web UI (e.g. `http://localhost:3000` or `http://localhost:5555`).
2. Navigate to **Developer API Key** on the dashboard (or Developer Settings in Cal.com).
3. Copy the live API key (e.g. `cal_live_...`).
4. Set `CAL_API_KEY` in your `.env` or MCP client configuration.

---

## Antigravity / MCP Client Configuration (stdio)

Add the following to your MCP client configuration (e.g. `~/.gemini/antigravity-cli/mcp_config.json` or equivalent client config):

### Public Profile (Client-facing Agents)
```json
{
  "mcpServers": {
    "caldiy-public": {
      "command": "node",
      "args": ["/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/dist/index.js"],
      "env": {
        "MCP_PROFILE": "public",
        "CAL_API_URL": "http://localhost:5555",
        "CAL_API_KEY": "cal_live_28a9b73491c107297eef840f34581290",
        "POLICY_FILE": "/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/policy.yaml",
        "DATA_DIR": "/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/data"
      }
    }
  }
}
```

### Owner Profile (Owner-only Agent)
```json
{
  "mcpServers": {
    "caldiy-owner": {
      "command": "node",
      "args": ["/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/dist/index.js"],
      "env": {
        "MCP_PROFILE": "owner",
        "CAL_API_URL": "http://localhost:5555",
        "CAL_API_KEY": "cal_live_28a9b73491c107297eef840f34581290",
        "POLICY_FILE": "/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/policy.yaml",
        "DATA_DIR": "/home/balpreet/Cal.diy mcp agent/caldiy-scheduling-mcp/data"
      }
    }
  }
}
```

---

## Policy File Guide (`policy.yaml`)

```yaml
autonomy_level: 4            # 0 suggest only, 1 book after confirm, 2 auto-book, 3 negotiate+book, 4 +displace
timezone: Asia/Kolkata
working_hours:
  mon-fri: ["10:00-18:00"]
default_priority: NORMAL
priority_rules:
  - match: { attendee_domain: "kodev.studio" }   priority: LOW
  - match: { event_type_slug: "client-call" }    priority: HIGH
  - match: { attendee_email: "vip@board.com" }   priority: CRITICAL
displacement:
  matrix:
    HIGH:     { LOW: auto, NORMAL: approval, HIGH: deny, CRITICAL: deny }
    CRITICAL: { LOW: auto, NORMAL: approval, HIGH: approval, CRITICAL: deny }
    NORMAL:   { LOW: approval }
    LOW:      {}
  max_displacements_per_plan: 1
  max_displacements_per_day: 3
  min_notice_hours: 24           # Never move a meeting starting sooner than 24h
  protect_external_attendees: true
  max_reschedules_per_booking: 2
  alt_slot_search_days: 7
  alt_slot_strategy: earliest
cancel: deny
public:
  expose_titles: false
  allow_self_reschedule: true
  allow_self_cancel: true
limits:
  tool_calls_per_minute: 30
  bookings_per_day_per_attendee: 3
approval_ttl_minutes: 60
plan_ttl_minutes: 5
```

---

## Architecture & API Notes

- Technical Spec: [`caldiy-scheduling-mcp-spec.md`](../caldiy-scheduling-mcp-spec.md)
- Verified API Notes: [`docs/caldiy-api-notes.md`](docs/caldiy-api-notes.md)
