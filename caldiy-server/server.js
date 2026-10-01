const http = require("node:http");
const { parse: parseUrl } = require("node:url");
const crypto = require("node:crypto");

const API_PORT = parseInt(process.env.PORT || "5555", 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || "3000", 10);
const API_KEY = process.env.CAL_API_KEY || "cal_live_28a9b73491c107297eef840f34581290";
const TIMEZONE = process.env.TIMEZONE || "Asia/Kolkata";
const OWNER_NAME = process.env.OWNER_NAME || "Balpreet";
const OWNER_EMAIL = process.env.OWNER_EMAIL || "balpreet@example.com";

// In-memory store initialized with seed data
const eventTypes = [
  {
    id: 1,
    title: "30 Minute Meeting",
    slug: "30min",
    length: 30,
    description: "Quick 30 min chat",
    locations: [{ type: "integrations:daily" }],
    userId: 1,
  },
  {
    id: 2,
    title: "Client Call",
    slug: "client-call",
    length: 45,
    description: "Client synchronization call",
    locations: [{ type: "integrations:daily" }],
    userId: 1,
  },
];

let nextBookingId = 1002;
const bookings = [
  {
    id: 1001,
    uid: "bkg_existing_sample_01",
    title: "Team Sync",
    start: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    end: new Date(Date.now() + 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString(),
    status: "accepted",
    eventTypeId: 1,
    attendees: [
      {
        name: "Alice Dev",
        email: "alice@kodev.studio",
        timeZone: TIMEZONE,
      },
    ],
    hosts: [{ id: 1, name: OWNER_NAME, email: OWNER_EMAIL }],
    location: "https://cal.diy/video/bkg_existing_sample_01",
    meetingUrl: "https://cal.diy/video/bkg_existing_sample_01",
    metadata: { priority: "LOW" },
    createdAt: new Date().toISOString(),
  },
];

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, cal-api-version",
  });
  res.end(JSON.stringify(body, null, 2));
}

function verifyAuth(req, res) {
  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  if (token !== API_KEY) {
    sendJson(res, 401, {
      status: "error",
      message: "ApiAuthStrategy - api key - Your api key is not valid",
    });
    return false;
  }
  return true;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function generateSlots(startDateStr, endDateStr) {
  const start = startDateStr ? new Date(startDateStr) : new Date();
  const end = endDateStr ? new Date(endDateStr) : new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const slots = {};

  const cur = new Date(start);
  while (cur <= end) {
    const dayOfWeek = cur.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const dateKey = cur.toISOString().split("T")[0];
      const daySlots = [];
      const hours = [10, 11, 14, 15, 16];
      for (const h of hours) {
        const slotTime = new Date(cur);
        slotTime.setUTCHours(h, 0, 0, 0);
        daySlots.push({ time: slotTime.toISOString() });
      }
      slots[dateKey] = daySlots;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

function renderHtmlDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cal.diy</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: #f9fafb; color: #111827; padding: 32px 24px; }
    .container { max-width: 900px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; border-bottom: 1px solid #e5e7eb; padding-bottom: 20px; }
    .brand { font-size: 24px; font-weight: 700; color: #111827; display: flex; align-items: center; gap: 8px; }
    .badge { background: #10b981; color: white; font-size: 12px; padding: 2px 8px; border-radius: 9999px; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    h2 { font-size: 18px; margin-bottom: 16px; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
    .event-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; transition: border-color 0.2s; }
    .event-card:hover { border-color: #3b82f6; }
    .event-title { font-weight: 600; margin-bottom: 6px; }
    .event-meta { font-size: 13px; color: #6b7280; margin-bottom: 12px; }
    .btn { display: inline-block; background: #111827; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500; }
    .api-key-box { background: #1f2937; color: #e5e7eb; font-family: monospace; font-size: 13px; padding: 12px; border-radius: 6px; word-break: break-all; margin-top: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
    th { color: #6b7280; font-weight: 500; font-size: 12px; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">Cal.diy <span class="badge">Running</span></div>
      <div><strong>${OWNER_NAME}</strong> (${OWNER_EMAIL})</div>
    </header>

    <div class="card">
      <h2>Developer API Key</h2>
      <p style="font-size: 14px; color: #4b5563;">Use this key to authenticate MCP server or external tools with Cal.diy API v2.</p>
      <div class="api-key-box">${API_KEY}</div>
    </div>

    <div class="card">
      <h2>Active Event Types</h2>
      <div class="grid">
        ${eventTypes.map(e => `
          <div class="event-card">
            <div class="event-title">${e.title}</div>
            <div class="event-meta">${e.length} mins • /${e.slug}</div>
            <p style="font-size: 13px; color: #4b5563; margin-bottom: 12px;">${e.description}</p>
            <span class="btn">Ready for Booking</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Scheduled Bookings</h2>
      <table>
        <thead>
          <tr>
            <th>UID</th>
            <th>Title</th>
            <th>Start Time</th>
            <th>Attendee</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${bookings.map(b => `
            <tr>
              <td><code>${b.uid}</code></td>
              <td>${b.title}</td>
              <td>${new Date(b.start).toLocaleString()}</td>
              <td>${b.attendees[0]?.name || ''} (${b.attendees[0]?.email || ''})</td>
              <td><span style="color: #059669; font-weight: 500;">${b.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>API v2 Status</h2>
      <p style="font-size: 14px; color: #4b5563;">Endpoints exposed on port <strong>3000</strong> & <strong>${API_PORT}</strong>. View documentation at <a href="/docs" style="color: #2563eb;">/docs</a>.</p>
    </div>
  </div>
</body>
</html>`;
}

async function requestHandler(req, res) {
  const parsed = parseUrl(req.url, true);
  let path = parsed.pathname;
  const method = req.method.toUpperCase();

  // Normalize /api/v2 to /v2
  if (path.startsWith("/api/v2")) {
    path = path.replace("/api/v2", "/v2");
  }

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, cal-api-version",
    });
    return res.end();
  }

  // Web dashboard on /
  if (path === "/" || path === "") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderHtmlDashboard());
  }

  // Health and docs
  if (path === "/health" || path === "/docs") {
    if (path === "/docs") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>Cal.diy API v2 Docs</title></head>
        <body style="font-family: sans-serif; padding: 24px;">
          <h1>Cal.diy API v2</h1>
          <p>Status: Healthy</p>
          <p>Auth Header: <code>Authorization: Bearer ${API_KEY}</code></p>
          <ul>
            <li>GET /v2/event-types</li>
            <li>GET /v2/slots</li>
            <li>GET /v2/bookings</li>
            <li>GET /v2/bookings/:uid</li>
            <li>POST /v2/bookings</li>
            <li>POST /v2/bookings/:uid/reschedule</li>
            <li>POST /v2/bookings/:uid/cancel</li>
            <li>GET /v2/me</li>
            <li>GET /v2/schedules</li>
          </ul>
        </body>
        </html>
      `);
    }
    return sendJson(res, 200, { status: "success", message: "Cal.diy server online" });
  }

  // All /v2/* endpoints require valid API key
  if (path.startsWith("/v2/")) {
    if (!verifyAuth(req, res)) return;

    // GET /v2/me
    if (path === "/v2/me" && method === "GET") {
      return sendJson(res, 200, {
        status: "success",
        data: {
          id: 1,
          username: "balpreet",
          name: OWNER_NAME,
          email: OWNER_EMAIL,
          timeZone: TIMEZONE,
          weekStart: "Monday",
          timeFormat: 12,
        },
      });
    }

    // GET /v2/schedules or /v2/schedules/default
    if ((path === "/v2/schedules" || path === "/v2/schedules/default") && method === "GET") {
      return sendJson(res, 200, {
        status: "success",
        data: {
          id: 1,
          name: "Default Schedule",
          timeZone: TIMEZONE,
          isDefault: true,
          workingHours: [
            {
              days: [1, 2, 3, 4, 5],
              startTime: 600,
              endTime: 1080,
            },
          ],
        },
      });
    }

    // GET /v2/event-types
    if (path === "/v2/event-types" && method === "GET") {
      return sendJson(res, 200, {
        status: "success",
        data: eventTypes,
      });
    }

    // GET /v2/slots or /v2/slots/available
    if ((path === "/v2/slots" || path === "/v2/slots/available") && method === "GET") {
      const start = parsed.query.start || parsed.query.dateFrom;
      const end = parsed.query.end || parsed.query.dateTo;
      return sendJson(res, 200, {
        status: "success",
        data: {
          slots: generateSlots(start, end),
        },
      });
    }

    // GET /v2/bookings
    if (path === "/v2/bookings" && method === "GET") {
      let filtered = [...bookings];
      if (parsed.query.afterStart) {
        const after = new Date(parsed.query.afterStart);
        filtered = filtered.filter((b) => new Date(b.start) >= after);
      }
      if (parsed.query.beforeEnd) {
        const before = new Date(parsed.query.beforeEnd);
        filtered = filtered.filter((b) => new Date(b.end) <= before);
      }
      if (parsed.query.attendeeEmail) {
        filtered = filtered.filter((b) =>
          b.attendees.some((a) => a.email.toLowerCase() === parsed.query.attendeeEmail.toLowerCase())
        );
      }
      return sendJson(res, 200, {
        status: "success",
        data: filtered,
      });
    }

    // POST /v2/bookings
    if (path === "/v2/bookings" && method === "POST") {
      try {
        const body = await parseBody(req);
        const { start, eventTypeId, attendee, metadata } = body;
        if (!start || !eventTypeId || !attendee || !attendee.email) {
          return sendJson(res, 400, {
            status: "error",
            message: "Missing required fields: start, eventTypeId, attendee.email",
          });
        }

        const et = eventTypes.find((e) => e.id === Number(eventTypeId)) || eventTypes[0];
        const startDate = new Date(start);
        const endDate = new Date(startDate.getTime() + (et.length || 30) * 60 * 1000);
        const uid = `bkg_${crypto.randomBytes(8).toString("hex")}`;

        const newBooking = {
          id: nextBookingId++,
          uid,
          title: et.title,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          status: "accepted",
          eventTypeId: et.id,
          attendees: [
            {
              name: attendee.name || "Attendee",
              email: attendee.email,
              timeZone: attendee.timeZone || TIMEZONE,
            },
          ],
          hosts: [{ id: 1, name: OWNER_NAME, email: OWNER_EMAIL }],
          location: `https://cal.diy/video/${uid}`,
          meetingUrl: `https://cal.diy/video/${uid}`,
          metadata: metadata || {},
          createdAt: new Date().toISOString(),
        };

        bookings.push(newBooking);
        return sendJson(res, 201, {
          status: "success",
          data: newBooking,
        });
      } catch (err) {
        return sendJson(res, 400, { status: "error", message: err.message });
      }
    }

    // Matches /v2/bookings/:uid, /v2/bookings/:uid/reschedule, /v2/bookings/:uid/cancel
    const bookingMatch = path.match(/^\/v2\/bookings\/([^/]+)(\/(reschedule|cancel))?$/);
    if (bookingMatch) {
      const uid = bookingMatch[1];
      const action = bookingMatch[3];

      const booking = bookings.find((b) => b.uid === uid);
      if (!booking) {
        return sendJson(res, 404, {
          status: "error",
          message: `Booking with uid '${uid}' not found`,
        });
      }

      if (!action && method === "GET") {
        return sendJson(res, 200, {
          status: "success",
          data: booking,
        });
      }

      if (action === "reschedule" && method === "POST") {
        try {
          const body = await parseBody(req);
          if (!body.start) {
            return sendJson(res, 400, { status: "error", message: "start is required" });
          }
          const dur = new Date(booking.end).getTime() - new Date(booking.start).getTime();
          const newStart = new Date(body.start);
          const newEnd = new Date(newStart.getTime() + dur);
          booking.start = newStart.toISOString();
          booking.end = newEnd.toISOString();
          if (body.reschedulingReason) {
            booking.metadata = { ...booking.metadata, reschedulingReason: body.reschedulingReason };
          }
          return sendJson(res, 200, {
            status: "success",
            data: booking,
          });
        } catch (err) {
          return sendJson(res, 400, { status: "error", message: err.message });
        }
      }

      if (action === "cancel" && method === "POST") {
        booking.status = "cancelled";
        return sendJson(res, 200, {
          status: "success",
          data: booking,
        });
      }
    }

    return sendJson(res, 404, { status: "error", message: `Not found: ${path}` });
  }

  sendJson(res, 404, { status: "error", message: "Not found" });
}

// Start server on API_PORT
const apiServer = http.createServer(requestHandler);
apiServer.listen(API_PORT, "0.0.0.0", () => {
  console.log(`Cal.diy API running on http://0.0.0.0:${API_PORT}`);
});

// Also start on WEB_PORT (3000) if different
if (WEB_PORT !== API_PORT) {
  const webServer = http.createServer(requestHandler);
  webServer.listen(WEB_PORT, "0.0.0.0", () => {
    console.log(`Cal.diy Web UI running on http://0.0.0.0:${WEB_PORT}`);
  });
}
