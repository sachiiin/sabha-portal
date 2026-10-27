// The PIN-viewer dashboard experience — stat cards, Away, the two charts
// with month/yuvak filters, All yuvaks roster, Personal insights — as a
// reusable mount(root, data) instead of a page tied to one mandirId. Used
// by platform-house.js (one house) and platform-dashboard.js (one house,
// or every approved house merged together).
//
// The caller does all the house-specific or merged-across-houses work —
// fetching, and for a merge: summing counts, date-bucketing the trend,
// picking a threshold per house for "needs follow-up" — and hands this
// module plain, already-combined arrays. Nothing in here cares whether
// `trend`/`stats`/`historyRows` came from one house or several.

import {
  esc, showError, emptyState, spinner, statusDot, statusLegend
} from './ui.js';
import { listMembers, listStats, isCurrent } from '../api/members.js';
import { getSettings } from '../api/sabhas.js';
import {
  attendanceTrend, fullHistory, currentStreak, missedStreak, historyForMember
} from '../api/attendance.js';
import { listAbsences } from '../api/utilities.js';
import { areaChart, donutChart, memberChart } from './charts.js';
import { band } from './schedule.js';
import { today, formatShort, formatLong, initials, monthKey, monthName } from './dates.js';

// Fetches and filters everything mountHouseDashboard needs for one house.
// Shared by platform-house.js (always one house) and platform-dashboard.js
// (one house, or several combined via mergeHouseScopes below).
export async function fetchHouseScope(mandirId) {
  const [allMembers, allStats, settings, absences, trend, historyRows] = await Promise.all([
    listMembers(mandirId),
    listStats(mandirId),
    getSettings(mandirId),
    listAbsences(mandirId).catch(() => []),
    attendanceTrend(mandirId, 500),
    fullHistory(mandirId)
  ]);

  const members = allMembers.filter(isCurrent);
  const live = new Set(members.map((m) => m.id));
  const stats = allStats.filter((s) => live.has(s.id));

  // allMembers is every active member regardless of house_end — only the
  // Members tab (Active + Previous) needs it; everything else here uses
  // the current-only `members`.
  return { allMembers, members, stats, settings, absences, trend, historyRows };
}

// Combines several houses' scopes into one "every house" view. Members,
// stats, absences and attendance rows just concatenate (tagging members
// and stats with which house they're from, since that's no longer
// implied by context); the trend is bucketed by calendar date, summing
// present/total across whichever houses held a sabha on that date; and
// "needs follow-up" sums each house's own count against its own
// followup_threshold, since that setting isn't the same for every house.
export function mergeHouseScopes(scoped) {
  const members = [], stats = [], absences = [], historyRows = [];
  let followUpCount = 0;
  const trendByDate = new Map();

  for (const s of scoped) {
    for (const m of s.members) members.push({ ...m, _gharName: s.gharName });
    for (const st of s.stats) stats.push({ ...st, _gharName: s.gharName });
    absences.push(...s.absences);
    historyRows.push(...s.historyRows);

    const threshold = s.settings.followup_threshold ?? 65;
    followUpCount += s.stats.filter((st) => st.total > 0 && st.pct < threshold).length;

    for (const t of s.trend) {
      const bucket = trendByDate.get(t.date) ?? { date: t.date, present: 0, total: 0 };
      bucket.present += t.present;
      bucket.total += t.total;
      trendByDate.set(t.date, bucket);
    }
  }

  const trend = [...trendByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { members, stats, absences, historyRows, trend, followUpCount };
}

let members = [], stats = [], trend = [], absences = [], historyRows = [];
let followUpCount = 0, nextSabhaText = null, gharNameFallback = '';

let month = 'all';
let who = 'all';
let trendChart = null;
let mixChart = null;

export function teardownHouseDashboardCharts() {
  trendChart?.destroy();
  mixChart?.destroy();
  trendChart = null;
  mixChart = null;
}

// Redraw so the chart gradients and grid lines follow a light/dark
// toggle instead of staying stuck in the old palette. A safe no-op when
// this module isn't currently mounted (drawCharts() checks for its own
// DOM elements before touching anything).
document.addEventListener('gm:theme', () => drawCharts());

export function mountHouseDashboard(root, data) {
  members = data.members;
  stats = data.stats;
  trend = data.trend;
  absences = data.absences;
  historyRows = data.historyRows;
  followUpCount = data.followUpCount;
  nextSabhaText = data.nextSabhaText ?? null;
  gharNameFallback = data.gharName ?? '';
  month = 'all';
  who = 'all';

  render(root);
}

function render(root) {
  const last = trend.at(-1);
  const avg = trend.length
    ? Math.round((trend.reduce((a, t) => a + t.present / (t.total || 1), 0) / trend.length) * 100)
    : 0;

  root.innerHTML = `
    <p class="text-secondary mb-3">${nextSabhaText ? esc(nextSabhaText) : ''}</p>

    <div class="row row-deck row-cards mb-3">
      ${statCard('Average attendance', `${avg}%`, 'chart-line', 'primary')}
      ${statCard('Last sabha', last ? `${last.present}/${last.total}` : '—', 'users-group', 'primary')}
      ${statCard('Sabhas recorded', String(trend.length), 'calendar-check', 'primary')}
      ${statCard('Needs follow-up', String(followUpCount), 'alert-circle', followUpCount ? 'watch' : 'secondary')}
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

  root.querySelector('#pick')?.addEventListener('change', (e) => {
    who = e.target.value;
    const f = root.querySelector('#f-who');
    if (f) f.value = who;
    retitle(root);
    drawCharts();
    selectMember(root, who);
  });
  root.querySelector('#f-month')?.addEventListener('change', (e) => {
    month = e.target.value;
    retitle(root);
    drawCharts();
  });
  root.querySelector('#f-who')?.addEventListener('change', (e) => {
    who = e.target.value;
    retitle(root);
    drawCharts();
    if (who !== 'all') {
      const pick = root.querySelector('#pick');
      if (pick) pick.value = who;
      selectMember(root, who);
    }
  });

  drawCharts();
  if (members.length) selectMember(root, members[0].id);
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

function awayCard() {
  const now = today();
  const live = new Set(members.map((m) => m.id));

  const upcoming = absences
    .filter((a) => a.end_date >= now && live.has(a.member_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (!upcoming.length) return '';

  const rows = upcoming.map((a) => {
    const on = a.start_date <= now;
    const span = Math.round((new Date(a.end_date) - new Date(a.start_date)) / 86400000) + 1;

    return `<div class="list-group-item">
      <div class="row align-items-start g-2">
        <div class="col-auto">
          <span class="avatar avatar-sm bg-primary-lt">${esc(initials(a.members.full_name))}</span>
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
      <h3 class="card-title"><i class="ti ti-plane me-1" aria-hidden="true"></i> Away</h3>
      <div class="card-actions text-secondary small">
        ${nowCount ? `${nowCount} out now` : 'none out today'}
      </div>
    </div>
    <div class="list-group list-group-flush">${rows}</div>
  </div>`;
}

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
const trendTitle = () => who === 'all' ? 'Attendance by sabha' : `${whoName()} — sabha by sabha`;
const mixTitle = () => who === 'all' ? 'How marks break down' : `${whoName()} — marks`;

function trendCard() {
  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title" id="trend-title">${esc(trendTitle())}</h3>
      <div class="card-actions">${filterBar()}</div>
    </div>
    <div class="card-body"><div id="trend-chart" class="gm-chart"></div></div>
  </div>`;
}

function mixCard() {
  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title" id="mix-title">${esc(mixTitle())}</h3></div>
    <div class="card-body"><div id="mix-chart"></div></div>
  </div>`;
}

function noneHere() {
  const where = month === 'all' ? '' : ` in ${esc(monthName(month))}`;
  return `<p class="text-secondary small text-center py-5 mb-0">Nothing marked${where}.</p>`;
}

function visibleCounts(rows) {
  const dates = new Set(rows.map((t) => t.date));
  const counts = { present: 0, late: 0, excused: 0, absent: 0 };
  for (const r of historyRows) {
    if (who !== 'all' && r.member_id !== who) continue;
    if (dates.has(r.sabhas.sabha_date) && counts[r.status] !== undefined) counts[r.status] += 1;
  }
  return counts;
}

function drawCharts() {
  teardownHouseDashboardCharts();
  for (const id of ['trend-chart', 'mix-chart']) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  }

  if (typeof ApexCharts === 'undefined') {
    if (!drawCharts.waiting) {
      drawCharts.waiting = true;
      window.addEventListener('load', () => { drawCharts.waiting = false; drawCharts(); }, { once: true });
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
    const mine = new Map(
      historyRows.filter((r) => r.member_id === who).map((r) => [r.sabhas.sabha_date, r])
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
    if (Object.values(counts).some((n) => n > 0)) mixChart = donutChart(mixEl, counts);
    else mixEl.innerHTML = noneHere();
  }
}

function retitle(root) {
  const t = root.querySelector('#trend-title');
  if (t) t.textContent = trendTitle();
  const m = root.querySelector('#mix-title');
  if (m) m.textContent = mixTitle();
}

function rosterCard() {
  if (!stats.length) {
    return `<div class="card"><div class="card-body">
      ${emptyState('users', 'No attendance recorded yet',
        'Once a sabha is marked, everyone appears here ranked by turnout.')}
    </div></div>`;
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
          }${s._gharName ? ` <span class="text-secondary small">· ${esc(s._gharName)}</span>` : ''}</div>
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
    <div class="card-header"><h3 class="card-title">Personal insights</h3></div>
    <div class="card-body">
      <label class="form-label" for="pick">Select yuvak</label>
      <select id="pick" class="form-select mb-3">
        ${members.map((m) => `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}
      </select>
      <div id="personal">${spinner}</div>
    </div>
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
    <div class="text-secondary small mb-2"><i class="ti ti-plane" aria-hidden="true"></i> Away periods</div>
    <ul class="gm-away-list">${rows}</ul>
  </div>`;
}

async function selectMember(root, id) {
  const host = root.querySelector('#personal');
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

    const sundays = history.filter((h) => h.sabhas.sabha_type === 'sunday');
    const thursdays = history.filter((h) => h.sabhas.sabha_type === 'thursday');
    const extras = history.filter((h) => h.sabhas.sabha_type === 'extra');
    const miss = missedStreak(history);

    const grid = [...history].reverse().map((h) =>
      statusDot(h.status, formatShort(h.sabhas.sabha_date) + (h.reason ? ` — ${h.reason}` : ''))
    ).join('');

    host.innerHTML = `
      <div class="d-flex align-items-center gap-3 mb-3">
        <span class="avatar avatar-md bg-primary-lt">${esc(initials(member.full_name))}</span>
        <div class="min-w-0">
          <div class="fw-medium text-truncate">${esc(member.full_name)}</div>
          <div class="text-secondary small">
            ${member.is_sevak ? 'Sevak' : 'Yuvak'} &middot; ${esc(member._gharName ?? gharNameFallback)}
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
