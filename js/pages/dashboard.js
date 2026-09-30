// Dashboard — the landing page.
// House-wide metrics, attendance trend, roster, and a per-yuvak panel.

import { requireAuth } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, showError, emptyState, spinner
} from '../lib/ui.js';
import { listStats, listMembers } from '../api/members.js';
import { getSettings } from '../api/sabhas.js';
import {
  attendanceTrend, historyForMember, currentStreak, missedStreak
} from '../api/attendance.js';
import { band, nextSabha } from '../lib/schedule.js';
import { today, formatShort, formatLong, initials } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, stats, members, trend, settings;

init();

async function init() {
  try {
    profile = await requireAuth();
    renderChrome(profile, 'dashboard');

    [stats, members, trend, settings] = await Promise.all([
      listStats(profile.mandirId),
      listMembers(profile.mandirId),
      attendanceTrend(profile.mandirId, 12),
      getSettings(profile.mandirId)
    ]);

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

  const action = upcoming
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
        ${trend.length ? trendCard() : ''}
        ${rosterCard()}
      </div>
      <div class="col-12 col-lg-5">
        ${personalCard()}
      </div>
    </div>`;

  document.getElementById('pick')?.addEventListener('change', (e) => selectMember(e.target.value));
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

function trendCard() {
  const cols = trend.map((t) => {
    const pct = Math.round((t.present / (t.total || 1)) * 100);
    return `<div class="gm-trend__col">
      <span class="gm-trend__n">${t.present}</span>
      <div class="gm-trend__bar" style="height:${Math.max(pct * 0.68, 4)}px"></div>
    </div>`;
  }).join('');

  const labels = trend
    .map((t) => `<div class="gm-trend__lbl">${esc(formatShort(t.date).split(' ')[0])}</div>`)
    .join('');

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title">Attendance by sabha</h3>
      <div class="card-actions text-secondary small">last ${trend.length}</div>
    </div>
    <div class="card-body">
      <div class="gm-trend">${cols}</div>
      <div class="gm-trend__x">${labels}</div>
    </div>
  </div>`;
}

function rosterCard() {
  if (!stats.length) {
    return `<div class="card">
      <div class="card-body">
        ${emptyState('users', 'No attendance recorded yet',
          'Once you mark a sabha, everyone appears here ranked by turnout.',
          '<a href="attendance.html" class="btn btn-primary">Take attendance</a>')}
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

    const grid = [...history].reverse().map((h) => {
      const ch = { present: 'P', late: 'L', excused: 'E', absent: 'A' }[h.status];
      return `<span class="gm-dot gm-dot--${h.status}" title="${esc(formatShort(h.sabhas.sabha_date))}">${ch}</span>`;
    }).join('');

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
        <div class="gm-dots mb-3">${grid}</div>
        <div class="row g-2">
          ${miniStat('Sunday', `${rate(sundays)}%`)}
          ${miniStat('Thursday', `${rate(thursdays)}%`)}
          ${extras.length ? miniStat('Extra', `${rate(extras)}%`) : ''}
        </div>`
        : '<p class="text-secondary small mb-0">No attendance recorded for this member yet.</p>'}`;
  } catch (e) {
    showError(host, e.message);
  }
}

function miniStat(label, value, colour = '') {
  return `<div class="col-6">
    <div class="p-2 rounded" style="background: var(--tblr-bg-surface-secondary)">
      <div class="text-secondary small">${esc(label)}</div>
      <div class="h3 mb-0 ${colour}">${esc(value)}</div>
    </div>
  </div>`;
}