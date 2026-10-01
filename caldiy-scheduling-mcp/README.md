# caldiy-scheduling-mcp

> **Status:** Scaffold only — implementation in progress.

An MCP server that acts as a policy-enforcing gateway in front of a
self-hosted [Cal.diy](https://github.com/calcom/cal.diy) instance.
Lets an AI agent schedule meetings under deterministic, owner-defined policy.

No agent logic. No email. No dashboard. Cal.diy is the single source of truth.

## Quick start

```bash
cp policy.example.yaml policy.yaml   # edit to your needs
cp .env.example .env                 # fill in CAL_API_URL, CAL_API_KEY, etc.
npm install
npm run build
npm start
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CAL_API_URL` | ✅ | — | Base URL of your Cal.diy API v2 |
| `CAL_API_KEY` | ✅ | — | Owner API key from Cal.diy settings |
| `MCP_PROFILE` | ✅ | — | `public` or `owner` |
| `MCP_TRANSPORT` | | `stdio` | `stdio` or `http` |
| `MCP_HTTP_PORT` | | `3333` | HTTP port (if transport=http) |
| `MCP_HTTP_BEARER_TOKEN` | if http | — | Bearer token for HTTP transport |
| `POLICY_FILE` | | `./policy.yaml` | Path to policy config |
| `DATA_DIR` | | `./data` | SQLite storage directory |
| `DRY_RUN` | | `false` | Plan + audit without writing to Cal.diy |
| `NOTIFY_WEBHOOK_URL` | | — | Owner notification webhook |

## Antigravity / MCP client config (stdio)

```json
{
  "mcpServers": {
    "caldiy-public": {
      "command": "node",
      "args": ["/path/to/caldiy-scheduling-mcp/dist/index.js"],
      "env": {
        "MCP_PROFILE": "public",
        "CAL_API_URL": "http://localhost:5555",
        "CAL_API_KEY": "your-key-here",
        "POLICY_FILE": "/path/to/policy.yaml"
      }
    }
  }
}
```

## Profiles

- **`public`** — For client-facing agents. Sees availability only. Cannot read
  owner meeting details, set priorities, or access approvals.
- **`owner`** — Full access including priorities, approvals, audit log.
  Never expose this profile to untrusted agents.

## Architecture

See [`caldiy-scheduling-mcp-spec.md`](../caldiy-scheduling-mcp-spec.md) for
the full technical specification.

## Cal.diy API notes

See [`docs/caldiy-api-notes.md`](docs/caldiy-api-notes.md) for verified
endpoint contracts and unconfirmed assumptions.
