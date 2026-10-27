// One house, opened from All Houses — platform admin only, read-only.
// Reuses the same mandir-scoped API functions the house's own pages use
// (they already take an explicit mandirId rather than assuming the
// caller's own), so this needed no new client-side data layer — only the
// read-only RLS policies in sql/15-platform-house-view.sql to allow it.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, showError, spinner, emptyState
} from '../lib/ui.js';
import { getMandir } from '../api/mandirs.js';
import { listMembers, listStats } from '../api/members.js';
import { getSettings, listSabhas } from '../api/sabhas.js';
import { listAllUsers } from '../api/team.js';
import { formatLong } from '../lib/dates.js';
import { band } from '../lib/schedule.js';

applyTheme();

const main = document.getElementById('main');
const mandirId = new URLSearchParams(location.search).get('id');

let profile, mandir, members, stats, settings, sabhas, users;
let tab = 'dashboard';

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
  [mandir, members, stats, settings, sabhas, users] = await Promise.all([
    getMandir(mandirId),
    listMembers(mandirId),
    listStats(mandirId),
    getSettings(mandirId),
    listSabhas(mandirId, { limit: 100 }),
    listAllUsers()
  ]);
  render();
}

function render() {
  main.innerHTML = `
    ${pageHeader(mandir.ghar_name, esc(mandir.name),
      '<a href="platform-houses.html" class="btn"><i class="ti ti-arrow-left me-1"></i> All Houses</a>')}
    ${tabsBar()}
    <div id="tab-content">${tabContent()}</div>`;

  main.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
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

function tabContent() {
  if (tab === 'history') return historyTab();
  if (tab === 'members') return membersTab();
  if (tab === 'users') return usersTab();
  return dashboardTab();
}

/* ---------- dashboard ---------- */

function statCard(label, value, icon, tone = 'primary') {
  const colour = tone === 'watch' ? 'text-watch' : tone === 'primary' ? 'text-primary' : 'text-secondary';
  return `<div class="col-6 col-md-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto"><span class="bg-primary-lt avatar"><i class="ti ti-${icon} fs-2"></i></span></div>
          <div class="col">
            <div class="text-secondary small">${esc(label)}</div>
            <div class="gm-stat ${colour}">${esc(value)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function dashboardTab() {
  const threshold = settings.followup_threshold ?? 65;
  const followUp = stats.filter((s) => s.total > 0 && s.pct < threshold).length;
  const avg = stats.length ? Math.round(stats.reduce((a, s) => a + s.pct, 0) / stats.length) : 0;
  const held = sabhas.filter((s) => !s.is_cancelled).length;

  return `
    <div class="row row-deck row-cards mb-3">
      ${statCard('Members', String(members.length), 'users')}
      ${statCard('Sabhas recorded', String(held), 'calendar-check')}
      ${statCard('Average attendance', `${avg}%`, 'chart-line')}
      ${statCard('Needs follow-up', String(followUp), 'alert-circle', followUp ? 'watch' : 'secondary')}
    </div>
    <div class="card">
      <div class="card-header"><h3 class="card-title">Roster</h3></div>
      ${stats.length
        ? `<div class="list-group list-group-flush">${stats.map(rosterRow).join('')}</div>`
        : `<div class="card-body">${emptyState('users', 'No attendance recorded yet')}</div>`}
    </div>`;
}

function rosterRow(s) {
  const b = band(s.pct);
  return `<div class="list-group-item">
    <div class="row align-items-center g-2">
      <div class="col text-truncate">
        ${esc(s.full_name)}${s.is_sevak ? ' <span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
      </div>
      <div class="col-auto text-end" style="min-width:5.5rem">
        <span class="text-${b} fw-medium">${s.pct}%</span>
        <div class="text-secondary small">${s.attended}/${s.total}</div>
      </div>
    </div>
  </div>`;
}

/* ---------- history ---------- */

function historyTab() {
  const rows = [...sabhas].sort((a, b) => b.sabha_date.localeCompare(a.sabha_date));
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Sabhas</h3></div>
    ${rows.length
      ? `<div class="list-group list-group-flush">${rows.map(sabhaRow).join('')}</div>`
      : `<div class="card-body">${emptyState('calendar', 'No sabhas yet')}</div>`}
  </div>`;
}

function sabhaRow(s) {
  return `<div class="list-group-item">
    <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
      <div>
        <span class="fw-medium">${esc(formatLong(s.sabha_date))}</span>
        <span class="badge bg-secondary-lt ms-1">${esc(s.sabha_type)}</span>
        ${s.is_cancelled ? '<span class="badge bg-danger-lt ms-1">Cancelled</span>' : ''}
      </div>
      ${s.topic ? `<div class="text-secondary small">${esc(s.topic)}</div>` : ''}
    </div>
  </div>`;
}

/* ---------- members ---------- */

function membersTab() {
  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Members</h3></div>
    ${members.length
      ? `<div class="list-group list-group-flush">${members.map(memberRow).join('')}</div>`
      : `<div class="card-body">${emptyState('users', 'No members yet')}</div>`}
  </div>`;
}

function memberRow(m) {
  return `<div class="list-group-item">
    <div class="d-flex align-items-center justify-content-between gap-2 flex-wrap">
      <div>
        <span class="fw-medium">${esc(m.full_name)}</span>
        ${m.is_sevak ? ' <span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
        <span class="badge bg-secondary-lt ms-1">${esc(m.mandal)}</span>
        ${!m.is_active ? '<span class="badge bg-secondary-lt ms-1">Inactive</span>' : ''}
      </div>
      <div class="text-secondary small">${esc(m.phone ?? '')}</div>
    </div>
  </div>`;
}

/* ---------- users ---------- */

const ROLE_BADGE = { admin: 'bg-primary-lt', sevak: 'bg-secondary-lt' };

function usersTab() {
  const rows = users.filter((u) => u.mandir_id === mandirId);
  return `<div class="card">
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

function userRow(u) {
  return `<div class="list-group-item">
    <div class="fw-medium">
      ${esc(u.full_name)} <span class="badge ${ROLE_BADGE[u.role] ?? ''} ms-1">${esc(u.role)}</span>
    </div>
    <div class="text-secondary small">Since ${esc(formatLong(u.created_at.slice(0, 10)))}</div>
  </div>`;
}
