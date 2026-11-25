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
"use strict";

const http = require("http");

const UPSTREAM = "https://api.mail.tm";
const PORT = parseInt(process.env.PORT, 10) || 10000;
const HOST = "0.0.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Movmail-Address",
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

  if (!isAllowed(req.method, url.pathname)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("error", () => sendJson(res, 500, { error: "request read failed" }));
  req.on("end", async () => {
    try {
      const body = chunks.length ? Buffer.concat(chunks) : null;
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
