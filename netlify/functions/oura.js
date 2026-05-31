// netlify/functions/oura.js
// Proxies Oura API calls to avoid CORS issues.
// Requires env var: OURA_PAT (personal access token from cloud.ouraring.com/personal-access-tokens)
// Deploy: set OURA_PAT in Netlify dashboard → Site settings → Environment variables

exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const token = process.env.OURA_PAT;
  if (!token) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'OURA_PAT env var not set. Add it in Netlify dashboard.' }),
    };
  }

  // ?endpoint=daily_readiness&start_date=2026-05-30&end_date=2026-05-31
  const params = event.queryStringParameters || {};
  const endpoint = params.endpoint || 'daily_readiness';
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const startDate = params.start_date || yesterday;
  const endDate = params.end_date || today;

  const ENDPOINTS = {
    daily_readiness: `https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`,
    daily_sleep:     `https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`,
    heartrate:       `https://api.ouraring.com/v2/usercollection/heartrate?start_datetime=${startDate}T00:00:00&end_datetime=${endDate}T23:59:59`,
    daily_spo2:      `https://api.ouraring.com/v2/usercollection/daily_spo2?start_date=${startDate}&end_date=${endDate}`,
    // Convenience: fetch all sleep+readiness in one call
    summary: null,
  };

  if (endpoint === 'summary') {
    // Parallel fetch of readiness + sleep
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [readinessRes, sleepRes, spo2Res] = await Promise.all([
        fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
        fetch(`https://api.ouraring.com/v2/usercollection/daily_spo2?start_date=${startDate}&end_date=${endDate}`, { headers }),
      ]);
      const [readiness, sleep, spo2] = await Promise.all([
        readinessRes.json(), sleepRes.json(), spo2Res.json(),
      ]);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ readiness, sleep, spo2 }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  const url = ENDPOINTS[endpoint];
  if (!url) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: `Unknown endpoint: ${endpoint}. Use: daily_readiness, daily_sleep, heartrate, daily_spo2, summary` }),
    };
  }

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
