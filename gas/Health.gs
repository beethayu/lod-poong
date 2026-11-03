// ===== นำเข้าจากทางลัด iOS (Apple Health ← Xiaomi Home / Garmin Connect) =====
// รับข้อความหลายบรรทัด ตัวนำหน้าบอกชนิด (วันที่แบบ ISO 8601 จากทางลัด):
//   w <วันที่> 108.0                   น้ำหนัก กก.
//   f <วันที่> 32.3                    % ไขมัน (0.323 ก็ได้)
//   s <วันที่ (จัดกลุ่มตามวัน)> 6836    ก้าวรวมของวันนั้น
//   n <เริ่ม> <จบ> <ค่า>                ช่วงการนอน (ค่า = หลับ/แกนกลาง/ลึก/REM/ตื่น/อยู่บนเตียง)
//   o <เริ่ม> <จบ> <ประเภท>             การออกกำลังที่บันทึกในนาฬิกา
// ไม่มีตัวนำหน้า = น้ำหนัก/ไขมันแบบเดิม · ส่งซ้ำได้ ไม่ลงเบิ้ล

const ISO_RE_ = /(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g;
const STEP_BASE_ = 5000;      // ก้าวปกติที่รวมอยู่ในระดับกิจกรรมแล้ว
const STEP_KCAL_KG_ = 0.0005; // แคลต่อก้าวต่อ กก. น้ำหนักตัว

function isoMs_(m) {
  const tz = m[5] ? (m[5] === 'Z' ? 'Z' : m[5].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : '+07:00';
  return new Date(m[1] + 'T' + String(m[2] || '0').padStart(2, '0') + ':' + (m[3] || '00') + ':' + (m[4] || '00') + tz).getTime();
}
function bkk_(ms, f) { return Utilities.formatDate(new Date(ms), 'Asia/Bangkok', f); }

function importHealth(text) {
  return withLock_(() => {
    const lines = (Array.isArray(text) ? text : String(text || '').split(/[\n;]+/)).map(s => String(s).trim()).filter(Boolean);
    const wf = [], st = [], sl = [], wo = [];
    lines.forEach(line => {
      const k = (line.match(/^\s*([a-z])\s/i) || [])[1];
      const kk = k ? k.toLowerCase() : '';
      if (kk === 's') st.push(line); else if (kk === 'n') sl.push(line); else if (kk === 'o') wo.push(line);
      else if (!kk || kk === 'w' || kk === 'f') wf.push(line);
    });
    const r = importWeight_(wf);
    const ns = importSteps_(st), nn = importSleep_(sl), no = importWorkouts_(wo);
    const msg = [];
    if (wf.length) msg.push('น้ำหนัก +' + r.added + (r.updated ? ' (เติมไขมัน ' + r.updated + ')' : ''));
    if (st.length) msg.push('ก้าว ' + ns + ' วัน');
    if (sl.length) msg.push('นอน ' + nn + ' คืน');
    if (wo.length) msg.push('ออกกำลัง +' + no.added);
    return { ok: true, added: r.added, updated: r.updated, skipped: r.skipped, steps: ns, sleep: nn, workouts: no.added,
      message: 'ลดพุง: ' + (msg.length ? msg.join(' · ') : 'ไม่มีข้อมูลใหม่') };
  });
}

function dailyPut_(date, o) {
  const sh = sheet_(SH_.DAILY);
  const r = findRow_(sh, date);
  let cur = { date: date };
  if (r > 0) {
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const v = sh.getRange(r, 1, 1, head.length).getDisplayValues()[0];
    head.forEach((h, i) => cur[h] = v[i]);
  }
  Object.assign(cur, o, { date: date, updated_at: nowStr_() });
  upsert_(SH_.DAILY, cur);
}

function importSteps_(lines) {
  const day = {};
  lines.forEach(line => {
    ISO_RE_.lastIndex = 0;
    const m = ISO_RE_.exec(line); if (!m) return;
    const date = m[2] ? bkk_(isoMs_(m), 'yyyy-MM-dd') : m[1];
    const rest = line.slice(m.index + m[0].length);
    const nm = rest.replace(/[,\s](?=\d{3}\b)/g, '').match(/\d+(?:\.\d+)?/);
    if (!nm) return;
    day[date] = (day[date] || 0) + Number(nm[0]);
  });
  const now = nowTime_(), t = today_();
  Object.keys(day).forEach(d => dailyPut_(d, { steps: Math.round(day[d]), steps_at: d === t ? now : '' }));
  return Object.keys(day).length;
}

function importSleep_(lines) {
  const nights = {};
  lines.forEach(line => {
    ISO_RE_.lastIndex = 0;
    const a = ISO_RE_.exec(line), b = a && ISO_RE_.exec(line);
    if (!a || !b) return;
    const val = line.slice(b.index + b[0].length).trim();
    if (/bed|เตียง|awake|ตื่น/i.test(val)) return;
    const s = isoMs_(a), e = isoMs_(b);
    if (!(e > s) || e - s > 16 * 3600000) return;
    const key = bkk_(e + 6 * 3600000, 'yyyy-MM-dd');   // คืนนี้ นับเป็นวันที่ตื่น
    (nights[key] = nights[key] || []).push([s, e]);
  });
  Object.keys(nights).forEach(d => {
    const iv = nights[d].sort((x, y) => x[0] - y[0]), merged = [];
    iv.forEach(x => { const l = merged[merged.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else merged.push([x[0], x[1]]); });
    const total = merged.reduce((s, x) => s + x[1] - x[0], 0);
    // ช่วงหลัก = ก้อนที่ยาวสุด (ช่องว่างเกิน 2 ชม. แยกก้อน เช่น งีบกลางวัน)
    const blocks = [];
    merged.forEach(x => { const l = blocks[blocks.length - 1]; if (l && x[0] - l.e <= 2 * 3600000) { l.e = x[1]; l.m += x[1] - x[0]; } else blocks.push({ s: x[0], e: x[1], m: x[1] - x[0] }); });
    const main = blocks.sort((x, y) => y.m - x.m)[0];
    dailyPut_(d, { sleep_min: Math.round(total / 60000), sleep_from: bkk_(main.s, 'HH:mm'), sleep_to: bkk_(main.e, 'HH:mm') });
  });
  return Object.keys(nights).length;
}

const WO_MAP_ = [
  [/run|วิ่ง/i, 'วิ่ง', 8], [/hik|เดินป่า/i, 'เดินป่า', 6], [/walk|เดิน/i, 'เดินเร็ว', 4.3], [/cycl|bik|ปั่น/i, 'ปั่นจักรยาน', 6],
  [/swim|ว่าย/i, 'ว่ายน้ำ', 6], [/strength|weight|ความแข็งแรง|ความแข็งแกร่ง|เวท|ยกน้ำหนัก/i, 'เวท', 5],
  [/hiit|interval/i, 'HIIT', 8], [/yoga|โยคะ/i, 'โยคะ', 2.5], [/ellip|อีลิป/i, 'เครื่องเดินวงรี', 5], [/row|พาย/i, 'พายเรือ', 6]
];

function importWorkouts_(lines) {
  const log = rows_(SH_.LOG), skip = settings_().hk_skip || [];
  const lw = latestWeight_(log) || { weight: 100 };
  let added = 0;
  lines.forEach(line => {
    ISO_RE_.lastIndex = 0;
    const a = ISO_RE_.exec(line), b = a && ISO_RE_.exec(line);
    if (!a || !b) return;
    const s = isoMs_(a), e = isoMs_(b), min = Math.round((e - s) / 60000);
    if (!(min >= 3) || min > 600) return;
    const type = line.slice(b.index + b[0].length).trim();
    const mp = WO_MAP_.find(x => x[0].test(type)) || [null, type || 'ออกกำลัง', 4];
    const id = 'H' + Math.round(s / 60000).toString(36).toUpperCase();
    if (skip.indexOf(id) >= 0) return;
    const date = bkk_(s, 'yyyy-MM-dd'), time = bkk_(s, 'HH:mm');
    const kcal = Math.round(mp[2] * lw.weight * min / 60);
    const have = log.find(l => l.msg_id === id);
    if (have) {
      if (num_(have.minutes) !== min) { have.minutes = min; have.kcal = kcal; upsert_(SH_.LOG, have); }
      return;
    }
    // จดไว้ในแอปแล้ว (เวลาใกล้กัน ±90 นาที) → ไม่ลงซ้ำ
    const tm = x => { const p = String(x || '00:00').split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); };
    if (log.some(l => l.kind === 'exercise' && l.date === date && l.source !== 'health' && Math.abs(tm(l.time) - tm(time)) <= 90)) return;
    const o = cleanLog_({ kind: 'exercise', date: date, time: time, name: 'นาฬิกา: ' + mp[1], minutes: min, kcal: kcal,
      source: 'health', msg_id: id, note: 'Garmin/Apple Health' + (type && type !== mp[1] ? ' · ' + type : '') });
    upsert_(SH_.LOG, o); log.push(o); added++;
  });
  return { added: added };
}

// แคลจากก้าวที่เกินปกติ (ยังไม่หารสอง) — หักก้าวช่วงเดิน/วิ่งที่จดเป็นออกกำลังแล้ว
function stepKcal_(steps, weight, dayLogs) {
  let used = 0;
  (dayLogs || []).forEach(l => {
    if (l.kind !== 'exercise') return;
    if (/วิ่ง|run/i.test(l.name)) used += num_(l.minutes) * 150;
    else if (/เดิน|walk|hik/i.test(l.name)) used += num_(l.minutes) * 110;
  });
  const extra = Math.max(0, num_(steps) - STEP_BASE_ - used);
  return Math.round(extra * STEP_KCAL_KG_ * (weight || 100) / 5) * 5;
}
