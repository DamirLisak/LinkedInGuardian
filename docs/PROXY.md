# LinkedInGuardian CORS Proxy

## Testing with a LinkedIn OAuth token (token mode)

Before setting up a proxy, you can test **token mode** directly in Settings →
LinkedIn data source → *LinkedIn access token*.

### ⚠️ What a token can and cannot do

| Target | Token mode result |
|---|---|
| **Your own member profile** | ✅ works — `/v2/me` or `/v2/userinfo` return the token owner's data |
| **Any other member** (e.g. Bill Gates) | ❌ impossible — LinkedIn has **no API** to look up third-party members by vanity name |
| **A company page you administer** | ✅ works if your app has the *Community Management API* product |
| **A company page you don't administer** | ❌ 403 — even with the product approved |

So token mode is mainly useful for **self-checks** and **your own company pages**.
For arbitrary third-party profiles, use public fetch or the manual paste field.

### Step-by-step: create the app and get a token

1. **Create the app** at <https://www.linkedin.com/developers/apps/new>:
   - *Page URL*: your own LinkedIn company page (create one for free if you don't
     have any — e.g. a personal brand page). LinkedIn requires every app to be
     attached to a page you administer.
   - *App name*: anything, e.g. `LinkedInGuardian-Test`
   - *Logo*: any small image
   - Accept the legal terms and create.
2. **Verify the app**: LinkedIn sends a verification code/link — open the
   generated verification link while logged in as the page admin and confirm.
3. **Request products** (tab *Products* in your app):
   - **"Sign In with LinkedIn using OpenID Connect"** — approved instantly.
     Grants `openid profile email` scopes → enables `/v2/userinfo` (your identity).
   - **"Community Management API"** (optional, for company lookups) — requires
     a review; you must be admin of the attached page.
4. **Get a token** at <https://www.linkedin.com/developers/tools/oauth>:
   - Select your app → generate a token for your own account.
   - Copy the access token (starts with `AQX…`).
5. **In LinkedInGuardian**: Settings → LinkedIn data source → *LinkedIn access
   token* → paste the token → Save. Then check your own profile URL or your
   company page.

> Tokens expire after **60 days**. Browser calls to `api.linkedin.com` are
> **always** blocked by CORS (see below) — use the proxy for real tests.

## Why a proxy is needed

**`api.linkedin.com` sends no CORS headers** (verified: neither preflight nor
plain responses contain `Access-Control-Allow-*`). A browser therefore cannot
call the LinkedIn API directly — regardless of how correct your token is. The
token mode in LinkedInGuardian only works **through a proxy**.

## Option 0 — Local proxy for testing (fastest)

A ready-made proxy ships with this repo: [`proxy.js`](../proxy.js).

```bash
# 1. start it with your token
LI_TOKEN="AQX…" node proxy.js
# → "LinkedInGuardian proxy listening on http://localhost:8787"

# 2. In LinkedInGuardian Settings:
#    - LinkedIn data source: "CORS proxy"
#    - Proxy base URL:       http://localhost:8787
#    (leave the LinkedIn token field empty — the proxy injects it)
```

Then check your own profile URL — the app will show
`Data source: CORS proxy` and analyze your real profile data.

> Note: the member endpoint returns the **token owner's** profile (you) —
> LinkedIn has no API for third-party member lookup. Company lookups require
> the *Community Management API* product and page-admin rights.

LinkedInGuardian expects the proxy to accept:

```
GET <proxy-base>?type=member|company&slug=<vanity-name>
```

and return the LinkedIn data as the response body (JSON or text).

## Option A — Cloudflare Worker (free tier is enough)

Create a Worker at <https://workers.cloudflare.com> with this code:

```js
export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",            // tighten to your Pages URL!
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "member";
    const slug = url.searchParams.get("slug");
    if (!slug) return new Response("missing slug", { status: 400, headers: cors });

    // Store the token as a Worker secret:  wrangler secret put LI_TOKEN
    const token = env.LI_TOKEN;
    const headers = {
      "Authorization": `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202401",
    };

    let endpoint;
    if (type === "company") {
      endpoint = `https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(slug)}`;
    } else {
      // Member profiles are only retrievable for the token owner or via
      // partner programs. Adjust to your app's approved scopes.
      endpoint = `https://api.linkedin.com/v2/me`;
    }

    const resp = await fetch(endpoint, { headers });
    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...cors, "Content-Type": resp.headers.get("Content-Type") || "application/json" },
    });
    // NOTE: `env` must be destructured: async fetch(request, env)
  },
};
```

> Fix the signature to `async fetch(request, env)` — the token comes from
> `env.LI_TOKEN`, never hard-code it.

Then in LinkedInGuardian **Settings → LinkedIn data source → CORS proxy**, enter:

```
https://your-worker.your-subdomain.workers.dev/linkedin
```

## Option B — Any small server

Any server that forwards `?type=&slug=` to LinkedIn with your token and adds
`Access-Control-Allow-Origin: https://damirlisak.github.io` works. Example with
Node/Express:

```js
app.get("/linkedin", async (req, res) => {
  const { type, slug } = req.query;
  const r = await fetch(`https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=${slug}`, {
    headers: { Authorization: `Bearer ${process.env.LI_TOKEN}`, "LinkedIn-Version": "202401" },
  });
  res.set("Access-Control-Allow-Origin", "https://damirlisak.github.io");
  res.type("json").send(await r.text());
});
```

## Important LinkedIn API constraints

- Member profile data requires your app to be approved for the relevant products
  (e.g. *Profile API*, *Sign In with LinkedIn using OpenID Connect*). See
  <https://learn.microsoft.com/en-us/linkedin/marketing/>.
- You may only process data of members who have consented (OAuth) — scraping or
  bulk lookups of third parties violate LinkedIn's User Agreement.
- Access tokens expire (60 days for refresh-token flows); plan a refresh flow in
  your proxy if needed.
