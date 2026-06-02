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
  const today = now.toISOString().split('T')[0];
  const twoDaysAgo = new Date(now - 2 * 86400000).toISOString().split('T')[0];
 
  try {
    const [readinessRes, sleepRes, activityRes] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${twoDaysAgo}&end_date=${today}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${twoDaysAgo}&end_date=${today}`, { headers }),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${twoDaysAgo}&end_date=${today}`, { headers }),
    ]);
 
    const [readinessData, sleepData, activityData] = await Promise.all([
      readinessRes.json(),
      sleepRes.json(),
      activityRes.json(),
    ]);
 
    const r = readinessData.data?.[readinessData.data.length - 1];
    const sleepSessions = (sleepData.data || []).filter(s => s.type === 'long_sleep');
    const s = sleepSessions[sleepSessions.length - 1];
    const a = activityData.data?.[activityData.data.length - 1];
 
    // HRV: avg from sleep session; max from 5-min HRV samples
    let hrvAvg = '';
    let hrvMax = '';
    if (s) {
      hrvAvg = s.average_hrv ? Math.round(s.average_hrv) : '';
      if (s.hrv && Array.isArray(s.hrv.items)) {
        const valid = s.hrv.items.filter(v => v !== null && v > 0);
        if (valid.length > 0) hrvMax = Math.round(Math.max(...valid));
      }
    }
 
    // RHR: resting_heart_rate from readiness = the reported RHR value (matches Oura app)
    // lowest_heart_rate from sleep = true overnight minimum (min RHR)
    const rhr    = r?.resting_heart_rate ?? '';
    const rhrMin = s?.lowest_heart_rate ?? '';
 
    // Total sleep + awake
    function fmtSleep(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
    const totalSleep = s?.total_sleep_duration ? fmtSleep(s.total_sleep_duration) : '';
    const awakeMin   = s?.awake_time ? Math.round(s.awake_time / 60) : '';
 
    // Body temp: Oura returns deviation in CELSIUS — convert to Fahrenheit (×1.8, no +32 since it's a delta)
    let bodyTemp = '';
    if (r?.temperature_deviation !== undefined && r?.temperature_deviation !== null) {
      const tempF = r.temperature_deviation * 1.8;
      bodyTemp = (tempF >= 0 ? '+' : '') + tempF.toFixed(1);
    }
 
    // Steps: always use yesterday's completed activity (today resets to 0 in morning)
    // Find yesterday's activity entry specifically
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
    const yesterdayActivity = activityData.data?.find(a => a.day === yesterday);
    const todayActivity = activityData.data?.find(a => a.day === today);
    // Use yesterday's steps; fall back to most recent if yesterday not found
    const steps = yesterdayActivity?.steps ?? todayActivity?.steps ?? a?.steps ?? '';
 
    const result = {
      readiness_score:    r?.score ?? '',
      sleep_score:        s?.score ?? '',
      average_hrv:        hrvAvg,
      hrv_max:            hrvMax,
      resting_heart_rate: rhr,
      lowest_heart_rate:  rhrMin,
      total_sleep_duration_fmt: totalSleep,
      awake_time_min:     awakeMin,
      temperature_deviation_f: bodyTemp,
      steps:              steps,
      _date:              s?.day ?? r?.day ?? today,
      _steps_date:        yesterdayActivity ? yesterday : (todayActivity ? today : 'unknown'),
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
 
