export async function onRequest(context) {
  const PAT = context.env.OURA_PAT;
  if (!PAT) {
    return new Response(JSON.stringify({ error: 'OURA_PAT not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
 
  const headers = {
    'Authorization': `Bearer ${PAT}`,
    'Content-Type': 'application/json'
  };
 
  const now = new Date();
 
  // Oura sleep day = 6pm yesterday to 6pm today
  // Use a wide window to catch all sessions regardless of timezone
  const start = new Date(now - 36 * 3600 * 1000); // 36 hours ago
  const end   = new Date(now +  6 * 3600 * 1000); // 6 hours ahead
 
  const startStr = start.toISOString().split('T')[0];
  const endStr   = end.toISOString().split('T')[0];
  const today    = now.toISOString().split('T')[0];
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
 
  try {
    // Fetch sleep sessions, readiness, and activity in parallel
    const [sleepRes, readinessRes, activityRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${yesterday}&end_date=${today}`, { headers }),
    ]);
 
    const [sleepData, readinessData, activityData] = await Promise.all([
      sleepRes.json(), readinessRes.json(), activityRes.json()
    ]);
 
    // Log raw response for debugging
    const rawLog = {
      sleep_sessions: sleepData.data?.map(s => ({
        day: s.day, type: s.type, score: s.score,
        average_hrv: s.average_hrv, average_heart_rate: s.average_heart_rate,
        lowest_heart_rate: s.lowest_heart_rate,
        total_sleep_duration: s.total_sleep_duration,
        awake_time: s.awake_time, deep_sleep_duration: s.deep_sleep_duration,
        bedtime_start: s.bedtime_start, bedtime_end: s.bedtime_end,
      })),
      readiness: readinessData.data?.map(r => ({ day: r.day, score: r.score, resting_heart_rate: r.resting_heart_rate })),
    };
 
    // Find the most recent long_sleep session
    const sessions = (sleepData.data || [])
      .filter(s => s.type === 'long_sleep')
      .sort((a, b) => new Date(b.bedtime_end || b.day) - new Date(a.bedtime_end || a.day));
 
    const s = sessions[0]; // most recent long sleep
 
    // Most recent readiness
    const readinessList = (readinessData.data || []).sort((a, b) => new Date(b.day) - new Date(a.day));
    const r = readinessList[0];
 
    if (!s) {
      return new Response(JSON.stringify({
        error: 'No long_sleep session found',
        raw: rawLog
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
 
    function fmtSleep(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
 
    // HRV: average_hrv directly from sleep session
    const hrvAvg = s.average_hrv ? Math.round(s.average_hrv) : '';
 
    // Max HRV from HRV samples if available
    let hrvMax = '';
    if (s.hrv && Array.isArray(s.hrv.items)) {
      const valid = s.hrv.items.filter(v => v !== null && v > 0);
      if (valid.length > 0) hrvMax = Math.round(Math.max(...valid));
    }
 
    // RHR: resting_heart_rate from readiness (matches Oura app display)
    // lowest_heart_rate from session = overnight minimum
    const rhr    = r?.resting_heart_rate || s.average_heart_rate || '';
    const rhrMin = s.lowest_heart_rate || '';
 
    // Sleep score from session
    const sleepScore = s.score || '';
 
    // Body temp from readiness (°C → °F delta)
    let bodyTemp = '';
    if (r?.temperature_deviation != null) {
      const f = r.temperature_deviation * 1.8;
      bodyTemp = (f >= 0 ? '+' : '') + f.toFixed(1);
    }
 
    // Steps: yesterday's completed count
    const acts = (activityData.data || []).sort((a, b) => new Date(b.day) - new Date(a.day));
    const yesterdayAct = acts.find(a => a.day === yesterday);
    const steps = yesterdayAct?.steps ?? acts[0]?.steps ?? '';
 
    const result = {
      readiness_score:          r?.score ?? '',
      sleep_score:              sleepScore,
      average_hrv:              hrvAvg,
      hrv_max:                  hrvMax,
      resting_heart_rate:       rhr,
      lowest_heart_rate:        rhrMin,
      total_sleep_duration_fmt: fmtSleep(s.total_sleep_duration),
      deep_sleep_fmt:           fmtSleep(s.deep_sleep_duration),
      awake_time_min:           s.awake_time ? Math.round(s.awake_time / 60) : '',
      temperature_deviation_f:  bodyTemp,
      steps:                    steps,
      _date:                    s.day,
      _steps_date:              yesterdayAct ? yesterday : 'fallback',
      _raw:                     rawLog,
    };
 
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
 
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
 
