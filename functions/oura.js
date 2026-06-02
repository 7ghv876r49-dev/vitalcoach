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

    // daily_sleep is the primary source — most recent entry has score + contributors
    const dailySleepEntries = dailySleepData.data || [];
    const ds = dailySleepEntries[dailySleepEntries.length - 1];

    // Match raw sleep session for HRV samples — try daily_sleep date first, fall back
    const sleepSessions = (sleepData.data || []).filter(x => x.type === 'long_sleep');
    const s = ds?.day
      ? (sleepSessions.find(x => x.day === ds.day) || sleepSessions[sleepSessions.length - 1])
      : sleepSessions[sleepSessions.length - 1];

    // HRV avg + max
    // Try raw sleep session first (has HRV samples for max), fall back to daily_sleep contributors
    let hrvAvg = '', hrvMax = '';
    if (s && s.day === ds?.day) {
      // Raw session matches daily_sleep date — use it
      hrvAvg = s.average_hrv ? Math.round(s.average_hrv) : '';
      if (s.hrv && Array.isArray(s.hrv.items)) {
        const valid = s.hrv.items.filter(v => v !== null && v > 0);
        if (valid.length > 0) hrvMax = Math.round(Math.max(...valid));
      }
    } else {
      // Raw session is older — use daily_sleep average_hrv
      hrvAvg = ds?.average_hrv ? Math.round(ds.average_hrv) : (s?.average_hrv ? Math.round(s.average_hrv) : '');
      // Max HRV not available without raw session — leave blank for now
      hrvMax = s?.average_hrv ? Math.round(s.average_hrv) : ''; // best approximation
    }

    // RHR from readiness; min RHR from sleep
    const rhr    = r?.resting_heart_rate || s?.lowest_heart_rate || '';
    const rhrMin = s?.lowest_heart_rate ?? '';

    const sleepScore = ds?.score || '';

    // Total sleep + awake + deep — from daily_sleep contributors or session
    function fmtSleep(sec) {
      if (!sec) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
    // daily_sleep has total_sleep_duration, awake_time, deep_sleep_duration
    const totalSleep = fmtSleep(ds?.total_sleep_duration || s?.total_sleep_duration);
    const awakeMin   = ds?.awake_time ? Math.round(ds.awake_time / 60) : (s?.awake_time ? Math.round(s.awake_time / 60) : '');
    const deepSleep  = fmtSleep(ds?.deep_sleep_duration || s?.deep_sleep_duration);

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
      _date:                    ds?.day ?? s?.day ?? r?.day ?? today,
      _steps_date:              yesterdayActivity ? yesterday : (todayActivity ? today : 'unknown'),
      _debug: {
        daily_sleep_days: dailySleepEntries.map(d => d.day + ':score=' + d.score + ':hrv=' + d.average_hrv).join('|'),
        readiness_days:   (readinessData.data||[]).map(r => r.day + ':' + r.score).join('|'),
        sleep_session:    s?.day + ':' + s?.type + ':hrv=' + s?.average_hrv,
        ds_day:           ds?.day,
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
