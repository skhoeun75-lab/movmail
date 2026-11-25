// movmail-proxy — tiny CORS proxy for the Mail.tm API.
// No dependencies: native http + global fetch (Node 18+).
// Mail.tm does not send Access-Control-Allow-Origin, so browsers
// cannot call https://api.mail.tm directly. This service runs on
// Render (Singapore) and forwards requests server-side, adding CORS
// headers so the MovMail static site can use it.
"use strict";

const http = require("http");

const UPSTREAM = "https://api.mail.tm";
const PORT = parseInt(process.env.PORT, 10) || 10000;
const HOST = "0.0.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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
    } catch (err) {
      sendJson(res, 502, { error: "upstream failed", detail: String((err && err.message) || err) });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log("movmail-proxy listening on " + HOST + ":" + PORT);
});
