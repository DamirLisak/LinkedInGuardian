#!/usr/bin/env node
/* ============================================================
   LinkedInGuardian — local CORS proxy for the LinkedIn API
   ------------------------------------------------------------
   Solves the hard problem: api.linkedin.com sends NO CORS
   headers, so browsers can never call it directly. This proxy
   runs on your machine, injects your token server-side, and
   adds the CORS headers the browser needs.

   Usage:
     1. Put your token in the LI_TOKEN env var (or edit TOKEN below)
     2. node proxy.js
     3. In LinkedInGuardian Settings:
          - LinkedIn data source: "CORS proxy"
          - Proxy base URL:       http://localhost:8787
        (leave the LinkedIn token field EMPTY — the proxy injects it)
   ============================================================ */
"use strict";

const http = require("http");

const PORT = process.env.PORT || 8787;
const TOKEN = process.env.LI_TOKEN || "PASTE_YOUR_TOKEN_HERE";

const CORS = {
  "Access-Control-Allow-Origin": "*", // tighten to your site origin if exposed publicly
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const type = url.searchParams.get("type") || "member";
  const slug = url.searchParams.get("slug") || "";

  const headers = {
    "Authorization": `Bearer ${TOKEN}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "LinkedIn-Version": "202401",
  };

  let endpoint;
  if (type === "company") {
    endpoint =
      `https://api.linkedin.com/v2/organizations?q=vanityName&vanityName=${encodeURIComponent(slug)}`;
  } else {
    // Member: the API only exposes the TOKEN OWNER's profile.
    // Try legacy /v2/me first, then the OIDC /v2/userinfo.
    endpoint = "https://api.linkedin.com/v2/me?projection=(id,firstName,lastName,headline,vanityName)";
  }

  try {
    let r = await fetch(endpoint, { headers });
    let body = await r.text();

    if (!r.ok && type !== "company") {
      // fallback to OIDC userinfo
      const r2 = await fetch("https://api.linkedin.com/v2/userinfo", { headers });
      body = JSON.stringify({ me_error: r.status, userinfo: await r2.json() });
      r = r2;
    }

    res.writeHead(r.status, { ...CORS, "Content-Type": "application/json" });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(PORT, () => {
  console.log(`LinkedInGuardian proxy listening on http://localhost:${PORT}`);
  console.log(`Token ${TOKEN.startsWith("AQ") ? "loaded from env" : "NOT configured — set LI_TOKEN"}`);
});
