/**
 * Cloudflare Worker: Strava OAuth + activity proxy for Løbeøkonomi-appen.
 *
 * Formålet med denne worker er at holde Stravas Client Secret hemmelig.
 * Løbeøkonomi-appen er en statisk side i et offentligt GitHub-repo, så den
 * kan ALDRIG have adgang til Client Secret direkte — kun denne worker (som
 * kører isoleret hos Cloudflare og har hemmeligheden gemt som en krypteret
 * variabel) må foretage selve token-udvekslingen med Strava.
 *
 * ─── Opsætning ────────────────────────────────────────────────────────────
 * 1. Opret et Strava API-program på https://www.strava.com/settings/api
 *    - Authorization Callback Domain: andsteiner.github.io
 *    - Noter "Client ID" og "Client Secret"
 * 2. Opret en gratis Cloudflare-konto på https://dash.cloudflare.com/
 * 3. Workers & Pages → Create → Create Worker → giv den et navn → Deploy
 * 4. "Edit code" → slet standard-koden → indsæt HELE denne fil → Deploy
 * 5. Worker → Settings → Variables and Secrets → tilføj to secrets:
 *      STRAVA_CLIENT_ID      (fra trin 1)
 *      STRAVA_CLIENT_SECRET  (fra trin 1)
 * 6. Kopiér workerens URL (fx https://lobeokonomi-strava.<dit-navn>.workers.dev)
 *    og indsæt den som STRAVA_WORKER_URL i index.html, sammen med Client ID
 *    som STRAVA_CLIENT_ID.
 * ───────────────────────────────────────────────────────────────────────────
 */

const ALLOWED_ORIGIN = "https://andsteiner.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function handleExchange(request, env) {
  const { code } = await request.json();
  if (!code) return jsonResponse({ message: "code mangler" }, 400);

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  return jsonResponse(data, res.status);
}

async function handleRefresh(request, env) {
  const { refresh_token } = await request.json();
  if (!refresh_token) return jsonResponse({ message: "refresh_token mangler" }, 400);

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  return jsonResponse(data, res.status);
}

// Ren proxy: klienten sender sit eget access token med, workeren videresender
// blot kaldet til Strava (så browserens CORS-begrænsning undgås).
async function handleActivities(request) {
  const auth = request.headers.get("Authorization");
  if (!auth) return jsonResponse({ message: "Authorization header mangler" }, 401);

  const url = new URL(request.url);
  const stravaUrl = new URL("https://www.strava.com/api/v3/athlete/activities");
  for (const key of ["after", "before", "page", "per_page"]) {
    if (url.searchParams.has(key)) stravaUrl.searchParams.set(key, url.searchParams.get(key));
  }

  const res = await fetch(stravaUrl, { headers: { Authorization: auth } });
  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/exchange" && request.method === "POST") return await handleExchange(request, env);
      if (url.pathname === "/refresh" && request.method === "POST") return await handleRefresh(request, env);
      if (url.pathname === "/activities" && request.method === "GET") return await handleActivities(request);
      return jsonResponse({ message: "not found" }, 404);
    } catch (err) {
      return jsonResponse({ message: err.message }, 500);
    }
  },
};
