// MedRemind Server - Node.js v24 + SQLite Server
// Features: REST API, Image Upload, SQLite Storage, Cron Notification Engine, Discord Webhook, iCal Generator

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'appointments.db');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

// Initialize Database
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    relation TEXT,
    color TEXT DEFAULT '#3B82F6',
    avatar TEXT DEFAULT '👤',
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    doctor_name TEXT,
    hospital TEXT NOT NULL,
    department TEXT,
    appointment_date TEXT NOT NULL,
    appointment_time TEXT NOT NULL,
    prep_notes TEXT,
    prep_checklist TEXT,
    slip_image_url TEXT,
    notes TEXT,
    status TEXT DEFAULT 'upcoming',
    reminded_7d INTEGER DEFAULT 0,
    reminded_3d INTEGER DEFAULT 0,
    reminded_1d INTEGER DEFAULT 0,
    reminded_day_of INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY(profile_id) REFERENCES profiles(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id TEXT,
    channel TEXT,
    trigger_type TEXT,
    status TEXT,
    message TEXT,
    sent_at TEXT
  );
`);

// Insert default profiles if empty
const profileCount = db.prepare('SELECT COUNT(*) as count FROM profiles').get().count;
if (profileCount === 0) {
  const insertProfile = db.prepare(`
    INSERT INTO profiles (id, name, relation, color, avatar, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  insertProfile.run('p_self', 'ฉัน (ตัวเอง)', 'ตัวเอง', '#3B82F6', '🧑', now);
  insertProfile.run('p_dad', 'คุณพ่อ', 'คุณพ่อ', '#10B981', '👨', now);
  insertProfile.run('p_mom', 'คุณแม่', 'คุณแม่', '#EC4899', '👩', now);
}

// Helper: Get Settings
function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

// Helper: Call Google Sheets Web App Backend
async function callGoogleSheets(action, payload = {}) {
  const sheetUrl = getSetting('google_sheet_url') || process.env.GOOGLE_SHEET_URL;
  if (!sheetUrl || !sheetUrl.startsWith('http')) return null;

  try {
    const res = await fetch(sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, payload)),
      redirect: 'follow'
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error('Google Sheets Error:', err.message);
    return null;
  }
}

// Sync Cache Helper
function syncLocalProfiles(profiles) {
  try {
    for (const p of profiles) {
      db.prepare(`
        INSERT INTO profiles (id, name, relation, color, avatar, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, relation = excluded.relation, color = excluded.color, avatar = excluded.avatar
      `).run(p.id, p.name, p.relation || 'ทั่วไป', p.color || '#3B82F6', p.avatar || '👤', p.created_at || new Date().toISOString());
    }
  } catch (e) {}
}

function normalizeApptDate(val) {
  if (!val) return '';
  val = String(val).trim();

  // If already a clean YYYY-MM-DD string without time
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }

  // If ISO string with T/Z (e.g. 2027-02-10T17:00:00.000Z), convert from UTC to Thai time (+7)
  const dt = new Date(val);
  if (!isNaN(dt.getTime())) {
    const tzOffset = 7 * 60 * 60 * 1000;
    const thaiTime = new Date(dt.getTime() + tzOffset);
    const y = thaiTime.getUTCFullYear();
    const m = String(thaiTime.getUTCMonth() + 1).padStart(2, '0');
    const d = String(thaiTime.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const match = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return val;
}

function normalizeApptTime(val) {
  if (!val) return '09:00';
  val = String(val).trim();
  if (/^\d{1,2}:\d{2}$/.test(val)) return val.padStart(5, '0');
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(val)) return val.substring(0, 5);
  if (val.includes('T')) {
    const dt = new Date(val);
    if (!isNaN(dt.getTime())) {
      const totalSec = dt.getUTCHours() * 3600 + dt.getUTCMinutes() * 60 + dt.getUTCSeconds() + (6 * 3600 + 42 * 60 + 4);
      const h = Math.floor((totalSec / 3600) % 24);
      const m = Math.round((totalSec % 3600) / 60);
      return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    }
  }
  return val;
}

function syncLocalAppointments(appts) {
  try {
    for (const a of appts) {
      const normDate = normalizeApptDate(a.appointment_date);
      const normTime = normalizeApptTime(a.appointment_time);
      db.prepare(`
        INSERT INTO appointments (
          id, profile_id, title, doctor_name, hospital, department,
          appointment_date, appointment_time, prep_notes, prep_checklist,
          slip_image_url, notes, status, reminded_7d, reminded_3d, reminded_1d, reminded_day_of, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          profile_id = excluded.profile_id, title = excluded.title, doctor_name = excluded.doctor_name,
          hospital = excluded.hospital, department = excluded.department, appointment_date = excluded.appointment_date,
          appointment_time = excluded.appointment_time, prep_notes = excluded.prep_notes, prep_checklist = excluded.prep_checklist,
          slip_image_url = excluded.slip_image_url, notes = excluded.notes, status = excluded.status,
          reminded_7d = excluded.reminded_7d, reminded_3d = excluded.reminded_3d, reminded_1d = excluded.reminded_1d,
          reminded_day_of = excluded.reminded_day_of, updated_at = excluded.updated_at
      `).run(
        a.id, a.profile_id, a.title, a.doctor_name || '', a.hospital, a.department || '',
        normDate, normTime, a.prep_notes || '',
        typeof a.prep_checklist === 'string' ? a.prep_checklist : JSON.stringify(a.prep_checklist || []),
        a.slip_image_url || '', a.notes || '', a.status || 'upcoming',
        Number(a.reminded_7d) || 0, Number(a.reminded_3d) || 0, Number(a.reminded_1d) || 0, Number(a.reminded_day_of) || 0,
        a.created_at || new Date().toISOString(), a.updated_at || new Date().toISOString()
      );
    }
  } catch (e) {}
}

// MIME Types for Static Files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ics': 'text/calendar; charset=utf-8'
};

// Date Format Helpers (Thai Display)
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function formatThaiDate(dateStr, timeStr) {
  const normDate = normalizeApptDate(dateStr);
  const normTime = normalizeApptTime(timeStr);
  const match = normDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return normDate;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const dateObj = new Date(year, month - 1, day);
  const dayName = THAI_DAYS[dateObj.getDay()] || '';
  const thaiYear = year + 543;
  return `วัน${dayName}ที่ ${day} ${THAI_MONTHS[month - 1]} ${thaiYear}${normTime ? ` เวลา ${normTime} น.` : ''}`;
}

// Generate Discord Rich Embed Message
function buildDiscordEmbed(appointment, profile, triggerLabel, triggerColor = 0x3B82F6) {
  const thaiDateTime = formatThaiDate(appointment.appointment_date, appointment.appointment_time);
  
  const fields = [
    {
      name: '👤 คนไข้ / ผู้รับการตรวจ',
      value: `**${profile.name}** (${profile.relation || 'ทั่วไป'})`,
      inline: true
    },
    {
      name: '🏥 โรงพยาบาล / คลินิก',
      value: `${appointment.hospital || '-'}`,
      inline: true
    },
    {
      name: '👨‍⚕️ แพทย์ / แผนก',
      value: `${appointment.doctor_name ? `นพ./พญ. ${appointment.doctor_name}` : 'ไม่ระบุ'} ${appointment.department ? `(${appointment.department})` : ''}`,
      inline: false
    },
    {
      name: '📅 วันและเวลานัดหมาย',
      value: `🕒 **${thaiDateTime}**`,
      inline: false
    }
  ];

  // Add Prep Notes & Checklist
  if (appointment.prep_notes || appointment.prep_checklist) {
    let prepContent = '';
    if (appointment.prep_notes) {
      prepContent += `📌 ${appointment.prep_notes}\n`;
    }
    if (appointment.prep_checklist) {
      try {
        const items = typeof appointment.prep_checklist === 'string' ? JSON.parse(appointment.prep_checklist) : appointment.prep_checklist;
        if (Array.isArray(items) && items.length > 0) {
          prepContent += items.map(item => `• ${item.text || item}`).join('\n');
        }
      } catch (e) {}
    }
    if (prepContent.trim()) {
      fields.push({
        name: '⚠️ สิ่งที่ต้องเตรียมตัว & ข้อควรปฏิบัติ',
        value: prepContent.trim(),
        inline: false
      });
    }
  }

  // Add Notes
  if (appointment.notes && appointment.notes.trim()) {
    fields.push({
      name: '📝 บันทึกเพิ่มเติม',
      value: appointment.notes.trim(),
      inline: false
    });
  }

  // Determine Embed Color
  let embedColor = triggerColor;
  if (profile.color && profile.color.startsWith('#')) {
    embedColor = parseInt(profile.color.slice(1), 16) || triggerColor;
  }

  const embed = {
    title: `🏥 แจ้งเตือนนัดพบแพทย์: ${appointment.title} (${triggerLabel})`,
    description: `แจ้งเตือนกำหนดการพบแพทย์สำหรับ **${profile.name}**`,
    color: embedColor,
    fields: fields,
    footer: {
      text: 'MedRemind • ระบบแจ้งเตือนนัดแพทย์และบันทึกสุขภาพครอบครัว'
    },
    timestamp: new Date().toISOString()
  };

  return {
    username: 'MedRemind นัดหมอ-เตือนใจ',
    avatar_url: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
    embeds: [embed]
  };
}

// Send Discord Webhook
async function sendDiscordNotification(appointment, profile, triggerType) {
  const webhookUrl = getSetting('discord_webhook_url');
  if (!webhookUrl || !webhookUrl.startsWith('http')) {
    return { success: false, error: 'Discord Webhook URL is not configured' };
  }

  let triggerLabel = '';
  let color = 0x3B82F6;

  switch (triggerType) {
    case '7d':
      triggerLabel = '⏰ ล่วงหน้า 7 วัน';
      color = 0x3B82F6;
      break;
    case '3d':
      triggerLabel = '⏳ ล่วงหน้า 3 วัน';
      color = 0xF59E0B;
      break;
    case '1d':
      triggerLabel = '🚨 พรุ่งนี้แล้ว! (ล่วงหน้า 1 วัน)';
      color = 0xEF4444;
      break;
    case 'day_of':
      triggerLabel = '☀️ วันนี้มีนัดแพทย์!';
      color = 0x10B981;
      break;
    case 'test':
      triggerLabel = '🔔 ทดสอบการแจ้งเตือน';
      color = 0x8B5CF6;
      break;
    case 'create':
      triggerLabel = '📢 บันทึกนัดหมายใหม่';
      color = 0x3B82F6;
      break;
    default:
      triggerLabel = 'แจ้งเตือนนัดหมาย';
  }

  const payload = buildDiscordEmbed(appointment, profile, triggerLabel, color);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      logNotification(appointment.id, 'discord', triggerType, 'failed', `HTTP ${res.status}: ${errText}`);
      return { success: false, error: `Discord HTTP ${res.status}: ${errText}` };
    }

    logNotification(appointment.id, 'discord', triggerType, 'success', `Sent ${triggerLabel}`);
    return { success: true };
  } catch (err) {
    logNotification(appointment.id, 'discord', triggerType, 'failed', err.message);
    return { success: false, error: err.message };
  }
}

function logNotification(appointmentId, channel, triggerType, status, message) {
  try {
    db.prepare(`
      INSERT INTO notification_logs (appointment_id, channel, trigger_type, status, message, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(appointmentId, channel, triggerType, status, message, new Date().toISOString());
  } catch (e) {
    console.error('Error logging notification:', e);
  }
}

// Generate RFC 5545 iCalendar (.ics) string
function generateICS(appointment, profile) {
  const normDate = normalizeApptDate(appointment.appointment_date);
  const normTime = normalizeApptTime(appointment.appointment_time);
  const [year, month, day] = normDate.split('-').map(Number);
  const [hour, min] = normTime.split(':').map(Number);
  
  const pad = n => String(n).padStart(2, '0');
  
  const startDt = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(min)}00`;
  const endHour = hour + 2;
  const endDt = `${year}${pad(month)}${pad(day)}T${pad(endHour > 23 ? 23 : endHour)}${pad(min)}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = `medremind-${appointment.id}@local`;

  let description = `นัดหมายแพทย์: ${appointment.title}\\nคนไข้: ${profile ? profile.name : '-'}\\nแพทย์: ${appointment.doctor_name || '-'}\\nแผนก: ${appointment.department || '-'}`;
  if (appointment.prep_notes) {
    description += `\\n\\n⚠️ สิ่งที่ต้องเตรียมตัว:\\n${appointment.prep_notes.replace(/\n/g, '\\n')}`;
  }
  if (appointment.notes) {
    description += `\\n\\n📝 หมายเหตุ:\\n${appointment.notes.replace(/\n/g, '\\n')}`;
  }

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MedRemind//Doctor Appointment Reminder//TH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=Asia/Bangkok:${startDt}`,
    `DTEND;TZID=Asia/Bangkok:${endDt}`,
    `SUMMARY:🏥 [นัดหมอ] ${appointment.title} - ${profile ? profile.name : ''}`,
    `LOCATION:${appointment.hospital || ''}${appointment.department ? ` (${appointment.department})` : ''}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-P7D',
    'ACTION:DISPLAY',
    `DESCRIPTION:เตือนล่วงหน้า 7 วัน: นัดพบแพทย์ ${appointment.title}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:เตือนพรุ่งนี้มีนัดแพทย์: ${appointment.title}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:อีก 2 ชั่วโมงถึงเวลานัด: ${appointment.title}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  return icsLines.join('\r\n');
}

// Generate Google Calendar Link
function generateGoogleCalendarUrl(appointment, profile) {
  const [year, month, day] = appointment.appointment_date.split('-').map(Number);
  const [hour, min] = (appointment.appointment_time || '09:00').split(':').map(Number);
  const pad = n => String(n).padStart(2, '0');

  const startIso = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(min)}00`;
  const endHour = Math.min(hour + 2, 23);
  const endIso = `${year}${pad(month)}${pad(day)}T${pad(endHour)}${pad(min)}00`;

  let details = `นัดหมายแพทย์: ${appointment.title}\nคนไข้: ${profile ? profile.name : '-'}\nแพทย์: ${appointment.doctor_name || '-'}\nแผนก: ${appointment.department || '-'}`;
  if (appointment.prep_notes) {
    details += `\n\n⚠️ สิ่งที่ต้องเตรียมตัว:\n${appointment.prep_notes}`;
  }
  if (appointment.notes) {
    details += `\n\n📝 บันทึกเพิ่มเติม:\n${appointment.notes}`;
  }

  const title = `🏥 [นัดหมอ] ${appointment.title} (${profile ? profile.name : ''})`;
  const location = `${appointment.hospital || ''}${appointment.department ? ` - ${appointment.department}` : ''}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${startIso}/${endIso}`,
    details: details,
    location: location,
    ctz: 'Asia/Bangkok'
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Background Cron Scheduler (Runs every 60 seconds)
async function checkAndSendReminders() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const nowHour = today.getHours();

    let appointments = [];

    // Check Google Sheets first
    const sheetData = await callGoogleSheets('getAppointments');
    if (sheetData && sheetData.success && Array.isArray(sheetData.data)) {
      appointments = sheetData.data.filter(a => a.status === 'upcoming' && a.appointment_date >= todayStr);
      syncLocalAppointments(sheetData.data);
    } else {
      appointments = db.prepare(`
        SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
        FROM appointments a
        JOIN profiles p ON a.profile_id = p.id
        WHERE a.status = 'upcoming' AND a.appointment_date >= ?
      `).all(todayStr);
    }

    for (const appt of appointments) {
      const profile = {
        name: appt.profile_name,
        relation: appt.profile_relation,
        color: appt.profile_color,
        avatar: appt.profile_avatar
      };

      const apptDate = new Date(appt.appointment_date + 'T00:00:00');
      const todayDate = new Date(todayStr + 'T00:00:00');
      const diffTime = apptDate.getTime() - todayDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

      // 7 Days reminder
      if (diffDays === 7 && !Number(appt.reminded_7d)) {
        sendDiscordNotification(appt, profile, '7d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_7d = 1 WHERE id = ?').run(appt.id);
            callGoogleSheets('updateAppointment', { appointment: Object.assign({}, appt, { reminded_7d: 1 }) });
          }
        });
      }

      // 3 Days reminder
      if (diffDays === 3 && !Number(appt.reminded_3d)) {
        sendDiscordNotification(appt, profile, '3d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_3d = 1 WHERE id = ?').run(appt.id);
            callGoogleSheets('updateAppointment', { appointment: Object.assign({}, appt, { reminded_3d: 1 }) });
          }
        });
      }

      // 1 Day reminder (Tomorrow)
      if (diffDays === 1 && !Number(appt.reminded_1d)) {
        sendDiscordNotification(appt, profile, '1d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_1d = 1 WHERE id = ?').run(appt.id);
            callGoogleSheets('updateAppointment', { appointment: Object.assign({}, appt, { reminded_1d: 1 }) });
          }
        });
      }

      // Day of appointment (Send once in the morning >= 7:00 AM)
      if (diffDays === 0 && !Number(appt.reminded_day_of) && nowHour >= 7) {
        sendDiscordNotification(appt, profile, 'day_of').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_day_of = 1 WHERE id = ?').run(appt.id);
            callGoogleSheets('updateAppointment', { appointment: Object.assign({}, appt, { reminded_day_of: 1 }) });
          }
        });
      }
    }
  } catch (err) {
    console.error('Error in scheduler check:', err);
  }
}

setInterval(checkAndSendReminders, 60 * 1000);
setTimeout(checkAndSendReminders, 3000);

// Parse JSON Body Helper
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Parse Binary Buffer Helper
function parseRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const sendError = (statusCode, message) => {
    sendJson(statusCode, { error: message });
  };

  try {
    // API ROUTE: /api/profiles
    if (pathname === '/api/profiles') {
      if (method === 'GET') {
        const rows = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all();
        
        // Background sync with Google Sheets without blocking response
        callGoogleSheets('getProfiles').then(sheetProfiles => {
          if (sheetProfiles && sheetProfiles.success && Array.isArray(sheetProfiles.data) && sheetProfiles.data.length > 0) {
            syncLocalProfiles(sheetProfiles.data);
          }
        }).catch(() => {});

        if (rows.length > 0) {
          sendJson(200, rows);
          return;
        }

        // If local is completely empty, wait for Google Sheets
        const sheetProfiles = await callGoogleSheets('getProfiles');
        if (sheetProfiles && sheetProfiles.success && Array.isArray(sheetProfiles.data) && sheetProfiles.data.length > 0) {
          syncLocalProfiles(sheetProfiles.data);
          sendJson(200, sheetProfiles.data);
          return;
        }

        sendJson(200, rows);
        return;
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.name) return sendError(400, 'Name is required');
        const id = 'p_' + crypto.randomBytes(4).toString('hex');
        const now = new Date().toISOString();
        const newProfile = {
          id,
          name: body.name,
          relation: body.relation || 'ทั่วไป',
          color: body.color || '#3B82F6',
          avatar: body.avatar || '👤',
          created_at: now
        };

        db.prepare(`
          INSERT INTO profiles (id, name, relation, color, avatar, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, newProfile.name, newProfile.relation, newProfile.color, newProfile.avatar, now);

        // Async background sync with Google Sheets
        callGoogleSheets('saveProfile', { profile: newProfile }).catch(e => console.error(e));

        const created = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
        sendJson(201, created);
        return;
      }
    }

    if (pathname.startsWith('/api/profiles/')) {
      const profileId = pathname.split('/')[3];
      if (method === 'PUT') {
        const body = await parseJsonBody(req);
        db.prepare(`
          UPDATE profiles SET name = ?, relation = ?, color = ?, avatar = ?
          WHERE id = ?
        `).run(body.name, body.relation, body.color, body.avatar, profileId);

        // Async background sync
        callGoogleSheets('saveProfile', {
          profile: { id: profileId, name: body.name, relation: body.relation, color: body.color, avatar: body.avatar }
        }).catch(e => console.error(e));

        const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
        sendJson(200, updated);
        return;
      }

      if (method === 'DELETE') {
        const count = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE profile_id = ?').get(profileId).count;
        if (count > 0) {
          return sendError(400, `ไม่สามารถลบโปรไฟล์นี้ได้เนื่องจากมี ${count} รายการนัดหมายผูกอยู่`);
        }
        db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
        callGoogleSheets('deleteProfile', { id: profileId }).catch(e => console.error(e));
        sendJson(200, { success: true });
        return;
      }
    }

    // API ROUTE: /api/appointments
    if (pathname === '/api/appointments') {
      if (method === 'GET') {
        const profileId = parsedUrl.searchParams.get('profile_id');
        const status = parsedUrl.searchParams.get('status');

        // Background sync with Google Sheets without blocking response
        callGoogleSheets('getAppointments').then(sheetRes => {
          if (sheetRes && sheetRes.success && Array.isArray(sheetRes.data)) {
            syncLocalAppointments(sheetRes.data);
          }
        }).catch(() => {});

        let sql = `
          SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
          FROM appointments a
          JOIN profiles p ON a.profile_id = p.id
          WHERE 1=1
        `;
        const params = [];

        if (profileId && profileId !== 'all') {
          sql += ' AND a.profile_id = ?';
          params.push(profileId);
        }
        if (status && status !== 'all') {
          sql += ' AND a.status = ?';
          params.push(status);
        }

        sql += ' ORDER BY a.appointment_date ASC, a.appointment_time ASC';
        const rows = db.prepare(sql).all(...params);

        if (rows.length > 0) {
          sendJson(200, rows);
          return;
        }

        // If local is empty, wait for Google Sheets
        const sheetRes = await callGoogleSheets('getAppointments');
        if (sheetRes && sheetRes.success && Array.isArray(sheetRes.data)) {
          syncLocalAppointments(sheetRes.data);
          let filtered = sheetRes.data;
          if (profileId && profileId !== 'all') {
            filtered = filtered.filter(a => a.profile_id === profileId);
          }
          if (status && status !== 'all') {
            filtered = filtered.filter(a => a.status === status);
          }
          filtered.sort((a, b) => {
            const d = (a.appointment_date || '').localeCompare(b.appointment_date || '');
            return d !== 0 ? d : (a.appointment_time || '').localeCompare(b.appointment_time || '');
          });
          sendJson(200, filtered);
          return;
        }

        sendJson(200, rows);
        return;
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.title || !body.profile_id || !body.appointment_date || !body.hospital) {
          return sendError(400, 'Title, Profile, Date, and Hospital are required');
        }

        const id = 'apt_' + crypto.randomBytes(6).toString('hex');
        const now = new Date().toISOString();

        const newAppt = {
          id,
          profile_id: body.profile_id,
          title: body.title,
          doctor_name: body.doctor_name || '',
          hospital: body.hospital,
          department: body.department || '',
          appointment_date: body.appointment_date,
          appointment_time: body.appointment_time || '09:00',
          prep_notes: body.prep_notes || '',
          prep_checklist: body.prep_checklist ? (typeof body.prep_checklist === 'string' ? body.prep_checklist : JSON.stringify(body.prep_checklist)) : '[]',
          slip_image_url: body.slip_image_url || '',
          notes: body.notes || '',
          status: body.status || 'upcoming',
          created_at: now,
          updated_at: now
        };

        db.prepare(`
          INSERT INTO appointments (
            id, profile_id, title, doctor_name, hospital, department,
            appointment_date, appointment_time, prep_notes, prep_checklist,
            slip_image_url, notes, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, newAppt.profile_id, newAppt.title, newAppt.doctor_name, newAppt.hospital, newAppt.department,
          newAppt.appointment_date, newAppt.appointment_time, newAppt.prep_notes,
          newAppt.prep_checklist, newAppt.slip_image_url, newAppt.notes, newAppt.status, now, now
        );

        // Async background sync with Google Sheets (Non-blocking!)
        callGoogleSheets('saveAppointment', { appointment: newAppt }).catch(e => console.error(e));

        const created = db.prepare(`
          SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
          FROM appointments a
          JOIN profiles p ON a.profile_id = p.id
          WHERE a.id = ?
        `).get(id);

        if (body.notify_now) {
          sendDiscordNotification(created, {
            name: created.profile_name,
            relation: created.profile_relation,
            color: created.profile_color,
            avatar: created.profile_avatar
          }, 'create').catch(e => console.error('Error sending discord notification:', e));
        }

        // Return immediately in milliseconds!
        sendJson(201, created);
        return;
      }
    }

    if (pathname.startsWith('/api/appointments/')) {
      const parts = pathname.split('/');
      const apptId = parts[3];
      const action = parts[4];

      const existing = db.prepare(`
        SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
        FROM appointments a
        JOIN profiles p ON a.profile_id = p.id
        WHERE a.id = ?
      `).get(apptId);

      if (!existing) return sendError(404, 'Appointment not found');

      const profileObj = {
        name: existing.profile_name,
        relation: existing.profile_relation,
        color: existing.profile_color,
        avatar: existing.profile_avatar
      };

      if (action === 'ics' && method === 'GET') {
        const icsContent = generateICS(existing, profileObj);
        res.writeHead(200, {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': `attachment; filename="appointment-${existing.appointment_date}.ics"`
        });
        res.end(icsContent);
        return;
      }

      if (action === 'gcal' && method === 'GET') {
        const gcalUrl = generateGoogleCalendarUrl(existing, profileObj);
        sendJson(200, { url: gcalUrl });
        return;
      }

      if (action === 'notify' && method === 'POST') {
        const result = await sendDiscordNotification(existing, profileObj, 'test');
        sendJson(200, result);
        return;
      }

      if (action === 'status' && method === 'PUT') {
        const body = await parseJsonBody(req);
        const newStatus = body.status || 'completed';
        db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?')
          .run(newStatus, new Date().toISOString(), apptId);

        // Async background sync
        callGoogleSheets('updateAppointment', {
          appointment: Object.assign({}, existing, { status: newStatus })
        }).catch(e => console.error(e));

        sendJson(200, { success: true });
        return;
      }

      if (method === 'PUT') {
        const body = await parseJsonBody(req);
        const updatedAppt = {
          id: apptId,
          profile_id: body.profile_id,
          title: body.title,
          doctor_name: body.doctor_name || '',
          hospital: body.hospital,
          department: body.department || '',
          appointment_date: body.appointment_date,
          appointment_time: body.appointment_time || '09:00',
          prep_notes: body.prep_notes || '',
          prep_checklist: body.prep_checklist ? (typeof body.prep_checklist === 'string' ? body.prep_checklist : JSON.stringify(body.prep_checklist)) : '[]',
          slip_image_url: body.slip_image_url || '',
          notes: body.notes || '',
          status: body.status || 'upcoming',
          updated_at: new Date().toISOString()
        };

        db.prepare(`
          UPDATE appointments SET
            profile_id = ?, title = ?, doctor_name = ?, hospital = ?, department = ?,
            appointment_date = ?, appointment_time = ?, prep_notes = ?, prep_checklist = ?,
            slip_image_url = ?, notes = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          updatedAppt.profile_id, updatedAppt.title, updatedAppt.doctor_name, updatedAppt.hospital, updatedAppt.department,
          updatedAppt.appointment_date, updatedAppt.appointment_time, updatedAppt.prep_notes,
          updatedAppt.prep_checklist, updatedAppt.slip_image_url, updatedAppt.notes, updatedAppt.status,
          updatedAppt.updated_at, apptId
        );

        // Async background sync
        callGoogleSheets('updateAppointment', { appointment: updatedAppt }).catch(e => console.error(e));

        const updated = db.prepare(`
          SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
          FROM appointments a
          JOIN profiles p ON a.profile_id = p.id
          WHERE a.id = ?
        `).get(apptId);

        sendJson(200, updated);
        return;
      }

      if (method === 'DELETE') {
        if (existing.slip_image_url && !existing.slip_image_url.startsWith('http')) {
          const filePath = path.join(ROOT_DIR, existing.slip_image_url);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
        }
        db.prepare('DELETE FROM appointments WHERE id = ?').run(apptId);
        callGoogleSheets('deleteAppointment', { id: apptId }).catch(e => console.error(e));
        sendJson(200, { success: true });
        return;
      }
    }

    // API ROUTE: /api/upload
    if (pathname === '/api/upload' && method === 'POST') {
      const rawBuffer = await parseRawBody(req);
      let fileBuffer = null;
      let fileExt = '.jpg';

      try {
        const json = JSON.parse(rawBuffer.toString('utf-8'));
        if (json.base64) {
          const matches = json.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            fileExt = '.' + (matches[1].split('/')[1] || 'jpg');
            if (fileExt === '.jpeg') fileExt = '.jpg';
            fileBuffer = Buffer.from(matches[2], 'base64');
          }
        }
      } catch (e) {
        fileBuffer = rawBuffer;
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        return sendError(400, 'No valid image data provided');
      }

      const filename = `slip_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${fileExt}`;
      const savePath = path.join(UPLOADS_DIR, filename);
      fs.writeFileSync(savePath, fileBuffer);

      sendJson(201, {
        filename: filename,
        url: `/uploads/${filename}`
      });
      return;
    }

    // API ROUTE: /api/settings
    if (pathname === '/api/settings') {
      if (method === 'GET') {
        const rows = db.prepare('SELECT key, value FROM settings').all();
        const settings = {};
        for (const r of rows) settings[r.key] = r.value;
        sendJson(200, settings);
        return;
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        for (const [k, v] of Object.entries(body)) {
          setSetting(k, v);
        }
        sendJson(200, { success: true });
        return;
      }
    }

    // Test Discord Webhook
    if (pathname === '/api/settings/test-discord' && method === 'POST') {
      const body = await parseJsonBody(req);
      const webhookUrl = body.webhook_url || getSetting('discord_webhook_url');
      if (!webhookUrl) return sendError(400, 'Discord Webhook URL is missing');

      const testPayload = {
        username: 'MedRemind นัดหมอ-เตือนใจ',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/2966/2966327.png',
        embeds: [{
          title: '✅ เชื่อมต่อ Discord Webhook สำเร็จ!',
          description: 'ระบบ MedRemind พร้อมส่งการแจ้งเตือนนัดพบแพทย์และข้อปฏิบัติเข้าช่องนี้แล้ว',
          color: 0x10B981,
          fields: [
            { name: '⏰ รอบการแจ้งเตือนอัตโนมัติ', value: '• ⏰ ล่วงหน้า 7 วัน\n• ⏳ ล่วงหน้า 3 วัน\n• 🚨 ล่วงหน้า 1 วัน (พรุ่งนี้)\n• ☀️ เช้าวันนัด (07:00 น.)', inline: false }
          ],
          footer: { text: 'MedRemind • ระบบแจ้งเตือนสุขภาพและนัดแพทย์' },
          timestamp: new Date().toISOString()
        }]
      };

      try {
        const resWebhook = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(testPayload)
        });

        if (!resWebhook.ok) {
          const t = await resWebhook.text();
          return sendError(400, `Discord Error ${resWebhook.status}: ${t}`);
        }

        sendJson(200, { success: true, message: 'ส่งข้อความทดสอบเข้า Discord สำเร็จแล้ว!' });
        return;
      } catch (err) {
        return sendError(500, `Network Error: ${err.message}`);
      }
    }

    // Test Google Sheets Connection
    if (pathname === '/api/settings/test-sheets' && method === 'POST') {
      const body = await parseJsonBody(req);
      const sheetUrl = body.google_sheet_url || getSetting('google_sheet_url');
      if (!sheetUrl) return sendError(400, 'Google Sheet Web App URL is missing');

      try {
        const resSheets = await fetch(sheetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'ping' }),
          redirect: 'follow'
        });

        if (!resSheets.ok) {
          return sendError(400, `Google Sheets HTTP Error: ${resSheets.status}`);
        }

        const data = await resSheets.json();
        if (data.success) {
          sendJson(200, { success: true, message: 'เชื่อมต่อ Google Sheets สำเร็จเรียบร้อยแล้ว!' });
        } else {
          sendJson(400, { success: false, error: data.error || 'Connection failed' });
        }
        return;
      } catch (err) {
        return sendError(500, `Network Error: ${err.message}`);
      }
    }

    // API ROUTE: /api/logs
    if (pathname === '/api/logs' && method === 'GET') {
      const logs = db.prepare(`
        SELECT l.*, a.title as appointment_title, a.appointment_date
        FROM notification_logs l
        LEFT JOIN appointments a ON l.appointment_id = a.id
        ORDER BY l.sent_at DESC
        LIMIT 50
      `).all();
      sendJson(200, logs);
      return;
    }

    // STATIC FILE SERVING: /uploads/
    if (pathname.startsWith('/uploads/')) {
      const filename = path.basename(pathname);
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      sendError(404, 'File not found');
      return;
    }

    // STATIC FILE SERVING: /public/
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(PUBLIC_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    sendError(404, 'Not Found');
  } catch (err) {
    console.error('Server Error:', err);
    sendError(500, `Internal Server Error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🏥 MedRemind Server running at: http://localhost:${PORT}`);
  console.log(`📅 Automatic Scheduler active (Checking every 60s)`);
  console.log(`======================================================\n`);
});
