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
        appt.slip_image_url || '',
        appt.notes || '',
        appt.status || 'upcoming',
        appt.reminded_7d ? 1 : 0,
        appt.reminded_3d ? 1 : 0,
        appt.reminded_1d ? 1 : 0,
        appt.reminded_day_of ? 1 : 0,
        appt.created_at || new Date().toISOString(),
        appt.updated_at || new Date().toISOString()
      ]);
      return jsonResponse({ success: true });
    }

    // 3. แก้ไขนัดหมาย
    if (action === 'updateAppointment') {
      const appt = data.appointment;
      const sheet = ss.getSheetByName('Appointments');
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
          sheet.getRange(row, 11).setValue(appt.slip_image_url || '');
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
      return jsonResponse({ success: true });
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

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}