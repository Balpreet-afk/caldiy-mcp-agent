# Cal.diy API Notes

> **Status:** Verified from local repo reference docs in `cal.diy/agents/skills/calcom-api/references/`.
> Source files examined: `authentication.md`, `bookings.md`, `slots-availability.md`,
> `event-types.md`, `schedules.md`.

---

## Unverified Assumptions

- `GET /v2/me` returns `{ id, email, username, name, timeZone }` — seen in authentication.md example only; not tested against a live instance.
- `metadata` field on bookings is both writable (included in POST request body) and readable (returned in GET responses). Treat as JSON object. SQLite remains authoritative for priority; `metadata` is a convenience mirror only.
- `cal-api-version: 2024-08-13` is the pinned version shown in all examples. No newer version documented in the reference files.
- Reschedule endpoint is `POST /v2/bookings/{uid}/reschedule` (not `PATCH`).
- Cancel endpoint is `POST /v2/bookings/{uid}/cancel` (not `DELETE`).
- Slot reservation TTL is approximately 10 minutes (documented as "typically 10 minutes").
- List bookings `take` max is 250. No cursor-based pagination documented — use `skip` offsets.

---

## Authentication

All requests require:

```http
Authorization: Bearer <CAL_API_KEY>
Content-Type: application/json
cal-api-version: 2024-08-13
```

- API keys are prefixed `cal_live_...` (production) or `cal_test_...` (sandbox).
- 401 = invalid/missing key. 403 = authenticated but no permission.

### Error response shape (all endpoints)

```json
{
  "status": "error",
  "error": {
    "code": "UNAUTHORIZED | FORBIDDEN | NOT_FOUND | VALIDATION_ERROR | RATE_LIMITED",
    "message": "Human-readable message"
  }
}
```

### Rate limiting

- 429 returned with `Retry-After: <seconds>` header.
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

---

## Endpoints

### GET /v2/me

**Purpose:** Owner timezone, display name.

**Headers:** Standard auth.

**Response:**

```json
{
  "status": "success",
  "data": {
    "id": 12345,
    "email": "user@example.com",
    "username": "johndoe",
    "name": "John Doe",
    "timeZone": "America/New_York"
  }
}
```

**Verified:** Example only (authentication.md). Assumed accurate.

---

### GET /v2/event-types

**Purpose:** List owner bookable event types for `get_owner_info`.

**Headers:** Standard auth.

**Query params:**

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `take` | number | 10 | 250 |
| `skip` | number | 0 | — |

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": 123,
      "title": "30 Minute Meeting",
      "slug": "30min",
      "description": "A quick 30 minute call",
      "lengthInMinutes": 30,
      "minimumBookingNotice": 120,
      "requiresConfirmation": false,
      "hidden": false,
      "metadata": {}
    }
  ]
}
```

**Key fields for MCP server:** `id`, `slug`, `lengthInMinutes`, `title` (private — never expose on public profile).

**Verified:** event-types.md.

---

### GET /v2/slots

**Purpose:** Available time slots for a given event type and date range (`find_slots`).

**Headers:** Standard auth.

**Query params:**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `startTime` | ISO 8601 | Yes | Range start |
| `endTime` | ISO 8601 | Yes | Range end (max 14 days for MCP per spec) |
| `eventTypeId` | number | Conditional | Required if no slug |
| `eventTypeSlug` | string | Conditional | Required if no id |
| `timeZone` | string | No | IANA tz for display; response times still UTC |
| `duration` | number | No | Override duration in minutes |
| `rescheduleUid` | string | No | Pass when rescheduling to exclude the existing booking |

**Response:**

```json
{
  "status": "success",
  "data": {
    "slots": {
      "2024-01-15": [
        { "time": "2024-01-15T09:00:00.000Z" },
        { "time": "2024-01-15T09:30:00.000Z" }
      ],
      "2024-01-16": [
        { "time": "2024-01-16T09:00:00.000Z" }
      ]
    }
  }
}
```

All times UTC. Slots keyed by local date in requested timezone (if provided), else UTC date.

**Verified:** slots-availability.md.

---

### POST /v2/slots/reservations

**Purpose:** Temporarily lock a slot while completing booking (optional, use for stale-slot protection).

**Request body:**

```json
{
  "eventTypeId": 123,
  "slotUtcStartDate": "2024-01-15T09:00:00.000Z",
  "slotUtcEndDate": "2024-01-15T09:30:00.000Z"
}
```

**Response:**

```json
{
  "status": "success",
  "data": {
    "uid": "reservation-uid-123",
    "eventTypeId": 123,
    "slotUtcStartDate": "2024-01-15T09:00:00.000Z",
    "slotUtcEndDate": "2024-01-15T09:30:00.000Z",
    "expiresAt": "2024-01-15T08:10:00.000Z"
  }
}
```

Expires ~10 minutes. Release with `DELETE /v2/slots/reservations/{uid}`.

**Verified:** slots-availability.md.

---

### GET /v2/bookings

**Purpose:** List owner bookings for conflict discovery and owner schedule view.

**Headers:** Standard auth.

**Query params:**

| Param | Type | Notes |
|-------|------|-------|
| `status` | string | `upcoming \| recurring \| past \| cancelled \| unconfirmed` |
| `afterStart` | ISO 8601 | Filter bookings starting after this time |
| `beforeEnd` | ISO 8601 | Filter bookings ending before this time |
| `attendeeEmail` | string | Filter by attendee |
| `eventTypeId` | number | Filter by event type |
| `sortStart` | string | `asc \| desc` |
| `take` | number | Default 10, max 250 |
| `skip` | number | Pagination offset |

**Response:**

```json
{
  "status": "success",
  "data": [
    {
      "id": 12345,
      "uid": "abc123def456",
      "title": "30 Minute Meeting",
      "start": "2024-01-15T10:00:00.000Z",
      "end": "2024-01-15T10:30:00.000Z",
      "status": "accepted",
      "eventTypeId": 123,
      "attendees": [
        { "name": "John Doe", "email": "john@example.com", "timeZone": "America/New_York" }
      ],
      "hosts": [
        { "id": 456, "name": "Jane Smith", "email": "jane@company.com" }
      ],
      "location": "https://cal.com/video/abc123",
      "meetingUrl": "https://cal.com/video/abc123",
      "metadata": {},
      "createdAt": "2024-01-10T08:00:00.000Z"
    }
  ]
}
```

**Security note for MCP:** `title`, `attendees`, `location`, `meetingUrl` are private. Never expose on public profile. Return attendee strings only in `untrusted` field after sanitization.

**Verified:** bookings.md.

---

### GET /v2/bookings/{bookingUid}

**Purpose:** Single booking full detail (`get_booking`, `get_booking_status`).

**Path param:** `bookingUid` — string uid (not numeric id).

**Response:** Same shape as single item in list above.

**Identity binding for public profile:** Caller must supply `attendee_email`; MCP server verifies it matches `data.attendees[*].email` before returning.

**Verified:** bookings.md.

---

### POST /v2/bookings

**Purpose:** Create a booking (`book_meeting`, saga step B).

**Request body:**

```json
{
  "start": "2024-01-15T10:00:00Z",
  "eventTypeId": 123,
  "attendee": {
    "name": "John Doe",
    "email": "john@example.com",
    "timeZone": "America/New_York",
    "language": "en"
  },
  "metadata": {
    "priority": "HIGH",
    "plan_id": "uuid"
  }
}
```

**Required fields:** `start`, `eventTypeId`, `attendee.name`, `attendee.email`, `attendee.timeZone`.

**Optional:** `metadata` (writable JSON object — use to mirror priority as convenience).

**Response:** Full booking object with `uid` for future operations.

**Idempotency:** No native idempotency key documented. Use SQLite dedup via `idempotency_key` column in `plans` table.

**Verified:** bookings.md.

---

### POST /v2/bookings/{bookingUid}/reschedule

**Purpose:** Move an existing booking to a new time (saga step A — reschedule displaced meeting).

**Request body:**

```json
{
  "start": "2024-01-16T14:00:00Z",
  "reschedulingReason": "Conflict with higher-priority meeting"
}
```

**Required:** `start` (ISO 8601 new start time).

**Response:** Updated booking object.

**Note:** Not `PATCH` — uses `POST`. Use `rescheduleUid` param on `GET /v2/slots` when finding alt slots to correctly exclude the original booking time.

**Verified:** bookings.md.

---

### POST /v2/bookings/{bookingUid}/cancel

**Purpose:** Cancel a booking (saga compensation, `cancel_own_booking`).

**Request body:**

```json
{
  "cancellationReason": "Rescheduled by policy engine"
}
```

**Required:** none (reason is optional).

**Note:** Not `DELETE` — uses `POST /cancel`. Attendees automatically receive cancellation emails.

**Verified:** bookings.md.

---

## Booking Status Values

| Value | Meaning |
|-------|---------|
| `accepted` | Confirmed |
| `pending` | Awaiting host confirmation |
| `cancelled` | Cancelled |
| `rejected` | Declined by host |

---

## Error Taxonomy Mapping

| Cal.diy HTTP status | MCP internal code |
|---------------------|-------------------|
| 409 / slot taken | `slot_unavailable` |
| 404 | `not_found` |
| 401 | `auth_failed` |
| 429 | `rate_limited` |
| 400 / 422 / 5xx | `upstream_error` |

---

## Notes on `metadata` Field

- Readable and writable on bookings (confirmed from bookings.md examples).
- Use to mirror priority: `{ "priority": "HIGH", "plan_id": "..." }`.
- SQLite `meeting_priority` table is the authoritative source.
- Cap `metadata` size — avoid storing untrusted strings here.

---

## Pagination

All list endpoints: `take` (default 10, max 250) + `skip` offset. No cursor. For large calendars (>250 bookings in window), issue multiple requests with `skip`.

---

## Schedules (Reference Only)

`GET /v2/schedules` — working hours for conflict-aware alt-slot picker.

- `workingHours[].days` = array of weekday ints (0=Sun ... 6=Sat).
- `workingHours[].startTime` = minutes from midnight (e.g. 540 = 9:00 AM).
- `workingHours[].endTime` = minutes from midnight (e.g. 1020 = 5:00 PM).

Use `GET /v2/schedules/default` to get the owner's default schedule for working-hours constraint in alt-slot search.
