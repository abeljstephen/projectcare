/**
 * ProjectCare Proxy — Cloudflare Worker
 *
 * Forwards GPT requests to the GAS engine so users see icarenow.io
 * (or your custom domain) instead of script.google.com.
 *
 * GAS web apps return a 302 redirect before serving the response.
 * This worker follows that redirect manually as a POST (fetch() would
 * convert POST → GET on a 302, dropping the request body).
 *
 * SECURITY NOTES:
 * - GAS_URL must be set as a Cloudflare Worker secret, NOT in source.
 *   Run:  wrangler secret put GAS_URL
 *   Then paste the full https://script.google.com/macros/s/.../exec URL.
 * - CORS is restricted to known origins only (no wildcard).
 * - Origin validation rejects requests from unknown domains.
 */

// Allowed origins — add icarenow.io production domain when ready
const ALLOWED_ORIGINS = new Set([
  'https://abeljstephen.github.io',
  'https://icarenow.io',
  'https://www.icarenow.io',
]);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    // Reject requests from unknown origins (browser-to-worker requests always
    // include Origin; server-to-server callers must use the WP REST API directly)
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: 'Origin not allowed' }, 403, origin);
    }

    // GAS_URL is a Cloudflare Worker secret — never hardcoded in source
    const gasUrl = env.GAS_URL;
    if (!gasUrl) {
      return json({ error: 'Worker misconfigured — GAS_URL secret not set' }, 500, origin);
    }

    const body = await request.text();
    if (!body) {
      return json({ error: 'Empty request body' }, 400, origin);
    }

    // Validate body is JSON before forwarding
    try { JSON.parse(body); }
    catch (_) { return json({ error: 'Request body must be valid JSON' }, 400, origin); }

    const postArgs = {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Keep-Alive':   'timeout=120',
      },
      body:    body,
      redirect: 'manual',
    };

    // Step 1 — initial POST to GAS (expect 302)
    let gasResponse;
    try {
      gasResponse = await fetch(gasUrl, postArgs);
    } catch (err) {
      return json({ error: 'Gateway error', detail: err.message, stage: 'initial' }, 502, origin);
    }

    // Step 2 — follow the redirect as GET to script.googleusercontent.com
    // GAS returns 302 → googleusercontent.com — pre-computes response on initial POST
    if (gasResponse.status >= 300 && gasResponse.status < 400) {
      const location = gasResponse.headers.get('location');
      if (!location) {
        return json({ error: 'Gateway error', detail: 'Redirect with no location', stage: 'redirect' }, 502, origin);
      }
      try {
        gasResponse = await fetch(location, { method: 'GET', redirect: 'follow' });
      } catch (err) {
        return json({ error: 'Gateway error', detail: err.message, stage: 'redirect' }, 502, origin);
      }
    }

    const responseText = await gasResponse.text();

    return new Response(responseText, {
      status:  gasResponse.status,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
      },
    });
  },
};

function json(obj, status = 200, origin = '') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  // Only emit ACAO header for allowed origins — never wildcard
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
