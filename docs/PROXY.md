# LinkedInGuardian CORS Proxy

LinkedIn's official API does **not** send CORS headers, so a browser on a static
GitHub Pages site cannot call it directly. If you have a LinkedIn app with a valid
OAuth 2.0 access token, you can route requests through a tiny proxy that injects
the credentials **server-side**.

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
