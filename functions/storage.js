// functions/storage.js
// Cloudflare Pages Function — read/write tracker + knowledge file from KV
// KV binding: VITALCOACH_KV

export async function onRequest(context) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  const kv = context.env.VITALCOACH_KV;
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV binding not configured' }), { status: 500, headers: CORS });
  }

  const url = new URL(context.request.url);
  const action = url.searchParams.get('action'); // 'read' or 'write'
  const key = url.searchParams.get('key');       // 'tracker', 'knowledge', or 'system_prompt'

  if (!key || !['tracker','knowledge','system_prompt'].includes(key)) {
    return new Response(JSON.stringify({ error: 'Invalid key. Use: tracker, knowledge, system_prompt' }), { status: 400, headers: CORS });
  }

  if (context.request.method === 'GET' || action === 'read') {
    // READ
    const value = await kv.get(key);
    if (!value) {
      return new Response(JSON.stringify({ error: 'Key not found', key }), { status: 404, headers: CORS });
    }
    return new Response(JSON.stringify({ key, value }), { status: 200, headers: CORS });
  }

  if (context.request.method === 'POST' || action === 'write') {
    // WRITE
    let body;
    try { body = await context.request.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: CORS });
    }
    if (!body.value) {
      return new Response(JSON.stringify({ error: 'Missing value in body' }), { status: 400, headers: CORS });
    }
    await kv.put(key, body.value);
    return new Response(JSON.stringify({ ok: true, key }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
}
