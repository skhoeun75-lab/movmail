// movmail-proxy — tiny CORS proxy for the Mail.tm API.
// Native http + global fetch (Node 18+), plus the optional `pg`
// package for saving messages to PostgreSQL.
// Mail.tm does not send Access-Control-Allow-Origin, so browsers
// cannot call https://api.mail.tm directly. This service runs on
// Render (Singapore) and forwards requests server-side, adding CORS
// headers so the MovMail static site can use it.
//
// Saved messages: whenever the proxy forwards GET /messages (list)
// or GET /messages/:id (detail), it upserts the message into the
// `saved_messages` table — but ONLY when the DATABASE_URL env var is
// set. If the database is unreachable or DATABASE_URL is unset, the
// proxy keeps working exactly as before: the save is skipped, the
// error is logged, and the proxied request is never failed.
//
// ADMIN_TOKEN — REQUIRED ON RENDER: set the ADMIN_TOKEN env var on the
// Render movmail-proxy service (Dashboard → movmail-proxy →
// Environment → ADMIN_TOKEN = a long random secret, e.g. from
// `openssl rand -hex 32`). Every /api/admin/* endpoint requires the
// matching X-Admin-Token request header (timing-safe compare) and
// returns 401 without it. NEVER hardcode any token or password in
// this file or the repo — the parent agent must set ADMIN_TOKEN on
// Render before the admin panel can be used.
"use strict";

const http = require("http");
const crypto = require("crypto");

const UPSTREAM = "https://api.mail.tm";
const PORT = parseInt(process.env.PORT, 10) || 10000;
const HOST = "0.0.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Movmail-Address, X-Movmail-Gmail, X-Admin-Token",
};

/* ---------- Saved messages (Render PostgreSQL, optional) ---------- */

const CREATE_TABLE_SQL = [
  "CREATE TABLE IF NOT EXISTS saved_messages (",
  "  id TEXT PRIMARY KEY,",
  "  account_address TEXT NOT NULL,",
  "  sender_name TEXT,",
  "  sender_address TEXT,",
  "  subject TEXT,",
  "  intro TEXT,",
  "  text_body TEXT,",
  "  html_body TEXT,",
  "  received_at TIMESTAMPTZ,",
  "  raw JSONB,",
  "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  ")",
].join("\n");

// A list upsert must never wipe out bodies saved earlier by a detail
// fetch: bodies and `raw` only move forward (NULL never overwrites,
// and a list item's `raw` never replaces a detail's `raw`, which is
// the one that carries text/html).
const UPSERT_SQL = [
  "INSERT INTO saved_messages",
  "  (id, account_address, sender_name, sender_address, subject, intro,",
  "   text_body, html_body, received_at, raw)",
  "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)",
  "ON CONFLICT (id) DO UPDATE SET",
  "  account_address = EXCLUDED.account_address,",
  "  sender_name = COALESCE(EXCLUDED.sender_name, saved_messages.sender_name),",
  "  sender_address = COALESCE(EXCLUDED.sender_address, saved_messages.sender_address),",
  "  subject = COALESCE(EXCLUDED.subject, saved_messages.subject),",
  "  intro = COALESCE(EXCLUDED.intro, saved_messages.intro),",
  "  text_body = COALESCE(EXCLUDED.text_body, saved_messages.text_body),",
  "  html_body = COALESCE(EXCLUDED.html_body, saved_messages.html_body),",
  "  received_at = COALESCE(EXCLUDED.received_at, saved_messages.received_at),",
  "  raw = CASE",
  "    WHEN saved_messages.raw IS NULL THEN EXCLUDED.raw",
  "    WHEN (EXCLUDED.raw ->> 'text') IS NOT NULL THEN EXCLUDED.raw",
  "    ELSE saved_messages.raw",
  "  END",
].join("\n");

let dbPool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require("pg");
    dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Render Postgres requires SSL; its cert is not in the default
      // trust chain, so do not verify it.
      ssl: { rejectUnauthorized: false },
    });
    dbPool.on("error", (err) => {
      console.error("movmail-proxy: db pool error:", err.message);
    });
    dbPool
      .query(CREATE_TABLE_SQL)
      .then(() => console.log("movmail-proxy: saved_messages table ready"))
      .catch((err) =>
        console.error("movmail-proxy: cannot create saved_messages table:", err.message)
      );
  } catch (err) {
    console.error("movmail-proxy: pg not available, saving disabled:", err.message);
    dbPool = null;
  }
}

// The account address a request belongs to: prefer the
// X-Movmail-Address header the frontend sends, otherwise decode the
// `address` claim from the Mail.tm JWT (no extra dependency).
function addressFromRequest(req) {
  const h = req.headers["x-movmail-address"];
  if (typeof h === "string" && h.indexOf("@") !== -1) return h.trim().toLowerCase();
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return "";
  try {
    const payload = JSON.parse(
      Buffer.from(
        m[1].split(".")[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    );
    return typeof payload.address === "string" ? payload.address.toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

async function saveMessage(msg, address, detail) {
  if (!dbPool || !msg || !msg.id || !address) return;
  const textBody = detail ? detail.text || null : null;
  const htmlBody = detail
    ? Array.isArray(detail.html)
      ? detail.html.join("\n")
      : detail.html || null
    : null;
  try {
    await dbPool.query(UPSERT_SQL, [
      msg.id,
      address,
      (msg.from && msg.from.name) || null,
      (msg.from && msg.from.address) || null,
      msg.subject || null,
      msg.intro || null,
      textBody,
      htmlBody,
      msg.createdAt || null,
      JSON.stringify(detail || msg),
    ]);
  } catch (err) {
    // Saving must never break the proxied request: log and move on.
    console.error("movmail-proxy: save failed for", msg.id + ":", err.message);
  }
}

function rowToSaved(row) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);
  return {
    id: row.id,
    account_address: row.account_address,
    sender_name: row.sender_name,
    sender_address: row.sender_address,
    subject: row.subject,
    intro: row.intro,
    text_body: row.text_body,
    html_body: row.html_body,
    received_at: iso(row.received_at),
    raw: row.raw || null,
    created_at: iso(row.created_at),
  };
}

async function handleSavedList(req, res, url) {
  const address = (url.searchParams.get("address") || "").trim().toLowerCase();
  if (!address || address.indexOf("@") === -1) {
    sendJson(res, 400, { error: "address query param required" });
    return;
  }
  // No database configured yet: report an empty saved list rather
  // than an error, so the site keeps working.
  if (!dbPool) {
    sendJson(res, 200, []);
    return;
  }
  try {
    const r = await dbPool.query(
      "SELECT id, account_address, sender_name, sender_address, subject," +
        " intro, text_body, html_body, received_at, raw, created_at" +
        " FROM saved_messages WHERE account_address = $1" +
        " ORDER BY received_at DESC NULLS LAST, created_at DESC LIMIT 100",
      [address]
    );
    sendJson(res, 200, r.rows.map(rowToSaved));
  } catch (err) {
    console.error("movmail-proxy: /saved failed:", err.message);
    sendJson(res, 500, { error: "database unavailable" });
  }
}

async function handleSavedOne(req, res, url) {
  const id = decodeURIComponent(url.pathname.slice("/saved/".length));
  if (!dbPool) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  try {
    const r = await dbPool.query(
      "SELECT id, account_address, sender_name, sender_address, subject," +
        " intro, text_body, html_body, received_at, raw, created_at" +
        " FROM saved_messages WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!r.rows.length) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 200, rowToSaved(r.rows[0]));
  } catch (err) {
    console.error("movmail-proxy: /saved/:id failed:", err.message);
    sendJson(res, 500, { error: "database unavailable" });
  }
}

/* ======================================================================
   Accounts / admin API (users, redeem codes, receipts, security)
   ----------------------------------------------------------------------
   HONESTY LIMITS — what the server can and cannot prove:
   - `device` and `connection` are BROWSER-REPORTED (userAgent,
     navigator.connection). They are whatever the browser claims; an
     expert can spoof them. Treat them as hints, never as proof.
   - `ip`, `country`, `city` come from the SERVER: the real client IP
     from the x-forwarded-for header Render sets, plus a GeoIP lookup
     (ipapi.co, falling back to ip-api.com) done by this proxy. Those
     are real unless the user is behind a VPN/proxy themselves (then
     the IP is the VPN's exit IP).

   STORAGE: the same Postgres (DATABASE_URL) as saved_messages.
   TEST-ONLY FALLBACK: when DATABASE_URL is unset, or when the env var
   MOVMAIL_TEST_MEMORY=1 is set, this API uses a small in-memory store
   so every endpoint can be tested headlessly with no database. The
   Render deployment always has DATABASE_URL set, so it always uses
   Postgres; the memory store is never the default there and holds
   nothing across restarts.
   ====================================================================== */

const USE_MEMORY_STORE = !dbPool || process.env.MOVMAIL_TEST_MEMORY === "1";

const CREATE_API_TABLES_SQL = [
  [
    "CREATE TABLE IF NOT EXISTS users (",
    "  gmail TEXT PRIMARY KEY,",
    "  name TEXT,",
    "  country TEXT,",
    "  city TEXT,",
    "  ip TEXT,",
    "  device TEXT,",
    "  connection TEXT,",
    "  plan TEXT NOT NULL DEFAULT 'free',",
    "  blocked BOOLEAN NOT NULL DEFAULT false,",
    "  blocked_reason TEXT,",
    "  daily_uses INT NOT NULL DEFAULT 0,",
    "  redeemed_uses INT NOT NULL DEFAULT 0,",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    ")",
  ].join("\n"),
  [
    "CREATE TABLE IF NOT EXISTS redeem_codes (",
    "  code TEXT PRIMARY KEY,",
    "  amount_per_day INT NOT NULL,",
    "  status TEXT NOT NULL DEFAULT 'active',",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "  expires_at TIMESTAMPTZ,",
    "  used_by TEXT,",
    "  used_at TIMESTAMPTZ",
    ")",
  ].join("\n"),
  [
    "CREATE TABLE IF NOT EXISTS receipts (",
    "  id SERIAL PRIMARY KEY,",
    "  gmail TEXT NOT NULL,",
    "  plan TEXT NOT NULL,",
    "  method TEXT NOT NULL,",
    "  image_data_url TEXT,",
    "  status TEXT NOT NULL DEFAULT 'pending',",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),",
    "  decided_at TIMESTAMPTZ",
    ")",
  ].join("\n"),
  [
    "CREATE TABLE IF NOT EXISTS security_events (",
    "  id SERIAL PRIMARY KEY,",
    "  gmail TEXT,",
    "  type TEXT,",
    "  detail TEXT,",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    ")",
  ].join("\n"),
];

if (dbPool) {
  (async () => {
    for (const sql of CREATE_API_TABLES_SQL) {
      try {
        await dbPool.query(sql);
      } catch (err) {
        console.error("movmail-proxy: cannot create api table:", err.message);
      }
    }
    console.log("movmail-proxy: accounts/admin tables ready");
  })();
}

// Test-only in-memory store (see header comment). Never used on
// Render, where DATABASE_URL is always set.
const mem = {
  users: new Map(), // gmail -> user row
  codes: new Map(), // code -> code row
  receipts: [], // receipt rows
  events: [], // security event rows
  receiptSeq: 1,
  eventSeq: 1,
};

const toIso = (v) => (v instanceof Date ? v.toISOString() : v || null);

function userFromRow(r) {
  if (!r) return null;
  return {
    gmail: r.gmail,
    name: r.name,
    country: r.country,
    city: r.city,
    ip: r.ip,
    device: r.device,
    connection: r.connection,
    plan: r.plan,
    blocked: !!r.blocked,
    blocked_reason: r.blocked_reason,
    daily_uses: r.daily_uses,
    redeemed_uses: r.redeemed_uses,
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
    last_seen_at: toIso(r.last_seen_at),
  };
}

// A code's live status is derived: stored 'disabled' wins, then
// used, then expired (past expires_at), else active.
function derivedCodeStatus(r) {
  if (r.status === "disabled") return "disabled";
  if (r.used_by) return "used";
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return "expired";
  return "active";
}

function codeFromRow(r) {
  if (!r) return null;
  return {
    code: r.code,
    amountPerDay: r.amount_per_day,
    status: derivedCodeStatus(r),
    created_at: toIso(r.created_at),
    expiresAt: toIso(r.expires_at),
    usedBy: r.used_by,
    usedAt: toIso(r.used_at),
  };
}

function receiptFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    gmail: r.gmail,
    plan: r.plan,
    method: r.method,
    imageDataUrl: r.image_data_url,
    status: r.status,
    created_at: toIso(r.created_at),
    decided_at: toIso(r.decided_at),
  };
}

/* ---------- data layer (Postgres, or memory when testing) ---------- */

async function upsertUser(u) {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query(
      "INSERT INTO users (gmail, name, country, city, ip, device, connection, last_seen_at)" +
        " VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())" +
        " ON CONFLICT (gmail) DO UPDATE SET" +
        "  name = COALESCE(EXCLUDED.name, users.name)," +
        "  country = COALESCE(EXCLUDED.country, users.country)," +
        "  city = COALESCE(EXCLUDED.city, users.city)," +
        "  ip = COALESCE(EXCLUDED.ip, users.ip)," +
        "  device = COALESCE(EXCLUDED.device, users.device)," +
        "  connection = COALESCE(EXCLUDED.connection, users.connection)," +
        "  updated_at = NOW(), last_seen_at = NOW()" +
        " RETURNING *",
      [u.gmail, u.name || null, u.country || null, u.city || null, u.ip || null, u.device || null, u.connection || null]
    );
    return userFromRow(r.rows[0]);
  }
  const now = new Date().toISOString();
  const prev = mem.users.get(u.gmail);
  const row = prev
    ? { ...prev }
    : {
        gmail: u.gmail,
        plan: "free",
        blocked: false,
        blocked_reason: null,
        daily_uses: 0,
        redeemed_uses: 0,
        created_at: now,
      };
  if (u.name != null) row.name = u.name;
  if (u.country != null) row.country = u.country;
  if (u.city != null) row.city = u.city;
  if (u.ip != null) row.ip = u.ip;
  if (u.device != null) row.device = u.device;
  if (u.connection != null) row.connection = u.connection;
  row.updated_at = now;
  row.last_seen_at = now;
  mem.users.set(u.gmail, row);
  return userFromRow(row);
}

async function getUser(gmail) {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query("SELECT * FROM users WHERE gmail = $1", [gmail]);
    return userFromRow(r.rows[0] || null);
  }
  return userFromRow(mem.users.get(gmail) || null);
}

async function listUsersWithRisk() {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query(
      "SELECT u.*, EXISTS (SELECT 1 FROM security_events e WHERE e.gmail = u.gmail) AS has_events" +
        " FROM users u ORDER BY u.created_at DESC"
    );
    return r.rows.map((row) => ({ ...userFromRow(row), risk: !!row.has_events }));
  }
  return [...mem.users.values()]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map((row) => ({ ...userFromRow(row), risk: mem.events.some((e) => e.gmail === row.gmail) }));
}

async function setBlocked(gmail, blocked, reason) {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query(
      "UPDATE users SET blocked = $2, blocked_reason = $3, updated_at = NOW()" +
        " WHERE gmail = $1 RETURNING *",
      [gmail, !!blocked, reason || null]
    );
    return userFromRow(r.rows[0] || null);
  }
  const row = mem.users.get(gmail);
  if (!row) return null;
  row.blocked = !!blocked;
  row.blocked_reason = reason || null;
  row.updated_at = new Date().toISOString();
  return userFromRow(row);
}

// 8 chars, mixed letters+digits, unambiguous charset (no 0/O/1/l).
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
function generateCode() {
  for (;;) {
    const bytes = crypto.randomBytes(8);
    let code = "";
    for (const b of bytes) code += CODE_CHARSET[b % CODE_CHARSET.length];
    if (/[A-Za-z]/.test(code) && /[0-9]/.test(code)) return code;
  }
}

async function createCode(amountPerDay, expiresAt) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    if (!USE_MEMORY_STORE) {
      try {
        const r = await dbPool.query(
          "INSERT INTO redeem_codes (code, amount_per_day, status, expires_at)" +
            " VALUES ($1,$2,'active',$3) RETURNING *",
          [code, amountPerDay, expiresAt || null]
        );
        return codeFromRow(r.rows[0]);
      } catch (err) {
        if (err && err.code === "23505") continue; // rare collision: retry
        throw err;
      }
    }
    if (mem.codes.has(code)) continue;
    const row = {
      code,
      amount_per_day: amountPerDay,
      status: "active",
      created_at: new Date().toISOString(),
      expires_at: expiresAt || null,
      used_by: null,
      used_at: null,
    };
    mem.codes.set(code, row);
    return codeFromRow(row);
  }
  throw new Error("could not generate a unique code");
}

async function listCodes() {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query("SELECT * FROM redeem_codes ORDER BY created_at DESC");
    return r.rows.map(codeFromRow);
  }
  return [...mem.codes.values()]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map(codeFromRow);
}

async function setCodeStatus(code, status) {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query(
      "UPDATE redeem_codes SET status = $2 WHERE code = $1 RETURNING *",
      [code, status]
    );
    return codeFromRow(r.rows[0] || null);
  }
  const row = mem.codes.get(code);
  if (!row) return null;
  row.status = status;
  return codeFromRow(row);
}

// One use per code, ever. Returns {ok, amountPerDay} or {error}.
async function redeemCode(gmail, code) {
  if (!USE_MEMORY_STORE) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const codeRes = await client.query("SELECT * FROM redeem_codes WHERE code = $1 FOR UPDATE", [code]);
      const crow = codeRes.rows[0];
      if (!crow) {
        await client.query("ROLLBACK");
        return { error: "code not found" };
      }
      const st = derivedCodeStatus(crow);
      if (st !== "active") {
        await client.query("ROLLBACK");
        return { error: "code is " + st };
      }
      const userRes = await client.query("SELECT * FROM users WHERE gmail = $1 FOR UPDATE", [gmail]);
      if (!userRes.rows.length) {
        await client.query("ROLLBACK");
        return { error: "unknown account" };
      }
      await client.query(
        "UPDATE redeem_codes SET status = 'used', used_by = $2, used_at = NOW() WHERE code = $1",
        [code, gmail]
      );
      await client.query(
        "UPDATE users SET redeemed_uses = redeemed_uses + $2, updated_at = NOW() WHERE gmail = $1",
        [gmail, crow.amount_per_day]
      );
      await client.query("COMMIT");
      return { ok: true, amountPerDay: crow.amount_per_day };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }
  const crow = mem.codes.get(code);
  if (!crow) return { error: "code not found" };
  const st = derivedCodeStatus(crow);
  if (st !== "active") return { error: "code is " + st };
  const user = mem.users.get(gmail);
  if (!user) return { error: "unknown account" };
  crow.status = "used";
  crow.used_by = gmail;
  crow.used_at = new Date().toISOString();
  user.redeemed_uses = (user.redeemed_uses || 0) + crow.amount_per_day;
  return { ok: true, amountPerDay: crow.amount_per_day };
}

async function createReceipt(gmail, plan, method, imageDataUrl) {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query(
      "INSERT INTO receipts (gmail, plan, method, image_data_url, status)" +
        " VALUES ($1,$2,$3,$4,'pending') RETURNING *",
      [gmail, plan, method, imageDataUrl || null]
    );
    return receiptFromRow(r.rows[0]);
  }
  const row = {
    id: mem.receiptSeq++,
    gmail,
    plan,
    method,
    image_data_url: imageDataUrl || null,
    status: "pending",
    created_at: new Date().toISOString(),
    decided_at: null,
  };
  mem.receipts.push(row);
  return receiptFromRow(row);
}

async function listReceipts() {
  if (!USE_MEMORY_STORE) {
    const r = await dbPool.query("SELECT * FROM receipts ORDER BY created_at DESC");
    return r.rows.map(receiptFromRow);
  }
  return [...mem.receipts]
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
    .map(receiptFromRow);
}

function planFromReceipt(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "monthly" || p === "pro-monthly") return "pro-monthly";
  if (p === "yearly" || p === "pro-yearly") return "pro-yearly";
  return null;
}

async function decideReceipt(id, approve) {
  if (!USE_MEMORY_STORE) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT * FROM receipts WHERE id = $1 FOR UPDATE", [id]);
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const status = approve ? "approved" : "rejected";
      await client.query("UPDATE receipts SET status = $2, decided_at = NOW() WHERE id = $1", [id, status]);
      if (approve) {
        const plan = planFromReceipt(row.plan);
        if (plan) {
          await client.query("UPDATE users SET plan = $2, updated_at = NOW() WHERE gmail = $1", [row.gmail, plan]);
        }
      }
      await client.query("COMMIT");
      const done = await dbPool.query("SELECT * FROM receipts WHERE id = $1", [id]);
      return receiptFromRow(done.rows[0]);
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }
  const row = mem.receipts.find((x) => x.id === id);
  if (!row) return null;
  row.status = approve ? "approved" : "rejected";
  row.decided_at = new Date().toISOString();
  if (approve) {
    const plan = planFromReceipt(row.plan);
    const user = mem.users.get(row.gmail);
    if (plan && user) user.plan = plan;
  }
  return receiptFromRow(row);
}

async function logSecurityEvent(gmail, type, detail) {
  if (!USE_MEMORY_STORE) {
    await dbPool.query(
      "INSERT INTO security_events (gmail, type, detail) VALUES ($1,$2,$3)",
      [gmail || null, type || null, detail || null]
    );
    return;
  }
  mem.events.push({
    id: mem.eventSeq++,
    gmail: gmail || null,
    type: type || null,
    detail: detail || null,
    created_at: new Date().toISOString(),
  });
}

/* ---------- helpers: admin auth, body reading, GeoIP ---------- */

function requireAdmin(req, res) {
  const token = process.env.ADMIN_TOKEN || "";
  const supplied = String(req.headers["x-admin-token"] || "");
  if (!token) {
    sendJson(res, 401, { error: "admin token not configured" });
    return false;
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

// Reads a JSON body with a size cap. Returns the parsed object, or
// null after already sending the error response.
function readJsonBody(req, res, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) tooBig = true;
      else chunks.push(c);
    });
    req.on("error", () => resolve(null));
    req.on("end", () => {
      if (tooBig) {
        sendJson(res, 413, { error: "body too large" });
        resolve(null);
        return;
      }
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (_) {
        sendJson(res, 400, { error: "invalid JSON" });
        resolve(null);
      }
    });
  });
}

// Real client IP: first entry of x-forwarded-for (set by Render),
// falling back to the socket address.
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  const ra = req.socket && req.socket.remoteAddress;
  return ra || "";
}

// GeoIP, cached in memory ~1h per IP. Private/loopback IPs are never
// looked up. Tries ipapi.co first, then ip-api.com as a fallback
// (ipapi.co's free tier is per egress IP and shared Render IPs can
// hit its rate limit). Any failure returns null and the caller keeps
// the client-sent country/city.
const GEO_CACHE_TTL_MS = 60 * 60 * 1000;
const geoCache = new Map(); // ip -> { at, country, city }
async function geoLookupOne(url, parse) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    return parse(j);
  } catch (_) {
    return null;
  }
}
async function geoLookup(ip) {
  if (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)
  ) {
    return null;
  }
  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.at < GEO_CACHE_TTL_MS) return cached;
  let out =
    (await geoLookupOne("https://ipapi.co/" + encodeURIComponent(ip) + "/json/", (j) => {
      if (!j || j.error) return null;
      return { country: j.country_name || j.country || null, city: j.city || null };
    })) ||
    (await geoLookupOne("http://ip-api.com/json/" + encodeURIComponent(ip) + "?fields=status,country,city", (j) => {
      if (!j || j.status !== "success") return null;
      return { country: j.country || null, city: j.city || null };
    }));
  if (!out) return null;
  geoCache.set(ip, { at: Date.now(), ...out });
  return out;
}

/* ---------- API handlers ---------- */

async function handleApiAccountsUpsert(req, res) {
  const body = await readJsonBody(req, res, 64 * 1024);
  if (!body) return;
  const gmail = String(body.gmail || "").trim().toLowerCase();
  if (!gmail || gmail.indexOf("@") === -1) {
    sendJson(res, 400, { error: "gmail required" });
    return;
  }
  const ip = clientIp(req);
  const geo = await geoLookup(ip);
  const user = await upsertUser({
    gmail,
    name: body.name ? String(body.name) : null,
    // Server GeoIP wins; client-sent values are only a fallback.
    country: (geo && geo.country) || (body.country ? String(body.country) : null),
    city: (geo && geo.city) || (body.city ? String(body.city) : null),
    ip: ip || null,
    // device/connection are browser-reported and can be spoofed.
    device: body.device ? String(body.device) : null,
    connection: body.connection ? String(body.connection) : null,
  });
  sendJson(res, 200, user);
}

async function handleApiAccountsMe(req, res, url) {
  const gmail = (url.searchParams.get("gmail") || "").trim().toLowerCase();
  if (!gmail) {
    sendJson(res, 400, { error: "gmail query param required" });
    return;
  }
  const u = await getUser(gmail);
  if (!u) {
    sendJson(res, 404, { error: "unknown account" });
    return;
  }
  sendJson(res, 200, {
    gmail: u.gmail,
    name: u.name,
    plan: u.plan,
    blocked: u.blocked,
    daily_uses: u.daily_uses,
    redeemed_uses: u.redeemed_uses,
    country: u.country,
    city: u.city,
  });
}

async function handleApiBlocked(req, res, url) {
  const gmail = (url.searchParams.get("gmail") || "").trim().toLowerCase();
  if (!gmail) {
    sendJson(res, 400, { error: "gmail query param required" });
    return;
  }
  const u = await getUser(gmail);
  if (!u || !u.blocked) {
    sendJson(res, 200, { blocked: false });
    return;
  }
  sendJson(res, 200, { blocked: true, reason: u.blocked_reason || undefined });
}

async function handleApiRedeem(req, res) {
  const body = await readJsonBody(req, res, 64 * 1024);
  if (!body) return;
  const gmail = String(body.gmail || "").trim().toLowerCase();
  const code = String(body.code || "").trim();
  if (!gmail || !code) {
    sendJson(res, 400, { error: "gmail and code required" });
    return;
  }
  const result = await redeemCode(gmail, code);
  if (result.error) {
    sendJson(res, 400, { error: result.error });
    return;
  }
  sendJson(res, 200, { ok: true, amountPerDay: result.amountPerDay });
}

const RECEIPT_IMAGE_MAX_CHARS = 5 * 1024 * 1024; // ~5MB data URL

async function handleApiReceiptsCreate(req, res) {
  const body = await readJsonBody(req, res, 6 * 1024 * 1024);
  if (!body) return;
  const gmail = String(body.gmail || "").trim().toLowerCase();
  const plan = String(body.plan || "").trim();
  const method = String(body.method || "").trim();
  const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!gmail || !plan || !method) {
    sendJson(res, 400, { error: "gmail, plan and method required" });
    return;
  }
  if (imageDataUrl.length > RECEIPT_IMAGE_MAX_CHARS) {
    sendJson(res, 413, { error: "receipt image too large (max ~5MB)" });
    return;
  }
  const receipt = await createReceipt(gmail, plan, method, imageDataUrl);
  sendJson(res, 200, { ok: true, id: receipt.id });
}

async function handleApiSecurityEvent(req, res) {
  const body = await readJsonBody(req, res, 64 * 1024);
  if (!body) return;
  const type = String(body.type || "").trim();
  if (!type) {
    sendJson(res, 400, { error: "type required" });
    return;
  }
  await logSecurityEvent(
    body.gmail ? String(body.gmail).trim().toLowerCase() : null,
    type,
    body.detail ? String(body.detail) : null
  );
  sendJson(res, 200, { ok: true });
}

async function handleAdminUsers(req, res) {
  const users = await listUsersWithRisk();
  sendJson(res, 200, users);
}

async function handleAdminBlock(req, res) {
  const body = await readJsonBody(req, res, 64 * 1024);
  if (!body) return;
  const gmail = String(body.gmail || "").trim().toLowerCase();
  if (!gmail || typeof body.blocked === "undefined") {
    sendJson(res, 400, { error: "gmail and blocked required" });
    return;
  }
  const user = await setBlocked(gmail, body.blocked === true, body.reason ? String(body.reason) : null);
  if (!user) {
    sendJson(res, 404, { error: "unknown account" });
    return;
  }
  sendJson(res, 200, user);
}

async function handleAdminCodesCreate(req, res) {
  const body = await readJsonBody(req, res, 64 * 1024);
  if (!body) return;
  const amountPerDay = Number(body.amountPerDay);
  if (!Number.isInteger(amountPerDay) || amountPerDay < 10 || amountPerDay > 100) {
    sendJson(res, 400, { error: "amountPerDay must be an integer between 10 and 100" });
    return;
  }
  let expiresAt = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) {
      sendJson(res, 400, { error: "expiresAt must be a valid date" });
      return;
    }
    expiresAt = d.toISOString();
  }
  const code = await createCode(amountPerDay, expiresAt);
  sendJson(res, 200, {
    code: code.code,
    amountPerDay: code.amountPerDay,
    expiresAt: code.expiresAt,
    status: code.status,
  });
}

async function handleAdminCodesList(req, res) {
  sendJson(res, 200, await listCodes());
}

async function handleAdminCodeToggle(req, res, code, action) {
  const row = await setCodeStatus(code, action === "disable" ? "disabled" : "active");
  if (!row) {
    sendJson(res, 404, { error: "code not found" });
    return;
  }
  sendJson(res, 200, row);
}

async function handleAdminReceiptsList(req, res) {
  sendJson(res, 200, await listReceipts());
}

async function handleAdminReceiptDecide(req, res, id, action) {
  const receipt = await decideReceipt(Number(id), action === "approve");
  if (!receipt) {
    sendJson(res, 404, { error: "receipt not found" });
    return;
  }
  sendJson(res, 200, receipt);
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  try {
    if (req.method === "POST" && p === "/api/accounts/upsert") return handleApiAccountsUpsert(req, res);
    if (req.method === "GET" && p === "/api/accounts/me") return handleApiAccountsMe(req, res, url);
    if (req.method === "GET" && p === "/api/blocked") return handleApiBlocked(req, res, url);
    if (req.method === "POST" && p === "/api/redeem") return handleApiRedeem(req, res);
    if (req.method === "POST" && p === "/api/receipts") return handleApiReceiptsCreate(req, res);
    if (req.method === "POST" && p === "/api/security/event") return handleApiSecurityEvent(req, res);
    if (p.startsWith("/api/admin/")) {
      if (!requireAdmin(req, res)) return;
      if (req.method === "GET" && p === "/api/admin/users") return handleAdminUsers(req, res);
      if (req.method === "POST" && p === "/api/admin/block") return handleAdminBlock(req, res);
      if (req.method === "POST" && p === "/api/admin/codes") return handleAdminCodesCreate(req, res);
      if (req.method === "GET" && p === "/api/admin/codes") return handleAdminCodesList(req, res);
      const mCode = /^\/api\/admin\/codes\/([^/]+)\/(disable|activate)$/.exec(p);
      if (req.method === "POST" && mCode) return handleAdminCodeToggle(req, res, mCode[1], mCode[2]);
      if (req.method === "GET" && p === "/api/admin/receipts") return handleAdminReceiptsList(req, res);
      const mRec = /^\/api\/admin\/receipts\/(\d+)\/(approve|reject)$/.exec(p);
      if (req.method === "POST" && mRec) return handleAdminReceiptDecide(req, res, mRec[1], mRec[2]);
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    console.error("movmail-proxy: api failed:", err.message);
    sendJson(res, 500, { error: "internal error" });
  }
}

/* ---------- GET /domains cache (5 minutes) ----------
   The domain list almost never changes, but the site asks for it on
   every account creation. Cache successful upstream answers in
   memory so repeated lookups do not hit Mail.tm at all. Only
   successful (2xx) answers are cached; failures are never cached. */
const DOMAINS_CACHE_TTL_MS = 5 * 60 * 1000;
let domainsCache = { at: 0, data: null };

/* ---------- HTTP plumbing ---------- */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function isAllowed(method, pathname) {
  if (method === "GET" && pathname === "/domains") return true;
  if (method === "POST" && pathname === "/accounts") return true;
  if (method === "POST" && pathname === "/token") return true;
  if (method === "GET" && pathname === "/messages") return true;
  if (method === "GET" && /^\/messages\/[^/]+$/.test(pathname)) return true;
  if ((method === "GET" || method === "DELETE") && /^\/accounts\/[^/]+$/.test(pathname)) return true;
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, { ok: true, service: "movmail-proxy" });
    return;
  }

  // Saved messages (served locally from Postgres, not proxied)
  if (req.method === "GET" && url.pathname === "/saved") {
    handleSavedList(req, res, url);
    return;
  }
  if (req.method === "GET" && /^\/saved\/[^/]+$/.test(url.pathname)) {
    handleSavedOne(req, res, url);
    return;
  }

  // Accounts / admin API (served locally, not proxied)
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }

  if (!isAllowed(req.method, url.pathname)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  // GET /domains: serve from the 5-minute cache when it is fresh,
  // without touching Mail.tm at all.
  const isDomains = req.method === "GET" && url.pathname === "/domains";
  if (isDomains && domainsCache.data !== null && Date.now() - domainsCache.at < DOMAINS_CACHE_TTL_MS) {
    sendJson(res, 200, domainsCache.data);
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("error", () => sendJson(res, 500, { error: "request read failed" }));
  req.on("end", async () => {
    try {
      const body = chunks.length ? Buffer.concat(chunks) : null;

      // Blocked accounts may not create Mail.tm accounts: the site
      // sends its signed-in gmail in the body or X-Movmail-Gmail.
      if (req.method === "POST" && url.pathname === "/accounts") {
        let gmailCandidate = "";
        try {
          const parsed = body && body.length ? JSON.parse(body.toString("utf8")) : {};
          gmailCandidate = String(
            parsed.gmail || parsed.address || req.headers["x-movmail-gmail"] || ""
          )
            .trim()
            .toLowerCase();
        } catch (_) {}
        if (gmailCandidate) {
          let blockedUser = null;
          try {
            blockedUser = await getUser(gmailCandidate);
          } catch (_) {}
          if (blockedUser && blockedUser.blocked) {
            sendJson(res, 403, {
              error: "account blocked",
              reason: blockedUser.blocked_reason || "This account has been blocked by the administrator.",
            });
            return;
          }
        }
      }

      const headers = { Accept: "application/json" };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      if (body && body.length) headers["Content-Type"] = "application/json";

      const upstreamRes = await fetch(UPSTREAM + url.pathname + url.search, {
        method: req.method,
        headers,
        body: body && body.length ? body : undefined,
      });

      const text = await upstreamRes.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }

      if (data !== null) {
        sendJson(res, upstreamRes.status, data);
      } else {
        res.writeHead(upstreamRes.status, {
          ...CORS_HEADERS,
          "Content-Type": "text/plain",
          "Content-Length": Buffer.byteLength(text),
        });
        res.end(text);
      }

      // Cache successful /domains answers for 5 minutes.
      if (isDomains && data !== null && upstreamRes.status >= 200 && upstreamRes.status < 300) {
        domainsCache = { at: Date.now(), data };
      }

      // Auto-save (fire-and-forget, never delays or fails the reply):
      // only on a successful upstream response.
      if (data !== null && upstreamRes.status >= 200 && upstreamRes.status < 300) {
        const address = addressFromRequest(req);
        if (req.method === "GET" && url.pathname === "/messages") {
          const list = Array.isArray(data)
            ? data
            : data && Array.isArray(data["hydra:member"])
              ? data["hydra:member"]
              : [];
          list.forEach((m) => {
            saveMessage(m, address, null);
          });
        } else if (req.method === "GET" && /^\/messages\/[^/]+$/.test(url.pathname)) {
          saveMessage(data, address, data);
        }
      }
    } catch (err) {
      sendJson(res, 502, { error: "upstream failed", detail: String((err && err.message) || err) });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("movmail-proxy listening on " + HOST + ":" + PORT);
});
