// netlify/functions/oura.js
// Fetches Oura data using built-in https module (no dependencies needed)
// Requires env var: OURA_PAT

const https = require('https');

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const options = { headers };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0,100))); }
      });
    }).on('error', reject);
  });
}

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
      body: JSON.stringify({ error: 'OURA_PAT env var not set.' }),
    };
  }

  const params = event.queryStringParameters || {};
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const startDate = params.start_date || yesterday;
  const endDate = params.end_date || today;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const base = 'https://api.ouraring.com/v2/usercollection';
    const [readiness, dailySleep, sleep, activity] = await Promise.all([
      httpsGet(`${base}/daily_readiness?start_date=${startDate}&end_date=${endDate}`, headers),
      httpsGet(`${base}/daily_sleep?start_date=${startDate}&end_date=${endDate}`, headers),
      httpsGet(`${base}/sleep?start_date=${startDate}&end_date=${endDate}`, headers),
      httpsGet(`${base}/daily_activity?start_date=${startDate}&end_date=${endDate}`, headers),
    ]);

    const r  = readiness.data  && readiness.data[readiness.data.length - 1];
    const ds = dailySleep.data && dailySleep.data[dailySleep.data.length - 1];
    const a  = activity.data   && activity.data[activity.data.length - 1];

    // Find longest sleep session across date range
    const allSessions = sleep.data || [];
    const mainSleep = allSessions
      .filter(s => s.total_sleep_duration > 0)
      .sort((a, b) => (b.total_sleep_duration || 0) - (a.total_sleep_duration || 0))[0] || null;

    const result = {
      date: ds ? ds.day : endDate,
      readiness_score:      r         ? r.score                      : null,
      temperature_deviation:r         ? r.temperature_deviation       : null,
      sleep_score:          ds        ? ds.score                      : null,
      average_hrv:          mainSleep ? mainSleep.average_hrv         : null,
      lowest_heart_rate:    mainSleep ? mainSleep.lowest_heart_rate   : null,
      total_sleep_duration: mainSleep ? mainSleep.total_sleep_duration: null,
      awake_time:           mainSleep ? mainSleep.awake_time          : null,
      deep_sleep_duration:  mainSleep ? mainSleep.deep_sleep_duration : null,
      rem_sleep_duration:   mainSleep ? mainSleep.rem_sleep_duration  : null,
      steps:                a         ? a.steps                       : null,
    };

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
