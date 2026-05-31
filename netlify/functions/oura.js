// netlify/functions/oura.js
// Fetches Oura data and returns all fields needed for Vital Coach inputs tab
// Requires env var: OURA_PAT

const fetch = globalThis.fetch || require('node-fetch');

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
    // Fetch all needed endpoints in parallel
    const [readinessRes, dailySleepRes, sleepRes, activityRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${startDate}&end_date=${endDate}`, { headers }),
    ]);

    const [readiness, dailySleep, sleep, activity] = await Promise.all([
      readinessRes.json(),
      dailySleepRes.json(),
      sleepRes.json(),
      activityRes.json(),
    ]);

    // Get latest entries
    const r = readiness.data && readiness.data[readiness.data.length - 1];
    const ds = dailySleep.data && dailySleep.data[dailySleep.data.length - 1];
    const a = activity.data && activity.data[activity.data.length - 1];

    // Sleep sessions — find the longest session across the date range
    const latestDate = ds ? ds.day : endDate;
    // Try today first, then yesterday, take the longest session
    const allSessions = sleep.data || [];
    const mainSleep = allSessions
      .filter(s => s.total_sleep_duration > 0)
      .sort((a,b) => (b.total_sleep_duration||0) - (a.total_sleep_duration||0))[0] || null;

    // Build response with all fields
    const result = {
      date: latestDate,
      // From daily_readiness
      readiness_score: r ? r.score : null,
      temperature_deviation: r ? r.temperature_deviation : null,
      // HRV avg in ms from sleep session (real milliseconds value)
      average_hrv: mainSleep ? mainSleep.average_hrv : null,
      // From daily_sleep  
      sleep_score: ds ? ds.score : null,
      // From sleep sessions (detailed)
      total_sleep_duration: mainSleep ? mainSleep.total_sleep_duration : null,  // seconds
      awake_time: mainSleep ? mainSleep.awake_time : null,                       // seconds
      lowest_heart_rate: mainSleep ? mainSleep.lowest_heart_rate : null,
      deep_sleep_duration: mainSleep ? mainSleep.deep_sleep_duration : null,     // seconds
      rem_sleep_duration: mainSleep ? mainSleep.rem_sleep_duration : null,       // seconds
      // From daily_activity
      steps: a ? a.steps : null,
      // Raw data for debugging
      _raw: {
        readiness: r || null,
        daily_sleep: ds || null,
        main_sleep_keys: mainSleep ? Object.keys(mainSleep) : [],
        main_sleep: mainSleep || null,
        activity: a || null,
      }
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
