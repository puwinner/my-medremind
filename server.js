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
  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day);
  const dayName = THAI_DAYS[dateObj.getDay()];
  const thaiYear = year + 543;
  return `วัน${dayName}ที่ ${day} ${THAI_MONTHS[month - 1]} ${thaiYear}${timeStr ? ` เวลา ${timeStr} น.` : ''}`;
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
  const [year, month, day] = appointment.appointment_date.split('-').map(Number);
  const [hour, min] = (appointment.appointment_time || '09:00').split(':').map(Number);
  
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
function checkAndSendReminders() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const nowHour = today.getHours();

    const appointments = db.prepare(`
      SELECT a.*, p.name as profile_name, p.relation as profile_relation, p.color as profile_color, p.avatar as profile_avatar
      FROM appointments a
      JOIN profiles p ON a.profile_id = p.id
      WHERE a.status = 'upcoming' AND a.appointment_date >= ?
    `).all(todayStr);

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
      if (diffDays === 7 && !appt.reminded_7d) {
        sendDiscordNotification(appt, profile, '7d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_7d = 1 WHERE id = ?').run(appt.id);
          }
        });
      }

      // 3 Days reminder
      if (diffDays === 3 && !appt.reminded_3d) {
        sendDiscordNotification(appt, profile, '3d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_3d = 1 WHERE id = ?').run(appt.id);
          }
        });
      }

      // 1 Day reminder (Tomorrow)
      if (diffDays === 1 && !appt.reminded_1d) {
        sendDiscordNotification(appt, profile, '1d').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_1d = 1 WHERE id = ?').run(appt.id);
          }
        });
      }

      // Day of appointment (Send once in the morning >= 7:00 AM)
      if (diffDays === 0 && !appt.reminded_day_of && nowHour >= 7) {
        sendDiscordNotification(appt, profile, 'day_of').then(res => {
          if (res.success) {
            db.prepare('UPDATE appointments SET reminded_day_of = 1 WHERE id = ?').run(appt.id);
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
        sendJson(200, rows);
        return;
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.name) return sendError(400, 'Name is required');
        const id = 'p_' + crypto.randomBytes(4).toString('hex');
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO profiles (id, name, relation, color, avatar, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, body.name, body.relation || 'ทั่วไป', body.color || '#3B82F6', body.avatar || '👤', now);
        
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
        sendJson(200, { success: true });
        return;
      }
    }

    // API ROUTE: /api/appointments
    if (pathname === '/api/appointments') {
      if (method === 'GET') {
        const profileId = parsedUrl.searchParams.get('profile_id');
        const status = parsedUrl.searchParams.get('status');

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

        db.prepare(`
          INSERT INTO appointments (
            id, profile_id, title, doctor_name, hospital, department,
            appointment_date, appointment_time, prep_notes, prep_checklist,
            slip_image_url, notes, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, body.profile_id, body.title, body.doctor_name || '', body.hospital, body.department || '',
          body.appointment_date, body.appointment_time || '09:00', body.prep_notes || '',
          body.prep_checklist ? (typeof body.prep_checklist === 'string' ? body.prep_checklist : JSON.stringify(body.prep_checklist)) : '[]',
          body.slip_image_url || '', body.notes || '', body.status || 'upcoming', now, now
        );

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
          }, 'test');
        }

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
        db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?')
          .run(body.status || 'completed', new Date().toISOString(), apptId);
        sendJson(200, { success: true });
        return;
      }

      if (method === 'PUT') {
        const body = await parseJsonBody(req);
        db.prepare(`
          UPDATE appointments SET
            profile_id = ?, title = ?, doctor_name = ?, hospital = ?, department = ?,
            appointment_date = ?, appointment_time = ?, prep_notes = ?, prep_checklist = ?,
            slip_image_url = ?, notes = ?, status = ?, updated_at = ?
          WHERE id = ?
        `).run(
          body.profile_id, body.title, body.doctor_name || '', body.hospital, body.department || '',
          body.appointment_date, body.appointment_time || '09:00', body.prep_notes || '',
          body.prep_checklist ? (typeof body.prep_checklist === 'string' ? body.prep_checklist : JSON.stringify(body.prep_checklist)) : '[]',
          body.slip_image_url || '', body.notes || '', body.status || 'upcoming',
          new Date().toISOString(), apptId
        );

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
