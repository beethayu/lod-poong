// ===== API สำหรับหน้าเว็บบน GitHub Pages (มีรหัสผ่าน) =====
// ต้นฉบับอยู่ที่ GitHub beethayu/lod-poong โฟลเดอร์ gas/ — ห้ามแก้ในหน้า Apps Script ตรง ๆ (deploy อัตโนมัติจาก GitHub)
// รหัสผ่านเก็บใน Script Properties: API_KEY (ตั้งครั้งแรกจากหน้าเว็บด้วย initSetup)
const APP_VERSION = '1.0';
const API_BLOCK_ = ['doGet', 'doPost', 'authorizeAll'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.fn) {
    let args = [];
    try { args = p.args ? JSON.parse(p.args) : []; } catch (err) {}
    return apiRun_(p.fn, args, p.k);
  }
  return apiOut_({ ok: true, app: 'lod-poong', version: APP_VERSION, setup: !apiKey_() });
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return apiOut_({ ok: false, error: 'ข้อมูลที่ส่งมาไม่ใช่ JSON' });
  }
  return apiRun_(req.fn, req.args === undefined ? [] : req.args, req.k);
}

function apiKey_() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

function apiRun_(fn, args, k) {
  try {
    const key = apiKey_();
    // ยังไม่ตั้งรหัส: เรียกได้แค่ initSetup / getAll (เพื่อให้หน้าเว็บรู้ว่าต้องตั้งค่า)
    if (!key) {
      if (fn !== 'initSetup' && fn !== 'getAll') throw new Error('SETUP: ยังไม่ได้ตั้งรหัส');
    } else if (String(k || '') !== key) {
      Utilities.sleep(800);
      return apiOut_({ ok: false, error: 'AUTH: รหัสผ่านไม่ถูกต้อง' });
    }
    if (!fn || typeof fn !== 'string' || /_$/.test(fn) || API_BLOCK_.indexOf(fn) >= 0) {
      throw new Error('ไม่อนุญาตให้เรียก: ' + fn);
    }
    const f = globalThis[fn];
    if (typeof f !== 'function') throw new Error('ไม่พบฟังก์ชัน: ' + fn);
    const result = f.apply(null, Array.isArray(args) ? args : [args]);
    return apiOut_({ ok: true, result: result === undefined ? null : result });
  } catch (err) {
    return apiOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

function apiOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ตั้งค่าครั้งแรกจากหน้าเว็บ (ใช้ได้ครั้งเดียว ตอนยังไม่มี API_KEY)
function initSetup(apiKey, geminiKey) {
  if (apiKey_()) throw new Error('ตั้งรหัสไปแล้ว');
  apiKey = String(apiKey || '').trim();
  if (apiKey.length < 4) throw new Error('รหัสสั้นเกินไป (อย่างน้อย 4 ตัว)');
  const props = PropertiesService.getScriptProperties();
  if (geminiKey) props.setProperty('GEMINI_KEY', String(geminiKey).trim());
  props.setProperty('API_KEY', apiKey);
  setupSheets_();
  return getAll();
}

// รันครั้งเดียวในหน้า Apps Script (เลือก authorizeAll แล้วกด ▶ เรียกใช้) เพื่อกดอนุญาตสิทธิ์
function authorizeAll() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  const f = photoFolder_();
  UrlFetchApp.fetch('https://www.google.com');
  setupSheets_();
  Logger.log('✅ อนุญาตครบแล้ว โฟลเดอร์รูป: ' + f.getUrl());
}
