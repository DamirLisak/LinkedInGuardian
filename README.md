# LinkedInGuardian

**Determine how trustworthy a LinkedIn member or company is — before you hand over money.**

LinkedInGuardian is a 100% client-side web tool that analyzes the public profile and posts of any
LinkedIn member or company page with an AI language model and produces a **trustworthiness rating
from 1 to 10**, including red flags, green flags, cited evidence and a plain-language verdict.

It was built to counter a widespread scam pattern on LinkedIn: "consultants" who promise massive
revenue growth, guaranteed M&A deals or quick riches — and then sell expensive services that leave
clients in financial distress.

🔗 **Live site:** https://damirlisak.github.io/LinkedInGuardian/

---

## ✨ Features

- **1–10 trust score** with an animated gauge, AI confidence level and a five-signal breakdown
  (claims verifiability, posting behavior, engagement authenticity, language patterns,
  professional consistency)
- **Red flags / green flags / evidence** — every rating is explained, not just a number
- **Bring your own AI** — works with **OpenRouter**, **OpenAI**, **Anthropic**, **Google Gemini**
  and any OpenAI-compatible endpoint (LM Studio, Ollama, vLLM, …)
- **Cookie-based settings** — API keys, model choice and LinkedIn credentials are stored in a
  first-party cookie so you enter them once; optionally **AES-GCM encrypted** with a master
  password (Web Crypto API)
- **Three LinkedIn data modes**
  - *Public research* (default, no LinkedIn key needed)
  - *LinkedIn OAuth token* (official API from your own app)
  - *CORS proxy* (your own server injects credentials — see [`docs/PROXY.md`](docs/PROXY.md))
- **Strict mode** for extra skepticism, recent-check history, copy/print report
- **No backend, no tracking, no server-side storage** — everything runs in your browser

## 🚀 Quick start

1. Open the [live site](https://damirlisak.github.io/LinkedInGuardian/) (or run locally — see below).
2. Click **Settings**, choose a provider (e.g. OpenRouter), paste your API key, pick a model.
3. Paste a LinkedIn URL into the search box, e.g.
   - `https://www.linkedin.com/in/damir-lisak-a49241207/`
   - `https://www.linkedin.com/company/gipsoft/home/`
4. Press **Check now** and read the assessment.

### Run locally

Any static file server works:

```bash
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080
```

> Open the page via `http://localhost` — opening `index.html` directly via `file://` blocks
> cookies and fetch in most browsers.

## 🔑 Getting API keys

| Provider | Key URL | Notes |
|---|---|---|
| OpenRouter (recommended) | https://openrouter.ai/keys | One key, hundreds of models, free tiers available |
| OpenAI | https://platform.openai.com/api-keys | |
| Anthropic | https://console.anthropic.com/ | Direct browser calls supported via CORS header |
| Google Gemini | https://aistudio.google.com/apikey | Free tier available |

Your key is sent **only** from your browser to the provider you selected. This site has no
server that could see it.

## 🔍 Data access & limitations (why some profiles can't be fetched automatically)

LinkedInGuardian's automatic public fetch works through LinkedIn's **logged-out "guest pages"**,
and LinkedIn decides per profile whether to serve them:

| Test | Result |
|---|---|
| `linkedin.com/in/williamhgates/` (logged out) | ✅ full public page served |
| `linkedin.com/company/gipsoft/` (logged out, bare URL) | ✅ full public page served |
| `linkedin.com/company/gipsoft/home/` | ❌ login wall (deep links always wall guests) |
| Regular member profiles (e.g. low-activity accounts) | ❌ login wall, even with visibility ON |

Three factors stack up:

1. **URL path** — guest pages exist only at the *bare* vanity URL (`/in/name/`, `/company/name/`).
   Sub-pages (`/home/`, `/about/`, `/posts/`) always redirect logged-out visitors to the auth wall.
   LinkedInGuardian automatically tries the bare URL first.
2. **Profile prominence in LinkedIn's public index** — the "Public visibility" switch is
   necessary but **not sufficient**. LinkedIn only serves guest pages for profiles it considers
   worth serving (high-profile members, active company pages). A regular member profile gets the
   auth wall even when viewed logged-out from a residential browser — verified independently of
   any bot detection.
3. **Bot detection** — datacenter IPs (used by reader proxies) are throttled aggressively, and
   the same URL may succeed or fail at different times.

**Consequence:** automatic fetching works for prominent members and most company pages, but not
for every profile. For reliable results with restricted profiles, use the **manual paste field**
(open the profile logged-in, copy the visible text) or run the
[CORS proxy](docs/PROXY.md) with your own LinkedIn token. This is LinkedIn's privacy design —
not a bug in LinkedInGuardian.

## 🏗 Project structure

```
LinkedInGuardian/
├── index.html          # single-page app
├── css/style.css       # styling (no framework)
├── js/app.js           # all logic: settings, providers, LinkedIn modes, analysis
├── docs/PROXY.md       # how to run your own LinkedIn CORS proxy
├── .nojekyll           # serve files as-is on GitHub Pages
└── README.md
```

## ⚠️ Disclaimer

LinkedInGuardian provides **AI-generated opinions** based on public signals. Assessments can be
wrong, incomplete or outdated. They are not legal advice, not a fact-check, and not a verified
background report. Decisions made on the basis of a report are your own responsibility.
Do not use this tool to harass or defame anyone, and respect LinkedIn's User Agreement and
applicable privacy laws (GDPR, …). Not affiliated with LinkedIn Corp.

## 📄 License

GPL-3.0 — see [LICENSE](LICENSE).
