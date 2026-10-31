// report.html — a decorative, printable monthly attendance report.
// Deliberately chrome-less (no sidebar/topbar, no dark mode): this page
// is a document meant to be printed or saved as a PDF, not navigated
// like the rest of the portal, so it always renders the same regardless
// of whoever's viewing it or what theme they prefer.

import { requireAuth } from '../auth.js';
import { esc, showError, MARK_SVG, statusDot, statusLegend } from '../lib/ui.js';
import { listMembers, isCurrent } from '../api/members.js';
import { getSettings, listSabhas } from '../api/sabhas.js';
import { fullHistory, attendanceTrend } from '../api/attendance.js';
import { listAbsences } from '../api/utilities.js';
import { areaChart, donutChart } from '../lib/charts.js';
import { band } from '../lib/schedule.js';
import { today, formatShort, formatLong, initials, monthKey, monthName } from '../lib/dates.js';

const root = document.getElementById('report-root');
const monthSelect = document.getElementById('report-month');

let profile, members, rows, trend, settings, absences, sabhas;
let month = new URLSearchParams(location.search).get('month');

document.getElementById('report-print').addEventListener('click', () => window.print());

init();

async function init() {
  try {
    profile = await requireAuth();

    [members, rows, trend, settings, absences, sabhas] = await Promise.all([
      listMembers(profile.mandirId),
      fullHistory(profile.mandirId),
      attendanceTrend(profile.mandirId, 500),
      getSettings(profile.mandirId),
      listAbsences(profile.mandirId).catch(() => []),
      listSabhas(profile.mandirId, { limit: 500 })
    ]);

    const months = monthsWithData();
    if (!month || !months.includes(month)) month = months[0] ?? monthKey(today());

    monthSelect.innerHTML = months.length
      ? months.map((k) => `<option value="${k}"${k === month ? ' selected' : ''}>${esc(monthName(k))}</option>`).join('')
      : `<option value="${month}">${esc(monthName(month))}</option>`;

    monthSelect.addEventListener('change', () => {
      location.href = `report.html?month=${encodeURIComponent(monthSelect.value)}`;
    });

    render();
  } catch (e) {
    showError(root, e.message);
  }
}

function monthsWithData() {
  return [...new Set(trend.map((t) => monthKey(t.date)))].sort().reverse();
}

function monthTrend() {
  return trend.filter((t) => monthKey(t.date) === month);
}

function monthRows() {
  return rows.filter((r) => monthKey(r.sabhas.sabha_date) === month);
}

// Per-yuvak counts for the selected month only — listStats() is all-time,
// so this is computed fresh from the raw attendance rows. Includes anyone
// who has a mark that month, even if they've since moved out, since this
// is a record of what actually happened then.
function memberMonthlyStats() {
  const marks = monthRows();
  const byId = new Map();

  for (const r of marks) {
    if (!byId.has(r.member_id)) {
      const m = members.find((x) => x.id === r.member_id);
      byId.set(r.member_id, {
        full_name: m?.full_name ?? r.members.full_name,
        is_sevak: m?.is_sevak ?? false,
        present: 0, late: 0, excused: 0, absent: 0, total: 0
      });
    }
    const row = byId.get(r.member_id);
    row.total += 1;
    row[r.status] = (row[r.status] ?? 0) + 1;
  }

  return [...byId.values()]
    .map((row) => {
      const attended = row.present + row.late;
      return { ...row, attended, pct: row.total ? Math.round((attended / row.total) * 100) : 0 };
    })
    .sort((a, b) => a.pct - b.pct || a.full_name.localeCompare(b.full_name));
}

// Who is out of the house right now — a snapshot of today, not scoped to
// the report's month, since "who is currently away" only has one answer
// no matter which month you're looking back at.
function awayNowCard() {
  const now = today();
  const current = members.filter(isCurrent);
  const live = new Set(current.map((m) => m.id));
  const away = absences
    .filter((a) => a.start_date <= now && a.end_date >= now && live.has(a.member_id))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (!away.length) return '';

  const rows = away.map((a) => `<div class="list-group-item">
    <div class="row align-items-start g-2">
      <div class="col-auto">
        <span class="avatar avatar-sm bg-primary-lt">${esc(initials(a.members.full_name))}</span>
      </div>
      <div class="col">
        <div>${esc(a.members.full_name)}</div>
        <div class="text-secondary small">
          ${esc(formatShort(a.start_date))} – ${esc(formatShort(a.end_date))}
        </div>
        <div class="small mt-1">${esc(a.note)}</div>
      </div>
    </div>
  </div>`).join('');

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title"><i class="ti ti-plane me-1" aria-hidden="true"></i> Currently away</h3>
      <div class="card-actions text-secondary small">${away.length}</div>
    </div>
    <div class="list-group list-group-flush">${rows}</div>
  </div>`;
}

function monthSabhas() {
  return sabhas.filter((s) => monthKey(s.sabha_date) === month)
    .sort((a, b) => a.sabha_date.localeCompare(b.sabha_date));
}

// The same member-by-sabha grid as History, narrowed to this month's held
// sabhas. Current roster only, same as History's own grid.
function gridCard() {
  const held = monthSabhas().filter((s) => !s.is_cancelled);
  if (!held.length) return '';

  const current = members.filter(isCurrent);
  const map = new Map();
  for (const r of rows) map.set(`${r.members.full_name}|${r.sabhas.sabha_date}`, r.status);

  const head = held
    .map((s) => `<th><span class="small">${esc(formatShort(s.sabha_date))}</span></th>`)
    .join('');

  const body = current.map((m) => {
    const cells = held.map((s) =>
      `<td>${statusDot(map.get(`${m.full_name}|${s.sabha_date}`) ?? null)}</td>`
    ).join('');
    return `<tr><td>${esc(m.full_name)}</td>${cells}</tr>`;
  }).join('');

  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title">Attendance grid &middot; ${esc(monthName(month))}</h3></div>
    <div class="table-responsive">
      <table class="table table-vcenter card-table gm-grid-table">
        <thead><tr><th>Member</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <div class="card-footer">${statusLegend({ inline: true })}</div>
  </div>`;
}

function sabhasCard() {
  const all = monthSabhas();
  if (!all.length) return '';

  const counts = new Map();
  for (const r of rows) {
    const d = r.sabhas.sabha_date;
    if (!counts.has(d)) counts.set(d, { present: 0, total: 0 });
    const c = counts.get(d);
    c.total += 1;
    if (r.status === 'present' || r.status === 'late') c.present += 1;
  }

  const list = all.map((s) => {
    const c = counts.get(s.sabha_date) ?? { present: 0, total: 0 };
    const pct = c.total ? Math.round((c.present / c.total) * 100) : 0;
    const icon = { sunday: 'sun', thursday: 'moon', extra: 'sparkles' }[s.sabha_type] ?? 'calendar';
    return `<div class="list-group-item">
      <div class="row align-items-center g-2">
        <div class="col-auto">
          <span class="avatar avatar-sm bg-primary-lt"><i class="ti ti-${icon}"></i></span>
        </div>
        <div class="col text-truncate">
          <div>${esc(formatShort(s.sabha_date))}
            <span class="text-secondary small text-capitalize ms-1">${esc(s.sabha_type)}</span>
          </div>
          ${s.topic ? `<div class="text-secondary small text-truncate">${esc(s.topic)}</div>` : ''}
        </div>
        <div class="col-auto">
          ${s.is_cancelled
            ? '<span class="badge bg-danger-lt">Cancelled</span>'
            : `<span class="text-${band(pct)} fw-medium">${c.present}/${c.total}</span>`}
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title">Sabhas &middot; ${esc(monthName(month))}</h3></div>
    <div class="list-group list-group-flush">${list}</div>
  </div>`;
}

function summary(mstats) {
  const mt = monthTrend();
  const avg = mt.length
    ? Math.round((mt.reduce((a, t) => a + t.present / (t.total || 1), 0) / mt.length) * 100)
    : 0;
  const threshold = settings.followup_threshold ?? 65;
  return {
    avg,
    sabhas: mt.length,
    yuvaks: mstats.length,
    followUp: mstats.filter((s) => s.total > 0 && s.pct < threshold).length
  };
}

function render() {
  // The browser's "Save as PDF" suggests the document's <title> as the
  // filename, so this is what the downloaded PDF ends up called.
  document.title = `${profile.gharName} - ${monthName(month)} Sabha Report`;

  const mstats = memberMonthlyStats();
  const stat = summary(mstats);

  root.innerHTML = `
    <div class="gm-report-header">
      <div class="gm-report-brand">
        <span class="gm-mark gm-mark--lg">${MARK_SVG}</span>
        <div>
          <div class="gm-report-title">${esc(profile.gharName)}</div>
          <div class="gm-report-subtitle">Monthly Attendance Report</div>
        </div>
      </div>
      <div class="gm-report-meta">
        <div class="gm-report-month">${esc(monthName(month))}</div>
        <div class="gm-report-generated">Generated ${esc(formatLong(today()))}</div>
      </div>
    </div>

    <div class="row row-cards mb-3">
      ${statCard('Average attendance', `${stat.avg}%`, 'chart-line')}
      ${statCard('Sabhas held', String(stat.sabhas), 'calendar-check')}
      ${statCard('Yuvaks', String(stat.yuvaks), 'users-group')}
      ${statCard('Needs follow-up', String(stat.followUp), 'alert-circle')}
    </div>

    ${awayNowCard()}

    ${stat.sabhas ? `
      <div class="row row-cards mb-3">
        <div class="col-12 col-lg-7">
          <div class="card">
            <div class="card-header"><h3 class="card-title">Attendance by sabha</h3></div>
            <div class="card-body"><div id="report-trend-chart"></div></div>
          </div>
        </div>
        <div class="col-12 col-lg-5">
          <div class="card">
            <div class="card-header"><h3 class="card-title">How marks break down</h3></div>
            <div class="card-body"><div id="report-mix-chart"></div></div>
          </div>
        </div>
      </div>` : ''}

    ${gridCard()}
    ${sabhasCard()}

    <div class="card">
      <div class="card-header"><h3 class="card-title">All yuvaks &middot; ${esc(monthName(month))}</h3></div>
      <div class="table-responsive">
        <table class="table table-vcenter card-table">
          <thead>
            <tr>
              <th>Yuvak</th>
              <th class="text-end">Present</th>
              <th class="text-end">Late</th>
              <th class="text-end">Excused</th>
              <th class="text-end">Absent</th>
              <th class="text-end">Total</th>
              <th class="text-end">%</th>
            </tr>
          </thead>
          <tbody>
            ${mstats.length ? mstats.map(rowHTML).join('') : `
              <tr><td colspan="7" class="text-secondary text-center py-4">
                No attendance recorded in ${esc(monthName(month))}.
              </td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="gm-report-footer">
      Generated by the ${esc(profile.gharName)} Sabha portal
    </div>`;

  drawCharts(mstats);
}

function statCard(label, value, icon) {
  return `<div class="col-6 col-md-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto">
            <span class="bg-primary-lt avatar"><i class="ti ti-${icon} fs-2"></i></span>
          </div>
          <div class="col">
            <div class="text-secondary small">${esc(label)}</div>
            <div class="gm-stat text-primary">${esc(value)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function rowHTML(s) {
  const b = band(s.pct);
  return `<tr>
    <td>${esc(s.full_name)}${s.is_sevak ? ' <span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}</td>
    <td class="text-end">${s.present}</td>
    <td class="text-end">${s.late}</td>
    <td class="text-end">${s.excused}</td>
    <td class="text-end">${s.absent}</td>
    <td class="text-end">${s.total}</td>
    <td class="text-end text-${b} fw-medium">${s.pct}%</td>
  </tr>`;
}

let trendChart = null;
let mixChart = null;

function drawCharts(mstats) {
  trendChart?.destroy();
  mixChart?.destroy();
  trendChart = null;
  mixChart = null;

  if (typeof ApexCharts === 'undefined') {
    window.addEventListener('load', () => drawCharts(mstats), { once: true });
    return;
  }

  const mt = monthTrend();
  const trendEl = document.getElementById('report-trend-chart');
  if (trendEl) {
    trendChart = areaChart(trendEl, {
      labels: mt.map((t) => formatShort(t.date)),
      values: mt.map((t) => t.present),
      total: Math.max(...mt.map((t) => t.total), members.length, 1)
    });
  }

  const mixEl = document.getElementById('report-mix-chart');
  if (mixEl) {
    const counts = { present: 0, late: 0, excused: 0, absent: 0 };
    for (const s of mstats) {
      counts.present += s.present;
      counts.late += s.late;
      counts.excused += s.excused;
      counts.absent += s.absent;
    }
    mixChart = donutChart(mixEl, counts);
  }
}
