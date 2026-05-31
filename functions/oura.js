// functions/oura.js
// Cloudflare Pages Function — proxies Oura API calls
// Requires env var: OURA_PAT (set in Cloudflare Pages dashboard)

export async function onRequest(context) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (context.request.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: CORS });
  }

  const token = context.env.OURA_PAT;
  if (!token) {
    return new Response(JSON.stringify({ error: 'OURA_PAT env var not set.' }), { status: 500, headers: CORS });
  }

  const url = new URL(context.request.url);
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const startDate = url.searchParams.get('start_date') || yesterday;
  const endDate = url.searchParams.get('end_date') || today;
  const headers = { Authorization: `Bearer ${token}` };
  const base = 'https://api.ouraring.com/v2/usercollection';

  try {
    const [readinessRes, dailySleepRes, sleepRes, activityRes] = await Promise.all([
      fetch(`${base}/daily_readiness?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${base}/daily_sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${base}/sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${base}/daily_activity?start_date=${startDate}&end_date=${endDate}`, { headers }),
    ]);

    const [readiness, dailySleep, sleep, activity] = await Promise.all([
      readinessRes.json(), dailySleepRes.json(), sleepRes.json(), activityRes.json(),
    ]);

    const r  = readiness.data  && readiness.data[readiness.data.length - 1];
    const ds = dailySleep.data && dailySleep.data[dailySleep.data.length - 1];
    const a  = activity.data   && activity.data[activity.data.length - 1];

    const allSessions = sleep.data || [];
    const mainSleep = allSessions
      .filter(s => s.total_sleep_duration > 0)
      .sort((a, b) => (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0))[0] || null;

    const result = {
      date:                 ds        ? ds.day                         : endDate,
      readiness_score:      r         ? r.score                        : null,
      temperature_deviation:r         ? r.temperature_deviation        : null,
      sleep_score:          ds        ? ds.score                       : null,
      average_hrv:          mainSleep ? mainSleep.average_hrv          : null,
      lowest_heart_rate:    mainSleep ? mainSleep.lowest_heart_rate    : null,
      total_sleep_duration: mainSleep ? mainSleep.total_sleep_duration : null,
      awake_time:           mainSleep ? mainSleep.awake_time           : null,
      deep_sleep_duration:  mainSleep ? mainSleep.deep_sleep_duration  : null,
      rem_sleep_duration:   mainSleep ? mainSleep.rem_sleep_duration   : null,
      steps:                a         ? a.steps                        : null,
    };

    return new Response(JSON.stringify(result), { status: 200, headers: CORS });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}
