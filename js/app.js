/* ============================================================
   LinkedInGuardian — app.js
   100% client-side. No build step, no backend, no tracking.
   ============================================================ */
"use strict";

/* ------------------------------------------------------------
   Tiny DOM helpers
------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function showToast(msg, ms = 2600) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.hidden = true; }, ms);
}

/* ------------------------------------------------------------
   Cookie settings store (with optional AES-GCM encryption)
------------------------------------------------------------ */
const COOKIE_NAME = "lg_settings";
const COOKIE_DAYS = 180;

const Settings = {
  data: {
    provider: "openrouter",
    customEndpoint: "",
    apiKey: "",
    model: "",
    liMode: "public",          // public | token | proxy
    liToken: "",
    liProxy: "",
    saveHistory: true,
    strictMode: false,
    encrypted: false,
    history: []                // [{url, name, score, ts}]
  },

  load() {
    const raw = readCookie(COOKIE_NAME);
    if (!raw) return;
    try {
      let json = raw;
      if (raw.startsWith("enc:")) {
        // Encrypted payload — needs the master password (entered on demand).
        this._pendingEncrypted = raw.slice(4);
        return;
      }
      Object.assign(this.data, JSON.parse(json));
    } catch { /* corrupt cookie — ignore */ }
  },

  /** Try to decrypt an encrypted cookie with the given password. */
  async unlock(password) {
    if (!this._pendingEncrypted) return true;
    try {
      const json = await Crypto.decrypt(this._pendingEncrypted, password);
      Object.assign(this.data, JSON.parse(json));
      this._pendingEncrypted = null;
      this._password = password;
      return true;
    } catch {
      return false;
    }
  },

  isLocked() { return !!this._pendingEncrypted; },

  hasKey() { return !!this.data.apiKey; },

  async save() {
    let payload = JSON.stringify(this.data);
    if (this.data.encrypted && this._password) {
      payload = "enc:" + await Crypto.encrypt(payload, this._password);
    }
    setCookie(COOKIE_NAME, payload, COOKIE_DAYS);
  },

  clear() {
    document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Lax`;
    this.data = JSON.parse(JSON.stringify({
      provider: "openrouter", customEndpoint: "", apiKey: "", model: "",
      liMode: "public", liToken: "", liProxy: "",
      saveHistory: true, strictMode: false, encrypted: false, history: []
    }));
    this._pendingEncrypted = null;
    this._password = null;
  },

  addHistory(entry) {
    if (!this.data.saveHistory) return;
    this.data.history = [entry, ...this.data.history.filter(h => h.url !== entry.url)].slice(0, 10);
    this.save();
  }
};

function setCookie(name, value, days) {
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}
function readCookie(name) {
  const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

/* ------------------------------------------------------------
   Web Crypto helpers (AES-GCM, PBKDF2 key derivation)
------------------------------------------------------------ */
const Crypto = {
  async deriveKey(password, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
    );
  },
  async encrypt(plain, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `${b64(salt)}.${b64(iv)}.${b64(ct)}`;
  },
  async decrypt(payload, password) {
    const [s, i, c] = payload.split(".");
    const b64d = (str) => Uint8Array.from(atob(str), (ch) => ch.charCodeAt(0));
    const key = await this.deriveKey(password, b64d(s));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(i) }, key, b64d(c));
    return new TextDecoder().decode(pt);
  }
};

/* ------------------------------------------------------------
   Provider registry — all OpenAI-compatible + native adapters
------------------------------------------------------------ */
const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    defaultModel: "openai/gpt-4o-mini",
    headers: (key) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-Title": "LinkedInGuardian"
    })
  },
  openai: {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
    defaultModel: "gpt-4o-mini",
    headers: (key) => ({ "Authorization": `Bearer ${key}`, "Content-Type": "application/json" })
  },
  anthropic: {
    label: "Anthropic",
    endpoint: "https://api.anthropic.com/v1/messages",
    modelsEndpoint: null,
    defaultModel: "claude-sonnet-4-20250514",
    headers: (key) => ({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "Content-Type": "application/json"
    }),
    native: true
  },
  gemini: {
    label: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    modelsEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.0-flash",
    headers: (_key) => ({ "Content-Type": "application/json" }),
    native: "gemini"
  },
  custom: {
    label: "Custom OpenAI-compatible",
    endpoint: "", // from settings.customEndpoint
    modelsEndpoint: null,
    defaultModel: "local-model",
    headers: (key) => ({
      "Content-Type": "application/json",
      ...(key ? { "Authorization": `Bearer ${key}` } : {})
    })
  }
};

function providerEndpoint(p) {
  const def = PROVIDERS[p];
  if (p === "custom") {
    let base = (Settings.data.customEndpoint || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("Custom endpoint URL is not configured in Settings.");
    if (!/\/v\d+/.test(base)) base += "/v1";
    return { chat: base + "/chat/completions", models: base + "/models" };
  }
  return { chat: def.endpoint, models: def.modelsEndpoint };
}

/* ------------------------------------------------------------
   LLM client — unified chat() across providers
------------------------------------------------------------ */
const LLM = {
  async chat(system, user, { maxTokens = 4000, temperature = 0.2 } = {}) {
    const p = Settings.data.provider;
    const def = PROVIDERS[p];
    const key = Settings.data.apiKey;
    const model = Settings.data.model || def.defaultModel;
    const urls = providerEndpoint(p);

    if (def.native === "gemini") {
      return this._gemini(urls.chat, key, model, system, user, maxTokens, temperature);
    }
    if (def.native === true) {
      return this._anthropic(urls.chat, key, model, system, user, maxTokens, temperature);
    }
    return this._openaiCompatible(urls.chat, def.headers(key), model, system, user, maxTokens, temperature);
  },

  async _openaiCompatible(url, headers, model, system, user, maxTokens, temperature) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    // Reasoning models (vLLM, DeepSeek, GLM …) may put the answer in content
    // and the thinking in reasoning_content/reasoning — or, if the token
    // budget was consumed by thinking, leave content empty entirely.
    let content = (msg?.content || "").trim();
    if (!content) content = (msg?.reasoning_content || msg?.reasoning || "").trim();
    if (!content) {
      const finish = data.choices?.[0]?.finish_reason || "unknown";
      throw new Error(
        `The model returned an empty response (finish_reason: ${finish}). ` +
        (finish === "length"
          ? "The max-token budget was likely consumed by the model's reasoning — try a higher limit or a non-reasoning model."
          : "Try again or choose another model in Settings.")
      );
    }
    return content;
  },

  async _anthropic(url, key, model, system, user, maxTokens, temperature) {
    const res = await fetch(url, {
      method: "POST",
      headers: PROVIDERS.anthropic.headers(key),
      body: JSON.stringify({
        model, max_tokens: maxTokens, temperature, system,
        messages: [{ role: "user", content: user }]
      })
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const text = (data.content || []).map((b) => b.text || "").join("");
    if (!text) throw new Error("Anthropic returned an empty response.");
    return text;
  },

  async _gemini(base, key, model, system, user, maxTokens, temperature) {
    const url = `${base}/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json"
        }
      })
    });
    if (!res.ok) throw await httpError(res);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
    if (!text) throw new Error("Gemini returned an empty response.");
    return text;
  }
};

async function httpError(res) {
  let detail = "";
  try {
    const j = await res.json();
    detail = j.error?.message || j.message || JSON.stringify(j).slice(0, 200);
  } catch { detail = res.statusText; }
  const hint = res.status === 401 || res.status === 403
    ? " — check your API key in Settings"
    : res.status === 429 ? " — rate limit reached, try again shortly" : "";
  return new Error(`API error ${res.status}${hint}: ${detail}`);
}

/* ------------------------------------------------------------
   LinkedIn URL parsing
------------------------------------------------------------ */
function parseLinkedInUrl(input) {
  const out = { valid: false, type: null, slug: null, canonical: null, error: null };
  let url;
  try { url = new URL(input.trim()); } catch { out.error = "This is not a valid URL."; return out; }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!/(^|\.)linkedin\.com$/.test(host)) {
    out.error = "Please enter a URL on linkedin.com.";
    return out;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "in" && parts[1]) {
    out.type = "member";
    out.slug = decodeURIComponent(parts[1]).replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
  } else if (parts[0] === "company" && parts[1]) {
    out.type = "company";
    out.slug = decodeURIComponent(parts[1]);
  } else if (parts[0] === "school" && parts[1]) {
    out.type = "company";
    out.slug = decodeURIComponent(parts[1]);
  } else {
    out.error = "Unsupported LinkedIn URL. Use a member URL (/in/…) or a company URL (/company/…).";
    return out;
  }

  out.valid = true;
  out.canonical = out.type === "member"
    ? `https://www.linkedin.com/in/${encodeURIComponent(out.slug)}/`
    : `https://www.linkedin.com/company/${encodeURIComponent(out.slug)}/`;
  return out;
}

/* ------------------------------------------------------------
   LinkedIn data fetching (3 modes)
------------------------------------------------------------ */
const LinkedInData = {
  /**
   * Returns { source, text, note } — text is fed to the LLM.
   */
  async fetch(parsed, onNote) {
    const mode = Settings.data.liMode;

    if (mode === "token" && Settings.data.liToken) {
      try {
        return await this.viaToken(parsed, onNote);
      } catch (e) {
        onNote(`LinkedIn API request failed (${e.message}) — falling back to public research mode.`);
      }
    }
    if (mode === "proxy" && Settings.data.liProxy) {
      try {
        return await this.viaProxy(parsed, onNote);
      } catch (e) {
        onNote(`Proxy request failed (${e.message}) — falling back to public research mode.`);
      }
    }
    return this.viaPublicResearch(parsed, onNote);
  },

  /** Official LinkedIn API via a user-supplied OAuth token (may fail due to CORS/scopes). */
  async viaToken(parsed, onNote) {
    onNote("Calling LinkedIn API with your access token…");
    const token = Settings.data.liToken;
    const base = "https://api.linkedin.com/v2";
    const headers = { "Authorization": `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" };

    let text = "";
    if (parsed.type === "member") {
      // /me requires the r_liteprofile scope on the token owner — for third parties
      // we can only try the public profile lookup, which often 403s. We still try.
      const res = await fetch(`${base}/me?projection=(id,firstName,lastName,headline,vanityName)`, { headers });
      if (!res.ok) throw await httpError(res);
      const me = await res.json();
      text += `LinkedIn API /me response:\n${JSON.stringify(me, null, 2)}\n`;
    } else {
      const res = await fetch(`${base}/organizations/${encodeURIComponent(parsed.slug)}`, { headers });
      if (!res.ok) throw await httpError(res);
      const org = await res.json();
      text += `LinkedIn API organization response:\n${JSON.stringify(org, null, 2)}\n`;
    }
    return { source: "LinkedIn API (token)", text, note: "Data retrieved via LinkedIn API token." };
  },

  /** User-hosted CORS proxy that injects credentials server-side. */
  async viaProxy(parsed, onNote) {
    onNote("Fetching profile data through your proxy…");
    const base = Settings.data.liProxy.replace(/\/+$/, "");
    const res = await fetch(`${base}?type=${parsed.type}&slug=${encodeURIComponent(parsed.slug)}`);
    if (!res.ok) throw await httpError(res);
    const body = await res.text();
    return {
      source: "CORS proxy",
      text: `Data from user proxy for ${parsed.canonical}:\n${body.slice(0, 12000)}`,
      note: "Data retrieved via CORS proxy."
    };
  },

  /**
   * Default: no LinkedIn credentials. We hand the URL to the LLM provider and let
   * the model research public information about the profile/company.
   */
  async viaPublicResearch(parsed, onNote) {
    onNote("No LinkedIn credentials — the AI will research public information about this URL.");
    return {
      source: "Public research (AI)",
      text: null, // signals the prompt to use its research capability
      note: "Public-research mode: the assessment is based on what the AI model knows/finds about this public profile."
    };
  }
};

/* ------------------------------------------------------------
   Analysis prompt
------------------------------------------------------------ */
const SYSTEM_PROMPT = `You are LinkedInGuardian, a meticulous fraud-and-credibility analyst for LinkedIn profiles.
Your task: assess how trustworthy a LinkedIn member or company is, with special focus on
business-opportunity scammers — people who promise massive revenue growth, guaranteed M&A deals,
or "get rich" outcomes, then sell expensive consulting that leaves clients financially harmed.

You MUST respond with a single JSON object and nothing else, matching exactly this schema:
{
  "subject": { "name": string, "headline": string, "type": "member"|"company" },
  "score": number,              // integer 1-10 trustworthiness
  "confidence": number,         // 0-100, how confident you are in this assessment
  "verdict": string,            // 2-4 sentence plain-language verdict
  "red_flags": string[],        // concrete scam/risk indicators found (may be empty)
  "green_flags": string[],      // credibility indicators found (may be empty)
  "evidence": string[],         // specific quotes/observations the score is based on
  "signals": {                  // each 0-100, higher = more trustworthy
    "claims_verifiability": number,
    "posting_behavior": number,
    "engagement_authenticity": number,
    "language_patterns": number,
    "professional_consistency": number
  }
}

Scoring guide: 1-2 strong scam indicators; 3-4 multiple red flags, high caution; 5-6 mixed signals,
verify all claims; 7-8 mostly credible with minor gaps; 9-10 consistent, verifiable professional presence.
Be skeptical of: unverifiable income/ROI claims, urgency pressure, vague "proprietary methods",
stock-photo-like engagement, recycled testimonial language, mismatched career history, pay-to-play offers.
Be fair: do not penalize legitimate marketing language, non-native English, or modest profiles.
If you have little or no reliable information about the subject, say so in the verdict,
lower the confidence, and score near 5 rather than guessing.`;

function buildUserPrompt(parsed, data, strict) {
  const target = parsed.type === "member"
    ? `LinkedIn MEMBER profile: ${parsed.canonical} (vanity name: "${parsed.slug}")`
    : `LinkedIn COMPANY page: ${parsed.canonical} (vanity name: "${parsed.slug}")`;

  const dataBlock = data.text
    ? `=== DATA RETRIEVED (${data.source}) ===\n${data.text.slice(0, 14000)}\n=== END DATA ===`
    : `=== DATA RETRIEVED ===\nNo direct API data available. Use your knowledge and any public information
you can recall about this exact profile URL and vanity name. If you cannot find reliable information,
state that clearly, set confidence low (<= 35) and score near 5. Do NOT invent facts, quotes or evidence.
=== END DATA ===`;

  return `Analyze this LinkedIn target for trustworthiness and scam risk.

TARGET: ${target}
${strict ? "MODE: STRICT — the user asked for extra skepticism. Weight possible red flags more heavily." : ""}

${dataBlock}

Respond with ONLY the JSON object described in the system prompt.`;
}

/* ------------------------------------------------------------
   JSON extraction (models sometimes wrap JSON in prose/fences)
------------------------------------------------------------ */
function extractJson(text) {
  // Strip reasoning traces some models emit inline.
  text = String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("The AI response did not contain JSON.");
  return JSON.parse(text.slice(start, end + 1));
}

/* ------------------------------------------------------------
   Result rendering
------------------------------------------------------------ */
const SCORE_LABELS = [
  [1, "High risk — strong scam indicators", "var(--red)"],
  [3, "Multiple red flags — high caution", "var(--red)"],
  [5, "Mixed signals — verify all claims", "var(--amber)"],
  [7, "Mostly credible — minor gaps", "#3d8f37"],
  [9, "Consistent & verifiable presence", "var(--green)"]
];

function scoreMeta(score) {
  for (const [min, label, color] of SCORE_LABELS) if (score <= min + 1) return { label, color };
  return SCORE_LABELS.at(-1);
}

const SIGNAL_NAMES = {
  claims_verifiability: "Claims verifiability",
  posting_behavior: "Posting behavior",
  engagement_authenticity: "Engagement authenticity",
  language_patterns: "Language patterns",
  professional_consistency: "Professional consistency"
};

function renderResult(r, parsed, meta) {
  // gauge
  const fill = $("gaugeFill");
  const offset = 251.3 * (1 - r.score / 10);
  fill.style.strokeDashoffset = offset;
  fill.style.stroke = scoreMeta(r.score).color;

  $("scoreValue").textContent = r.score;
  $("scoreValue").style.color = scoreMeta(r.score).color;
  $("scoreLabel").textContent = scoreMeta(r.score).label;

  const conf = Math.max(0, Math.min(100, Math.round(r.confidence ?? 0)));
  $("confidenceFill").style.width = conf + "%";
  $("confidenceValue").textContent = conf + "%";

  // subject
  const box = $("subjectBox");
  box.hidden = false;
  $("subjectName").textContent = r.subject?.name || parsed.slug;
  $("subjectMeta").textContent =
    (r.subject?.headline ? r.subject.headline + " · " : "") +
    (parsed.type === "member" ? "LinkedIn member" : "LinkedIn company") +
    ` · analyzed ${new Date().toLocaleString()}`;
  $("subjectLink").href = parsed.canonical;

  // verdict + flags
  $("verdictText").textContent = r.verdict || "No verdict returned.";
  fillList($("redFlags"), r.red_flags);
  fillList($("greenFlags"), r.green_flags);
  fillList($("evidenceList"), r.evidence);

  // signals
  const sig = $("signalsBox");
  sig.innerHTML = "";
  const entries = Object.entries(r.signals || {});
  if (!entries.length) {
    sig.innerHTML = '<span class="muted">No signal data returned.</span>';
  } else {
    for (const [k, v] of entries) {
      const val = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
      const row = document.createElement("div");
      row.className = "signal-row";
      row.innerHTML = `
        <span class="signal-name">${esc(SIGNAL_NAMES[k] || k)}</span>
        <span class="signal-track"><span class="signal-fill" style="width:${val}%;
          background:${val >= 60 ? "var(--green)" : val >= 40 ? "var(--accent)" : "var(--red)"}"></span></span>
        <span class="signal-val">${val}</span>`;
      sig.appendChild(row);
    }
  }

  // raw output
  $("rawOutput").textContent = meta.raw;

  $("resultSection").hidden = false;
  $("resultSection").scrollIntoView({ behavior: "smooth", block: "start" });
}

function fillList(ul, items) {
  ul.innerHTML = "";
  if (!items || !items.length) {
    ul.innerHTML = '<li class="muted">None found</li>';
    return;
  }
  for (const it of items.slice(0, 12)) {
    const li = document.createElement("li");
    li.textContent = typeof it === "string" ? it : JSON.stringify(it);
    ul.appendChild(li);
  }
}

/* ------------------------------------------------------------
   Progress UI
------------------------------------------------------------ */
const Progress = {
  show() {
    $("progressWrap").hidden = false;
    $("errorBox").hidden = true;
    this.set(0, null);
    document.querySelectorAll("#stepsList li").forEach((li) => {
      li.classList.remove("active", "done");
    });
  },
  step(name) {
    document.querySelectorAll("#stepsList li").forEach((li) => {
      if (li.dataset.step === name) li.classList.add("active");
    });
  },
  done(name) {
    const li = document.querySelector(`#stepsList li[data-step="${name}"]`);
    if (li) { li.classList.remove("active"); li.classList.add("done"); }
  },
  set(pct, note) {
    $("progressBar").style.width = pct + "%";
    if (note !== null) $("progressNote").textContent = note;
  },
  fail() {
    document.querySelectorAll("#stepsList li.active").forEach((li) => li.classList.remove("active"));
  },
  hide() { $("progressWrap").hidden = true; }
};

/* ------------------------------------------------------------
   Main check flow
------------------------------------------------------------ */
let checking = false;

async function runCheck(urlValue) {
  if (checking) return;
  const parsed = parseLinkedInUrl(urlValue);
  if (!parsed.valid) {
    showError(parsed.error);
    return;
  }

  if (!Settings.hasKey()) {
    showError("No AI API key configured. Open <strong>Settings</strong> and add your API key first.");
    openSettings();
    return;
  }
  if (Settings.isLocked()) {
    showError("Your settings cookie is encrypted. Open <strong>Settings</strong> and unlock with your master password.");
    openSettings();
    return;
  }

  checking = true;
  setCheckEnabled(false);
  $("resultSection").hidden = true;
  Progress.show();

  try {
    // 1. parse
    Progress.step("parse");
    Progress.set(8, `Target: ${parsed.canonical}`);
    await sleep(250);
    Progress.done("parse");

    // 2. fetch data
    Progress.step("fetch");
    Progress.set(22, "Fetching profile data…");
    const data = await LinkedInData.fetch(parsed, (n) => Progress.set(30, n));
    Progress.done("fetch");
    Progress.set(40, `Data source: ${data.source}`);

    // 3. analyze
    Progress.step("analyze");
    Progress.set(55, "Sending to the AI model for analysis…");
    const raw = await LLM.chat(
      SYSTEM_PROMPT,
      buildUserPrompt(parsed, data, Settings.data.strictMode)
    );
    Progress.set(85, "Parsing AI assessment…");
    Progress.done("analyze");

    // 4. score
    Progress.step("score");
    let result;
    try {
      result = extractJson(raw);
    } catch (e) {
      throw new Error("Could not parse the AI response as JSON. " + e.message +
        " — Try a stronger model in Settings (e.g. gpt-4o, claude-sonnet, gemini-2.0-flash).");
    }
    result.score = clampScore(result.score);
    Progress.done("score");
    Progress.set(100, "Done.");

    renderResult(result, parsed, { raw });
    Settings.addHistory({
      url: parsed.canonical,
      name: result.subject?.name || parsed.slug,
      score: result.score,
      ts: Date.now()
    });
    setTimeout(() => Progress.hide(), 900);
  } catch (err) {
    Progress.fail();
    showError(err.message || "Unexpected error during analysis.");
  } finally {
    checking = false;
    setCheckEnabled(true);
  }
}

function clampScore(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, n));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function setCheckEnabled(on) {
  $("checkBtn").disabled = !on;
  $("checkBtn").querySelector(".btn-label").textContent = on ? "Check now" : "Analyzing…";
}

function showError(html) {
  const box = $("errorBox");
  box.innerHTML = "⚠️ " + html;
  box.hidden = false;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ------------------------------------------------------------
   Settings dialog
------------------------------------------------------------ */
function openSettings() {
  const d = Settings.data;
  $("providerSelect").value = d.provider;
  $("customEndpoint").value = d.customEndpoint || "";
  $("apiKeyInput").value = d.apiKey || "";
  $("modelInput").value = d.model || "";
  $("liTokenInput").value = d.liToken || "";
  $("liProxyInput").value = d.liProxy || "";
  $("saveHistoryCheck").checked = !!d.saveHistory;
  $("strictModeCheck").checked = !!d.strictMode;
  $("encryptCheck").checked = !!d.encrypted;
  $("masterPassRow").hidden = !d.encrypted && !Settings.isLocked();
  $("unlockBtn").hidden = !Settings.isLocked();
  syncProviderUI();
  syncLinkedInModeUI();
  $("settingsAlert").hidden = true;
  $("settingsBackdrop").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSettings() {
  $("settingsBackdrop").hidden = true;
  document.body.style.overflow = "";
}

function syncProviderUI() {
  const p = $("providerSelect").value;
  $("customEndpointRow").hidden = p !== "custom";
  const hints = {
    openrouter: 'Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>. Stored only in your browser\'s cookie.',
    openai: 'Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a>.',
    anthropic: 'Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>.',
    gemini: 'Get a key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.',
    custom: 'Point to any OpenAI-compatible server (LM Studio, Ollama with OpenAI adapter, vLLM…).'
  };
  $("keyHint").innerHTML = hints[p] || "";
  if (!$("modelInput").value || $("modelInput").dataset.auto === "1") {
    $("modelInput").value = PROVIDERS[p].defaultModel;
    $("modelInput").dataset.auto = "1";
  }
}

function syncLinkedInModeUI() {
  const mode = document.querySelector('input[name="liMode"]:checked')?.value || "public";
  $("liTokenRow").hidden = mode !== "token";
  $("liProxyRow").hidden = mode !== "proxy";
}

async function saveSettings() {
  const alertBox = $("settingsAlert");
  const show = (msg, cls) => {
    alertBox.className = "alert " + cls;
    alertBox.innerHTML = msg;
    alertBox.hidden = false;
  };

  const provider = $("providerSelect").value;
  const apiKey = $("apiKeyInput").value.trim();
  const model = $("modelInput").value.trim();

  if (!apiKey && provider !== "custom") {
    show("Please enter an API key.", "alert-error");
    return;
  }

  const wasEncrypted = Settings.data.encrypted;
  const password = $("masterPassInput").value;

  if ($("encryptCheck").checked && !Settings.data.encrypted && !password) {
    show("Enter a master password to enable encryption.", "alert-error");
    return;
  }

  Object.assign(Settings.data, {
    provider,
    customEndpoint: $("customEndpoint").value.trim(),
    apiKey,
    model,
    liMode: document.querySelector('input[name="liMode"]:checked')?.value || "public",
    liToken: $("liTokenInput").value.trim(),
    liProxy: $("liProxyInput").value.trim(),
    saveHistory: $("saveHistoryCheck").checked,
    strictMode: $("strictModeCheck").checked,
    encrypted: $("encryptCheck").checked
  });

  if ($("encryptCheck").checked) {
    if (!wasEncrypted || password) Settings._password = password;
    if (!Settings._password) {
      show("Re-enter your master password to re-save encrypted settings.", "alert-error");
      return;
    }
  } else {
    Settings._password = null;
  }

  try {
    await Settings.save();
    closeSettings();
    showToast("Settings saved to cookie ✓");
  } catch (e) {
    show("Could not save settings: " + e.message, "alert-error");
  }
}

async function testAiConnection() {
  const out = $("aiTestResult");
  out.className = "test-result";
  out.textContent = "…testing";

  // Temporarily use what's typed in the dialog
  const backup = { ...Settings.data };
  Object.assign(Settings.data, {
    provider: $("providerSelect").value,
    customEndpoint: $("customEndpoint").value.trim(),
    apiKey: $("apiKeyInput").value.trim(),
    model: $("modelInput").value.trim()
  });

  try {
    const answer = await LLM.chat(
      'You are a connection tester. Respond with exactly this JSON: {"ok": true}',
      "Reply with the JSON now.", { maxTokens: 2000, temperature: 0 }
    );
    extractJson(answer);
    out.className = "test-result ok";
    out.textContent = "✓ Connection OK";
  } catch (e) {
    out.className = "test-result fail";
    out.textContent = "✗ " + (e.message.length > 90 ? e.message.slice(0, 90) + "…" : e.message);
  } finally {
    Object.assign(Settings.data, backup);
  }
}

async function fetchModels() {
  const btn = $("fetchModelsBtn");
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const p = Settings.data.provider = $("providerSelect").value;
    Settings.data.apiKey = $("apiKeyInput").value.trim();
    Settings.data.customEndpoint = $("customEndpoint").value.trim();
    const urls = providerEndpoint(p);
    const def = PROVIDERS[p];

    let ids = [];
    if (p === "gemini") {
      const res = await fetch(`${urls.models}?key=${encodeURIComponent(Settings.data.apiKey)}`);
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      ids = (j.models || []).map((m) => (m.name || "").replace(/^models\//, "")).filter(Boolean);
    } else if (urls.models) {
      const res = await fetch(urls.models, { headers: def.headers(Settings.data.apiKey) });
      if (!res.ok) throw await httpError(res);
      const j = await res.json();
      ids = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    } else {
      throw new Error("This provider does not expose a model list. Type the model name manually.");
    }

    const dl = $("modelList");
    dl.innerHTML = "";
    for (const id of ids.slice(0, 300)) {
      const opt = document.createElement("option");
      opt.value = id;
      dl.appendChild(opt);
    }
    showToast(`Loaded ${Math.min(ids.length, 300)} models ✓`);
  } catch (e) {
    showToast("Could not load models: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "⟳ Models";
  }
}

/* ------------------------------------------------------------
   Report export
------------------------------------------------------------ */
function buildReportText() {
  const score = $("scoreValue").textContent;
  const lines = [
    "LinkedInGuardian Report",
    "=======================",
    `Subject:   ${$("subjectName").textContent}`,
    `URL:       ${$("subjectLink").href}`,
    `Date:      ${new Date().toISOString()}`,
    `Score:     ${score}/10 — ${$("scoreLabel").textContent}`,
    `Confidence:${$("confidenceValue").textContent}`,
    "",
    "VERDICT",
    $("verdictText").textContent,
    "",
    "RED FLAGS"
  ];
  document.querySelectorAll("#redFlags li").forEach((li) => lines.push("- " + li.textContent));
  lines.push("", "GREEN FLAGS");
  document.querySelectorAll("#greenFlags li").forEach((li) => lines.push("- " + li.textContent));
  lines.push("", "EVIDENCE");
  document.querySelectorAll("#evidenceList li").forEach((li) => lines.push("- " + li.textContent));
  lines.push("", "Generated client-side by LinkedInGuardian — AI opinion, not a fact-check.");
  return lines.join("\n");
}

/* ------------------------------------------------------------
   Wire-up
------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  Settings.load();

  // form
  $("checkForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runCheck($("profileUrl").value);
  });

  // settings open/close
  for (const id of ["settingsBtn", "footerSettingsBtn"]) {
    $(id).addEventListener("click", openSettings);
  }
  $("settingsCloseBtn").addEventListener("click", closeSettings);
  $("settingsCancelBtn").addEventListener("click", closeSettings);
  $("settingsSaveBtn").addEventListener("click", saveSettings);
  $("settingsBackdrop").addEventListener("click", (e) => {
    if (e.target === $("settingsBackdrop")) closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("settingsBackdrop").hidden) closeSettings();
  });

  // settings interactions
  $("providerSelect").addEventListener("change", syncProviderUI);
  document.querySelectorAll('input[name="liMode"]').forEach((r) =>
    r.addEventListener("change", syncLinkedInModeUI));
  $("encryptCheck").addEventListener("change", () => {
    $("masterPassRow").hidden = !$("encryptCheck").checked;
    $("unlockBtn").hidden = !Settings.isLocked();
  });

  // Unlock encrypted cookie with master password
  $("unlockBtn").addEventListener("click", async () => {
    const pw = $("masterPassInput").value;
    if (!pw) { showToast("Enter your master password first."); return; }
    const ok = await Settings.unlock(pw);
    if (ok) {
      showToast("Settings unlocked ✓");
      $("unlockBtn").hidden = true;
      openSettings(); // re-open with decrypted values
    } else {
      showToast("Wrong master password.");
    }
  });
  $("toggleKeyBtn").addEventListener("click", () => {
    const inp = $("apiKeyInput");
    inp.type = inp.type === "password" ? "text" : "password";
  });
  $("testAiBtn").addEventListener("click", testAiConnection);
  $("fetchModelsBtn").addEventListener("click", fetchModels);

  $("clearSettingsBtn").addEventListener("click", () => {
    if (!confirm("Delete all LinkedInGuardian settings (API keys, history) from this browser?")) return;
    Settings.clear();
    closeSettings();
    showToast("All settings cleared.");
  });

  // result actions
  $("toggleRawBtn").addEventListener("click", () => {
    const raw = $("rawOutput");
    raw.hidden = !raw.hidden;
    $("toggleRawBtn").textContent = raw.hidden ? "Show raw AI output" : "Hide raw AI output";
  });
  $("copyReportBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(buildReportText());
      showToast("Report copied to clipboard ✓");
    } catch {
      showToast("Clipboard not available in this browser.");
    }
  });
  $("printReportBtn").addEventListener("click", () => window.print());
  $("newCheckBtn").addEventListener("click", () => {
    $("resultSection").hidden = true;
    $("profileUrl").value = "";
    $("profileUrl").focus();
    window.scrollTo({ top: $("checker").offsetTop - 70, behavior: "smooth" });
  });

  // brand link scrolls to top
  $("brandLink").addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});
