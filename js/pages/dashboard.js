// Dashboard — the landing page.
// House-wide metrics, attendance trend, roster, and a per-yuvak panel.

import { requireAuth, canWrite } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, showError, emptyState, spinner, toast,
  statusDot, statusLegend
} from '../lib/ui.js';
import { listStats, listMembers, isCurrent } from '../api/members.js';
import { getSettings } from '../api/sabhas.js';
import {
  attendanceTrend, fullHistory, historyForMember, currentStreak, missedStreak
} from '../api/attendance.js';
import { listAbsences } from '../api/utilities.js';
import { areaChart, donutChart, memberChart } from '../lib/charts.js';
import { band, nextSabha } from '../lib/schedule.js';
import { today, formatShort, formatLong, initials, monthKey, monthName } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');

// Redraw when the light/dark toggle fires, so the gradients and grid
// lines follow rather than staying stuck in the old palette.
document.addEventListener('gm:theme', () => drawCharts());
let profile, stats, members, trend, settings, absences = [], marks = [];

init();

async function init() {
  try {
    profile = await requireAuth();
    renderChrome(profile, 'dashboard');

    const e = new URLSearchParams(location.search).get('e');
    if (e === 'readonly') {
      toast('That page needs a sevak sign-in. PIN access is view-only.', 'info');
      history.replaceState(null, '', 'index.html');
    } else if (e === 'forbidden') {
      toast('That page is for the platform admin only.', 'info');
      history.replaceState(null, '', 'index.html');
    }

    let allStats, allMembers;
    [allStats, allMembers, trend, settings, absences, marks] = await Promise.all([
      listStats(profile.mandirId),
      listMembers(profile.mandirId),
      // Pull the whole trend; the range pills slice it client-side so
      // switching 6/12/All does not round-trip to the database.
      attendanceTrend(profile.mandirId, 500),
      getSettings(profile.mandirId),
      // A PIN session can read these too, but never guarantee it —
      // an empty list is better than a dead dashboard.
      listAbsences(profile.mandirId).catch(() => []),
      fullHistory(profile.mandirId).catch(() => [])
    ]);

    // Previous members — those whose "Until" date has passed — are kept
    // off the dashboard. Their history is still in the database and still
    // counts toward utility bills; it just is not who lives here now.
    members = allMembers.filter(isCurrent);
    const live = new Set(members.map((m) => m.id));
    stats = allStats.filter((s) => live.has(s.id));

    render();
    if (members.length) selectMember(members[0].id);
  } catch (e) {
    showError(main, e.message);
  }
}

function render() {
  const threshold = settings.followup_threshold ?? 65;
  const last = trend.at(-1);
  const avg = trend.length
    ? Math.round((trend.reduce((a, t) => a + t.present / (t.total || 1), 0) / trend.length) * 100)
    : 0;
  const followUp = stats.filter((s) => s.total > 0 && s.pct < threshold).length;
  const upcoming = nextSabha(today(), settings.thursday_anchor);

  const action = upcoming && canWrite(profile)
    ? `<a href="attendance.html?date=${upcoming}" class="btn btn-primary">
         <i class="ti ti-checkbox me-1"></i> Take attendance
       </a>`
    : '';

  main.innerHTML = `
    ${pageHeader(
      'Dashboard',
      upcoming
        ? `Next sabha &middot; ${esc(formatLong(upcoming))}`
        : 'No sabha scheduled in the next two weeks',
      action
    )}

    <div class="row row-deck row-cards mb-3">
      ${statCard('Average attendance', `${avg}%`, 'chart-line', 'primary')}
      ${statCard('Last sabha', last ? `${last.present}/${last.total}` : '—', 'users-group', 'primary')}
      ${statCard('Sabhas recorded', String(trend.length), 'calendar-check', 'primary')}
      ${statCard('Needs follow-up', String(followUp), 'alert-circle', followUp ? 'watch' : 'secondary')}
    </div>

    <div class="row row-cards">
      <div class="col-12 col-lg-7">
        ${awayCard()}
        ${trend.length ? trendCard() : ''}
        ${rosterCard()}
      </div>
      <div class="col-12 col-lg-5">
        ${trend.length ? mixCard() : ''}
        ${personalCard()}
      </div>
    </div>`;

  // The two yuvak pickers are one choice shown twice — picking a name in
  // either the chart header or the insights panel moves both, so the page
  // is never showing one person's chart beside another's numbers.
  document.getElementById('pick')?.addEventListener('change', (e) => {
    who = e.target.value;
    const f = document.getElementById('f-who');
    if (f) f.value = who;
    retitle();
    drawCharts();
    selectMember(who);
  });

  // The filters only change what the two charts draw, so retitle the
  // cards in place rather than re-rendering the whole dashboard.
  document.getElementById('f-month')?.addEventListener('change', (e) => {
    month = e.target.value;
    retitle();
    drawCharts();
  });

  document.getElementById('f-who')?.addEventListener('change', (e) => {
    who = e.target.value;
    retitle();
    drawCharts();
    if (who !== 'all') {
      const pick = document.getElementById('pick');
      if (pick) pick.value = who;
      selectMember(who);
    }
  });

  drawCharts();
}

function retitle() {
  const t = document.getElementById('trend-title');
  if (t) t.textContent = trendTitle();
  const m = document.getElementById('mix-title');
  if (m) m.textContent = mixTitle();
}

function statCard(label, value, icon, tone) {
  const colour = tone === 'watch' ? 'text-watch' : tone === 'primary' ? 'text-primary' : 'text-secondary';
  return `<div class="col-6 col-md-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto">
            <span class="bg-primary-lt avatar"><i class="ti ti-${icon} fs-2"></i></span>
          </div>
          <div class="col">
            <div class="text-secondary small">${esc(label)}</div>
            <div class="gm-stat ${colour}">${esc(value)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

// Who is out of the house right now, and who is about to be. Past trips
// are history and belong on the History page, not here.
function awayCard() {
  const now = today();
  const live = new Set(members.map((m) => m.id));

  const upcoming = absences
    .filter((a) => a.end_date >= now && live.has(a.member_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (!upcoming.length) return '';

  const rows = upcoming.map((a) => {
    const on = a.start_date <= now;
    const span = Math.round(
      (new Date(a.end_date) - new Date(a.start_date)) / 86400000
    ) + 1;

    return `<div class="list-group-item">
      <div class="row align-items-start g-2">
        <div class="col-auto">
          <span class="avatar avatar-sm bg-primary-lt">
            ${esc(initials(a.members.full_name))}
          </span>
        </div>
        <div class="col">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span>${esc(a.members.full_name)}</span>
            <span class="badge ${on ? 'bg-orange-lt' : 'bg-secondary-lt'}">
              ${on ? 'Away now' : 'From ' + esc(formatShort(a.start_date))}
            </span>
          </div>
          <div class="text-secondary small">
            ${esc(formatShort(a.start_date))} – ${esc(formatShort(a.end_date))}
            &middot; ${span} ${span === 1 ? 'day' : 'days'}
          </div>
          <div class="small mt-1">${esc(a.note)}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  const nowCount = upcoming.filter((a) => a.start_date <= now).length;

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title">
        <i class="ti ti-plane me-1" aria-hidden="true"></i> Away
      </h3>
      <div class="card-actions text-secondary small">
        ${nowCount ? `${nowCount} out now` : 'none out today'}
      </div>
    </div>
    <div class="list-group list-group-flush">${rows}</div>
  </div>`;
}

// Chart filters. 'all' months and 'all' yuvaks is the house-wide view.
let month = 'all';
let who = 'all';

// Every month that has a recorded sabha, newest first.
function monthsWithSabhas() {
  return [...new Set(trend.map((t) => monthKey(t.date)))].sort().reverse();
}

function visibleTrend() {
  return month === 'all' ? trend : trend.filter((t) => monthKey(t.date) === month);
}

function filterBar() {
  const months = monthsWithSabhas();
  return `<div class="gm-filters">
    <label class="gm-filters__item">
      <span>Month</span>
      <select id="f-month" class="form-select form-select-sm">
        <option value="all"${month === 'all' ? ' selected' : ''}>All months</option>
        ${months.map((k) =>
          `<option value="${k}"${month === k ? ' selected' : ''}>${esc(monthName(k))}</option>`
        ).join('')}
      </select>
    </label>
    <label class="gm-filters__item">
      <span>Yuvak</span>
      <select id="f-who" class="form-select form-select-sm">
        <option value="all"${who === 'all' ? ' selected' : ''}>All yuvaks</option>
        ${members.map((m) =>
          `<option value="${m.id}"${who === m.id ? ' selected' : ''}>${esc(m.full_name)}</option>`
        ).join('')}
      </select>
    </label>
  </div>`;
}

const whoName = () => members.find((m) => m.id === who)?.full_name ?? '';

function trendTitle() {
  return who === 'all' ? 'Attendance by sabha' : `${whoName()} — sabha by sabha`;
}

function mixTitle() {
  return who === 'all' ? 'How marks break down' : `${whoName()} — marks`;
}

function trendCard() {
  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title" id="trend-title">${esc(trendTitle())}</h3>
      <div class="card-actions">${filterBar()}</div>
    </div>
    <div class="card-body">
      <div id="trend-chart" class="gm-chart"></div>
    </div>
  </div>`;
}

// Chart.render() needs its container to exist, so this runs after the
// page HTML is in the DOM. Charts are torn down before redrawing or
// ApexCharts leaves the old canvas behind.
let trendChart = null;
let mixChart = null;

function drawCharts() {
  trendChart?.destroy();
  mixChart?.destroy();
  trendChart = null;
  mixChart = null;

  // ApexCharts appends into its container, so an empty-state message
  // left behind would sit above the next chart. Clear both hosts first.
  for (const id of ['trend-chart', 'mix-chart']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }

  // The library is a deferred CDN script. It should be ready by now, but
  // on a cold cache it may not be — try again once the page has loaded,
  // and give up quietly rather than throwing if the CDN is unreachable.
  if (typeof ApexCharts === 'undefined') {
    if (!drawCharts.waiting) {
      drawCharts.waiting = true;
      window.addEventListener('load', () => {
        drawCharts.waiting = false;
        drawCharts();
      }, { once: true });
    }
    return;
  }

  const rows = visibleTrend();
  const trendEl = document.getElementById('trend-chart');

  if (trendEl && !rows.length) {
    trendEl.innerHTML = noneHere();
  } else if (trendEl && who === 'all') {
    trendChart = areaChart(trendEl, {
      labels: rows.map((t) => formatShort(t.date)),
      values: rows.map((t) => t.present),
      total: Math.max(...rows.map((t) => t.total), members.length, 1)
    });
  } else if (trendEl) {
    // One yuvak: a column per sabha in view, coloured by their mark.
    // Sabhas with no row for them (away, or not living here yet) stay
    // grey rather than being dropped, so the dates still line up.
    const mine = new Map(
      marks.filter((r) => r.member_id === who).map((r) => [r.sabhas.sabha_date, r])
    );
    trendChart = memberChart(trendEl, {
      labels: rows.map((t) => formatShort(t.date)),
      marks: rows.map((t) => mine.get(t.date)?.status ?? null),
      notMarked: rows.map((t) => mine.get(t.date)?.reason ?? '')
    });
  }

  const mixEl = document.getElementById('mix-chart');
  if (mixEl) {
    const counts = visibleCounts(rows);
    if (Object.values(counts).some((n) => n > 0)) {
      mixChart = donutChart(mixEl, counts);
    } else {
      mixEl.innerHTML = noneHere();
    }
  }
}

// Marks inside both filters — the months in view, and the chosen yuvak.
function visibleCounts(rows) {
  const dates = new Set(rows.map((t) => t.date));
  const counts = { present: 0, late: 0, excused: 0, absent: 0 };
  for (const r of marks) {
    if (who !== 'all' && r.member_id !== who) continue;
    if (dates.has(r.sabhas.sabha_date) && counts[r.status] !== undefined) {
      counts[r.status] += 1;
    }
  }
  return counts;
}

function noneHere() {
  const where = month === 'all' ? '' : ` in ${esc(monthName(month))}`;
  return `<p class="text-secondary small text-center py-5 mb-0">
    Nothing marked${where}.
  </p>`;
}

function mixCard() {
  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title" id="mix-title">${esc(mixTitle())}</h3></div>
    <div class="card-body">
      <div id="mix-chart"></div>
    </div>
  </div>`;
}

function rosterCard() {
  if (!stats.length) {
    return `<div class="card">
      <div class="card-body">
        ${emptyState('users', 'No attendance recorded yet',
          'Once a sabha is marked, everyone appears here ranked by turnout.',
          canWrite(profile)
            ? '<a href="attendance.html" class="btn btn-primary">Take attendance</a>'
            : '')}
      </div>
    </div>`;
  }

  const rows = stats.map((s) => {
    const b = band(s.pct);
    return `<div class="list-group-item">
      <div class="row align-items-center g-2">
        <div class="col-auto">
          <span class="avatar avatar-sm bg-primary-lt">${esc(initials(s.full_name))}</span>
        </div>
        <div class="col text-truncate">
          <div class="text-truncate">${esc(s.full_name)}${
            s.is_sevak ? ' <span class="badge bg-primary-lt ms-1">Sevak</span>' : ''
          }</div>
          <div class="progress progress-sm mt-1">
            <div class="progress-bar bg-${b}" style="width:${s.pct}%"
                 role="progressbar" aria-valuenow="${s.pct}" aria-valuemin="0" aria-valuemax="100"></div>
          </div>
        </div>
        <div class="col-auto text-end" style="min-width:5.5rem">
          <span class="text-${b} fw-medium">${s.pct}%</span>
          <div class="text-secondary small">${s.attended}/${s.total}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="card">
    <div class="card-header">
      <h3 class="card-title">All yuvaks</h3>
      <div class="card-actions text-secondary small">${stats.length} active</div>
    </div>
    <div class="list-group list-group-flush">${rows}</div>
  </div>`;
}

function personalCard() {
  return `<div class="card sticky-top" style="top:1rem">
    <div class="card-header">
      <h3 class="card-title">Personal insights</h3>
    </div>
    <div class="card-body">
      <label class="form-label" for="pick">Select yuvak</label>
      <select id="pick" class="form-select mb-3">
        ${members.map((m) => `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}
      </select>
      <div id="personal">${spinner}</div>
    </div>
  </div>`;
}

async function selectMember(id) {
  const host = document.getElementById('personal');
  if (!host) return;
  host.innerHTML = spinner;

  try {
    const member = members.find((m) => m.id === id);
    const history = await historyForMember(id, 20);

    const stat = stats.find((s) => s.id === id)
      ?? { pct: 0, attended: 0, total: 0, missed: 0, late_count: 0, excused_count: 0 };
    const b = band(stat.pct);

    const rate = (rows) => rows.length
      ? Math.round(rows.filter((r) => r.status === 'present' || r.status === 'late').length / rows.length * 100)
      : 0;

    // Split by series, not weekday — a moved sabha keeps its series, so
    // a Thursday sabha held on Saturday still counts as Thursday here.
    const sundays = history.filter((h) => h.sabhas.sabha_type === 'sunday');
    const thursdays = history.filter((h) => h.sabhas.sabha_type === 'thursday');
    const extras = history.filter((h) => h.sabhas.sabha_type === 'extra');
    const miss = missedStreak(history);

    const grid = [...history].reverse().map((h) =>
      statusDot(
        h.status,
        formatShort(h.sabhas.sabha_date) + (h.reason ? ` — ${h.reason}` : '')
      )
    ).join('');

    host.innerHTML = `
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="avatar avatar-md bg-primary-lt">${esc(initials(member.full_name))}</span>
        <div class="min-w-0">
          <div class="fw-medium text-truncate">${esc(member.full_name)}</div>
          <div class="text-secondary small">
            ${member.is_sevak ? 'Sevak' : 'Yuvak'} &middot; ${esc(profile.gharName)}
          </div>
        </div>
      </div>

      ${miss >= 3 ? `<div class="alert alert-warning py-2 px-3 d-flex align-items-center gap-2">
        <i class="ti ti-alert-triangle"></i>
        <span class="small">Missed the last ${miss} sabhas</span>
      </div>` : ''}

      <div class="row g-2 mb-3">
        ${miniStat('Attendance', `${stat.pct}%`, `text-${b}`)}
        ${miniStat('Streak', String(currentStreak(history)))}
        ${miniStat('Missed', String(stat.missed))}
        ${miniStat('Late', String(stat.late_count))}
      </div>

      ${history.length ? `
        <div class="text-secondary small mb-1">Sabha by sabha, oldest first</div>
        <div class="gm-dots mb-2">${grid}</div>
        <div class="mb-3">${statusLegend({ inline: true, notes: false })}</div>
        <div class="row g-2">
          ${miniStat('Sunday', `${rate(sundays)}%`)}
          ${miniStat('Thursday', `${rate(thursdays)}%`)}
          ${extras.length ? miniStat('Extra', `${rate(extras)}%`) : ''}
        </div>`
        : '<p class="text-secondary small mb-0">No attendance recorded for this member yet.</p>'}

      ${memberAway(id)}`;
  } catch (e) {
    showError(host, e.message);
  }
}

// This yuvak's trips, newest first. Explains a run of missed sabhas
// without the sevak having to go looking for it.
function memberAway(memberId) {
  const now = today();
  const mine = absences
    .filter((a) => a.member_id === memberId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .slice(0, 4);

  if (!mine.length) return '';

  const rows = mine.map((a) => {
    const on = a.start_date <= now && a.end_date >= now;
    const future = a.start_date > now;
    return `<li class="gm-away-item">
      <span class="gm-away-item__dates">
        ${esc(formatShort(a.start_date))} – ${esc(formatShort(a.end_date))}
      </span>
      ${on ? '<span class="badge bg-orange-lt">now</span>'
           : future ? '<span class="badge bg-secondary-lt">upcoming</span>' : ''}
      <span class="gm-away-item__note">${esc(a.note)}</span>
    </li>`;
  }).join('');

  return `<div class="mt-3 pt-3 border-top">
    <div class="text-secondary small mb-2">
      <i class="ti ti-plane" aria-hidden="true"></i> Away periods
    </div>
    <ul class="gm-away-list">${rows}</ul>
  </div>`;
}

function miniStat(label, value, colour = '') {
  return `<div class="col-6">
    <div class="p-2 rounded" style="background: var(--tblr-bg-surface-secondary)">
      <div class="text-secondary small">${esc(label)}</div>
      <div class="h3 mb-0 ${colour}">${esc(value)}</div>
    </div>
  </div>`;
}
