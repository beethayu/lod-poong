// ===== ข้อมูลจาก Garmin Connect (สคริปต์ garmin/sync.py รันบน GitHub Actions ทุกเช้า) =====
// ทางเดินข้อมูล: นาฬิกา → แอป Connect (ซิงก์เบื้องหลัง) → คลาวด์ Garmin → GitHub Actions → importGarmin → ชีต Daily / Log
// ไม่ต้องผ่าน Apple Health และคำสั่งลัด · ได้ค่าที่ Health ไม่มี (HRV, Body Battery, ความเครียด, คะแนนนอน, VO2max)
// token ล็อกอิน Garmin เก็บใน Script Properties GARMIN_TOKENS (ไม่เก็บใน GitHub เพราะ repo เป็นสาธารณะ)

const GM_FIELDS_ = ['steps', 'sleep_min', 'sleep_from', 'sleep_to', 'sleep_score', 'sleep_deep', 'sleep_rem', 'sleep_light',
  'sleep_awake', 'rhr', 'hrv', 'hrv_week', 'hrv_status', 'bb_high', 'bb_low', 'bb_wake', 'stress', 'stress_max', 'readiness',
  'vo2max', 'kcal_active', 'kcal_total', 'int_min', 'floors', 'spo2', 'resp'];

// สคริปต์ขอ token ที่เก็บไว้ (ล็อกอินซ้ำทุกวันจาก GitHub อาจโดน Garmin บล็อก)
function garminTokens() {
  return PropertiesService.getScriptProperties().getProperty('GARMIN_TOKENS') || '';
}

// p = { days: [{date, steps, sleep_min, ...}], acts: [{start, end, type}], tokens: 'JSON' }
function importGarmin(p) {
  p = p || {};
  if (p.tokens && String(p.tokens).charAt(0) === '{') {
    PropertiesService.getScriptProperties().setProperty('GARMIN_TOKENS', String(p.tokens));
  }
  return withLock_(() => {
    const at = today_() + ' ' + nowTime_(), t = today_();
    let nd = 0;
    (p.days || []).forEach(d => {
      let date;
      try { date = isoDate_(d.date); } catch (e) { return; }
      const o = { garmin_at: at };
      GM_FIELDS_.forEach(k => {
        const v = d[k];
        if (v === undefined || v === null || v === '') return;
        o[k] = (k === 'sleep_from' || k === 'sleep_to' || k === 'hrv_status') ? String(v) : Number(v);
      });
      if (Object.keys(o).length < 2) return;
      if (o.steps !== undefined) o.steps_at = date === t ? nowTime_() : '';
      dailyPut_(date, o);
      nd++;
    });
    // ออกกำลังจากนาฬิกา → ใช้ทางเดียวกับ Apple Health (รหัส H+เวลาเริ่ม จึงไม่ลงซ้ำกับที่ทางลัดส่งมา)
    const lines = (p.acts || []).filter(a => a && a.start && a.end).map(a => 'o ' + a.start + ' ' + a.end + ' ' + (a.type || ''));
    const no = lines.length ? importWorkouts_(lines) : { added: 0 };
    try {
      upsert_(SH_.SET, { key: 'gm_last', value: JSON.stringify({ at: at, days: nd, acts: lines.length, added: no.added,
        fields: (p.days || []).length ? Object.keys(p.days[p.days.length - 1]).filter(k => GM_FIELDS_.indexOf(k) >= 0) : [] }) });
    } catch (e) {}
    return { ok: true, days: nd, acts: lines.length, added: no.added };
  });
}
