import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { CalDiyClient, CalDiyError } from "../src/caldiy/client.js";

const CAL_API_URL = "http://localhost:5555";
const CAL_API_KEY = "cal_test_12345";

const server = setupServer(
  http.get(`${CAL_API_URL}/v2/me`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        id: 1,
        email: "test@example.com",
        username: "testowner",
        name: "Test Owner",
        timeZone: "Asia/Kolkata",
      },
    });
  }),

  http.get(`${CAL_API_URL}/v2/event-types`, () => {
    return HttpResponse.json({
      status: "success",
      data: [
        {
          id: 10,
          title: "30 Min Chat",
          slug: "30min",
          length: 30,
          description: "Quick chat",
        },
      ],
    });
  }),

  http.get(`${CAL_API_URL}/v2/slots`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        slots: {
          "2026-10-02": [{ time: "2026-10-02T10:00:00.000Z" }],
        },
      },
    });
  }),

  http.get(`${CAL_API_URL}/v2/bookings`, () => {
    return HttpResponse.json({
      status: "success",
      data: [
        {
          id: 101,
          uid: "bkg_test_01",
          title: "30 Min Chat",
          start: "2026-10-02T10:00:00.000Z",
          end: "2026-10-02T10:30:00.000Z",
          status: "accepted",
          eventTypeId: 10,
          attendees: [{ name: "Alice", email: "alice@test.com", timeZone: "Asia/Kolkata" }],
        },
      ],
    });
  }),

  http.get(`${CAL_API_URL}/v2/bookings/bkg_test_01`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        id: 101,
        uid: "bkg_test_01",
        title: "30 Min Chat",
        start: "2026-10-02T10:00:00.000Z",
        end: "2026-10-02T10:30:00.000Z",
        status: "accepted",
        eventTypeId: 10,
        attendees: [{ name: "Alice", email: "alice@test.com", timeZone: "Asia/Kolkata" }],
      },
    });
  }),

  http.post(`${CAL_API_URL}/v2/bookings`, async ({ request }) => {
    const body = (await request.json()) as any;
    return HttpResponse.json(
      {
        status: "success",
        data: {
          id: 102,
          uid: "bkg_new_02",
          title: "Booked meeting",
          start: body.start,
          end: new Date(new Date(body.start).getTime() + 30 * 60000).toISOString(),
          status: "accepted",
          eventTypeId: body.eventTypeId,
          attendees: [body.attendee],
          metadata: body.metadata,
        },
      },
      { status: 201 }
    );
  }),

  http.post(`${CAL_API_URL}/v2/bookings/bkg_test_01/reschedule`, async ({ request }) => {
    const body = (await request.json()) as any;
    return HttpResponse.json({
      status: "success",
      data: {
        id: 101,
        uid: "bkg_test_01",
        title: "30 Min Chat",
        start: body.start,
        end: new Date(new Date(body.start).getTime() + 30 * 60000).toISOString(),
        status: "accepted",
        eventTypeId: 10,
        attendees: [{ name: "Alice", email: "alice@test.com", timeZone: "Asia/Kolkata" }],
      },
    });
  }),

  http.post(`${CAL_API_URL}/v2/bookings/bkg_test_01/cancel`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        id: 101,
        uid: "bkg_test_01",
        title: "30 Min Chat",
        status: "cancelled",
        eventTypeId: 10,
        attendees: [{ name: "Alice", email: "alice@test.com", timeZone: "Asia/Kolkata" }],
      },
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("CalDiyClient", () => {
  const client = new CalDiyClient({ CAL_API_URL, CAL_API_KEY });

  it("fetches user info", async () => {
    const user = await client.getUserInfo();
    expect(user.username).toBe("testowner");
    expect(user.email).toBe("test@example.com");
  });

  it("fetches event types", async () => {
    const eventTypes = await client.getEventTypes();
    expect(eventTypes).toHaveLength(1);
    expect(eventTypes[0].slug).toBe("30min");
  });

  it("fetches slots", async () => {
    const slots = await client.getSlots({
      eventTypeSlug: "30min",
      startTime: "2026-10-02T00:00:00Z",
      endTime: "2026-10-02T23:59:59Z",
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe("2026-10-02T10:00:00.000Z");
  });

  it("fetches bookings list and single booking", async () => {
    const bookings = await client.getBookings();
    expect(bookings).toHaveLength(1);
    expect(bookings[0].uid).toBe("bkg_test_01");

    const single = await client.getBooking("bkg_test_01");
    expect(single.uid).toBe("bkg_test_01");
  });

  it("creates booking", async () => {
    const created = await client.createBooking({
      start: "2026-10-03T11:00:00Z",
      eventTypeId: 10,
      attendee: { name: "Bob", email: "bob@test.com", timeZone: "Asia/Kolkata" },
      metadata: { priority: "HIGH" },
    });
    expect(created.uid).toBe("bkg_new_02");
    expect(created.status).toBe("accepted");
  });

  it("reschedules and cancels booking", async () => {
    const rescheduled = await client.rescheduleBooking("bkg_test_01", {
      start: "2026-10-04T12:00:00Z",
      reschedulingReason: "Rescheduled",
    });
    expect(rescheduled.start).toBe("2026-10-04T12:00:00Z");

    const cancelled = await client.cancelBooking("bkg_test_01", {
      cancellationReason: "Cancelled",
    });
    expect(cancelled.status).toBe("cancelled");
  });

  it("maps 404 to not_found error", async () => {
    server.use(
      http.get(`${CAL_API_URL}/v2/bookings/missing`, () => {
        return HttpResponse.json({ error: { message: "Booking not found" } }, { status: 404 });
      })
    );

    await expect(client.getBooking("missing")).rejects.toThrowError(CalDiyError);
    try {
      await client.getBooking("missing");
    } catch (err: any) {
      expect(err.code).toBe("not_found");
    }
  });

  it("maps 401 to auth_failed error", async () => {
    server.use(
      http.get(`${CAL_API_URL}/v2/me`, () => {
        return HttpResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
      })
    );

    try {
      await client.getUserInfo();
    } catch (err: any) {
      expect(err.code).toBe("auth_failed");
    }
  });
});
