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
 
  const start = new Date(now.getTime() - (4 * 24 * 60 * 60 * 1000)); 
  const end   = new Date(now.getTime() + (1 * 24 * 60 * 60 * 1000)); 
 
  const startStr = start.toISOString().split('T')[0];
  const endStr   = end.toISOString().split('T')[0];
  const today    = now.toISOString().split('T')[0];
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
 
  try {
    const [sleepRes, readinessRes, dailySleepRes, activityRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startStr}&end_date=${endStr}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${startStr}&end_date=${endStr}`, { headers }),
    ]);
 
    const [sleepData, readinessData, dailySleepData, activityData] = await Promise.all([
      sleepRes.json(), readinessRes.json(), dailySleepRes.json(), activityRes.json()
    ]);
 
    const sessions = (sleepData.data || [])
      .filter(s => s.type === 'long_sleep')
      .sort((a, b) => new Date(b.bedtime_end) - new Date(a.bedtime_end));
 
    const s = sessions[0];
 
    const readinessList = (readinessData.data || []).sort((a, b) => new Date(b.day) - new Date(a.day));
    const r = readinessList[0];
 
    if (!s) {
      return new Response(JSON.stringify({
        error: 'No long_sleep session found in the requested range.',
        debug_dates: { startStr, endStr },
        raw_sleep_count: sleepData.data?.length || 0
      }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
 
    function fmtSleep(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
 
    const hrvAvg = s.average_hrv ? Math.round(s.average_hrv) : '';
    // Target the true overnight average for RHR, and use lowest as a fallback
    const rhr = s.average_heart_rate ? Math.round(s.average_heart_rate) : (r?.resting_heart_rate || '');
    const rhrMin = s.lowest_heart_rate || '';
    
    const sortedDailySleep = (dailySleepData.data || []).sort((a, b) => new Date(b.day) - new Date(a.day));
    const sleepScore = sortedDailySleep[0]?.score || '';
 
    let hrvMax = '';
    if (s.hrv && Array.isArray(s.hrv.items)) {
      const valid = s.hrv.items.filter(v => v !== null && v > 0);
      if (valid.length > 0) hrvMax = Math.round(Math.max(...valid));
    }
 
    let bodyTemp = '';
    if (r?.temperature_deviation != null) {
      const f = r.temperature_deviation * 1.8;
      bodyTemp = (f >= 0 ? '+' : '') + f.toFixed(1);
    }
 
    const sortedActivity = (activityData.data || []).sort((a, b) => new Date(b.day) - new Date(a.day));
    const steps = sortedActivity[1]?.steps ?? sortedActivity[0]?.steps ?? '';
 
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
      _steps_date:              sortedActivity[1]?.day || 'none',
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
