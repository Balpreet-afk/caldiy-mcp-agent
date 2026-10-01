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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, cal-api-version, Idempotency-Key",
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
  const initialBookingsJson = JSON.stringify(bookings).replace(/</g, '\\u003c');
  const initialEventTypesJson = JSON.stringify(eventTypes).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cal.diy — Scheduling Dashboard</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
      --primary: #0f172a;
      --primary-hover: #1e293b;
      --accent: #2563eb;
      --success: #10b981;
      --success-bg: #ecfdf5;
      --danger: #ef4444;
      --danger-bg: #fef2f2;
      --warning: #f59e0b;
      --warning-bg: #fffbeb;
      --radius: 12px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font); }
    body { background: var(--bg); color: var(--text); padding-bottom: 60px; line-height: 1.5; }

    /* Toast container */
    #toast-container {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 360px;
    }
    .toast {
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      color: white;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      animation: slideIn 0.25s ease-out;
    }
    .toast.success { background: #059669; }
    .toast.error { background: #dc2626; }
    .toast.info { background: #2563eb; }
    @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }

    /* Header */
    header {
      background: white;
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .nav-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-mark {
      background: #0f172a;
      color: white;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 18px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
      letter-spacing: -0.5px;
    }
    .live-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      color: #166534;
    }
    .live-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 2px rgba(34,197,94,0.3);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.9); }
    }

    .user-profile {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #e2e8f0;
      color: #334155;
      font-size: 13px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-meta {
      font-size: 13px;
      line-height: 1.2;
      text-align: right;
    }
    .user-name { font-weight: 600; color: var(--text); }
    .user-tz { font-size: 12px; color: var(--text-muted); }

    /* Main Container */
    .container { max-width: 1200px; margin: 32px auto; padding: 0 24px; }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .stat-label { font-size: 13px; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 30px; font-weight: 700; color: var(--text); line-height: 1; }
    .stat-subtext { font-size: 12px; color: var(--text-muted); }

    /* Section Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      margin-bottom: 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .card-title { font-size: 18px; font-weight: 700; color: var(--text); display: flex; align-items: center; gap: 8px; }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-primary { background: var(--primary); color: white; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-outline { background: white; border-color: var(--border); color: var(--text); }
    .btn-outline:hover { background: #f1f5f9; border-color: #cbd5e1; }
    .btn-danger { background: var(--danger-bg); border-color: #fecaca; color: #b91c1c; }
    .btn-danger:hover { background: #fee2e2; }
    .btn-action {
      padding: 6px 12px;
      font-size: 12px;
      border-radius: 6px;
      font-weight: 500;
    }
    .btn-reschedule {
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }
    .btn-reschedule:hover { background: #dbeafe; }
    .btn-cancel {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .btn-cancel:hover { background: #fef3c7; }
    .btn-delete {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .btn-delete:hover { background: #fee2e2; }

    /* Filter & Search Bar */
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .search-input {
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 13px;
      min-width: 260px;
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); ring: 2px rgba(37,99,235,0.2); }
    .filter-tabs {
      display: flex;
      gap: 4px;
      background: #f1f5f9;
      padding: 4px;
      border-radius: 8px;
    }
    .tab-btn {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      border: none;
      background: none;
      cursor: pointer;
      transition: all 0.15s;
    }
    .tab-btn.active { background: white; color: var(--text); box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

    /* Bookings Table */
    .table-responsive {
      width: 100%;
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
      background: #fafafa;
    }
    td {
      padding: 14px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fcfcfc; }

    .uid-badge {
      font-family: monospace;
      font-size: 11px;
      background: #f1f5f9;
      color: #475569;
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-block;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .status-accepted { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .status-cancelled { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }

    .priority-badge {
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .prio-LOW { background: #f1f5f9; color: #475569; }
    .prio-NORMAL { background: #eff6ff; color: #1d4ed8; }
    .prio-HIGH { background: #fffbeb; color: #b45309; }
    .prio-CRITICAL { background: #fef2f2; color: #b91c1c; }

    .actions-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Event Types Grid */
    .event-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .event-box {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 18px;
      transition: all 0.15s ease;
      background: white;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .event-box:hover { border-color: var(--accent); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .event-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
    .event-name { font-weight: 700; font-size: 15px; color: var(--text); }
    .event-pill { font-size: 11px; background: #eff6ff; color: #1d4ed8; padding: 2px 8px; border-radius: 9999px; font-weight: 600; }
    .event-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 16px; }

    /* Developer Box */
    .dev-box {
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      word-break: break-all;
      gap: 16px;
    }
    .copy-btn {
      background: #334155;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
    }
    .copy-btn:hover { background: #475569; }

    /* Modals */
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(2px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-backdrop.open { display: flex; }
    .modal-content {
      background: white;
      border-radius: 12px;
      width: 100%;
      max-width: 520px;
      box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04);
      padding: 24px;
      position: relative;
      animation: modalSlide 0.2s ease-out;
    }
    @keyframes modalSlide { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .modal-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
    .modal-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 20px; }
    .form-group { margin-bottom: 16px; }
    .form-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
    .form-input, .form-select {
      width: 100%;
      padding: 9px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      outline: none;
    }
    .form-input:focus, .form-select:focus { border-color: var(--accent); }
    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .empty-state {
      padding: 48px 16px;
      text-align: center;
      color: var(--text-muted);
    }
    .empty-state p { font-size: 14px; margin-top: 4px; }
  </style>
</head>
<body>

  <!-- Toast Notification Container -->
  <div id="toast-container"></div>

  <!-- Header Navigation -->
  <header>
    <div class="nav-inner">
      <div class="brand-group">
        <div class="logo-mark">C</div>
        <div>
          <div class="brand-title">Cal.diy</div>
        </div>
        <div class="live-status">
          <span class="live-dot"></span>
          <span>Online (Port 3000 & 5555)</span>
        </div>
      </div>
      <div class="user-profile">
        <button class="btn btn-primary" onclick="openNewBookingModal()">+ Book Meeting</button>
        <div class="avatar">BP</div>
        <div class="user-meta">
          <div class="user-name">${OWNER_NAME}</div>
          <div class="user-tz">${TIMEZONE}</div>
        </div>
      </div>
    </div>
  </header>

  <div class="container">

    <!-- Stats Bar -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Meetings</div>
        <div class="stat-value" id="stat-total">0</div>
        <div class="stat-subtext">All time in-memory bookings</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Confirmed Active</div>
        <div class="stat-value" id="stat-active" style="color: #059669;">0</div>
        <div class="stat-subtext">Accepted and scheduled</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cancelled</div>
        <div class="stat-value" id="stat-cancelled" style="color: #b91c1c;">0</div>
        <div class="stat-subtext">Displaced or cancelled meetings</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Event Types</div>
        <div class="stat-value" id="stat-events">${eventTypes.length}</div>
        <div class="stat-subtext">Bookable public slots</div>
      </div>
    </div>

    <!-- Scheduled Bookings Section -->
    <div class="card">
      <div class="card-header">
        <div>
          <div class="card-title">
            <span>Scheduled Meetings</span>
          </div>
          <p style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">
            Manage existing calendar bookings. Reschedule to new slots or remove completely from the server.
          </p>
        </div>
        <button class="btn btn-outline" onclick="loadBookings()">↻ Refresh</button>
      </div>

      <!-- Filter and Search Toolbar -->
      <div class="toolbar">
        <input type="text" id="search-input" class="search-input" placeholder="Search by title, attendee, email, or UID..." oninput="filterBookings()">
        <div class="filter-tabs">
          <button class="tab-btn active" id="tab-all" onclick="setTab('all')">All (<span id="count-all">0</span>)</button>
          <button class="tab-btn" id="tab-accepted" onclick="setTab('accepted')">Accepted (<span id="count-accepted">0</span>)</button>
          <button class="tab-btn" id="tab-cancelled" onclick="setTab('cancelled')">Cancelled (<span id="count-cancelled">0</span>)</button>
        </div>
      </div>

      <!-- Bookings Table -->
      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Meeting</th>
              <th>Date & Time</th>
              <th>Attendee</th>
              <th>Priority</th>
              <th>Status</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody id="bookings-tbody">
            <!-- Rendered dynamically -->
          </tbody>
        </table>
        <div id="empty-state" class="empty-state" style="display: none;">
          <div style="font-size: 24px; margin-bottom: 8px;">📅</div>
          <strong>No meetings found</strong>
          <p>Create a new booking or clear your filter.</p>
        </div>
      </div>
    </div>

    <!-- Active Event Types -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Active Event Types</div>
        <span style="font-size: 13px; color: var(--text-muted);">Configured booking lengths and endpoints</span>
      </div>
      <div class="event-grid">
        ${eventTypes.map(e => `
          <div class="event-box">
            <div>
              <div class="event-head">
                <div class="event-name">${e.title}</div>
                <span class="event-pill">${e.length} min</span>
              </div>
              <p class="event-desc">${e.description}</p>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">
              <code style="font-size: 12px; color: var(--text-muted);">/${e.slug}</code>
              <button class="btn btn-outline btn-action" onclick="openNewBookingModal(${e.id})">Book This</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Developer API Key & Docs -->
    <div class="card">
      <div class="card-header">
        <div class="card-title">Developer Authentication & MCP Config</div>
        <a href="/docs" target="_blank" class="btn btn-outline btn-action">View API Docs</a>
      </div>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
        Use this API Key with the Cal.diy MCP server (<code>caldiy-scheduling-mcp</code>) or external callers.
      </p>
      <div class="dev-box">
        <span id="api-key-text">${API_KEY}</span>
        <button class="copy-btn" onclick="copyApiKey()">Copy Key</button>
      </div>
    </div>

  </div>

  <!-- Reschedule Modal -->
  <div class="modal-backdrop" id="reschedule-modal">
    <div class="modal-content">
      <div class="modal-title">Reschedule Meeting</div>
      <div class="modal-sub" id="reschedule-sub">Update date and time for this booking</div>

      <input type="hidden" id="reschedule-uid">
      <div class="form-group">
        <label class="form-label">Current Meeting Time</label>
        <div id="reschedule-current-time" style="font-size: 13px; color: var(--text-muted); padding: 8px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid var(--border);"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="reschedule-new-start">New Date & Start Time</label>
        <input type="datetime-local" id="reschedule-new-start" class="form-input" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="reschedule-reason">Reason (Optional)</label>
        <input type="text" id="reschedule-reason" class="form-input" placeholder="e.g. Schedule conflict or attendee request">
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal('reschedule-modal')">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-reschedule" onclick="submitReschedule()">Confirm Reschedule</button>
      </div>
    </div>
  </div>

  <!-- Remove / Delete Confirmation Modal -->
  <div class="modal-backdrop" id="delete-modal">
    <div class="modal-content">
      <div class="modal-title" style="color: var(--danger);">Remove Meeting Record</div>
      <div class="modal-sub">Are you sure you want to permanently remove this booking?</div>

      <input type="hidden" id="delete-uid">
      <p style="font-size: 13px; color: #475569; margin-bottom: 16px; background: #fef2f2; padding: 12px; border-radius: 6px; border: 1px solid #fecaca;">
        This will delete the booking completely from the Cal.diy server. This action cannot be undone.
      </p>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal('delete-modal')">Keep Booking</button>
        <button class="btn btn-danger" id="btn-confirm-delete" onclick="submitDelete()">Yes, Remove Meeting</button>
      </div>
    </div>
  </div>

  <!-- Cancel Confirmation Modal -->
  <div class="modal-backdrop" id="cancel-modal">
    <div class="modal-content">
      <div class="modal-title" style="color: #b45309;">Cancel Meeting</div>
      <div class="modal-sub">Mark this meeting as cancelled without deleting the record</div>

      <input type="hidden" id="cancel-uid">
      <div class="form-group">
        <label class="form-label" for="cancel-reason">Cancellation Reason (Optional)</label>
        <input type="text" id="cancel-reason" class="form-input" placeholder="e.g. Displaced by priority meeting">
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal('cancel-modal')">Close</button>
        <button class="btn btn-cancel" id="btn-confirm-cancel" onclick="submitCancel()">Confirm Cancellation</button>
      </div>
    </div>
  </div>

  <!-- New Booking Modal -->
  <div class="modal-backdrop" id="new-booking-modal">
    <div class="modal-content">
      <div class="modal-title">Schedule New Meeting</div>
      <div class="modal-sub">Create a new test or actual booking on Cal.diy</div>

      <div class="form-group">
        <label class="form-label" for="new-booking-type">Event Type</label>
        <select id="new-booking-type" class="form-select">
          ${eventTypes.map(e => `<option value="${e.id}">${e.title} (${e.length} min)</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="new-attendee-name">Attendee Name</label>
        <input type="text" id="new-attendee-name" class="form-input" placeholder="e.g. Alice Dev" value="Test Guest">
      </div>

      <div class="form-group">
        <label class="form-label" for="new-attendee-email">Attendee Email</label>
        <input type="email" id="new-attendee-email" class="form-input" placeholder="e.g. guest@example.com" value="guest@example.com" required>
      </div>

      <div class="form-group">
        <label class="form-label" for="new-start-time">Date & Time</label>
        <input type="datetime-local" id="new-start-time" class="form-input" required>
      </div>

      <div class="form-group">
        <label class="form-label" for="new-priority">Priority</label>
        <select id="new-priority" class="form-select">
          <option value="LOW">LOW</option>
          <option value="NORMAL" selected>NORMAL</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal('new-booking-modal')">Cancel</button>
        <button class="btn btn-primary" id="btn-confirm-create" onclick="submitNewBooking()">Create Booking</button>
      </div>
    </div>
  </div>

  <script>
    const API_KEY = "${API_KEY}";
    let allBookings = ${initialBookingsJson};
    let currentTab = 'all';

    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.innerHTML = '<span>' + message + '</span>';
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    function copyApiKey() {
      const key = document.getElementById('api-key-text').innerText.trim();
      navigator.clipboard.writeText(key).then(() => {
        showToast('API Key copied to clipboard!', 'info');
      }).catch(() => {
        showToast('Failed to copy API key', 'error');
      });
    }

    function closeModal(modalId) {
      document.getElementById(modalId).classList.remove('open');
    }

    function openModal(modalId) {
      document.getElementById(modalId).classList.add('open');
    }

    function setTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      filterBookings();
    }

    function toDatetimeLocal(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      const pad = (n) => String(n).padStart(2, '0');
      return \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}T\${pad(d.getHours())}:\${pad(d.getMinutes())}\`;
    }

    function formatDate(isoStr) {
      if (!isoStr) return '-';
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }) + ' at ' + d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit'
      });
    }

    async function apiRequest(endpoint, method = 'GET', body = null) {
      const options = {
        method,
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json'
        }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      const res = await fetch(endpoint, options);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Request failed with status ' + res.status);
      }
      return data;
    }

    async function loadBookings() {
      try {
        const res = await apiRequest('/v2/bookings');
        allBookings = res.data || [];
        filterBookings();
        updateStats();
        showToast('Bookings synced', 'info');
      } catch (err) {
        showToast('Failed to load bookings: ' + err.message, 'error');
      }
    }

    function updateStats() {
      const total = allBookings.length;
      const accepted = allBookings.filter(b => b.status === 'accepted').length;
      const cancelled = allBookings.filter(b => b.status === 'cancelled').length;

      document.getElementById('stat-total').innerText = total;
      document.getElementById('stat-active').innerText = accepted;
      document.getElementById('stat-cancelled').innerText = cancelled;

      document.getElementById('count-all').innerText = total;
      document.getElementById('count-accepted').innerText = accepted;
      document.getElementById('count-cancelled').innerText = cancelled;
    }

    function filterBookings() {
      const q = (document.getElementById('search-input').value || '').toLowerCase().trim();
      let filtered = allBookings.filter(b => {
        if (currentTab === 'accepted' && b.status !== 'accepted') return false;
        if (currentTab === 'cancelled' && b.status !== 'cancelled') return false;
        if (!q) return true;
        const attendee = b.attendees && b.attendees[0] ? (b.attendees[0].name + ' ' + b.attendees[0].email).toLowerCase() : '';
        const title = (b.title || '').toLowerCase();
        const uid = (b.uid || '').toLowerCase();
        return attendee.includes(q) || title.includes(q) || uid.includes(q);
      });

      renderTable(filtered);
    }

    function renderTable(list) {
      const tbody = document.getElementById('bookings-tbody');
      const emptyState = document.getElementById('empty-state');

      if (!list || list.length === 0) {
        tbody.innerHTML = '';
        emptyState.style.display = 'block';
        return;
      }

      emptyState.style.display = 'none';
      tbody.innerHTML = list.map(b => {
        const attendee = (b.attendees && b.attendees[0]) || { name: 'Unknown', email: '-' };
        const prio = (b.metadata && b.metadata.priority) || 'NORMAL';
        const isCancelled = b.status === 'cancelled';

        return \`
          <tr id="row-\${b.uid}">
            <td>
              <div style="font-weight: 600; color: var(--text);">\${escapeHtml(b.title || 'Untitled Meeting')}</div>
              <div style="margin-top: 4px;"><span class="uid-badge">\${escapeHtml(b.uid)}</span></div>
            </td>
            <td>
              <div style="font-weight: 500;">\${formatDate(b.start)}</div>
              <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">to \${formatDate(b.end).split(' at ')[1] || ''}</div>
            </td>
            <td>
              <div style="font-weight: 600;">\${escapeHtml(attendee.name || 'Attendee')}</div>
              <div style="font-size: 12px; color: var(--text-muted);">\${escapeHtml(attendee.email || '')}</div>
            </td>
            <td>
              <span class="priority-badge prio-\${prio}">\${prio}</span>
            </td>
            <td>
              <span class="status-badge status-\${b.status}">\${b.status}</span>
            </td>
            <td>
              <div class="actions-cell" style="justify-content: flex-end;">
                <button class="btn btn-action btn-reschedule" title="Reschedule meeting to another slot" onclick="promptReschedule('\${b.uid}')">
                  🗓️ Reschedule
                </button>
                \${!isCancelled ? \`
                  <button class="btn btn-action btn-cancel" title="Cancel meeting" onclick="promptCancel('\${b.uid}')">
                    🚫 Cancel
                  </button>
                \` : ''}
                <button class="btn btn-action btn-delete" title="Permanently remove booking" onclick="promptDelete('\${b.uid}')">
                  🗑️ Remove
                </button>
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* Actions */
    function promptReschedule(uid) {
      const b = allBookings.find(x => x.uid === uid);
      if (!b) return;

      document.getElementById('reschedule-uid').value = b.uid;
      document.getElementById('reschedule-sub').innerText = 'Reschedule "' + b.title + '" with ' + (b.attendees[0]?.name || 'attendee');
      document.getElementById('reschedule-current-time').innerText = formatDate(b.start) + ' (Duration: ' + (new Date(b.end) - new Date(b.start))/(60*1000) + ' mins)';
      document.getElementById('reschedule-new-start').value = toDatetimeLocal(b.start);
      document.getElementById('reschedule-reason').value = '';
      openModal('reschedule-modal');
    }

    async function submitReschedule() {
      const uid = document.getElementById('reschedule-uid').value;
      const newStartVal = document.getElementById('reschedule-new-start').value;
      const reason = document.getElementById('reschedule-reason').value.trim();
      const btn = document.getElementById('btn-confirm-reschedule');

      if (!newStartVal) {
        showToast('Please select a valid new date and time', 'error');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Rescheduling...';

      try {
        const payload = {
          start: new Date(newStartVal).toISOString(),
          reschedulingReason: reason || undefined
        };
        const res = await apiRequest('/v2/bookings/' + encodeURIComponent(uid) + '/reschedule', 'POST', payload);
        
        const idx = allBookings.findIndex(b => b.uid === uid);
        if (idx !== -1) {
          allBookings[idx] = res.data;
        }
        filterBookings();
        updateStats();
        closeModal('reschedule-modal');
        showToast('Meeting rescheduled successfully!', 'success');
      } catch (err) {
        showToast('Failed to reschedule: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm Reschedule';
      }
    }

    function promptCancel(uid) {
      document.getElementById('cancel-uid').value = uid;
      document.getElementById('cancel-reason').value = '';
      openModal('cancel-modal');
    }

    async function submitCancel() {
      const uid = document.getElementById('cancel-uid').value;
      const reason = document.getElementById('cancel-reason').value.trim();
      const btn = document.getElementById('btn-confirm-cancel');

      btn.disabled = true;
      btn.innerText = 'Cancelling...';

      try {
        const res = await apiRequest('/v2/bookings/' + encodeURIComponent(uid) + '/cancel', 'POST', {
          cancellationReason: reason || undefined
        });

        const idx = allBookings.findIndex(b => b.uid === uid);
        if (idx !== -1) {
          allBookings[idx] = res.data;
        }
        filterBookings();
        updateStats();
        closeModal('cancel-modal');
        showToast('Meeting marked as cancelled', 'info');
      } catch (err) {
        showToast('Failed to cancel: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm Cancellation';
      }
    }

    function promptDelete(uid) {
      document.getElementById('delete-uid').value = uid;
      openModal('delete-modal');
    }

    async function submitDelete() {
      const uid = document.getElementById('delete-uid').value;
      const btn = document.getElementById('btn-confirm-delete');

      btn.disabled = true;
      btn.innerText = 'Removing...';

      try {
        await apiRequest('/v2/bookings/' + encodeURIComponent(uid), 'DELETE');
        allBookings = allBookings.filter(b => b.uid !== uid);
        filterBookings();
        updateStats();
        closeModal('delete-modal');
        showToast('Meeting removed from server', 'success');
      } catch (err) {
        showToast('Failed to remove meeting: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Yes, Remove Meeting';
      }
    }

    function openNewBookingModal(eventTypeId) {
      if (eventTypeId) {
        document.getElementById('new-booking-type').value = eventTypeId;
      }
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      tomorrow.setHours(10, 0, 0, 0);
      document.getElementById('new-start-time').value = toDatetimeLocal(tomorrow.toISOString());
      openModal('new-booking-modal');
    }

    async function submitNewBooking() {
      const eventTypeId = parseInt(document.getElementById('new-booking-type').value, 10);
      const name = document.getElementById('new-attendee-name').value.trim();
      const email = document.getElementById('new-attendee-email').value.trim();
      const startTime = document.getElementById('new-start-time').value;
      const priority = document.getElementById('new-priority').value;
      const btn = document.getElementById('btn-confirm-create');

      if (!email || !startTime) {
        showToast('Please provide an email and start time', 'error');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Creating...';

      try {
        const payload = {
          eventTypeId,
          start: new Date(startTime).toISOString(),
          attendee: {
            name: name || 'Guest',
            email: email,
            timeZone: '${TIMEZONE}'
          },
          metadata: {
            priority
          }
        };

        const res = await apiRequest('/v2/bookings', 'POST', payload);
        allBookings.push(res.data);
        filterBookings();
        updateStats();
        closeModal('new-booking-modal');
        showToast('New meeting created successfully!', 'success');
      } catch (err) {
        showToast('Failed to create meeting: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Create Booking';
      }
    }

    // Initialize on load
    updateStats();
    filterBookings();
  </script>
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization, cal-api-version, Idempotency-Key",
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
        <body style="font-family: sans-serif; padding: 24px; line-height: 1.6;">
          <h1>Cal.diy API v2</h1>
          <p>Status: Healthy</p>
          <p>Auth Header: <code>Authorization: Bearer ${API_KEY}</code></p>
          <h3>Available Endpoints:</h3>
          <ul>
            <li><code>GET /v2/event-types</code> — List event types</li>
            <li><code>GET /v2/slots</code> — Available time slots</li>
            <li><code>GET /v2/bookings</code> — List scheduled bookings</li>
            <li><code>GET /v2/bookings/:uid</code> — Get single booking by UID</li>
            <li><code>POST /v2/bookings</code> — Create a new booking</li>
            <li><code>POST /v2/bookings/:uid/reschedule</code> — Reschedule booking</li>
            <li><code>PATCH /v2/bookings/:uid/reschedule</code> — Reschedule booking</li>
            <li><code>POST /v2/bookings/:uid/cancel</code> — Cancel booking</li>
            <li><code>DELETE /v2/bookings/:uid</code> — Permanently remove/delete booking</li>
            <li><code>GET /v2/me</code> — Current user information</li>
            <li><code>GET /v2/schedules</code> — Working hours schedule</li>
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
      if (parsed.query.status) {
        filtered = filtered.filter((b) => b.status === parsed.query.status);
      }
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
      const uid = decodeURIComponent(bookingMatch[1]);
      const action = bookingMatch[3];

      const bookingIndex = bookings.findIndex((b) => b.uid === uid);
      if (bookingIndex === -1) {
        return sendJson(res, 404, {
          status: "error",
          message: `Booking with uid '${uid}' not found`,
        });
      }
      const booking = bookings[bookingIndex];

      if (!action && method === "GET") {
        return sendJson(res, 200, {
          status: "success",
          data: booking,
        });
      }

      // DELETE /v2/bookings/:uid - Remove meeting completely
      if (!action && method === "DELETE") {
        bookings.splice(bookingIndex, 1);
        return sendJson(res, 200, {
          status: "success",
          message: `Booking '${uid}' removed successfully`,
          data: { uid },
        });
      }

      // POST or PATCH /v2/bookings/:uid/reschedule
      if (action === "reschedule" && (method === "POST" || method === "PATCH")) {
        try {
          const body = await parseBody(req);
          if (!body.start) {
            return sendJson(res, 400, { status: "error", message: "start is required" });
          }
          const dur = new Date(booking.end).getTime() - new Date(booking.start).getTime();
          const newStart = new Date(body.start);
          const newEnd = new Date(newStart.getTime() + (dur > 0 ? dur : 30 * 60 * 1000));
          booking.start = newStart.toISOString();
          booking.end = newEnd.toISOString();
          if (booking.status === "cancelled") {
            booking.status = "accepted";
          }
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

      // POST or DELETE /v2/bookings/:uid/cancel
      if (action === "cancel" && (method === "POST" || method === "DELETE")) {
        try {
          const body = await parseBody(req).catch(() => ({}));
          booking.status = "cancelled";
          if (body && body.cancellationReason) {
            booking.metadata = { ...booking.metadata, cancellationReason: body.cancellationReason };
          }
          return sendJson(res, 200, {
            status: "success",
            data: booking,
          });
        } catch (err) {
          return sendJson(res, 400, { status: "error", message: err.message });
        }
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

