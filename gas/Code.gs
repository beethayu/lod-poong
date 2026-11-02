// ===== ลดพุง: จดแคลอรี่ + ออกกำลัง + น้ำหนัก + โค้ช AI =====
// วันที่เก็บเป็นข้อความ yyyy-mm-dd (ค.ศ.) — หน้าเว็บแสดงเป็น พ.ศ.

const SH_ = {
  LOG: { name: 'Log', head: ['log_id', 'date', 'time', 'kind', 'meal', 'name', 'qty', 'kcal', 'protein', 'carb', 'fat',
    'ml', 'weight', 'fat_pct', 'muscle', 'minutes', 'source', 'msg_id', 'photo_id', 'note', 'created_at'] },
  CHAT: { name: 'Chat', head: ['msg_id', 'at', 'role', 'text', 'photo_id', 'log_ids', 'undone'] },
  SET: { name: 'Settings', head: ['key', 'value'] },
  TIP: { name: 'Tips', head: ['date', 'text', 'created_at'] },
  BODY: { name: 'BodyPhotos', head: ['photo_id', 'date', 'pose', 'file_id', 'thumb', 'created_at'] },
  SETS: { name: 'Sets', head: ['set_id', 'date', 'session_id', 'day_idx', 'ex_id', 'ex_name', 'set_no', 'reps', 'kg', 'feel', 'msg_id', 'created_at'] }
};
const TXT_COLS_ = ['date', 'time', 'at', 'key', 'value', 'qty'];
const KINDS_ = ['food', 'exercise', 'water', 'weight'];
const MEALS_ = ['breakfast', 'lunch', 'dinner', 'snack'];

// ค่าเริ่มต้น (จากเครื่องชั่ง Xiaomi 18 ต.ค. 2569)
const DEFAULT_SET_ = {
  sex: 'male', height: 177, age: '', activity: 1.375, goal_weight: 100, rate: 2, water_goal: 2500,
  macro_auto: true, kcal: '', protein: '', carb: '', fat: '',
  focus: 'ลดไขมันหน้าท้อง · อาหารไทย/ร้านสะดวกซื้อ · โปรตีนพอเก็บกล้าม · ท่าไม่กระแทกเข่า'
};
const FIRST_WEIGHT_ = { date: '2026-10-18', weight: 108.0, fat_pct: 32.3, muscle: 69.1 };

// ---------- ชีต ----------
var ss__ = null, sheets__ = {};
function ss_() { return ss__ || (ss__ = SpreadsheetApp.getActiveSpreadsheet()); }

// จำชีตไว้ในรอบเรียกเดียวกัน (ไม่ต้องอ่านหัวตารางซ้ำทุกครั้ง)
function sheet_(def) {
  if (sheets__[def.name]) return sheets__[def.name];
  return (sheets__[def.name] = sheetInit_(def));
}
function sheetInit_(def) {
  const ss = ss_();
  let sh = ss.getSheetByName(def.name);
  if (!sh) {
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    def.head.forEach((h, i) => { if (TXT_COLS_.indexOf(h) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@'); });
    return sh;
  }
  const cur = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
  def.head.forEach(h => {
    if (cur.indexOf(h) < 0) {
      const c = sh.getLastColumn() + 1;
      sh.getRange(1, c).setValue(h).setFontWeight('bold');
      if (TXT_COLS_.indexOf(h) >= 0) sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
      cur.push(h);
    }
  });
  return sh;
}

function rows_(def) {
  const sh = sheet_(def);
  const v = sh.getDataRange().getValues();
  const head = v[0];
  return v.slice(1).filter(r => r[0] !== '').map(r => {
    const o = {};
    head.forEach((h, i) => {
      let x = r[i];
      if (x instanceof Date) x = Utilities.formatDate(x, 'Asia/Bangkok', h === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
      o[h] = x;
    });
    return o;
  });
}

function toRow_(sh, o) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return head.map(h => (o[h] === undefined || o[h] === null) ? '' : o[h]);
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(1, 1, last, 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}

function upsert_(def, o) {
  const sh = sheet_(def);
  const r = findRow_(sh, o[def.head[0]]);
  const row = toRow_(sh, o);
  if (r > 0) sh.getRange(r, 1, 1, row.length).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function appendMany_(def, list) {
  if (!list.length) return;
  const sh = sheet_(def);
  const rows = list.map(o => toRow_(sh, o));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function deleteWhere_(def, pred) {
  const sh = sheet_(def);
  const v = sh.getDataRange().getValues();
  const head = v[0];
  let n = 0;
  for (let i = v.length - 1; i >= 1; i--) {
    const o = {}; head.forEach((h, k) => o[h] = v[i][k]);
    if (v[i][0] !== '' && pred(o)) { sh.deleteRow(i + 1); n++; }
  }
  return n;
}

function newId_(p) { return p + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase(); }
function today_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd'); }
function nowTime_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'HH:mm'); }
function nowStr_() { return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'); }
function num_(x) { const n = Number(String(x == null ? '' : x).replace(/,/g, '')); return isFinite(n) ? Math.round(n * 10) / 10 : 0; }
function addDays_(iso, k) {
  const d = new Date(iso + 'T12:00:00+07:00'); d.setDate(d.getDate() + k);
  return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
}
function isoDate_(s) {
  s = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error('วันที่ไม่ถูกต้อง: ' + s);
}
function isTrue_(x) { return x === true || String(x).toUpperCase() === 'TRUE' || x === 1 || x === '1'; }
var inLock_ = false;
function withLock_(f) {
  if (inLock_) return f();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  inLock_ = true;
  try { return f(); } finally { inLock_ = false; lock.releaseLock(); }
}

function setupSheets_() {
  Object.keys(SH_).forEach(k => sheet_(SH_[k]));
  const ss = ss_();
  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  if (!rows_(SH_.SET).length) {
    appendMany_(SH_.SET, Object.keys(DEFAULT_SET_).map(k => ({ key: k, value: JSON.stringify(DEFAULT_SET_[k]) })));
  }
  if (!rows_(SH_.LOG).length) {
    appendMany_(SH_.LOG, [Object.assign({ log_id: newId_('L'), time: '07:00', kind: 'weight', name: 'น้ำหนัก',
      source: 'manual', note: 'เครื่องชั่ง Xiaomi', created_at: nowStr_() }, FIRST_WEIGHT_)]);
  }
}

// ---------- ตั้งค่า ----------
function settings_() {
  const s = Object.assign({}, DEFAULT_SET_);
  rows_(SH_.SET).forEach(r => { try { s[r.key] = JSON.parse(r.value); } catch (e) { s[r.key] = r.value; } });
  return s;
}

function saveSettings(obj) {
  return withLock_(() => {
    const sh = sheet_(SH_.SET);
    Object.keys(obj || {}).forEach(k => {
      if (!/^[a-z_]+$/.test(k)) return;
      const o = { key: k, value: JSON.stringify(obj[k]) };
      upsert_(SH_.SET, o);
    });
    return getAll();
  });
}

// ---------- ข้อมูลทั้งหมด ----------
function getAll() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('API_KEY')) return { needsSetup: true, today: today_() };
  if (!ss_().getSheetByName(SH_.LOG.name)) setupSheets_();
  const t = today_();
  const from = addDays_(t, -400);
  const chat = rows_(SH_.CHAT);
  const tip = rows_(SH_.TIP).filter(x => x.date === t).pop();
  return {
    today: t,
    now: nowTime_(),
    version: APP_VERSION,
    settings: settings_(),
    log: rows_(SH_.LOG).filter(l => String(l.date) >= from),
    chat: chat.slice(-80),
    tip: tip ? tip.text : '',
    photos: bodyPhotos_(),
    sets: rows_(SH_.SETS).filter(x => String(x.date) >= addDays_(t, -180)),
    gemini: !!props.getProperty('GEMINI_KEY'),
    sheetUrl: ss_().getUrl()
  };
}

// ---------- บันทึก ----------
function cleanLog_(o) {
  const kind = KINDS_.indexOf(o.kind) >= 0 ? o.kind : 'food';
  const out = {
    log_id: o.log_id || newId_('L'),
    date: isoDate_(o.date || today_()),
    time: /^\d{1,2}:\d{2}$/.test(String(o.time || '')) ? String(o.time).padStart(5, '0') : nowTime_(),
    kind: kind,
    meal: kind === 'food' ? (MEALS_.indexOf(o.meal) >= 0 ? o.meal : mealOf_(o.time || nowTime_())) : '',
    name: String(o.name || '').trim().slice(0, 120),
    qty: String(o.qty || '').trim().slice(0, 60),
    kcal: '', protein: '', carb: '', fat: '', ml: '', weight: '', fat_pct: '', muscle: '', minutes: '',
    source: o.source || 'manual',
    msg_id: o.msg_id || '',
    photo_id: o.photo_id || '',
    note: String(o.note || '').trim().slice(0, 300),
    created_at: o.created_at || nowStr_()
  };
  if (kind === 'food') {
    if (!out.name) throw new Error('ใส่ชื่ออาหาร');
    out.kcal = Math.max(0, Math.round(num_(o.kcal)));
    ['protein', 'carb', 'fat'].forEach(k => out[k] = Math.max(0, num_(o[k])));
  } else if (kind === 'exercise') {
    if (!out.name) throw new Error('ใส่ชื่อการออกกำลัง');
    out.minutes = Math.max(0, Math.round(num_(o.minutes)));
    out.kcal = Math.max(0, Math.round(num_(o.kcal)));
  } else if (kind === 'water') {
    out.ml = Math.round(num_(o.ml));
    if (!out.ml) throw new Error('ใส่ปริมาณน้ำ');
    out.name = out.name || 'น้ำ';
  } else if (kind === 'weight') {
    out.weight = num_(o.weight);
    if (out.weight < 30 || out.weight > 300) throw new Error('น้ำหนักไม่ถูกต้อง');
    out.fat_pct = o.fat_pct === '' || o.fat_pct == null ? '' : num_(o.fat_pct);
    out.muscle = o.muscle === '' || o.muscle == null ? '' : num_(o.muscle);
    out.name = 'น้ำหนัก';
  }
  return out;
}

function mealOf_(hhmm) {
  const h = Number(String(hhmm).split(':')[0]) + Number(String(hhmm).split(':')[1] || 0) / 60;
  if (h >= 4 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 14.5) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snack';
}

function saveLog(o) {
  return withLock_(() => {
    const clean = cleanLog_(o || {});
    upsert_(SH_.LOG, clean);
    return getAll();
  });
}

function deleteLog(id) {
  return withLock_(() => {
    deleteWhere_(SH_.LOG, l => String(l.log_id) === String(id));
    return getAll();
  });
}

// แตะทีละแก้ (ml บวก = เพิ่ม, ลบ = เอาออกอันล่าสุดของวันนั้น)
function addWater(date, ml) {
  return withLock_(() => {
    date = isoDate_(date || today_());
    ml = Math.round(num_(ml)) || 250;
    if (ml > 0) {
      upsert_(SH_.LOG, cleanLog_({ kind: 'water', date: date, ml: ml, source: 'tap' }));
    } else {
      const last = rows_(SH_.LOG).filter(l => l.kind === 'water' && l.date === date).pop();
      if (last) deleteWhere_(SH_.LOG, l => l.log_id === last.log_id);
    }
    return getAll();
  });
}

// ---------- นำเข้าน้ำหนักจากทางลัด iOS (Apple Health ← Xiaomi Home) ----------
// รับข้อความหลายบรรทัด แต่ละบรรทัดมีวันที่ (yyyy-mm-dd หรือ ISO 8601) + ตัวเลข
//   w 2026-10-18T07:12:00+07:00 108.0   (น้ำหนัก กก.)
//   f 2026-10-18T07:12:00+07:00 32.3    (% ไขมัน — 0.323 ก็ได้)
// ไม่มีตัวนำหน้า: เลข > 45 = น้ำหนัก, ไม่งั้น = % ไขมัน · หลายค่าในวันเดียวกันใช้ค่าล่าสุด · วันที่มีน้ำหนักแล้วไม่ลงซ้ำ (เติม % ไขมันให้ได้)
function importHealth(text) {
  return withLock_(() => {
    const lines = (Array.isArray(text) ? text : String(text || '').split(/[\n;]+/)).map(s => String(s).trim()).filter(Boolean);
    const day = {};
    lines.forEach(line => {
      const m = line.match(/(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
      if (!m) return;
      const rest = line.slice(line.indexOf(m[0]) + m[0].length).replace(/[+-]\d{2}:?\d{2}\b/, '').replace(/:\d{2}(\.\d+)?/, '');
      const nm = rest.match(/(\d+(?:[.,]\d+)?)/);
      if (!nm) return;
      let v = Number(nm[1].replace(',', '.'));
      let k = (line.match(/^\s*([wf])\b/i) || [])[1];
      k = k ? k.toLowerCase() : (v > 45 ? 'w' : 'f');
      if (k === 'f' && v < 1) v = v * 100;
      const time = m[2] ? String(m[2]).padStart(2, '0') + ':' + m[3] : '07:00';
      const d = (day[m[1]] = day[m[1]] || {});
      if (!d[k] || time >= d[k].time) d[k] = { v: Math.round(v * 10) / 10, time: time };
    });
    const sh = sheet_(SH_.LOG);
    const log = rows_(SH_.LOG).filter(l => l.kind === 'weight');
    let added = 0, updated = 0, skipped = 0;
    const add = [];
    Object.keys(day).sort().forEach(date => {
      const d = day[date];
      const have = log.filter(l => l.date === date);
      if (!d.w) {
        // มีแต่ % ไขมัน → เติมให้แถวน้ำหนักของวันนั้นที่ยังไม่มี
        const h = have.find(l => l.fat_pct === '' || l.fat_pct == null);
        if (h && d.f) { h.fat_pct = d.f.v; upsert_(SH_.LOG, h); updated++; } else skipped++;
        return;
      }
      if (have.length) {
        const h = have.find(l => (l.fat_pct === '' || l.fat_pct == null) && Math.abs(num_(l.weight) - d.w.v) < 0.05);
        if (h && d.f) { h.fat_pct = d.f.v; upsert_(SH_.LOG, h); updated++; } else skipped++;
        return;
      }
      add.push(cleanLog_({ kind: 'weight', date: date, time: d.w.time, weight: d.w.v, fat_pct: d.f ? d.f.v : '',
        source: 'shortcut', note: 'Apple Health' }));
      added++;
    });
    appendMany_(SH_.LOG, add);
    return { ok: true, added: added, updated: updated, skipped: skipped,
      message: 'ลดพุง: เพิ่ม ' + added + ' วัน' + (updated ? ' · เติม % ไขมัน ' + updated : '') + (skipped ? ' · มีแล้ว ' + skipped : '') };
  });
}

// ---------- คำนวณเป้า (ตรงกับ calcTarget ในหน้าเว็บ) ----------
function latestWeight_(log) {
  const w = log.filter(l => l.kind === 'weight' && num_(l.weight) > 0)
    .sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1);
  const last = w[w.length - 1] || null;
  const lastFat = w.filter(l => l.fat_pct !== '' && num_(l.fat_pct) > 0).pop();
  return last ? { date: last.date, weight: num_(last.weight), fat_pct: lastFat ? num_(lastFat.fat_pct) : 0 } : null;
}

function calcTarget_(s, log) {
  const lw = latestWeight_(log) || { weight: 100, fat_pct: 0 };
  const w = lw.weight, f = lw.fat_pct;
  let bmr;
  if (f > 0) bmr = 370 + 21.6 * w * (1 - f / 100);
  else bmr = 10 * w + 6.25 * num_(s.height || 170) - 5 * (num_(s.age) || 40) + (s.sex === 'female' ? -161 : 5);
  const tdee = bmr * (num_(s.activity) || 1.2);
  const rate = num_(s.rate) || 2;
  let kcal = tdee - rate * 7700 / 30;
  const low = kcal < bmr;
  if (low) kcal = bmr;
  kcal = Math.round(kcal / 10) * 10;
  const lbm = f > 0 ? w * (1 - f / 100) : num_(s.goal_weight || w) * 0.75;
  let protein = Math.round(lbm * 2), fat = Math.round(kcal * 0.25 / 9);
  let carb = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  if (!isTrue_(s.macro_auto)) {
    kcal = num_(s.kcal) || kcal; protein = num_(s.protein) || protein; carb = num_(s.carb) || carb; fat = num_(s.fat) || fat;
  }
  return { kcal: kcal, protein: protein, carb: carb, fat: fat, bmr: Math.round(bmr), tdee: Math.round(tdee), low: low, weight: w, fat_pct: f };
}

function setGeminiKey(k) {
  k = String(k || '').trim();
  if (k.length < 20) throw new Error('รหัส Gemini ดูไม่ถูกต้อง');
  PropertiesService.getScriptProperties().setProperty('GEMINI_KEY', k);
  return geminiCheck();
}

function changeApiKey(newKey) {
  newKey = String(newKey || '').trim();
  if (newKey.length < 4) throw new Error('รหัสสั้นเกินไป');
  PropertiesService.getScriptProperties().setProperty('API_KEY', newKey);
  return true;
}

// ===== ระบบฝึก =====
// บันทึกการฝึกหนึ่งครั้ง: w = {date, day_idx, name, minutes, items:[{ex_id, ex_name, feel, sets:[{reps, kg}]}]}
function saveWorkout(w) {
  w = w || {};
  const date = isoDate_(w.date || today_());
  const sid = newId_('W');
  const rows = [];
  (w.items || []).forEach(it => {
    (it.sets || []).forEach((st, i) => {
      if (!(num_(st.reps) > 0)) return;
      rows.push({ set_id: newId_('S'), date: date, session_id: sid, day_idx: w.day_idx === undefined ? '' : w.day_idx,
        ex_id: String(it.ex_id || ''), ex_name: String(it.ex_name || '').slice(0, 80), set_no: i + 1,
        reps: num_(st.reps), kg: num_(st.kg), feel: i === it.sets.length - 1 ? (it.feel || '') : '', msg_id: '', created_at: nowStr_() });
    });
  });
  if (!rows.length) throw new Error('ยังไม่ได้ทำเซ็ตไหนเลย');
  return withLock_(() => {
    appendMany_(SH_.SETS, rows);
    const lw = latestWeight_(rows_(SH_.LOG)) || { weight: 100 };
    const min = Math.max(5, Math.round(num_(w.minutes)) || rows.length * 3);
    upsert_(SH_.LOG, cleanLog_({ kind: 'exercise', date: date, time: w.time || nowTime_(), name: 'เวท: ' + (w.name || 'ฝึก'),
      minutes: min, kcal: Math.round(5 * lw.weight * min / 60), source: 'workout', msg_id: sid,
      note: rows.length + ' เซ็ต' }));
    return getAll();
  });
}

function deleteWorkout(sessionId) {
  return withLock_(() => {
    deleteWhere_(SH_.SETS, x => x.session_id === sessionId);
    deleteWhere_(SH_.LOG, l => l.msg_id === sessionId);
    return getAll();
  });
}
