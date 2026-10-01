# Cal.diy API v2 — Notes & Findings

> **IMPORTANT (spec §0 rule 2):** Do not guess endpoint shapes.
> Before implementing `src/caldiy/client.ts`, read `{CAL_API_URL}/docs` and
> the `apps/api/v2` source in the cloned `cal.diy/` repo.
> Document every verified endpoint here and note anything unconfirmed.

## How to explore

```bash
# Start your Cal.diy instance, then open:
open http://localhost:5555/docs          # OpenAPI UI

# Or browse the v2 source:
find ../cal.diy/apps/api -name '*.ts' | head -40
```

## Endpoints to verify

| Purpose | Method | Path | `cal-api-version` | Verified? |
|---|---|---|---|---|
| List event types | GET | `/v2/event-types` | ? | ❌ |
| Get slots | GET | `/v2/slots` | ? | ❌ |
| Create booking | POST | `/v2/bookings` | ? | ❌ |
| List bookings | GET | `/v2/bookings` | ? | ❌ |
| Get booking | GET | `/v2/bookings/:uid` | ? | ❌ |
| Reschedule booking | PATCH | `/v2/bookings/:uid` | ? | ❌ |
| Cancel booking | DELETE / POST | `/v2/bookings/:uid/cancel` | ? | ❌ |
| Get schedule | GET | `/v2/schedules` | ? | ❌ |
| Get me / user info | GET | `/v2/me` | ? | ❌ |

## Unverified assumptions

- **Booking metadata**: Unknown whether `metadata` field on bookings is
  read/writable. If yes, mirror priority there as a convenience; SQLite is
  authoritative (spec §11).
- **Slot reservation**: Unknown whether a slot-reservation API exists. If not,
  the saga must handle the race condition between plan and execute.
- **Idempotency keys**: Unknown whether Cal.diy supports an idempotency header
  on booking creation/reschedule.
- **Attendee auth**: Verify how Cal.diy identifies the attendee on
  reschedule/cancel — by email match, token, or other?

## Verified findings

_Fill in as you discover endpoints against your running instance._
