/** รีเซ็ตรอบตารางรถทุกวัน 18:00 น. (Asia/Bangkok) */
const SCHEDULE_RESET_HOUR = 18;
const SCHEDULE_RESET_MINUTES = SCHEDULE_RESET_HOUR * 60;
const BANGKOK_TZ = 'Asia/Bangkok';

let allSchedules = [];
let refreshTimer = null;
let filteredSchedules = null;

/** แปลง field หลายภาษาจาก JSON ให้ตรงกับภาษาปัจจุบัน */
function localizeSchedule(item) {
  const lang = (typeof currentLang !== 'undefined' ? currentLang : localStorage.getItem('appLang')) || 'th';
  return {
    ...item,
    route: item[`route_${lang}`] || item.route_th || item.route || '',
    depart_from: item[`depart_from_${lang}`] || item.depart_from_th || item.depart_from || '',
    arrive_at: item[`arrive_at_${lang}`] || item.arrive_at_th || item.arrive_at || '',
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  allSchedules = await loadSchedules();
  refreshScheduleView();
  initFilters(allSchedules);

  window.addEventListener('languageChanged', () => refreshScheduleView());

  refreshTimer = setInterval(refreshScheduleView, 60 * 1000);
});

function getBangkokNow() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const pick = (type) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour'),
    minute: pick('minute')
  };
}

function getBangkokTimeLabel() {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK_TZ,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date());
}

function parseTimeToMinutes(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function getCurrentMinutesBangkok() {
  const { hour, minute } = getBangkokNow();
  return hour * 60 + minute;
}

function hasDepartTimePassed(item, nowMinutes) {
  return parseTimeToMinutes(item.depart_time) <= nowMinutes;
}

/**
 * หลัง 18:00 หรือก่อนรอบแรก → รอบ 08:00 เป็นอันดับ 1
 * ระหว่างให้บริการ → รอบถัดไปที่ยังไม่ถึงเวลาออกเป็นอันดับ 1
 * หลังรอบสุดท้ายแต่ก่อน 18:00 → รอบ 08:00 (วันถัดไป) เป็นอันดับ 1
 */
function orderSchedulesByCurrentTime(schedules) {
  const sorted = [...schedules].sort(
    (a, b) => parseTimeToMinutes(a.depart_time) - parseTimeToMinutes(b.depart_time)
  );

  if (sorted.length === 0) return [];

  const nowMinutes = getCurrentMinutesBangkok();
  const firstBusMinutes = parseTimeToMinutes(sorted[0].depart_time);
  const lastBusMinutes = parseTimeToMinutes(sorted[sorted.length - 1].depart_time);
  const inResetWindow =
    nowMinutes >= SCHEDULE_RESET_MINUTES || nowMinutes < firstBusMinutes;
  const allServiceEndedToday =
    !inResetWindow && nowMinutes > lastBusMinutes;

  let pivotIndex = 0;

  if (inResetWindow || allServiceEndedToday) {
    pivotIndex = 0;
  } else {
    pivotIndex = sorted.findIndex((s) => parseTimeToMinutes(s.depart_time) > nowMinutes);
    if (pivotIndex === -1) pivotIndex = 0;
  }

  const rotated = [...sorted.slice(pivotIndex), ...sorted.slice(0, pivotIndex)];

  return rotated.map((item, index) => {
    const isNext = index === 0;
    const isPassed =
      !isNext &&
      !inResetWindow &&
      !allServiceEndedToday &&
      hasDepartTimePassed(item, nowMinutes);

    return {
      ...localizeSchedule(item),
      displayRank: index + 1,
      isNext,
      isPassed
    };
  });
}

function getNextResetLabel() {
  const now = getBangkokNow();
  const nowMinutes = now.hour * 60 + now.minute;
  let y = now.year;
  let m = now.month;
  let d = now.day;

  if (nowMinutes >= SCHEDULE_RESET_MINUTES) {
    const bump = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00+07:00`);
    bump.setDate(bump.getDate() + 1);
    y = bump.getFullYear();
    m = bump.getMonth() + 1;
    d = bump.getDate();
  }

  const resetAt = new Date(
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(SCHEDULE_RESET_HOUR).padStart(2, '0')}:00:00+07:00`
  );

  return new Intl.DateTimeFormat('th-TH', {
    timeZone: BANGKOK_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(resetAt);
}

function renderScheduleStatus(ordered) {
  const el = document.getElementById('scheduleStatus');
  if (!el) return;

  const next = ordered.find((s) => s.isNext);
  const nextTime = next ? next.depart_time : '—';
  const nextRoute = next ? next.route : '';

  el.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div>
        <p class="text-xs uppercase tracking-wider font-bold text-primary dark:text-primary-light mb-1">
          ${getTranslation('schedule_live')}
        </p>
        <p class="text-sm text-black-600 dark:text-gray-300">
          <i class="far fa-clock mr-1"></i>${getTranslation('schedule_thai_time')}: <strong>${getBangkokTimeLabel()}</strong>
        </p>
      </div>
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center">
        <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 text-primary dark:text-primary-light text-sm font-bold border border-primary/30">
          <i class="fas fa-star"></i>
          ${getTranslation('schedule_next_round')}: ${nextTime}
        </span>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          <i class="fas fa-rotate mr-1"></i>${getTranslation('schedule_reset_at')} ${getNextResetLabel()}
        </span>
      </div>
    </div>
    ${nextRoute ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-2 truncate">${nextRoute}</p>` : ''}
  `;
}

function refreshScheduleView() {
  const source = filteredSchedules !== null ? filteredSchedules : allSchedules;
  const ordered = orderSchedulesByCurrentTime(source);
  renderScheduleStatus(ordered);
  renderSchedules(ordered);
}

function renderSchedules(data) {
  const tbody = document.getElementById('scheduleTableBody');
  const mobileContainer = document.getElementById('mobileScheduleCards');

  if (!tbody || !mobileContainer) return;

  tbody.innerHTML = '';
  mobileContainer.innerHTML = '';

  data.forEach((item, index) => {
    const delayClass = `delay-${(index % 3 + 1) * 100}`;
    const rowClass = item.isNext
      ? 'bg-primary/10 dark:bg-primary/20 ring-2 ring-primary/40'
      : item.isPassed
        ? 'opacity-55'
        : '';
    const rankBadge = item.isNext
      ? `<span class="inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-full bg-primary text-white text-xs font-extrabold shadow">${item.displayRank}</span>`
      : `<span class="inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold">${item.displayRank}</span>`;
    const nextLabel = item.isNext
      ? `<span class="ml-2 text-xs font-bold text-primary dark:text-primary-light uppercase">${getTranslation('schedule_next_round')}</span>`
      : '';
    const passedLabel = item.isPassed
      ? `<span class="ml-2 text-xs text-black-400">${getTranslation('schedule_passed')}</span>`
      : '';

    const tr = document.createElement('tr');
    tr.className = `border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors anim-hidden animate-slide-up ${delayClass} ${rowClass}`;
    tr.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm">${rankBadge}</td>
      <td class="px-6 py-4 text-sm font-medium text-white-900 dark:text-white">
        ${item.route}${nextLabel}${passedLabel}
      </td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-white-500 dark:text-white-400">${item.depart_from}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-white-500 dark:text-white-400">${item.arrive_at}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-bold ${item.isNext ? 'text-primary' : 'text-white-600 dark:text-white-400'} ${item.isPassed ? 'line-through' : ''}">${item.depart_time}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-bold ${item.isNext ? 'text-primary' : 'text-white-600 dark:text-white-400'} ${item.isPassed ? 'line-through' : ''}">${item.arrive_time}</td>
    `;
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = `glass-card p-4 mb-4 anim-hidden animate-slide-up ${delayClass} ${item.isNext ? 'ring-2 ring-primary/50' : ''} ${item.isPassed ? 'opacity-55' : ''}`;
    card.innerHTML = `
      <div class="flex justify-between items-start mb-3 border-b pb-2 dark:border-gray-700 gap-2">
        <div class="flex items-center gap-2 min-w-0">
          ${rankBadge}
          <h4 class="font-bold text-white-800 dark:text-white truncate">${item.route}</h4>
        </div>
        ${item.isNext ? `<span class="text-[10px] font-bold text-primary dark:text-primary-light uppercase shrink-0">${getTranslation('schedule_next_round')}</span>` : ''}
        ${item.isPassed ? `<span class="text-[10px] text-white-400 shrink-0">${getTranslation('schedule_passed')}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p class="text-white-500 dark:text-gray-400 text-xs" data-i18n="depart_from">${getTranslation('depart_from')}</p>
          <p class="font-medium text-white-800 dark:text-white">${item.depart_from}</p>
          <p class="font-bold text-primary text-lg ${item.isPassed ? 'line-through opacity-70' : ''}">${item.depart_time}</p>
        </div>
        <div>
          <p class="text-white-500 dark:text-gray-400 text-xs" data-i18n="arrive_at">${getTranslation('arrive_at')}</p>
          <p class="font-medium text-white-800 dark:text-white">${item.arrive_at}</p>
          <p class="font-bold text-primary text-lg ${item.isPassed ? 'line-through opacity-70' : ''}">${item.arrive_time}</p>
        </div>
      </div>
    `;
    mobileContainer.appendChild(card);
  });

  applyTranslations();
  if (typeof initAnimations === 'function') initAnimations();
}

function initFilters(schedules) {
  const searchInput = document.getElementById('routeSearch');
  const timeFilter = document.getElementById('timeFilter');

  function applyFilters() {
    // เช็คก่อนว่า searchInput มีอยู่จริงไหม ถ้าไม่มีให้ใช้ค่าว่าง '' แทน
    const term = searchInput ? searchInput.value.toLowerCase() : '';

    // ป้องกัน error กรณี timeFilter ไม่มีในหน้าเว็บเช่นกัน
    const time = timeFilter ? timeFilter.value : 'all';

    filteredSchedules = schedules.filter((item) => {
      const loc = localizeSchedule(item);
      const matchRoute =
        loc.route.toLowerCase().includes(term) ||
        loc.depart_from.toLowerCase().includes(term) ||
        loc.arrive_at.toLowerCase().includes(term);

      let matchTime = true;
      if (time === 'morning') {
        matchTime = item.depart_time < '12:00';
      } else if (time === 'afternoon') {
        matchTime = item.depart_time >= '12:00';
      }

      return matchRoute && matchTime;
    });

    refreshScheduleView();
  }

  if (searchInput) searchInput.addEventListener('input', applyFilters);
  if (timeFilter) timeFilter.addEventListener('change', applyFilters);
}