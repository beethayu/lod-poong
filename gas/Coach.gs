// ===== โค้ช AI (Gemini) — ทางบันทึกหลัก =====
// รหัสอยู่ใน Script Properties: GEMINI_KEY (ห้ามใส่ในโค้ด/GitHub)  รุ่นเปลี่ยนได้ที่ GEMINI_MODEL
const MEAL_TH_ = { breakfast: 'เช้า', lunch: 'กลางวัน', dinner: 'เย็น', snack: 'ของว่าง' };
const DOW_TH_ = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function geminiKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!k) throw new Error('ยังไม่ได้ใส่รหัส Gemini (ตั้งค่า → รหัส Gemini)');
  return k.trim();
}

function photoFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('รูปอาหาร ลดพุง');
  props.setProperty('PHOTO_FOLDER_ID', f.getId());
  return f;
}

function geminiCheck() {
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=5', {
    headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true
  });
  return { ok: res.getResponseCode() === 200, code: res.getResponseCode() };
}

var geminiUsed_ = '';
// json = true → บังคับตอบ JSON
function geminiCall_(parts, json) {
  const props = PropertiesService.getScriptProperties();
  const models = [props.getProperty('GEMINI_MODEL') || 'gemini-3.5-flash', 'gemini-3.5-flash-lite']
    .filter((m, i, a) => m && a.indexOf(m) === i);
  const think = m => /2\.5/.test(m) ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' };
  let last = '';
  const tries = [];
  models.forEach((m, k) => { tries.push(m); if (k === 0) tries.push(m); });
  for (let i = 0; i < tries.length; i++) {
    if (i === 1) Utilities.sleep(1500);
    const cfg = { temperature: 0.3, thinkingConfig: think(tries[i]) };
    if (json) cfg.responseMimeType = 'application/json';
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + tries[i] + ':generateContent', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': geminiKey_() },
      payload: JSON.stringify({ contents: [{ role: 'user', parts: parts }], generationConfig: cfg })
    });
    const code = res.getResponseCode(), txt = res.getContentText();
    if (code === 200) {
      geminiUsed_ = tries[i];
      const j = JSON.parse(txt);
      const out = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      return out.map(p => p.text || '').join('');
    }
    last = code + ' ' + txt.slice(0, 200);
    if (i === 0 && code !== 429 && code < 500) i++;
  }
  throw new Error('โค้ชตอบไม่ได้ตอนนี้ (Gemini ' + last + ')');
}

// สรุปข้อมูลจริงให้ AI เห็น
function coachContext_(s, log, today) {
  const tg = calcTarget_(s, log);
  const day = d => log.filter(l => l.date === d);
  const tot = list => {
    const t = { kcal: 0, protein: 0, carb: 0, fat: 0, ex: 0, water: 0 };
    list.forEach(l => {
      if (l.kind === 'food') { t.kcal += num_(l.kcal); t.protein += num_(l.protein); t.carb += num_(l.carb); t.fat += num_(l.fat); }
      if (l.kind === 'exercise') t.ex += num_(l.kcal);
      if (l.kind === 'water') t.water += num_(l.ml);
    });
    return t;
  };
  const td = day(today), tt = tot(td);
  const left = Math.round(tg.kcal - tt.kcal + tt.ex / 2);
  const lines = [];
  lines.push(`โปรไฟล์: ${s.sex === 'female' ? 'หญิง' : 'ชาย'} สูง ${s.height || '?'} ซม.${s.age ? ' อายุ ' + s.age : ''} · น้ำหนักล่าสุด ${tg.weight} กก.${tg.fat_pct ? ' ไขมัน ' + tg.fat_pct + '%' : ''} · เป้า ${s.goal_weight} กก. ลด ${s.rate} กก./เดือน`);
  lines.push(`เป้าต่อวัน: ${tg.kcal} แคล · โปรตีน ${tg.protein} ก. คาร์บ ${tg.carb} ก. ไขมัน ${tg.fat} ก. · BMR ${tg.bmr} TDEE ${tg.tdee} · น้ำ ${s.water_goal} มล.`);
  lines.push(`กติกา: แคลอรี่ออกกำลังบวกคืนครึ่งเดียว`);
  lines.push(`วันนี้กินแล้ว ${Math.round(tt.kcal)} แคล (โปรตีน ${Math.round(tt.protein)} คาร์บ ${Math.round(tt.carb)} ไขมัน ${Math.round(tt.fat)}) · ออกกำลัง ${Math.round(tt.ex)} แคล · น้ำ ${tt.water} มล. · เหลือกินได้ ${left} แคล โปรตีนขาดอีก ${Math.max(0, Math.round(tg.protein - tt.protein))} ก.`);
  lines.push('รายการวันนี้:');
  td.forEach(l => {
    if (l.kind === 'food') lines.push(`- [${MEAL_TH_[l.meal] || l.meal} ${l.time}] ${l.name} ${l.qty || ''} ${l.kcal} แคล P${l.protein} C${l.carb} F${l.fat}`);
    else if (l.kind === 'exercise') lines.push(`- [ออกกำลัง ${l.time}] ${l.name} ${l.minutes} นาที ${l.kcal} แคล`);
    else if (l.kind === 'weight') lines.push(`- [น้ำหนัก] ${l.weight} กก.${l.fat_pct ? ' ไขมัน ' + l.fat_pct + '%' : ''}`);
  });
  if (!td.length) lines.push('- (ยังไม่มี)');
  lines.push('14 วันก่อนหน้า (วันที่: กิน/โปรตีน/ออกกำลัง แคล):');
  for (let i = 14; i >= 1; i--) {
    const d = addDays_(today, -i), t = tot(day(d));
    if (t.kcal || t.ex) lines.push(`- ${d}: ${Math.round(t.kcal)}/${Math.round(t.protein)}ก./${Math.round(t.ex)}`);
  }
  const ws = log.filter(l => l.kind === 'weight').sort((a, b) => a.date < b.date ? -1 : 1).slice(-12);
  lines.push('น้ำหนักล่าสุด: ' + (ws.map(w => `${w.date} ${w.weight}${w.fat_pct ? '/' + w.fat_pct + '%' : ''}`).join(', ') || '-'));
  return { text: lines.join('\n'), target: tg, left: left };
}

// ส่งข้อความ (+รูป) ให้โค้ช → AI แยกสิ่งที่ต้องจด → จดทันที → คืนคำตอบ
function coachSend(text, images, mime) {
  text = String(text || '').trim().slice(0, 2000);
  const pages = (Array.isArray(images) ? images : [images]).filter(Boolean).slice(0, 4);
  if (!text && !pages.length) throw new Error('พิมพ์ข้อความหรือแนบรูป');
  mime = mime || 'image/jpeg';
  const s = settings_();
  const today = today_(), now = nowTime_();
  const log = rows_(SH_.LOG);
  const chat = rows_(SH_.CHAT);
  const ctx = coachContext_(s, log, today);
  const msgId = newId_('M');

  // รูปเก็บ Drive
  let photoIds = '';
  if (pages.length) {
    const folder = photoFolder_();
    photoIds = pages.map((p, i) => folder.createFile(Utilities.newBlob(Utilities.base64Decode(p), mime,
      'อาหาร_' + today + '_' + now.replace(':', '') + '_' + (i + 1) + '.jpg')).getId()).join(',');
  }

  // ข้อความก่อนหน้า (บริบท) + รายการที่จดจากข้อความล่าสุด (เผื่อผู้ใช้แก้)
  const hist = chat.filter(c => !isTrue_(c.undone)).slice(-16)
    .map(c => (c.role === 'user' ? 'ผู้ใช้' : 'โค้ช') + ` (${String(c.at).slice(5, 16)}): ` + String(c.text).slice(0, 400) + (c.photo_id && c.role === 'user' ? ' [แนบรูป]' : ''));
  const lastUser = chat.filter(c => c.role === 'user' && !isTrue_(c.undone)).pop();
  const lastEntries = lastUser ? log.filter(l => l.msg_id === lastUser.msg_id) : [];
  const d = new Date(today + 'T12:00:00+07:00');

  const prompt = `คุณคือ "โค้ชลดพุง" ผู้ช่วยลดน้ำหนักส่วนตัวของผู้ชายไทยคนหนึ่ง (คุยภาษาไทย) ตอนนี้ วัน${DOW_TH_[d.getDay()]} ${today} เวลา ${now}
หน้าที่: (1) จดสิ่งที่ผู้ใช้บอก/ส่งรูป ลงบันทึก (2) ตอบคำถามโดยดูข้อมูลจริงด้านล่าง
เน้นของผู้ใช้: ${s.focus || '-'}
สไตล์: ตรง สั้น มีเหตุผล ไม่ดุ ไม่อวยเกิน ไม่ใช้อีโมจิเยอะ · ไม่วินิจฉัยโรค ถ้าเจ็บ/ปวดผิดปกติ → แนะหยุดท่านั้นและไปหาหมอ

== ข้อมูลจริง ==
${ctx.text}

== บทสนทนาก่อนหน้า ==
${hist.join('\n') || '-'}

== รายการที่จดจากข้อความล่าสุดของผู้ใช้ ==
${lastEntries.map(l => `- ${l.kind} ${l.date} ${l.name || ''} ${l.qty || ''} ${l.kcal || l.ml || l.weight || ''}`).join('\n') || '-'}

== ข้อความใหม่ของผู้ใช้ ==
${text || '(ส่งรูปอย่างเดียว)'}${pages.length ? `\n[แนบรูป ${pages.length} รูป]` : ''}

ตอบเป็น JSON อย่างเดียว:
{"reply":"ข้อความตอบ","replace_last":false,"entries":[
 {"kind":"food","date":"yyyy-mm-dd","time":"HH:MM","meal":"breakfast|lunch|dinner|snack","name":"ชื่ออาหาร","qty":"ปริมาณ เช่น 1 จาน","kcal":0,"protein":0,"carb":0,"fat":0},
 {"kind":"weight","date":"yyyy-mm-dd","weight":0,"fat_pct":null},
 {"kind":"water","date":"yyyy-mm-dd","ml":0},
 {"kind":"exercise","date":"yyyy-mm-dd","time":"HH:MM","name":"ชื่อ","minutes":0,"kcal":0}
]}
กติกาการจด:
- จดเฉพาะสิ่งที่ผู้ใช้กิน/ดื่ม/ชั่ง/ออกกำลังแล้ว (หรือบอกว่ากำลังกิน) · ถ้าแค่ถาม/ปรึกษา/วางแผน entries = []
- ข้อความเดียวหลายเรื่องได้ แยกเป็นหลาย entries · อาหารหลายอย่าง = หลาย entries
- อาหาร: ประมาณแคล/โปรตีน/คาร์บ/ไขมัน (กรัม) ตามขนาดจานไทยทั่วไป / สินค้า 7-Eleven ใช้ค่าตามฉลากที่รู้ / รูปให้ดูขนาดจาน · ตัวเลขเป็นค่าประมาณ ห้ามปัดเป็น 0 ถ้ากินจริง
- meal: ดูคำว่า เช้า/เที่ยง/กลางวัน/บ่าย/เย็น/ดึก ไม่บอกให้เดาจากเวลา (ก่อน 10:30 เช้า, 10:30–14:30 กลางวัน, 17–21 เย็น, อื่น ๆ ของว่าง) · กาแฟ/ขนมระหว่างมื้อ = snack
- วันที่: "เมื่อวาน" = ${addDays_(today, -1)} · "เมื่อวานซืน" = ${addDays_(today, -2)} · ไม่บอก = ${today} · time ไม่รู้ใส่ ""
- น้ำ: 1 แก้ว = 250 มล. · ขวดเล็ก 600 · ขวดใหญ่ 1500 · กาแฟ/ชา/นม ให้จดเป็นอาหาร ไม่ใช่น้ำ
- ออกกำลัง: kcal = MET × น้ำหนัก ${ctx.target.weight} กก. × ชั่วโมง (เดินเร็ว 4.3, เดินชิล 3, ปั่นจักรยาน 6, ว่ายน้ำ 6, เวท 5, วิ่ง 8, งานไร่หนัก 5)
- น้ำหนัก: fat_pct ใส่ถ้าบอก ไม่งั้น null
- ถ้าผู้ใช้แก้รายการที่เพิ่งจด (เช่น "ไม่ใช่ 2 จาน 1 จาน", "ผิด ลบ") → replace_last = true แล้วใส่ entries ชุดใหม่ที่ถูกต้องทั้งหมดของข้อความนั้น (ลบทิ้งอย่างเดียว entries = [])
reply:
- ถ้าจด: ยืนยันสั้น ๆ (ชื่อ + แคลรวม) แล้วบอกเหลือกินได้อีกกี่แคลวันนี้ (คิดจากเหลือ ${ctx.left} ลบสิ่งที่เพิ่งจดวันนี้) + คำแนะนำ 1 ประโยคถ้ามีประโยชน์ (เช่น โปรตีนยังขาด)
- ถ้าถาม: ตอบตรงประเด็นจากข้อมูลจริง 2–6 บรรทัด แนะเมนูไทย/เซเว่นที่หาง่าย พร้อมแคลประมาณ
- ห้ามใช้ markdown ตาราง ใช้ขึ้นบรรทัดใหม่และ • ได้`;

  let data;
  const parts = [{ text: prompt }].concat(pages.map(p => ({ inline_data: { mime_type: mime, data: p } })));
  try {
    const txt = geminiCall_(parts, true);
    data = JSON.parse(txt.replace(/^```json\s*|```\s*$/g, ''));
    if (Array.isArray(data)) data = data[0] || {};
  } catch (e) {
    if (photoIds) discardPhotos_(photoIds);
    throw e;
  }

  return withLock_(() => {
    let replaced = 0;
    if (data.replace_last && lastUser) {
      replaced = deleteWhere_(SH_.LOG, l => l.msg_id === lastUser.msg_id);
    }
    const entries = [];
    (data.entries || []).forEach(e => {
      try {
        const o = Object.assign({}, e, { source: 'chat', msg_id: msgId, photo_id: e.kind === 'food' ? photoIds : '' });
        if (!o.time) o.time = (o.date && o.date !== today) ? '' : now;
        if (!o.time) o.time = { breakfast: '08:00', lunch: '12:00', dinner: '18:30', snack: '15:00' }[o.meal] || '12:00';
        entries.push(cleanLog_(o));
      } catch (err) {}
    });
    appendMany_(SH_.LOG, entries);
    const at = nowStr_();
    appendMany_(SH_.CHAT, [
      { msg_id: msgId, at: at, role: 'user', text: text, photo_id: photoIds, log_ids: '', undone: '' },
      { msg_id: msgId + 'R', at: at, role: 'model', text: String(data.reply || 'จดแล้ว').trim(),
        photo_id: '', log_ids: entries.map(e => e.log_id).join(','), undone: replaced ? 'replaced:' + lastUser.msg_id : '' }
    ]);
    const all = getAll();
    all.sent = { msg_id: msgId, entries: entries.length, model: geminiUsed_ };
    return all;
  });
}

// ปุ่ม "ยกเลิก" ในการ์ดแชต → ลบรายการที่จดจากข้อความนั้น
function coachUndo(msgId) {
  return withLock_(() => {
    msgId = String(msgId || '').replace(/R$/, '');
    const n = deleteWhere_(SH_.LOG, l => l.msg_id === msgId);
    const sh = sheet_(SH_.CHAT);
    const r = findRow_(sh, msgId + 'R');
    if (r > 0) {
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      sh.getRange(r, head.indexOf('undone') + 1).setValue('TRUE');
    }
    const all = getAll();
    all.undone = n;
    return all;
  });
}

function clearChat() {
  return withLock_(() => {
    const sh = sheet_(SH_.CHAT);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    return getAll();
  });
}

// การ์ดคำแนะนำวันละครั้ง (สร้างครั้งแรกของวัน แคชในชีต Tips)
function getTip(force) {
  const today = today_();
  const have = rows_(SH_.TIP).filter(t => t.date === today).pop();
  if (have && !force) return have.text;
  const s = settings_();
  const ctx = coachContext_(s, rows_(SH_.LOG), today);
  const prompt = `คุณคือ "โค้ชลดพุง" เขียนการ์ดโค้ชประจำวันนี้ (${today}) ให้ผู้ชายไทยที่กำลังลดน้ำหนัก ภาษาไทย ตอบ JSON อย่างเดียว:
{"head":"หัวข้อ 1 ประโยค ไม่เกิน 55 ตัวอักษร","body":"คำแนะนำ 1–2 ประโยค ไม่เกิน 170 ตัวอักษร"}
head = เรื่องที่สำคัญหรือน่าดีใจที่สุดจากข้อมูลจริง (เช่น น้ำหนักลงกี่ กก., จดครบกี่วัน, โปรตีนถึงเป้า) ให้มีกำลังใจ ใส่อีโมจิได้ 1 ตัวท้าย
body = 1 อย่างที่ทำได้วันนี้ เจาะจง (เมนูไทย/เซเว่นที่เหมาะ, เดินหลังมื้อ, เติมโปรตีนกี่กรัม) ถ้าเมื่อวานเกินเป้าบอกตรง ๆ แบบไม่ดุ
เน้นของผู้ใช้: ${s.focus || '-'} · สไตล์ ตรง มีเหตุผล ไม่อวยเกิน ไม่ใช้ markdown ไม่ขึ้นต้นด้วยคำทักทาย
${ctx.text}`;
  let text;
  try {
    const d = JSON.parse(geminiCall_([{ text: prompt }], true).replace(/^```json\s*|```\s*$/g, ''));
    text = JSON.stringify({ head: String(d.head || '').replace(/\*\*/g, '').trim(), body: String(d.body || '').replace(/\*\*/g, '').trim() });
  } catch (e) {
    if (/Gemini/.test(String(e.message))) throw e;
    text = JSON.stringify({ head: '', body: 'วันนี้จดทุกมื้อให้ครบ แล้วเติมโปรตีนให้ถึงเป้า' });
  }
  withLock_(() => {
    deleteWhere_(SH_.TIP, t => t.date === today || String(t.date) < addDays_(today, -60));
    appendMany_(SH_.TIP, [{ date: today, text: text, created_at: nowStr_() }]);
  });
  return text;
}

function discardPhotos_(ids) {
  String(ids || '').split(',').map(x => x.trim()).filter(Boolean).forEach(id => {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  });
}

// รูปอาหาร → base64 (ย่อแล้วตอนส่ง)
function getPhoto(id, page) {
  const f = DriveApp.getFileById(String(id).split(',')[Number(page) || 0].trim());
  const b = f.getBlob();
  return { mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) };
}

// ปุ่ม "ให้ AI ประมาณ" ในฟอร์มเพิ่มอาหาร → คืนแคล + สารอาหาร (ไม่บันทึก)
function estimateFood(name, qty) {
  name = String(name || '').trim().slice(0, 200); qty = String(qty || '').trim().slice(0, 60);
  if (!name) throw new Error('ใส่ชื่ออาหารก่อน');
  const prompt = `ประมาณพลังงานและสารอาหารของอาหารนี้ ตามขนาดที่คนไทยกินทั่วไป (ร้านอาหารไทย/ร้านตามสั่ง/7-Eleven ใช้ค่าตามฉลากที่รู้)
อาหาร: ${name}
ปริมาณ: ${qty || '1 ที่ (ขนาดปกติ)'}
ตอบ JSON อย่างเดียว: {"qty":"ปริมาณที่ใช้คิด เช่น 1 จาน","kcal":0,"protein":0,"carb":0,"fat":0,"note":"หมายเหตุสั้น ๆ ไม่เกิน 60 ตัวอักษร เช่น ส่วนที่แคลสูง"}
protein/carb/fat เป็นกรัม ตัวเลขเต็ม`;
  const d = JSON.parse(geminiCall_([{ text: prompt }], true).replace(/^```json\s*|```\s*$/g, ''));
  return { qty: String(d.qty || qty || ''), kcal: Math.round(num_(d.kcal)), protein: Math.round(num_(d.protein)),
    carb: Math.round(num_(d.carb)), fat: Math.round(num_(d.fat)), note: String(d.note || '').slice(0, 80) };
}

// ===== รูปหุ่น (หน้า / ข้าง / หลัง) =====
// รูปเต็มเก็บ Drive · ในชีตเก็บรูปย่อ (base64 ~240px) ไว้โชว์เร็ว
function savePhoto(date, pose, b64, thumb) {
  if (['front', 'side', 'back'].indexOf(pose) < 0) throw new Error('ท่าไม่ถูกต้อง');
  date = isoDate_(date || today_());
  if (!b64) throw new Error('ไม่มีรูป');
  const f = photoFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg',
    'หุ่น_' + date + '_' + pose + '_' + Date.now() + '.jpg'));
  return withLock_(() => {
    // วันเดียวกัน ท่าเดียวกัน = แทนที่ของเดิม
    const old = rows_(SH_.BODY).filter(p => p.date === date && p.pose === pose);
    old.forEach(p => { try { DriveApp.getFileById(p.file_id).setTrashed(true); } catch (e) {} });
    deleteWhere_(SH_.BODY, p => p.date === date && p.pose === pose);
    appendMany_(SH_.BODY, [{ photo_id: newId_('P'), date: date, pose: pose, file_id: f.getId(), thumb: String(thumb || '').slice(0, 45000), created_at: nowStr_() }]);
    return getAll();
  });
}

function deletePhoto(id) {
  return withLock_(() => {
    const p = rows_(SH_.BODY).find(x => x.photo_id === id);
    if (p) { try { DriveApp.getFileById(p.file_id).setTrashed(true); } catch (e) {} }
    deleteWhere_(SH_.BODY, x => x.photo_id === id);
    return getAll();
  });
}

// ส่งให้หน้าเว็บ: ทุกรูป (ไม่มีรูปย่อ) + รูปย่อเฉพาะรูปแรกและล่าสุดของแต่ละท่า
function bodyPhotos_() {
  const all = rows_(SH_.BODY).sort((a, b) => a.date < b.date ? -1 : 1);
  const keep = {};
  ['front', 'side', 'back'].forEach(pose => {
    const l = all.filter(p => p.pose === pose);
    if (l.length) { keep[l[0].photo_id] = 1; keep[l[l.length - 1].photo_id] = 1; }
  });
  return all.map(p => ({ photo_id: p.photo_id, date: p.date, pose: p.pose, file_id: p.file_id, thumb: keep[p.photo_id] ? p.thumb : '' }));
}
