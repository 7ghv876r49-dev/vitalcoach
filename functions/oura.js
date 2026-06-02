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
  const today     = now.toISOString().split('T')[0];
  const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
  const threeDaysAgo = new Date(now - 3 * 86400000).toISOString().split('T')[0];
  const tomorrow  = new Date(now + 86400000).toISOString().split('T')[0];
 
  try {
    const [readinessRes, sleepRes, activityRes, dailySleepRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${threeDaysAgo}&end_date=${tomorrow}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${threeDaysAgo}&end_date=${tomorrow}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${threeDaysAgo}&end_date=${tomorrow}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${threeDaysAgo}&end_date=${tomorrow}`, { headers }),
    ]);
 
    const [readinessData, sleepData, activityData, dailySleepData] = await Promise.all([
      readinessRes.json(), sleepRes.json(), activityRes.json(), dailySleepRes.json(),
    ]);
 
    // Most recent readiness
    const r = readinessData.data?.[readinessData.data.length - 1];
 
    // Most recent long_sleep session
    const sleepSessions = (sleepData.data || []).filter(x => x.type === 'long_sleep');
    const s = sleepSessions[sleepSessions.length - 1];
 
    // daily_sleep has the sleep score — match by day
    const dailySleepEntries = dailySleepData.data || [];
    const ds = s
      ? (dailySleepEntries.find(d => d.day === s.day) || dailySleepEntries[dailySleepEntries.length - 1])
      : dailySleepEntries[dailySleepEntries.length - 1];
 
    // HRV avg + max from sleep session
    let hrvAvg = '', hrvMax = '';
    if (s) {
      hrvAvg = s.average_hrv ? Math.round(s.average_hrv) : '';
      if (s.hrv && Array.isArray(s.hrv.items)) {
        const valid = s.hrv.items.filter(v => v !== null && v > 0);
        if (valid.length > 0) hrvMax = Math.round(Math.max(...valid));
      }
    }
 
    // RHR from readiness; min RHR from sleep
    const rhr    = r?.resting_heart_rate || s?.lowest_heart_rate || '';
    const rhrMin = s?.lowest_heart_rate ?? '';
 
    // Sleep score from daily_sleep endpoint
    const sleepScore = ds?.score || '';
 
    // Total sleep + awake
    function fmtSleep(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
    const totalSleep = s?.total_sleep_duration ? fmtSleep(s.total_sleep_duration) : '';
    const awakeMin   = s?.awake_time ? Math.round(s.awake_time / 60) : '';
 
    // Deep sleep
    const deepSleep = s?.deep_sleep_duration ? fmtSleep(s.deep_sleep_duration) : '';
 
    // Body temp: Oura returns °C deviation — convert to °F delta (×1.8)
    let bodyTemp = '';
    if (r?.temperature_deviation != null) {
      const tempF = r.temperature_deviation * 1.8;
      bodyTemp = (tempF >= 0 ? '+' : '') + tempF.toFixed(1);
    }
 
    // Steps: use yesterday's completed count (today resets to 0 in morning)
    const yesterdayActivity = activityData.data?.find(a => a.day === yesterday);
    const todayActivity     = activityData.data?.find(a => a.day === today);
    const steps = yesterdayActivity?.steps ?? todayActivity?.steps ?? '';
 
    const result = {
      readiness_score:          r?.score ?? '',
      sleep_score:              sleepScore,
      average_hrv:              hrvAvg,
      hrv_max:                  hrvMax,
      resting_heart_rate:       rhr,
      lowest_heart_rate:        rhrMin,
      total_sleep_duration_fmt: totalSleep,
      deep_sleep_fmt:           deepSleep,
      awake_time_min:           awakeMin,
      temperature_deviation_f:  bodyTemp,
      steps:                    steps,
      _date:                    s?.day ?? r?.day ?? today,
      _steps_date:              yesterdayActivity ? yesterday : (todayActivity ? today : 'unknown'),
      _debug: {
        daily_sleep_days: dailySleepEntries.map(d => d.day + ':' + d.score).join('|'),
        readiness_days:   (readinessData.data||[]).map(r => r.day + ':' + r.score).join('|'),
        sleep_session:    s?.day + ':' + s?.type,
      },
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
