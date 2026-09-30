// History — grid of members by sabha, the sabha list, and CSV export.

import { requireAuth } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, emptyState, spinner
} from '../lib/ui.js';
import { listMembers, listStats } from '../api/members.js';
import { listSabhas } from '../api/sabhas.js';
import { fullHistory } from '../api/attendance.js';
import { exportAttendance, exportSummary } from '../lib/export.js';
import { formatShort } from '../lib/dates.js';
import { band } from '../lib/schedule.js';

applyTheme();

const main = document.getElementById('main');
const LETTER = { present: 'P', late: 'L', excused: 'E', absent: 'A' };

let profile, members, sabhas, rows, stats;

init();

async function init() {
  try {
    profile = await requireAuth();
    renderChrome(profile, 'history');

    [members, sabhas, rows, stats] = await Promise.all([
      listMembers(profile.mandirId),
      listSabhas(profile.mandirId, { limit: 60 }),
      fullHistory(profile.mandirId),
      listStats(profile.mandirId)
    ]);

    render();
  } catch (e) {
    showError(main, e.message);
  }
}

function render() {
  const held = sabhas.filter((s) => !s.is_cancelled).slice(0, 15).reverse();

  const map = new Map();
  for (const r of rows) map.set(`${r.members.full_name}|${r.sabhas.sabha_date}`, r.status);

  const actions = `
    <button class="btn" id="exp-detail"><i class="ti ti-download me-1"></i> Attendance CSV</button>
    <button class="btn" id="exp-summary"><i class="ti ti-download me-1"></i> Summary CSV</button>`;

  main.innerHTML = `
    ${pageHeader('History', `${sabhas.length} sabhas recorded`, actions)}

    <div class="card mb-3">
      <div class="card-header">
        <h3 class="card-title">Attendance grid</h3>
        <div class="card-actions text-secondary small">last ${held.length} sabhas</div>
      </div>
      ${held.length
        ? `<div class="table-responsive">${gridTable(held, map)}</div>
           <div class="card-footer text-secondary small">
             P present &middot; L late &middot; E excused &middot; A absent &middot; dash not recorded
           </div>`
        : `<div class="card-body">${emptyState('calendar-off', 'Nothing recorded yet',
             'The grid fills in as you mark sabhas.')}</div>`}
    </div>

    <div class="card">
      <div class="card-header"><h3 class="card-title">Sabhas</h3></div>
      ${sabhas.length
        ? `<div class="list-group list-group-flush">${sabhaList()}</div>`
        : `<div class="card-body">${emptyState('calendar', 'No sabhas yet')}</div>`}
    </div>`;

  document.getElementById('exp-detail').addEventListener('click', () => {
    if (!rows.length) return toast('Nothing to export yet', 'error');
    exportAttendance(
      rows.map((r) => ({
        date: r.sabhas.sabha_date,
        type: r.sabhas.sabha_type,
        member: r.members.full_name,
        status: r.status,
        reason: r.reason ?? ''
      })),
      `dasanudas-attendance-${new Date().toISOString().slice(0, 10)}.csv`
    );
    toast('Downloaded', 'success');
  });

  document.getElementById('exp-summary').addEventListener('click', () => {
    if (!stats.length) return toast('Nothing to export yet', 'error');
    exportSummary(stats, `dasanudas-summary-${new Date().toISOString().slice(0, 10)}.csv`);
    toast('Downloaded', 'success');
  });
}

function gridTable(held, map) {
  const head = held
    .map((s) => `<th title="${s.sabha_date}"><span class="small">${esc(formatShort(s.sabha_date))}</span></th>`)
    .join('');

  const body = members.map((m) => {
    const cells = held.map((s) => {
      const st = map.get(`${m.full_name}|${s.sabha_date}`);
      return st
        ? `<td><span class="gm-dot gm-dot--${st}">${LETTER[st]}</span></td>`
        : '<td><span class="gm-dot gm-dot--none">–</span></td>';
    }).join('');
    return `<tr><td>${esc(m.full_name)}</td>${cells}</tr>`;
  }).join('');

  return `<table class="table table-vcenter card-table gm-grid-table">
    <thead><tr><th>Member</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function sabhaList() {
  const counts = new Map();
  for (const r of rows) {
    const d = r.sabhas.sabha_date;
    if (!counts.has(d)) counts.set(d, { present: 0, total: 0 });
    const c = counts.get(d);
    c.total++;
    if (r.status === 'present' || r.status === 'late') c.present++;
  }

  return sabhas.map((s) => {
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
            ${s.moved_from
              ? `<span class="badge bg-orange-lt ms-1">moved from ${esc(formatShort(s.moved_from))}</span>`
              : ''}
          </div>
          ${s.topic ? `<div class="text-secondary small text-truncate">${esc(s.topic)}</div>` : ''}
        </div>
        <div class="col-auto">
          ${s.is_cancelled
            ? '<span class="badge bg-danger-lt">Cancelled</span>'
            : `<span class="text-${band(pct)} fw-medium">${c.present}/${c.total}</span>`}
        </div>
        <div class="col-auto">
          <a class="btn btn-sm" href="attendance.html?date=${s.sabha_date}">Open</a>
        </div>
      </div>
    </div>`;
  }).join('');
}