/**
 * ProjectCare Proxy — Cloudflare Worker
 *
 * Forwards GPT requests to the GAS engine so users see icarenow.io
 * (or your custom domain) instead of script.google.com.
 *
 * GAS web apps return a 302 redirect before serving the response.
 * This worker follows that redirect manually as a POST (fetch() would
 * convert POST → GET on a 302, dropping the request body).
 */

const GAS_URL =
  'https://script.google.com/macros/s/AKfycbwu2VJv9zMJz3GSb7ijyLqrQzvwweJjS9hP6EFAB9Aao4MNo4vl2zgEil-GcBNACQxp/exec';

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const body = await request.text();

    if (!body) {
      return json({ error: 'Empty request body' }, 400);
    }

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
      gasResponse = await fetch(GAS_URL, postArgs);
    } catch (err) {
      return json({ error: 'Gateway error', detail: err.message, stage: 'initial' }, 502);
    }

    // Step 2 — follow the redirect as POST to script.googleusercontent.com
    // GAS returns 302 → googleusercontent.com — must re-POST with body there
    if (gasResponse.status >= 300 && gasResponse.status < 400) {
      const location = gasResponse.headers.get('location');

      if (!location) {
        return json({ error: 'Gateway error', detail: 'Redirect with no location', stage: 'redirect' }, 502);
      }

      try {
        // GET the result from the googleusercontent.com token URL
        // GAS pre-computes the response on the initial POST and serves it via GET
        gasResponse = await fetch(location, {
          method:  'GET',
          redirect: 'follow',
        });
      } catch (err) {
        return json({ error: 'Gateway error', detail: err.message, stage: 'redirect' }, 502);
      }
    }

    const responseText = await gasResponse.text();

    return new Response(responseText, {
      status:  gasResponse.status,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders(),
      },
    });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
