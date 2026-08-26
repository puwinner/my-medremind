// ============================================================================
// MedRemind - Google Sheets Cloud Database Backend
// สคริปต์สำหรับนำไปวางใน Google Sheets (Extensions > Apps Script)
// ============================================================================

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    initSheets(ss);

    let data = {};
    if (e && e.postData && e.postData.contents) {
      try { data = JSON.parse(e.postData.contents); } catch(err) {}
    }
    const action = (e && e.parameter && e.parameter.action) || data.action || 'getAppointments';

    // 1. ดึงรายการนัดหมายทั้งหมด
    if (action === 'getAppointments') {
      const rows = getSheetData(ss.getSheetByName('Appointments'));
      const profiles = getSheetData(ss.getSheetByName('Profiles'));
      const profileMap = {};
      profiles.forEach(p => { profileMap[p.id] = p; });

      const enriched = rows.map(r => {
        const p = profileMap[r.profile_id] || {};
        return Object.assign({}, r, {
          profile_name: p.name || 'ทั่วไป',
          profile_relation: p.relation || '',
          profile_color: p.color || '#3B82F6',
          profile_avatar: p.avatar || '👤'
        });
      });

      return jsonResponse({ success: true, data: enriched });
    }

    // 2. บันทึกนัดหมายใหม่
    if (action === 'saveAppointment') {
      const appt = data.appointment;
      const sheet = ss.getSheetByName('Appointments');
      const finalSlipUrl = processSlipImage(appt.slip_image_url, appt.id);

      sheet.appendRow([
        appt.id,
        appt.profile_id,
        appt.title,
        appt.doctor_name || '',
        appt.hospital || '',
        appt.department || '',
        appt.appointment_date,
        appt.appointment_time || '09:00',
        appt.prep_notes || '',
        typeof appt.prep_checklist === 'string' ? appt.prep_checklist : JSON.stringify(appt.prep_checklist || []),
        finalSlipUrl || '',
        appt.notes || '',
        appt.status || 'upcoming',
        appt.reminded_7d ? 1 : 0,
        appt.reminded_3d ? 1 : 0,
        appt.reminded_1d ? 1 : 0,
        appt.reminded_day_of ? 1 : 0,
        appt.created_at || new Date().toISOString(),
        appt.updated_at || new Date().toISOString()
      ]);
      return jsonResponse({ success: true, slip_image_url: finalSlipUrl });
    }

    // 3. แก้ไขนัดหมาย
    if (action === 'updateAppointment') {
      const appt = data.appointment;
      const sheet = ss.getSheetByName('Appointments');
      const finalSlipUrl = processSlipImage(appt.slip_image_url, appt.id);
      const dataRange = sheet.getDataRange();
      const values = dataRange.getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(appt.id)) {
          const row = i + 1;
          sheet.getRange(row, 2).setValue(appt.profile_id);
          sheet.getRange(row, 3).setValue(appt.title);
          sheet.getRange(row, 4).setValue(appt.doctor_name || '');
          sheet.getRange(row, 5).setValue(appt.hospital || '');
          sheet.getRange(row, 6).setValue(appt.department || '');
          sheet.getRange(row, 7).setValue(appt.appointment_date);
          sheet.getRange(row, 8).setValue(appt.appointment_time || '09:00');
          sheet.getRange(row, 9).setValue(appt.prep_notes || '');
          sheet.getRange(row, 10).setValue(typeof appt.prep_checklist === 'string' ? appt.prep_checklist : JSON.stringify(appt.prep_checklist || []));
          sheet.getRange(row, 11).setValue(finalSlipUrl || '');
          sheet.getRange(row, 12).setValue(appt.notes || '');
          if (appt.status) sheet.getRange(row, 13).setValue(appt.status);
          if (appt.reminded_7d !== undefined) sheet.getRange(row, 14).setValue(appt.reminded_7d ? 1 : 0);
          if (appt.reminded_3d !== undefined) sheet.getRange(row, 15).setValue(appt.reminded_3d ? 1 : 0);
          if (appt.reminded_1d !== undefined) sheet.getRange(row, 16).setValue(appt.reminded_1d ? 1 : 0);
          if (appt.reminded_day_of !== undefined) sheet.getRange(row, 17).setValue(appt.reminded_day_of ? 1 : 0);
          sheet.getRange(row, 19).setValue(new Date().toISOString());
          break;
        }
      }
      return jsonResponse({ success: true, slip_image_url: finalSlipUrl });
    }

    // 4. ลบนัดหมาย
    if (action === 'deleteAppointment') {
      const apptId = data.id || (e && e.parameter && e.parameter.id);
      const sheet = ss.getSheetByName('Appointments');
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(apptId)) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
      return jsonResponse({ success: true });
    }

    // 5. ดึงรายชื่อสมาชิก (Profiles)
    if (action === 'getProfiles') {
      const rows = getSheetData(ss.getSheetByName('Profiles'));
      return jsonResponse({ success: true, data: rows });
    }

    // 6. บันทึก/แก้ไขโปรไฟล์สมาชิก
    if (action === 'saveProfile') {
      const p = data.profile;
      const sheet = ss.getSheetByName('Profiles');
      const values = sheet.getDataRange().getValues();
      let found = false;
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(p.id)) {
          const row = i + 1;
          sheet.getRange(row, 2).setValue(p.name);
          sheet.getRange(row, 3).setValue(p.relation || 'ทั่วไป');
          sheet.getRange(row, 4).setValue(p.color || '#3B82F6');
          sheet.getRange(row, 5).setValue(p.avatar || '👤');
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([
          p.id, p.name, p.relation || 'ทั่วไป', p.color || '#3B82F6', p.avatar || '👤', new Date().toISOString()
        ]);
      }
      return jsonResponse({ success: true });
    }

    // 7. ลบโปรไฟล์สมาชิก
    if (action === 'deleteProfile') {
      const profileId = data.id || (e && e.parameter && e.parameter.id);
      const sheet = ss.getSheetByName('Profiles');
      const values = sheet.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][0]) === String(profileId)) {
          sheet.deleteRow(i + 1);
          break;
        }
      }
      return jsonResponse({ success: true });
    }

    // 8. ทดสอบการเชื่อมต่อ
    if (action === 'ping') {
      return jsonResponse({ success: true, message: 'Google Sheets Connected Successfully!' });
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function initSheets(ss) {
  let apptSheet = ss.getSheetByName('Appointments');
  if (!apptSheet) {
    apptSheet = ss.insertSheet('Appointments');
    apptSheet.appendRow([
      'id', 'profile_id', 'title', 'doctor_name', 'hospital', 'department',
      'appointment_date', 'appointment_time', 'prep_notes', 'prep_checklist',
      'slip_image_url', 'notes', 'status', 'reminded_7d', 'reminded_3d', 'reminded_1d', 'reminded_day_of',
      'created_at', 'updated_at'
    ]);
  }

  let profileSheet = ss.getSheetByName('Profiles');
  if (!profileSheet) {
    profileSheet = ss.insertSheet('Profiles');
    profileSheet.appendRow(['id', 'name', 'relation', 'color', 'avatar', 'created_at']);
    const now = new Date().toISOString();
    profileSheet.appendRow(['p_self', 'ฉัน (ตัวเอง)', 'ตัวเอง', '#3B82F6', '🧑', now]);
    profileSheet.appendRow(['p_dad', 'คุณพ่อ', 'คุณพ่อ', '#10B981', '👨', now]);
    profileSheet.appendRow(['p_mom', 'คุณแม่', 'คุณแม่', '#EC4899', '👩', now]);
  }
}

function getSheetData(sheet) {
  if (!sheet) return [];
  const displayValues = sheet.getDataRange().getDisplayValues();
  const rawValues = sheet.getDataRange().getValues();
  if (displayValues.length <= 1) return [];
  const headers = displayValues[0];
  const result = [];
  for (let i = 1; i < displayValues.length; i++) {
    const row = displayValues[i];
    const rawRow = rawValues[i];
    if (!row[0]) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      let val = row[j];
      
      if (header === 'appointment_date') {
        val = formatSheetDate(rawRow[j], val);
      } else if (header === 'appointment_time') {
        val = formatSheetTime(rawRow[j], val);
      }
      
      obj[header] = val;
    }
    result.push(obj);
  }
  return result;
}

function formatSheetDate(rawVal, displayVal) {
  if (rawVal instanceof Date) {
    const y = rawVal.getFullYear();
    const m = String(rawVal.getMonth() + 1).padStart(2, '0');
    const d = String(rawVal.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  if (typeof displayVal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(displayVal.trim())) {
    return displayVal.trim();
  }
  if (typeof displayVal === 'string' && displayVal.includes('T')) {
    const dt = new Date(displayVal);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
  }
  return displayVal;
}

function formatSheetTime(rawVal, displayVal) {
  if (typeof displayVal === 'string' && /^\d{1,2}:\d{2}/.test(displayVal.trim())) {
    return displayVal.trim().substring(0, 5);
  }
  if (rawVal instanceof Date) {
    const h = String(rawVal.getHours()).padStart(2, '0');
    const m = String(rawVal.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }
  return displayVal || '09:00';
}

function processSlipImage(slipUrl, apptId) {
  if (!slipUrl || typeof slipUrl !== 'string') return '';
  if (slipUrl.startsWith('data:')) {
    return saveImageToGoogleDrive(slipUrl, `slip_${apptId || Date.now()}.jpg`);
  }
  return slipUrl;
}

function saveImageToGoogleDrive(base64Data, filename) {
  try {
    const folderName = 'MedRemind_Doctor_Slips';
    const folders = DriveApp.getFoldersByName(folderName);
    let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return base64Data;

    const contentType = matches[1];
    const decodedBytes = Utilities.base64Decode(matches[2]);
    const blob = Utilities.newBlob(decodedBytes, contentType, filename || `slip_${Date.now()}.jpg`);

    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // Direct Google CDN fast image link (Permanent & high-speed)
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (err) {
    Logger.log('Drive image save error: ' + err.toString());
    return base64Data.length < 48000 ? base64Data : '';
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// 🔔 ระบบแจ้งเตือน Discord อัตโนมัติ 24/7 บน Google Cloud (ไม่ต้องเปิดคอม/เซิร์ฟเวอร์)
// ============================================================================

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1542036104612413520/m7gPpauvF7591fxV5uuG5BMx481lGD9sHAAYhXk7oax4ZMRKRFfQSxJOX9CsIgU7CsDx';
const RENDER_WEB_URL = 'https://my-medremind.onrender.com';

function sendDailyDiscordReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apptSheet = ss.getSheetByName('Appointments');
  const profileSheet = ss.getSheetByName('Profiles');
  if (!apptSheet || !profileSheet) return;

  // Wake up Render Web Service in background
  try {
    UrlFetchApp.fetch(RENDER_WEB_URL + '/api/settings', { muteHttpExceptions: true });
  } catch (e) {}

  const appointments = getSheetData(apptSheet);
  const profiles = getSheetData(profileSheet);
  const profileMap = {};
  profiles.forEach(p => { profileMap[p.id] = p; });

  const now = new Date();
  const todayBangkokStr = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  const todayBangkok = new Date(todayBangkokStr + 'T00:00:00');

  const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const THAI_DAYS_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

  const values = apptSheet.getDataRange().getValues();

  for (let idx = 0; idx < appointments.length; idx++) {
    const a = appointments[idx];
    if (a.status !== 'upcoming') continue;
    if (!a.appointment_date) continue;

    const targetDate = new Date(a.appointment_date + 'T00:00:00');
    const diffTime = targetDate.getTime() - todayBangkok.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    let triggerType = null;
    let triggerLabel = '';
    let triggerColor = 0x3B82F6;
    let flagColIndex = -1; // 1-based column in sheet

    if (diffDays === 7 && !Number(a.reminded_7d)) {
      triggerType = '7d';
      triggerLabel = '⏰ ล่วงหน้า 7 วัน';
      triggerColor = 0x3B82F6;
      flagColIndex = 14;
    } else if (diffDays === 3 && !Number(a.reminded_3d)) {
      triggerType = '3d';
      triggerLabel = '⏳ ล่วงหน้า 3 วัน';
      triggerColor = 0xF59E0B;
      flagColIndex = 15;
    } else if (diffDays === 1 && !Number(a.reminded_1d)) {
      triggerType = '1d';
      triggerLabel = '🚨 พรุ่งนี้แล้ว! (ล่วงหน้า 1 วัน)';
      triggerColor = 0xEF4444;
      flagColIndex = 16;
    } else if (diffDays === 0 && !Number(a.reminded_day_of)) {
      triggerType = 'day_of';
      triggerLabel = '☀️ วันนี้มีนัดแพทย์!';
      triggerColor = 0x10B981;
      flagColIndex = 17;
    }

    if (triggerType && flagColIndex !== -1) {
      const p = profileMap[a.profile_id] || { name: 'ทั่วไป', relation: '', color: '#3B82F6', avatar: '👤' };

      const [year, month, day] = a.appointment_date.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dayName = THAI_DAYS_FULL[dateObj.getDay()] || '';
      const thaiYear = year + 543;
      const formattedDate = `วัน${dayName}ที่ ${day} ${THAI_MONTHS_SHORT[month - 1]} ${thaiYear}`;

      const fields = [
        { name: '👤 คนไข้', value: `${p.avatar || '👤'} **${p.name}** (${p.relation || 'ทั่วไป'})`, inline: true },
        { name: '📅 วันที่นัดหมาย', value: `**${formattedDate}**`, inline: true },
        { name: '⏰ เวลา', value: `**${a.appointment_time || '09:00'} น.**`, inline: true },
        { name: '🏥 โรงพยาบาล', value: a.hospital, inline: false }
      ];

      if (a.doctor_name || a.department) {
        fields.push({
          name: '👨‍⚕️ แพทย์ / แผนก',
          value: `${a.doctor_name ? `นพ./พญ. ${a.doctor_name}` : ''}${a.department ? ` (${a.department})` : ''}`,
          inline: false
        });
      }

      if (a.prep_notes) {
        fields.push({
          name: '⚠️ สิ่งที่ต้องเตรียมตัว & ข้อควรปฏิบัติ',
          value: a.prep_notes,
          inline: false
        });
      }

      if (a.notes) {
        fields.push({
          name: '📝 บันทึกเพิ่มเติม',
          value: a.notes,
          inline: false
        });
      }

      const payload = {
        username: 'MedRemind นัดหมอ-เตือนใจ',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
        embeds: [{
          title: `🏥 แจ้งเตือนนัดพบแพทย์: ${a.title} (${triggerLabel})`,
          description: `แจ้งเตือนกำหนดการพบแพทย์สำหรับ **${p.name}**`,
          color: triggerColor,
          fields: fields,
          footer: { text: 'MedRemind • ระบบแจ้งเตือนสุขภาพและนัดแพทย์ (Google Cloud 24/7)' },
          timestamp: new Date().toISOString()
        }]
      };

      try {
        const response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
          method: 'POST',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
          // Find row index in sheet and mark reminded
          for (let rowIdx = 1; rowIdx < values.length; rowIdx++) {
            if (String(values[rowIdx][0]) === String(a.id)) {
              apptSheet.getRange(rowIdx + 1, flagColIndex).setValue(1);
              break;
            }
          }
        }
      } catch (err) {
        Logger.log('Discord notification error: ' + err.toString());
      }
    }
  }
}

// ฟังก์ชันสำหรับกดทดสอบยิง Discord ทันที (ไม่ต้องรอให้ถึงรอบวันเตือน)
function testSendDiscordNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apptSheet = ss.getSheetByName('Appointments');
  const profileSheet = ss.getSheetByName('Profiles');
  
  const appointments = apptSheet ? getSheetData(apptSheet) : [];
  const profiles = profileSheet ? getSheetData(profileSheet) : [];
  const profileMap = {};
  profiles.forEach(p => { profileMap[p.id] = p; });

  const sample = appointments.length > 0 ? appointments[0] : {
    title: 'ตรวจสุขภาพประจำปี',
    hospital: 'โรงพยาบาลรามาธิบดี',
    doctor_name: 'สมชาย ใจดี',
    appointment_date: '2026-09-02',
    appointment_time: '08:30',
    prep_notes: 'งดน้ำและอาหารหลัง 20:00 น.'
  };
  
  const p = profileMap[sample.profile_id] || { name: 'คุณพ่อ', relation: 'พ่อจ๋า', color: '#3B82F6', avatar: '👨' };

  const payload = {
    username: 'MedRemind นัดหมอ-เตือนใจ',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
    embeds: [{
      title: `🏥 [ทดสอบระบบ] แจ้งเตือนนัดพบแพทย์: ${sample.title}`,
      description: `แจ้งเตือนกำหนดการพบแพทย์สำหรับ **${p.name}**`,
      color: 0x10B981,
      fields: [
        { name: '👤 คนไข้', value: `${p.avatar || '👤'} **${p.name}** (${p.relation || 'ทั่วไป'})`, inline: true },
        { name: '📅 วันที่นัดหมาย', value: `**${sample.appointment_date}**`, inline: true },
        { name: '⏰ เวลา', value: `**${sample.appointment_time || '09:00'} น.**`, inline: true },
        { name: '🏥 โรงพยาบาล', value: sample.hospital || '-', inline: false },
        { name: '👨‍⚕️ แพทย์', value: `นพ./พญ. ${sample.doctor_name || '-'}`, inline: false },
        { name: '⚠️ สิ่งที่ต้องเตรียมตัว', value: sample.prep_notes || 'ไม่มี', inline: false }
      ],
      footer: { text: 'MedRemind • ส่งตรงจาก Google Cloud 24/7 สำเร็จเรียบร้อย' },
      timestamp: new Date().toISOString()
    }]
  };

  const response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  Logger.log('Discord Status: ' + response.getResponseCode());
}