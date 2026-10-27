// One house, opened from All Houses — platform admin only, read-only.
//
// This is deliberately the same experience a PIN viewer of this house
// would see on index.html/history.html/members.html — same stats, same
// charts, same grid, same CSV export — just all four pages folded into
// tabs on one page, and scoped to whichever mandirId the platform admin
// is looking at instead of their own. It reuses the exact same api/ and
// lib/ functions those pages do (they already take an explicit mandirId
// rather than assuming the caller's own), and the exact same chart/export
// helpers — only the database side had to learn to allow the reads, in
// sql/15-platform-house-view.sql and sql/16-platform-house-view-absences.sql.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, toast, showError, spinner,
  emptyState, statusDot, statusLegend
} from '../lib/ui.js';
import {
  mountHouseDashboard, teardownHouseDashboardCharts, fetchHouseScope
} from '../lib/house-dashboard.js';
import { getMandir } from '../api/mandirs.js';
import { MANDAL_LABEL } from '../api/members.js';
import { listSabhas } from '../api/sabhas.js';
import { listAllUsers } from '../api/team.js';
import { exportAttendance, exportSummary, slug } from '../lib/export.js';
import { band, nextSabha } from '../lib/schedule.js';
import { today, formatShort, formatLong, initials, monthKey, monthName } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
const mandirId = new URLSearchParams(location.search).get('id');

let profile, mandir;
let tab = 'dashboard';

// Shared across tabs, fetched once. `members` is every active member —
// the Members tab needs both who's currently living here and who's
// moved out. `currentMembers` is who's living here today, which is what
// Dashboard and History use (matching dashboard.js/history.js exactly).
let members = [], currentMembers = [], stats = [], settings, absences = [], sabhas = [], trend = [], historyRows = [], users = [];

init();

async function init() {
  try {
    if (!mandirId) throw new Error('No house specified.');
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'houses');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;

  let scope;
  [mandir, scope, sabhas, users] = await Promise.all([
    getMandir(mandirId),
    fetchHouseScope(mandirId),
    listSabhas(mandirId, { limit: 60 }),
    listAllUsers()
  ]);

  ({ settings, absences, trend } = scope);
  members = scope.allMembers;
  currentMembers = scope.members;
  stats = scope.stats;
  historyRows = scope.historyRows;

  render();
}

function render() {
  main.innerHTML = `
    ${pageHeader(mandir.ghar_name, mandir.address ? esc(mandir.address) : '',
      '<a href="platform-houses.html" class="btn"><i class="ti ti-arrow-left me-1"></i> All Houses</a>')}
    ${tabsBar()}
    <div id="tab-root"></div>`;

  main.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { switchTab(b.dataset.tab); }));

  mountTab();
}

function tabsBar() {
  const tabs = [
    ['dashboard', 'Dashboard'], ['history', 'History'], ['members', 'Members'], ['users', 'Users']
  ];
  return `<div class="gm-range mb-3">
    ${tabs.map(([key, label]) => `
      <button type="button" data-tab="${key}" aria-pressed="${tab === key}">${label}</button>`).join('')}
  </div>`;
}

function switchTab(key) {
  if (key === tab) return;
  teardownHouseDashboardCharts();
  tab = key;
  render();
}

function mountTab() {
  const root = document.getElementById('tab-root');
  if (tab === 'history') return renderHistory(root);
  if (tab === 'members') return renderMembers(root);
  if (tab === 'users') return renderUsers(root);

  const threshold = settings.followup_threshold ?? 65;
  const upcoming = nextSabha(today(), settings.thursday_anchor);

  return mountHouseDashboard(root, {
    gharName: mandir.ghar_name,
    members: currentMembers,
    stats,
    trend,
    absences,
    historyRows,
    followUpCount: stats.filter((s) => s.total > 0 && s.pct < threshold).length,
    nextSabhaText: upcoming
      ? `Next sabha · ${formatLong(upcoming)}`
      : 'No sabha scheduled in the next two weeks'
  });
}

/* =========================================================
   History tab — mirrors js/pages/history.js
   ========================================================= */

let gridMonth = 'recent';
let gridMap = new Map();

function heldSabhas() {
  const live = sabhas.filter((s) => !s.is_cancelled);
  if (gridMonth === 'recent') return live.slice(0, 15).reverse();
  return live.filter((s) => monthKey(s.sabha_date) === gridMonth).reverse();
}

function gridCard() {
  const held = heldSabhas();
  const months = [...new Set(sabhas.filter((s) => !s.is_cancelled).map((s) => monthKey(s.sabha_date)))]
    .sort().reverse();

  const picker = `<div class="gm-filters">
    <label class="gm-filters__item">
      <span>Month</span>
      <select id="grid-month" class="form-select form-select-sm">
        <option value="recent"${gridMonth === 'recent' ? ' selected' : ''}>Last 15 sabhas</option>
        ${months.map((k) =>
          `<option value="${k}"${gridMonth === k ? ' selected' : ''}>${esc(monthName(k))}</option>`
        ).join('')}
      </select>
    </label>
  </div>`;

  return `<div class="card-header">
      <h3 class="card-title">Attendance grid</h3>
      <div class="card-actions">${picker}</div>
    </div>
    ${held.length
      ? `<div class="table-responsive">${gridTable(held)}</div>
         <div class="gm-note-bar" id="note-bar" hidden></div>
         <div class="card-footer">
           ${statusLegend({ inline: true })}
           <div class="text-secondary small mt-2">
             Showing ${held.length} ${held.length === 1 ? 'sabha' : 'sabhas'}.
             A dash means that sabha was not recorded. A cell with a dot in the
             corner has a note — tap it to read.
           </div>
         </div>`
      : `<div class="card-body">${emptyState('calendar-off',
           gridMonth === 'recent' ? 'Nothing recorded yet' : 'No sabhas that month',
           gridMonth === 'recent'
             ? 'The grid fills in as sabhas are marked.'
             : 'Pick another month, or go back to the last 15 sabhas.')}</div>`}`;
}

function wireGrid() {
  document.getElementById('grid-month')?.addEventListener('change', (e) => {
    gridMonth = e.target.value;
    const card = document.getElementById('grid-card');
    if (!card) return;
    card.innerHTML = gridCard();
    wireGrid();
  });
  wireNotes();
}

function wireNotes() {
  const bar = document.getElementById('note-bar');
  if (!bar) return;

  let open = null;
  const close = () => { bar.hidden = true; open?.classList.remove('is-open'); open = null; };

  document.getElementById('tab-root').querySelectorAll('.gm-cell-note').forEach((btn) => {
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
              <span class="text-secondary">&middot; ${esc(when)}</span>
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

function gridTable(held) {
  gridMap = new Map();
  for (const r of historyRows) {
    gridMap.set(`${r.members.full_name}|${r.sabhas.sabha_date}`, { status: r.status, reason: r.reason });
  }

  const head = held
    .map((s) => `<th title="${s.sabha_date}"><span class="small">${esc(formatShort(s.sabha_date))}</span></th>`)
    .join('');

  const body = currentMembers.map((m) => {
    const cells = held.map((s) => {
      const cell = gridMap.get(`${m.full_name}|${s.sabha_date}`);
      if (!cell) return `<td>${statusDot(null, `${formatShort(s.sabha_date)} — not recorded`)}</td>`;

      const title = `${m.full_name} · ${formatShort(s.sabha_date)}` + (cell.reason ? `: ${cell.reason}` : '');

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

function historyAwayCard() {
  if (!absences.length) return '';

  const held = sabhas.filter((s) => !s.is_cancelled).map((s) => s.sabha_date);
  const now = today();

  const list = [...absences]
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((a) => {
      const span = Math.round((new Date(a.end_date) - new Date(a.start_date)) / 86400000) + 1;
      const covered = held.filter((d) => d >= a.start_date && d <= a.end_date).length;
      const on = a.start_date <= now && a.end_date >= now;
      const future = a.start_date > now;

      return `<div class="list-group-item${on || future ? '' : ' opacity-75'}">
        <div class="row align-items-start g-2">
          <div class="col-auto">
            <span class="avatar avatar-sm bg-primary-lt">${esc(initials(a.members.full_name))}</span>
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
              ${covered ? ` &middot; ${covered} ${covered === 1 ? 'sabha' : 'sabhas'} in this range` : ''}
            </div>
            <div class="small mt-1">${esc(a.note)}</div>
          </div>
        </div>
      </div>`;
    }).join('');

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title"><i class="ti ti-plane me-1" aria-hidden="true"></i> Away periods</h3>
      <div class="card-actions text-secondary small">${absences.length}</div>
    </div>
    <div class="list-group list-group-flush">${list}</div>
  </div>`;
}

function sabhaList() {
  const counts = new Map();
  for (const r of historyRows) {
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
      </div>
    </div>`;
  }).join('');
}

function renderHistory(root) {
  const actions = `
    <button class="btn" id="exp-detail"><i class="ti ti-download me-1"></i> Attendance CSV</button>
    <button class="btn" id="exp-summary"><i class="ti ti-download me-1"></i> Summary CSV</button>`;

  root.innerHTML = `
    <div class="d-flex justify-content-end gap-2 mb-3">${actions}</div>
    <div class="card mb-3" id="grid-card">${gridCard()}</div>
    ${historyAwayCard()}
    <div class="card">
      <div class="card-header"><h3 class="card-title">Sabhas</h3></div>
      ${sabhas.length
        ? `<div class="list-group list-group-flush">${sabhaList()}</div>`
        : `<div class="card-body">${emptyState('calendar', 'No sabhas yet')}</div>`}
    </div>`;

  document.getElementById('exp-detail').addEventListener('click', () => {
    if (!historyRows.length) return toast('Nothing to export yet', 'error');
    exportAttendance(
      historyRows.map((r) => ({
        date: r.sabhas.sabha_date,
        type: r.sabhas.sabha_type,
        member: r.members.full_name,
        status: r.status,
        reason: r.reason ?? ''
      })),
      `${slug(mandir.ghar_name)}-attendance-${new Date().toISOString().slice(0, 10)}.csv`
    );
    toast('Downloaded', 'success');
  });

  document.getElementById('exp-summary').addEventListener('click', () => {
    if (!stats.length) return toast('Nothing to export yet', 'error');
    exportSummary(stats, `${slug(mandir.ghar_name)}-summary-${new Date().toISOString().slice(0, 10)}.csv`);
    toast('Downloaded', 'success');
  });

  wireGrid();
}

/* =========================================================
   Members tab — mirrors js/pages/members.js (read-only sections only)
   ========================================================= */

function houseSpan(m) {
  if (!m.house_start && !m.house_end) {
    return `<div class="text-secondary small">
      <i class="ti ti-home-off" style="font-size:0.9em" aria-hidden="true"></i> House dates not set
    </div>`;
  }
  const from = m.house_start ? formatShort(m.house_start) : 'always';
  const to = m.house_end ? formatShort(m.house_end) : 'now';
  return `<div class="text-secondary small">
    <i class="ti ti-home" style="font-size:0.9em" aria-hidden="true"></i> ${esc(from)} – ${esc(to)}
  </div>`;
}

function memberRow(m, faded = false) {
  return `<div class="list-group-item${faded ? ' opacity-75' : ''}">
    <div class="row align-items-center g-2">
      <div class="col-auto">
        <span class="avatar avatar-sm bg-primary-lt">${esc(initials(m.full_name))}</span>
      </div>
      <div class="col text-truncate">
        <div class="text-truncate">
          ${esc(m.full_name)}${m.is_sevak ? ' <span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
        </div>
        <div class="text-secondary small text-truncate">${esc(MANDAL_LABEL[m.mandal] ?? m.mandal)}</div>
        ${houseSpan(m)}
      </div>
    </div>
  </div>`;
}

function renderMembers(root) {
  const now = today();
  const moved = (m) => Boolean(m.house_end) && m.house_end < now;
  const active = members.filter((m) => !moved(m));
  const previous = members.filter(moved);

  root.innerHTML = `
    <p class="text-secondary mb-3">
      ${active.length} living in ${esc(mandir.ghar_name)}
      ${previous.length ? ` &middot; ${previous.length} moved out` : ''}
    </p>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Active</h3>
        <div class="card-actions text-secondary small">${active.length}</div>
      </div>
      ${active.length
        ? `<div class="list-group list-group-flush">${active.map((m) => memberRow(m)).join('')}</div>`
        : `<div class="card-body">${emptyState('users', 'No active members')}</div>`}
    </div>

    ${previous.length ? `
      <div class="card mt-3">
        <div class="card-header">
          <h3 class="card-title">Previous members</h3>
          <div class="card-actions text-secondary small">${previous.length}</div>
        </div>
        <div class="list-group list-group-flush">
          ${previous.map((m) => memberRow(m, true)).join('')}
        </div>
      </div>` : ''}`;
}

/* =========================================================
   Users tab — new: who has a login for this house
   ========================================================= */

const ROLE_BADGE = { admin: 'bg-primary-lt', sevak: 'bg-secondary-lt' };

function userRow(u) {
  return `<div class="list-group-item">
    <div class="fw-medium">
      ${esc(u.full_name)} <span class="badge ${ROLE_BADGE[u.role] ?? ''} ms-1">${esc(u.role)}</span>
    </div>
    <div class="text-secondary small">Since ${esc(formatLong(u.created_at.slice(0, 10)))}</div>
  </div>`;
}

function renderUsers(root) {
  const rows = users.filter((u) => u.mandir_id === mandirId);
  root.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Users assigned to this house</h3>
        <div class="card-actions">
          <a href="platform-team.html" class="btn btn-sm">Manage in Team &amp; Users</a>
        </div>
      </div>
      ${rows.length
        ? `<div class="list-group list-group-flush">${rows.map(userRow).join('')}</div>`
        : `<div class="card-body">${emptyState('users-group', 'No users yet')}</div>`}
    </div>`;
}
