// History — grid of members by sabha, the sabha list, and CSV export.

import { requireAuth, canWrite } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, emptyState, spinner,
  statusDot, statusLegend, STATUS
} from '../lib/ui.js';
import { listMembers, listStats, isCurrent } from '../api/members.js';
import { listSabhas } from '../api/sabhas.js';
import { fullHistory } from '../api/attendance.js';
import { listAbsences } from '../api/utilities.js';
import { exportAttendance, exportSummary } from '../lib/export.js';
import { formatShort, formatLong, initials, today } from '../lib/dates.js';
import { band } from '../lib/schedule.js';

applyTheme();

const main = document.getElementById('main');

let profile, members, sabhas, rows, stats, absences = [];

init();

async function init() {
  try {
    profile = await requireAuth();
    renderChrome(profile, 'history');

    let allMembers, allStats;
    [allMembers, sabhas, rows, stats, absences] = await Promise.all([
      listMembers(profile.mandirId),
      listSabhas(profile.mandirId, { limit: 60 }),
      fullHistory(profile.mandirId),
      listStats(profile.mandirId),
      listAbsences(profile.mandirId).catch(() => [])
    ]);

    // Previous members drop off the grid and the summary export. Their
    // rows stay in `rows`, so the per-sabha turnout counts below are
    // still the real numbers for those dates.
    allStats = stats;
    members = allMembers.filter(isCurrent);
    const live = new Set(members.map((m) => m.id));
    stats = allStats.filter((s) => live.has(s.id));

    render();
  } catch (e) {
    showError(main, e.message);
  }
}

function render() {
  const held = sabhas.filter((s) => !s.is_cancelled).slice(0, 15).reverse();

  // Keyed by member and date so the grid can look up both the status and
  // whatever the sevak typed in the reason box.
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.members.full_name}|${r.sabhas.sabha_date}`,
      { status: r.status, reason: r.reason });
  }

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
           <div class="gm-note-bar" id="note-bar" hidden></div>
           <div class="card-footer">
             ${statusLegend({ inline: true })}
             <div class="text-secondary small mt-2">
               A dash means that sabha was not recorded. A cell with a dot in the
               corner has a note — tap it to read.
             </div>
           </div>`
        : `<div class="card-body">${emptyState('calendar-off', 'Nothing recorded yet',
             'The grid fills in as you mark sabhas.')}</div>`}
    </div>

    ${awayCard()}

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

  wireNotes();
}

// Tapping a cell that has a reason writes it into the strip below the grid.
// Tapping the same cell again clears it.
function wireNotes() {
  const bar = document.getElementById('note-bar');
  if (!bar) return;

  let open = null;

  const close = () => {
    bar.hidden = true;
    open?.classList.remove('is-open');
    open = null;
  };

  main.querySelectorAll('.gm-cell-note').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (open === btn) return close();

      open?.classList.remove('is-open');
      btn.classList.add('is-open');
      open = btn;

      const { who, when, status, note } = btn.dataset;
      bar.innerHTML = `
        <div class="d-flex align-items-start gap-2">
          ${statusDot(status)}
          <div class="flex-fill">
            <div class="small">
              <span class="fw-medium">${esc(who)}</span>
              <span class="text-secondary">&middot; ${esc(when)} &middot; ${esc(STATUS[status].label)}</span>
            </div>
            <div class="mt-1">${esc(note)}</div>
          </div>
          <button type="button" class="btn-close" aria-label="Close note"></button>
        </div>`;
      bar.hidden = false;
      bar.querySelector('.btn-close').addEventListener('click', close);
    });
  });
}

function gridTable(held, map) {
  const head = held
    .map((s) => `<th title="${s.sabha_date}"><span class="small">${esc(formatShort(s.sabha_date))}</span></th>`)
    .join('');

  const body = members.map((m) => {
    const cells = held.map((s) => {
      const cell = map.get(`${m.full_name}|${s.sabha_date}`);

      if (!cell) {
        return `<td>${statusDot(null, `${formatShort(s.sabha_date)} — not recorded`)}</td>`;
      }

      const title = `${m.full_name} · ${formatShort(s.sabha_date)} — ${STATUS[cell.status].label}`
        + (cell.reason ? `: ${cell.reason}` : '');

      // Cells carrying a reason become buttons: a tooltip is invisible on a
      // phone, so tapping writes the note into the strip under the grid.
      if (cell.reason) {
        return `<td>
          <button type="button" class="gm-cell-note" title="${esc(title)}"
                  data-who="${esc(m.full_name)}"
                  data-when="${esc(formatLong(s.sabha_date))}"
                  data-status="${cell.status}"
                  data-note="${esc(cell.reason.trim())}">
            ${statusDot(cell.status)}
            <span class="gm-hasnote" aria-hidden="true"></span>
            <span class="visually-hidden">Read the note</span>
          </button>
        </td>`;
      }

      return `<td>${statusDot(cell.status, title)}</td>`;
    }).join('');

    return `<tr><td>${esc(m.full_name)}</td>${cells}</tr>`;
  }).join('');

  return `<table class="table table-vcenter card-table gm-grid-table">
    <thead><tr><th>Member</th>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// Every away period, newest first, with how many recorded sabhas fell
// inside it. That number is the point of the card — it turns "he missed
// four in a row" into "he was in India for those four".
function awayCard() {
  if (!absences.length) return '';

  const held = sabhas.filter((s) => !s.is_cancelled).map((s) => s.sabha_date);
  const now = today();

  const list = [...absences]
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((a) => {
      const span = Math.round(
        (new Date(a.end_date) - new Date(a.start_date)) / 86400000
      ) + 1;
      const covered = held.filter((d) => d >= a.start_date && d <= a.end_date).length;
      const on = a.start_date <= now && a.end_date >= now;
      const future = a.start_date > now;

      return `<div class="list-group-item${on || future ? '' : ' opacity-75'}">
        <div class="row align-items-start g-2">
          <div class="col-auto">
            <span class="avatar avatar-sm bg-primary-lt">
              ${esc(initials(a.members.full_name))}
            </span>
          </div>
          <div class="col">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span>${esc(a.members.full_name)}</span>
              ${on ? '<span class="badge bg-orange-lt">away now</span>' : ''}
              ${future ? '<span class="badge bg-secondary-lt">upcoming</span>' : ''}
            </div>
            <div class="text-secondary small">
              ${esc(formatShort(a.start_date))} – ${esc(formatShort(a.end_date))}
              &middot; ${span} ${span === 1 ? 'day' : 'days'}
              ${covered
                ? ` &middot; ${covered} ${covered === 1 ? 'sabha' : 'sabhas'} in this range`
                : ''}
            </div>
            <div class="small mt-1">${esc(a.note)}</div>
          </div>
        </div>
      </div>`;
    }).join('');

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title">
        <i class="ti ti-plane me-1" aria-hidden="true"></i> Away periods
      </h3>
      <div class="card-actions text-secondary small">${absences.length}</div>
    </div>
    <div class="list-group list-group-flush">${list}</div>
  </div>`;
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
          ${canWrite(profile)
            ? `<a class="btn btn-sm" href="attendance.html?date=${s.sabha_date}">Open</a>`
            : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}
