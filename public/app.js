// MedRemind Application Frontend
const API_BASE = '';

const state = {
  profiles: [],
  appointments: [],
  settings: {},
  logs: [],
  currentTab: 'timeline',
  selectedProfileId: 'all',
  selectedStatus: 'upcoming',
  calendarDate: new Date(),
  editingAppointmentId: null,
  editingProfileId: null,
  uploadedImageUrl: null,
  checklistItems: []
};

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];
const THAI_DAYS_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THAI_DAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadInitialData();
});

async function loadInitialData() {
  showLoading(true);
  try {
    await Promise.all([fetchProfiles(), fetchAppointments(), fetchSettings()]);
    renderAll();
  } catch (err) {
    showToast('เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function fetchProfiles() {
  const res = await fetch(`${API_BASE}/api/profiles`);
  if (!res.ok) throw new Error('Cannot fetch profiles');
  state.profiles = await res.json();
}

function normalizeDateString(val) {
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

function normalizeTimeString(val) {
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

async function fetchAppointments() {
  const query = new URLSearchParams();
  if (state.selectedProfileId && state.selectedProfileId !== 'all') {
    query.set('profile_id', state.selectedProfileId);
  }
  if (state.selectedStatus && state.selectedStatus !== 'all') {
    query.set('status', state.selectedStatus);
  }

  const res = await fetch(`${API_BASE}/api/appointments?${query.toString()}`);
  if (!res.ok) throw new Error('Cannot fetch appointments');
  const rawList = await res.json();
  state.appointments = rawList.map(a => {
    return Object.assign({}, a, {
      appointment_date: normalizeDateString(a.appointment_date),
      appointment_time: normalizeTimeString(a.appointment_time)
    });
  });
}

async function fetchSettings() {
  const res = await fetch(`${API_BASE}/api/settings`);
  if (!res.ok) throw new Error('Cannot fetch settings');
  state.settings = await res.json();
}

async function fetchLogs() {
  const res = await fetch(`${API_BASE}/api/logs`);
  if (!res.ok) throw new Error('Cannot fetch logs');
  state.logs = await res.json();
}

function renderAll() {
  renderProfileFilters();
  renderStats();
  renderMainView();
}


function renderProfileFilters() {
  const container = document.getElementById('profile-filters');
  if (!container) return;

  let html = `
    <button onclick="selectProfileFilter('all')" class="px-3.5 py-1.5 rounded-full text-xs md:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
      state.selectedProfileId === 'all'
        ? 'bg-blue-600 text-white shadow-sm'
        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
    }">
      <span>👥</span> ทั้งหมด (${state.appointments.length})
    </button>
  `;

  for (const p of state.profiles) {
    const isSelected = state.selectedProfileId === p.id;
    html += `
      <button onclick="selectProfileFilter('${p.id}')" class="px-3.5 py-1.5 rounded-full text-xs md:text-sm font-medium transition-all whitespace-nowrap flex items-center gap-1.5 ${
        isSelected
          ? 'text-white shadow-sm'
          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
      }" style="${isSelected ? `background-color: ${p.color}; border-color: ${p.color};` : ''}">
        <span>${p.avatar || '👤'}</span>
        <span>${escapeHtml(p.name)}</span>
      </button>
    `;
  }

  container.innerHTML = html;
}

function selectProfileFilter(profileId) {
  state.selectedProfileId = profileId;
  fetchAppointments().then(() => {
    renderProfileFilters();
    renderStats();
    renderMainView();
  });
}

function selectStatusFilter(status) {
  state.selectedStatus = status;
  document.querySelectorAll('.status-filter-btn').forEach(btn => {
    if (btn.dataset.status === status) {
      btn.className = 'status-filter-btn px-3 py-1 text-xs font-medium rounded-lg bg-blue-600 text-white transition-colors';
    } else {
      btn.className = 'status-filter-btn px-3 py-1 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 transition-colors';
    }
  });

  fetchAppointments().then(() => {
    renderStats();
    renderMainView();
  });
}

function renderStats() {
  const nextApptEl = document.getElementById('stat-next-appt');
  const countUpcomingEl = document.getElementById('stat-count-upcoming');
  const countSpecialPrepEl = document.getElementById('stat-count-prep');

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const upcomingList = state.appointments.filter(a => a.status === 'upcoming' && a.appointment_date >= todayStr);
  const prepList = upcomingList.filter(a => (a.prep_notes && a.prep_notes.trim()) || (a.prep_checklist && a.prep_checklist !== '[]'));

  if (countUpcomingEl) countUpcomingEl.textContent = upcomingList.length;
  if (countSpecialPrepEl) countSpecialPrepEl.textContent = prepList.length;

  if (nextApptEl) {
    if (upcomingList.length > 0) {
      const next = upcomingList[0];
      const rel = getRelativeDayInfo(next.appointment_date);
      nextApptEl.innerHTML = `
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-sm md:text-base font-bold text-slate-900 truncate">🏥 ${escapeHtml(next.title)}</span>
          <span class="text-xs px-2.5 py-0.5 rounded-full font-bold shadow-2xs ${rel.badgeClass}">${rel.text}</span>
        </div>
        <div class="text-xs md:text-sm text-slate-600 font-medium truncate">
          👤 <strong>${escapeHtml(next.profile_name)}</strong> • 📅 ${formatThaiShortDate(next.appointment_date)} เวลา ${formatApptTime(next.appointment_time)} น. • ${escapeHtml(next.hospital)}
        </div>
      `;
    } else {
      nextApptEl.innerHTML = `<span class="text-sm text-slate-400 font-medium">ไม่มีนัดหมายเร็วๆ นี้</span>`;
    }
  }
}

function renderMainView() {
  const container = document.getElementById('view-container');
  if (!container) return;

  if (state.currentTab === 'timeline') {
    renderTimelineView(container);
  } else if (state.currentTab === 'calendar') {
    renderCalendarView(container);
  } else if (state.currentTab === 'profiles') {
    renderProfilesView(container);
  } else if (state.currentTab === 'logs') {
    renderLogsView(container);
  }
}


function renderTimelineView(container) {
  if (state.appointments.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-2xl p-8 text-center border border-slate-100 shadow-sm my-4">
        <div class="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center text-3xl mx-auto mb-3">🩺</div>
        <h3 class="text-base font-semibold text-slate-800 mb-1">ยังไม่มีรายการนัดหมาย</h3>
        <p class="text-xs text-slate-500 mb-4">เพิ่มนัดหมายแพทย์เพื่อรับการแจ้งเตือน 7 วันล่วงหน้า และซิงก์เข้าปฏิทิน</p>
        <button onclick="openAppointmentModal()" class="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all">
          <span>+ เพิ่มนัดหมายใหม่</span>
        </button>
      </div>
    `;
    return;
  }

  let html = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-20 md:pb-6">`;

  for (const appt of state.appointments) {
    const rel = getRelativeDayInfo(appt.appointment_date);
    const thaiDateStr = formatThaiFullDate(appt.appointment_date);
    const isCompleted = appt.status === 'completed';

    let checklist = [];
    if (appt.prep_checklist) {
      try {
        checklist = typeof appt.prep_checklist === 'string' ? JSON.parse(appt.prep_checklist) : appt.prep_checklist;
      } catch (e) {}
    }

    html += `
      <div class="appt-card bg-white rounded-2xl p-4 md:p-5 border border-slate-100 shadow-sm flex flex-col justify-between relative overflow-hidden ${
        isCompleted ? 'opacity-70 bg-slate-50/70' : ''
      }">
        <div class="absolute top-0 left-0 right-0 h-1.5" style="background-color: ${appt.profile_color || '#3B82F6'};"></div>

        <div>
          <div class="flex items-center justify-between mb-3 pt-1">
            <div class="flex items-center gap-2.5">
              <span class="w-8 h-8 rounded-full flex items-center justify-center text-base shadow-sm" style="background-color: ${appt.profile_color}15; border: 1.5px solid ${appt.profile_color}40;">
                ${appt.profile_avatar || '👤'}
              </span>
              <div>
                <div class="text-sm font-bold text-slate-900 leading-tight">${escapeHtml(appt.profile_name)}</div>
                <div class="text-xs text-slate-500">${escapeHtml(appt.profile_relation || '')}</div>
              </div>
            </div>
            
            <div class="flex items-center gap-1.5">
              ${
                isCompleted
                  ? `<span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">ไปตามนัดแล้ว ✓</span>`
                  : `<span class="text-xs font-bold px-3 py-1 rounded-full shadow-xs ${rel.badgeClass}">${rel.text}</span>`
              }
            </div>
          </div>

          <h3 class="text-base md:text-lg font-bold text-slate-900 mb-2 leading-snug">
            ${escapeHtml(appt.title)}
          </h3>

          <div class="space-y-1.5 text-sm text-slate-700 mb-3.5">
            <div class="flex items-center gap-2">
              <span class="text-slate-400">🏥</span>
              <span class="font-semibold text-slate-800">${escapeHtml(appt.hospital)}</span>
              ${appt.department ? `<span class="text-slate-500 font-normal">(${escapeHtml(appt.department)})</span>` : ''}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-slate-400">👨‍⚕️</span>
              <span>${appt.doctor_name ? `นพ./พญ. ${escapeHtml(appt.doctor_name)}` : 'ไม่ระบุแพทย์'}</span>
            </div>
            <div class="flex items-center gap-2 font-semibold text-blue-700 bg-blue-50/80 px-2.5 py-1 rounded-lg w-fit">
              <span>📅</span>
              <span>${thaiDateStr}</span>
              <span class="text-blue-400">•</span>
              <span>เวลา ${formatApptTime(appt.appointment_time)} น.</span>
            </div>
          </div>

          ${
            appt.prep_notes || checklist.length > 0
              ? `
              <div class="bg-amber-50/90 border border-amber-200/80 rounded-xl p-3 mb-3 text-xs md:text-sm">
                <div class="flex items-center gap-1.5 text-amber-900 font-bold mb-1.5">
                  <span class="text-base">⚠️</span> สิ่งที่ต้องเตรียมตัว & ข้อปฏิบัติ:
                </div>
                ${appt.prep_notes ? `<p class="text-amber-950 mb-1.5 font-medium leading-relaxed">${escapeHtml(appt.prep_notes)}</p>` : ''}
                ${
                  checklist.length > 0
                    ? `
                  <ul class="space-y-1 text-amber-900 text-xs md:text-sm font-medium">
                    ${checklist.map(item => `
                      <li class="flex items-start gap-1.5">
                        <span class="text-amber-600 font-bold">•</span>
                        <span>${escapeHtml(item.text || item)}</span>
                      </li>
                    `).join('')}
                  </ul>
                `
                    : ''
                }
              </div>
            `
              : ''
          }

          ${
            appt.slip_image_url
              ? `
              <div class="mb-3">
                <div class="flex items-center justify-between mb-1.5">
                  <span class="text-xs font-semibold text-slate-600">📸 ใบนัด / ใบสั่งยา</span>
                </div>
                <div class="relative group cursor-pointer overflow-hidden rounded-xl border border-slate-200 aspect-[16/9] bg-slate-100 max-h-40" onclick="openApptImageViewer('${appt.id}')">
                  <img src="${appt.slip_image_url}" alt="ใบนัดแพทย์" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                  <div class="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-xs font-bold gap-1.5 backdrop-blur-xs">
                    <span>🔍 กดเพื่อดูภาพขยาย</span>
                  </div>
                </div>
              </div>
            `
              : ''
          }

          ${
            appt.notes
              ? `<div class="text-xs md:text-sm text-slate-600 italic bg-slate-50 p-2.5 rounded-xl mb-3 border border-slate-100">💬 ${escapeHtml(appt.notes)}</div>`
              : ''
          }
        </div>

        <div class="pt-3 border-t border-slate-100 mt-2">
          <div class="grid grid-cols-3 gap-2 mb-3">
            <button onclick="addToGoogleCalendar('${appt.id}')" title="เพิ่มลง Google Calendar พร้อมแจ้งเตือน" class="flex items-center justify-center gap-1 py-2 px-2 bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-xl text-xs font-semibold border border-slate-200 hover:border-blue-200 transition-colors">
              <span>📅</span> G-Calendar
            </button>
            <button onclick="downloadICS('${appt.id}')" title="ดาวน์โหลดไฟล์ .ics สำหรับ iOS/Android Calendar" class="flex items-center justify-center gap-1 py-2 px-2 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 rounded-xl text-xs font-semibold border border-slate-200 hover:border-emerald-200 transition-colors">
              <span>📲</span> .ICS (Alarm)
            </button>
            <button onclick="testDiscordAlert('${appt.id}')" title="ทดสอบส่งแจ้งเตือนเข้า Discord ทันที" class="flex items-center justify-center gap-1 py-2 px-2 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 rounded-xl text-xs font-semibold border border-slate-200 hover:border-indigo-200 transition-colors">
              <span>🔔</span> Discord
            </button>
          </div>

          <div class="flex items-center justify-between gap-2">
            <button onclick="toggleAppointmentStatus('${appt.id}', '${appt.status === 'completed' ? 'upcoming' : 'completed'}')" class="text-xs md:text-sm font-bold ${
              isCompleted ? 'text-slate-500 hover:text-blue-600 bg-slate-100' : 'text-emerald-700 hover:text-emerald-800 bg-emerald-50 border border-emerald-200'
            } px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs">
              <span>${isCompleted ? '↩️ ปรับเป็นรอดำเนินการ' : '✅ บันทึกว่าไปแล้ว'}</span>
            </button>

            <div class="flex items-center gap-1">
              <button onclick="editAppointment('${appt.id}')" class="text-slate-500 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition-colors" title="แก้ไข">✏️</button>
              <button onclick="deleteAppointment('${appt.id}')" class="text-slate-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-xl transition-colors" title="ลบ">🗑️</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}

function renderCalendarView(container) {
  const currentMonth = state.calendarDate.getMonth();
  const currentYear = state.calendarDate.getFullYear();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const thaiMonthYear = `${THAI_MONTHS_FULL[currentMonth]} ${currentYear + 543}`;

  let html = `
    <div class="bg-white rounded-2xl p-4 md:p-6 border border-slate-100 shadow-sm mb-20 md:mb-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-base md:text-lg font-bold text-slate-800 flex items-center gap-2">
          <span>📅</span> ปฏิทินนัดหมาย: ${thaiMonthYear}
        </h2>
        <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button onclick="changeMonth(-1)" class="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-white rounded-lg transition-colors">◀</button>
          <button onclick="resetMonth()" class="px-2.5 h-8 text-xs font-semibold text-slate-700 hover:bg-white rounded-lg transition-colors">วันนี้</button>
          <button onclick="changeMonth(1)" class="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-white rounded-lg transition-colors">▶</button>
        </div>
      </div>

      <div class="grid grid-cols-7 gap-1 text-center font-semibold text-xs text-slate-400 mb-2">
        ${THAI_DAYS_SHORT.map(d => `<div class="py-1">${d}</div>`).join('')}
      </div>

      <div class="grid grid-cols-7 gap-1 md:gap-2">
  `;

  for (let i = 0; i < firstDay; i++) {
    html += `<div class="min-h-[60px] md:min-h-[90px] p-1 bg-slate-50/50 rounded-xl"></div>`;
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dayStr === todayStr;
    const dayAppts = state.appointments.filter(a => a.appointment_date === dayStr);

    html += `
      <div class="min-h-[60px] md:min-h-[90px] p-1.5 rounded-xl border transition-all ${
        isToday ? 'bg-blue-50/60 border-blue-300 shadow-xs' : 'bg-white border-slate-100 hover:border-slate-300'
      } flex flex-col justify-between">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${isToday ? 'w-5 h-5 bg-blue-600 text-white rounded-full flex items-center justify-center' : 'text-slate-700'}">${day}</span>
          ${dayAppts.length > 0 ? `<span class="text-[9px] px-1 bg-blue-100 text-blue-700 font-bold rounded-full">${dayAppts.length}</span>` : ''}
        </div>

        <div class="space-y-1 mt-1 overflow-hidden">
          ${dayAppts.map(a => `
            <div onclick="editAppointment('${a.id}')" title="${escapeHtml(a.title)} (${escapeHtml(a.profile_name)})" class="text-[10px] px-1 py-0.5 rounded font-medium text-white truncate cursor-pointer hover:opacity-90 transition-opacity" style="background-color: ${a.profile_color || '#3B82F6'};">
              ${a.appointment_time ? formatApptTime(a.appointment_time) + ' ' : ''}${escapeHtml(a.title)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  html += `</div></div>`;
  container.innerHTML = html;
}

function changeMonth(delta) {
  state.calendarDate.setMonth(state.calendarDate.getMonth() + delta);
  renderCalendarView(document.getElementById('view-container'));
}

function resetMonth() {
  state.calendarDate = new Date();
  renderCalendarView(document.getElementById('view-container'));
}


function renderProfilesView(container) {
  let html = `
    <div class="space-y-4 mb-20 md:mb-6">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-bold text-slate-800">👨‍👩‍👧‍👦 สมาชิกในครอบครัว</h2>
          <p class="text-xs text-slate-500">จัดการข้อมูลโปรไฟล์เพื่อแยกสถิติและสีแจ้งเตือนนัดหมาย</p>
        </div>
        <button onclick="openProfileModal()" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-all flex items-center gap-1">
          <span>+ เพิ่มสมาชิก</span>
        </button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
  `;

  for (const p of state.profiles) {
    const apptCount = state.appointments.filter(a => a.profile_id === p.id).length;
    html += `
      <div class="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shadow-sm" style="background-color: ${p.color}20; border: 2px solid ${p.color};">
            ${p.avatar || '👤'}
          </div>
          <div>
            <div class="font-bold text-slate-800 text-sm">${escapeHtml(p.name)}</div>
            <div class="text-xs text-slate-400">${escapeHtml(p.relation || 'ทั่วไป')} • มี ${apptCount} นัดหมาย</div>
          </div>
        </div>

        <div class="flex items-center gap-1.5">
          <button onclick="editProfile('${p.id}')" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-50 transition-colors" title="แก้ไข">✏️</button>
          <button onclick="deleteProfile('${p.id}')" class="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-50 transition-colors" title="ลบ">🗑️</button>
        </div>
      </div>
    `;
  }

  html += `</div></div>`;
  container.innerHTML = html;
}

async function renderLogsView(container) {
  container.innerHTML = `
    <div class="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm text-center">
      <div class="animate-spin text-2xl mb-2">⏳</div>
      <p class="text-xs text-slate-500">กำลังโหลดประวัติการแจ้งเตือน...</p>
    </div>
  `;

  await fetchLogs();

  let html = `
    <div class="bg-white rounded-2xl p-4 md:p-6 border border-slate-100 shadow-sm mb-20 md:mb-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-base font-bold text-slate-800 flex items-center gap-2">
            <span>📜</span> ประวัติการส่งแจ้งเตือน (Discord)
          </h2>
          <p class="text-xs text-slate-500">แสดงรอบการยิงแจ้งเตือน 7 วัน, 3 วัน, 1 วัน และวันนัดหมาย</p>
        </div>
        <button onclick="renderLogsView(document.getElementById('view-container'))" class="px-2.5 py-1 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
          🔄 รีเฟรช
        </button>
      </div>
  `;

  if (state.logs.length === 0) {
    html += `<div class="text-center py-8 text-xs text-slate-400">ยังไม่มีประวัติการส่งแจ้งเตือน</div>`;
  } else {
    html += `
      <div class="divide-y divide-slate-100 text-xs">
        ${state.logs.map(log => `
          <div class="py-2.5 flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-2.5 rounded-full ${log.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}"></span>
              <div>
                <div class="font-semibold text-slate-800">
                  ${log.appointment_title ? escapeHtml(log.appointment_title) : 'ทดสอบระบบ'} 
                  <span class="font-normal text-slate-400">(${log.trigger_type})</span>
                </div>
                <div class="text-[11px] text-slate-500">${escapeHtml(log.message || '')}</div>
              </div>
            </div>
            <div class="text-[10px] text-slate-400">
              ${new Date(log.sent_at).toLocaleString('th-TH')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  html += `</div>`;
  container.innerHTML = html;
}

async function addToGoogleCalendar(appointmentId) {
  try {
    const res = await fetch(`${API_BASE}/api/appointments/${appointmentId}/gcal`);
    if (!res.ok) throw new Error('Cannot get Google Calendar link');
    const data = await res.json();
    window.open(data.url, '_blank');
    showToast('กำลังเปิด Google Calendar...', 'info');
  } catch (err) {
    showToast('เปิด Google Calendar ไม่สำเร็จ: ' + err.message, 'error');
  }
}

function downloadICS(appointmentId) {
  window.location.href = `${API_BASE}/api/appointments/${appointmentId}/ics`;
  showToast('กำลังดาวน์โหลดไฟล์ .ics พร้อมตั้งปลุก (Alarm)...', 'success');
}

async function testDiscordAlert(appointmentId) {
  showToast('กำลังส่งแจ้งเตือนเข้า Discord...', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/appointments/${appointmentId}/notify`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('ส่งแจ้งเตือนเข้า Discord สำเร็จแล้ว! 🚀', 'success');
    } else {
      showToast('ส่งไม่สำเร็จ: ' + (data.error || 'กรุณาตรวจสอบ Webhook URL ในเมนูตั้งค่า'), 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function toggleAppointmentStatus(appointmentId, newStatus) {
  try {
    const res = await fetch(`${API_BASE}/api/appointments/${appointmentId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    if (!res.ok) throw new Error('Cannot update status');
    await fetchAppointments();
    renderAll();
    showToast(newStatus === 'completed' ? 'บันทึกว่าไปตามนัดเรียบร้อยแล้ว ✅' : 'ปรับสถานะเป็นรอดำเนินการแล้ว', 'success');
  } catch (err) {
    showToast('อัปเดตสถานะไม่สำเร็จ: ' + err.message, 'error');
  }
}

async function deleteAppointment(appointmentId) {
  if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบนัดหมายนี้?')) return;
  try {
    const res = await fetch(`${API_BASE}/api/appointments/${appointmentId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Cannot delete appointment');
    await fetchAppointments();
    renderAll();
    showToast('ลบนัดหมายเรียบร้อยแล้ว', 'success');
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + err.message, 'error');
  }
}


function openAppointmentModal(appointmentId = null) {
  state.editingAppointmentId = appointmentId;
  state.uploadedImageUrl = null;
  state.checklistItems = [];

  const modal = document.getElementById('appointment-modal');
  const titleEl = document.getElementById('modal-appt-title');
  const form = document.getElementById('appointment-form');

  const profileSelect = document.getElementById('form-profile-id');
  profileSelect.innerHTML = state.profiles.map(p => `
    <option value="${p.id}">${p.avatar || '👤'} ${escapeHtml(p.name)} (${escapeHtml(p.relation || 'ทั่วไป')})</option>
  `).join('');

  if (appointmentId) {
    titleEl.textContent = '✏️ แก้ไขนัดหมายแพทย์';
    const appt = state.appointments.find(a => a.id === appointmentId);
    if (appt) {
      document.getElementById('form-title').value = appt.title || '';
      document.getElementById('form-profile-id').value = appt.profile_id;
      document.getElementById('form-hospital').value = appt.hospital || '';
      document.getElementById('form-department').value = appt.department || '';
      document.getElementById('form-doctor').value = appt.doctor_name || '';
      document.getElementById('form-date').value = normalizeDateString(appt.appointment_date);
      document.getElementById('form-time').value = normalizeTimeString(appt.appointment_time);
      document.getElementById('form-prep-notes').value = appt.prep_notes || '';
      document.getElementById('form-notes').value = appt.notes || '';
      state.uploadedImageUrl = appt.slip_image_url || null;

      if (appt.prep_checklist) {
        try {
          const parsed = typeof appt.prep_checklist === 'string' ? JSON.parse(appt.prep_checklist) : appt.prep_checklist;
          state.checklistItems = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          state.checklistItems = [];
        }
      }
    }
  } else {
    titleEl.textContent = '➕ เพิ่มนัดหมายแพทย์ใหม่';
    form.reset();
    document.getElementById('form-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('form-time').value = '09:00';
    if (state.selectedProfileId && state.selectedProfileId !== 'all') {
      document.getElementById('form-profile-id').value = state.selectedProfileId;
    }
  }

  renderChecklistBuilder();
  renderImageUploadPreview();
  modal.classList.remove('hidden');
}

function closeAppointmentModal() {
  document.getElementById('appointment-modal').classList.add('hidden');
}

function editAppointment(id) {
  openAppointmentModal(id);
}

function renderChecklistBuilder() {
  const container = document.getElementById('checklist-container');
  if (!container) return;

  if (state.checklistItems.length === 0) {
    container.innerHTML = `<span class="text-xs text-slate-400 italic">ยังไม่มีรายการสิ่งที่ต้องเตรียมตัว</span>`;
    return;
  }

  container.innerHTML = state.checklistItems.map((item, idx) => `
    <div class="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg text-xs">
      <span class="text-slate-700">📌 ${escapeHtml(item.text || item)}</span>
      <button type="button" onclick="removeChecklistItem(${idx})" class="text-slate-400 hover:text-red-600 font-bold px-1">✕</button>
    </div>
  `).join('');
}

function addChecklistItem(text) {
  if (!text || !text.trim()) return;
  state.checklistItems.push({ text: text.trim(), done: false });
  renderChecklistBuilder();
}

function removeChecklistItem(idx) {
  state.checklistItems.splice(idx, 1);
  renderChecklistBuilder();
}

function addQuickPrep(text) {
  addChecklistItem(text);
  const prepInput = document.getElementById('form-prep-notes');
  if (prepInput && !prepInput.value.includes(text)) {
    prepInput.value = (prepInput.value ? prepInput.value + '\n' : '') + text;
  }
}

function compressImage(file, maxWidth, quality, callback) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const compressedData = canvas.toDataURL('image/jpeg', quality);
      callback(compressedData);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  showToast('กำลังประมวลผลรูปภาพ...', 'info');

  compressImage(file, 1000, 0.7, async (compressedBase64) => {
    state.uploadedImageUrl = compressedBase64;
    renderImageUploadPreview();

    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: compressedBase64 })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) state.uploadedImageUrl = data.url;
      }
      showToast('แนบรูปถ่ายใบนัดแพทย์เรียบร้อยแล้ว 📸', 'success');
    } catch (err) {
      showToast('แนบรูปถ่ายเรียบร้อยแล้ว 📸', 'success');
    }
  });
}

function renderImageUploadPreview() {
  const container = document.getElementById('image-preview-container');
  if (!container) return;

  if (state.uploadedImageUrl) {
    container.innerHTML = `
      <div class="relative inline-block mt-2">
        <img src="${state.uploadedImageUrl}" class="w-24 h-24 object-cover rounded-xl border border-slate-200 shadow-xs" />
        <button type="button" onclick="removeUploadedImage()" class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center shadow-sm">
          ✕
        </button>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

function removeUploadedImage() {
  state.uploadedImageUrl = null;
  renderImageUploadPreview();
}

async function handleAppointmentSubmit(event) {
  event.preventDefault();

  const payload = {
    title: document.getElementById('form-title').value.trim(),
    profile_id: document.getElementById('form-profile-id').value,
    hospital: document.getElementById('form-hospital').value.trim(),
    department: document.getElementById('form-department').value.trim(),
    doctor_name: document.getElementById('form-doctor').value.trim(),
    appointment_date: document.getElementById('form-date').value,
    appointment_time: document.getElementById('form-time').value,
    prep_notes: document.getElementById('form-prep-notes').value.trim(),
    prep_checklist: state.checklistItems,
    slip_image_url: state.uploadedImageUrl || '',
    notes: document.getElementById('form-notes').value.trim(),
    notify_now: document.getElementById('form-notify-now') ? document.getElementById('form-notify-now').checked : false
  };

  if (!payload.title || !payload.hospital || !payload.appointment_date) {
    showToast('กรุณากรอกข้อมูลสำคัญ (ชื่อนัดหมาย, รพ., วันที่) ให้ครบถ้วน', 'error');
    return;
  }

  showLoading(true);
  try {
    let url = `${API_BASE}/api/appointments`;
    let method = 'POST';

    if (state.editingAppointmentId) {
      url = `${API_BASE}/api/appointments/${state.editingAppointmentId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Save failed');
    }

    const createdAppt = await res.json();
    if (payload.notify_now && createdAppt && createdAppt.id) {
      fetch(`${API_BASE}/api/appointments/${createdAppt.id}/notify`, { method: 'POST' }).catch(e => console.error(e));
    }

    closeAppointmentModal();
    await fetchAppointments();
    renderAll();
    showToast(state.editingAppointmentId ? 'แก้ไขนัดหมายเรียบร้อยแล้ว!' : (payload.notify_now ? 'เพิ่มนัดหมายและส่งแจ้งเตือนเข้า Discord แล้ว! 🚀' : 'เพิ่มนัดหมายใหม่สำเร็จแล้ว!'), 'success');
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('setting-webhook').value = state.settings.discord_webhook_url || '';
  const sheetInput = document.getElementById('setting-google-sheet');
  if (sheetInput) sheetInput.value = state.settings.google_sheet_url || '';
  modal.classList.remove('hidden');
}

function closeSettingsModal() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings(event) {
  event.preventDefault();
  const webhookUrl = document.getElementById('setting-webhook').value.trim();
  const sheetInput = document.getElementById('setting-google-sheet');
  const googleSheetUrl = sheetInput ? sheetInput.value.trim() : '';

  try {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        discord_webhook_url: webhookUrl,
        google_sheet_url: googleSheetUrl
      })
    });
    if (!res.ok) throw new Error('Save settings failed');
    state.settings.discord_webhook_url = webhookUrl;
    state.settings.google_sheet_url = googleSheetUrl;
    closeSettingsModal();
    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว ✅', 'success');
    
    // Refresh appointments in case sheets was just connected
    await fetchAppointments();
    await fetchProfiles();
    renderAll();
  } catch (err) {
    showToast('บันทึกไม่สำเร็จ: ' + err.message, 'error');
  }
}

async function testDiscordSettings() {
  const webhookUrl = document.getElementById('setting-webhook').value.trim();
  if (!webhookUrl) {
    showToast('กรุณากรอก Discord Webhook URL ก่อนทดสอบ', 'error');
    return;
  }

  showToast('กำลังทดสอบส่งข้อความเข้า Discord...', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/settings/test-discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhook_url: webhookUrl })
    });

    const data = await res.json();
    if (data.success) {
      showToast('เชื่อมต่อ Discord สำเร็จ! ได้รับข้อความทดสอบแล้ว 🎉', 'success');
    } else {
      showToast('เชื่อมต่อไม่สำเร็จ: ' + (data.error || 'โปรดตรวจสอบ URL'), 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function testGoogleSheetsSettings() {
  const sheetInput = document.getElementById('setting-google-sheet');
  const sheetUrl = sheetInput ? sheetInput.value.trim() : '';
  if (!sheetUrl) {
    showToast('กรุณากรอก Google Sheet Web App URL ก่อนทดสอบ', 'error');
    return;
  }

  showToast('กำลังทดสอบเชื่อมต่อ Google Sheets...', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/settings/test-sheets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_sheet_url: sheetUrl })
    });

    const data = await res.json();
    if (data.success) {
      showToast('เชื่อมต่อ Google Sheets สำเร็จ! 📊 ข้อมูลจะถูกบันทึกถาวร', 'success');
    } else {
      showToast('เชื่อมต่อไม่สำเร็จ: ' + (data.error || 'โปรดตรวจสอบ URL'), 'error');
    }
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

function openProfileModal(profileId = null) {
  state.editingProfileId = profileId;
  const modal = document.getElementById('profile-modal');
  const titleEl = document.getElementById('modal-profile-title');

  if (profileId) {
    titleEl.textContent = '✏️ แก้ไขโปรไฟล์สมาชิก';
    const p = state.profiles.find(x => x.id === profileId);
    if (p) {
      document.getElementById('profile-name').value = p.name;
      document.getElementById('profile-relation').value = p.relation || 'ทั่วไป';
      document.getElementById('profile-color').value = p.color || '#3B82F6';
      document.getElementById('profile-avatar').value = p.avatar || '👤';
    }
  } else {
    titleEl.textContent = '➕ เพิ่มโปรไฟล์สมาชิก';
    document.getElementById('profile-form').reset();
    document.getElementById('profile-color').value = '#3B82F6';
    document.getElementById('profile-avatar').value = '👤';
  }

  modal.classList.remove('hidden');
}

function closeProfileModal() {
  document.getElementById('profile-modal').classList.add('hidden');
}

function editProfile(id) {
  openProfileModal(id);
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const payload = {
    name: document.getElementById('profile-name').value.trim(),
    relation: document.getElementById('profile-relation').value.trim(),
    color: document.getElementById('profile-color').value,
    avatar: document.getElementById('profile-avatar').value
  };

  if (!payload.name) {
    showToast('กรุณากรอกชื่อสมาชิก', 'error');
    return;
  }

  try {
    let url = `${API_BASE}/api/profiles`;
    let method = 'POST';

    if (state.editingProfileId) {
      url = `${API_BASE}/api/profiles/${state.editingProfileId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Profile save failed');
    }

    closeProfileModal();
    await fetchProfiles();
    renderAll();
    showToast('บันทึกโปรไฟล์สำเร็จแล้ว!', 'success');
  } catch (err) {
    showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
  }
}

async function deleteProfile(profileId) {
  if (!confirm('ต้องการลบโปรไฟล์นี้หรือไม่? (จะต้องไม่มีนัดหมายผูกอยู่)')) return;
  try {
    const res = await fetch(`${API_BASE}/api/profiles/${profileId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Cannot delete');
    await fetchProfiles();
    renderAll();
    showToast('ลบโปรไฟล์สำเร็จแล้ว', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openApptImageViewer(apptId) {
  const appt = state.appointments.find(a => a.id === apptId);
  if (appt && appt.slip_image_url) {
    openImageViewer(appt.slip_image_url);
  }
}

function openImageViewer(url) {
  if (!url) return;
  const modal = document.getElementById('image-viewer-modal');
  const img = document.getElementById('viewer-img');
  const downloadBtn = document.getElementById('viewer-download-btn');
  if (!modal || !img) return;
  img.src = url;
  if (downloadBtn) {
    downloadBtn.href = url;
  }
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeImageViewer() {
  const modal = document.getElementById('image-viewer-modal');
  if (modal) modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function switchTab(tabName) {
  state.currentTab = tabName;
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.className = 'nav-tab-btn flex flex-col md:flex-row items-center gap-1 py-2 px-3 text-xs md:text-sm font-bold text-blue-600 rounded-xl bg-blue-50 transition-colors';
    } else {
      btn.className = 'nav-tab-btn flex flex-col md:flex-row items-center gap-1 py-2 px-3 text-xs md:text-sm font-medium text-slate-500 hover:text-slate-900 rounded-xl transition-colors';
    }
  });

  renderMainView();
}

function parseApptDate(dateStr) {
  const norm = normalizeDateString(dateStr);
  if (!norm) return null;
  const match = norm.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const y = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    const d = parseInt(match[3], 10);
    return { year: y, month: m, day: d, dateObj: new Date(y, m - 1, d) };
  }
  return null;
}

function getRelativeDayInfo(dateStr) {
  const parsed = parseApptDate(dateStr);
  if (!parsed) return { text: 'ไม่ระบุวัน', badgeClass: 'bg-slate-100 text-slate-500' };

  const now = new Date();
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDate = parsed.dateObj;

  const diffTime = targetDate.getTime() - todayDate.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { text: '🚨 วันนี้!', badgeClass: 'bg-red-500 text-white badge-urgent' };
  } else if (diffDays === 1) {
    return { text: '⚡ พรุ่งนี้', badgeClass: 'bg-amber-500 text-white badge-urgent' };
  } else if (diffDays === 2) {
    return { text: 'อีก 2 วัน', badgeClass: 'bg-amber-100 text-amber-800' };
  } else if (diffDays === 3) {
    return { text: 'อีก 3 วัน', badgeClass: 'bg-yellow-100 text-yellow-800' };
  } else if (diffDays <= 7 && diffDays > 3) {
    return { text: `อีก ${diffDays} วัน`, badgeClass: 'bg-blue-100 text-blue-800' };
  } else if (diffDays > 7) {
    return { text: `อีก ${diffDays} วัน`, badgeClass: 'bg-slate-100 text-slate-700' };
  } else {
    return { text: 'เลยกำหนดแล้ว', badgeClass: 'bg-slate-100 text-slate-400' };
  }
}

function formatThaiFullDate(dateStr) {
  const parsed = parseApptDate(dateStr);
  if (!parsed) return '-';
  const dayName = THAI_DAYS_FULL[parsed.dateObj.getDay()] || '';
  const thaiYear = parsed.year + 543;
  return `วัน${dayName}ที่ ${parsed.day} ${THAI_MONTHS_SHORT[parsed.month - 1]} ${thaiYear}`;
}

function formatThaiShortDate(dateStr) {
  const parsed = parseApptDate(dateStr);
  if (!parsed) return '-';
  const thaiYear = parsed.year + 543;
  return `${parsed.day} ${THAI_MONTHS_SHORT[parsed.month - 1]} ${thaiYear}`;
}

function formatApptTime(timeStr) {
  return normalizeTimeString(timeStr);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  const toast = document.createElement('div');
  let bgClass = 'bg-slate-900 text-white';
  let icon = 'ℹ️';

  if (type === 'success') {
    bgClass = 'bg-emerald-600 text-white';
    icon = '✅';
  } else if (type === 'error') {
    bgClass = 'bg-red-600 text-white';
    icon = '⚠️';
  }

  toast.className = `${bgClass} px-4 py-2.5 rounded-xl shadow-lg text-xs md:text-sm font-medium flex items-center gap-2 transform transition-all duration-300 translate-y-2 opacity-0`;
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  }, 10);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showLoading(show) {
  const spinner = document.getElementById('global-loading');
  if (spinner) {
    if (show) spinner.classList.remove('hidden');
    else spinner.classList.add('hidden');
  }
}

function setupEventListeners() {
  const addChecklistBtn = document.getElementById('btn-add-checklist');
  const checklistInput = document.getElementById('input-custom-checklist');
  if (addChecklistBtn && checklistInput) {
    addChecklistBtn.addEventListener('click', () => {
      addChecklistItem(checklistInput.value);
      checklistInput.value = '';
    });
    checklistInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addChecklistItem(checklistInput.value);
        checklistInput.value = '';
      }
    });
  }
}

