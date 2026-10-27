// Approvals — platform admin only. Reviews every gharmandir's
// registration and approves or rejects it.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, toast, showError, spinner, emptyState
} from '../lib/ui.js';
import { listMandirs, setMandirStatus } from '../api/mandirs.js';
import { listAllUsers, setUserStatus, reassignUser } from '../api/team.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs, users;
let tab = 'pending';
let reassigningId = null;

init();

async function init() {
  try {
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'approvals');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  [mandirs, users] = await Promise.all([listMandirs(), listAllUsers()]);
  render();
}

function statCard(label, value, icon, tone = 'primary') {
  return `<div class="col-6 col-lg-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center g-2">
          <div class="col-auto">
            <span class="avatar bg-${tone}-lt"><i class="ti ti-${icon}"></i></span>
          </div>
          <div class="col">
            <div class="text-secondary">${esc(label)}</div>
            <div class="h3 mb-0 text-${tone}">${value}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function summary() {
  const approved = mandirs.filter((m) => m.status === 'approved');
  const pending = mandirs.filter((m) => m.status === 'pending');
  const platformAdmins = users.filter((u) => u.platform_admin);
  const houseUsers = users.filter((u) => !u.platform_admin);
  const recent = [...mandirs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6);

  return `
    <div class="row row-deck row-cards mb-3">
      ${statCard('Houses', mandirs.length, 'building-community')}
      ${statCard('Needs review', pending.length, 'clock-hour-4', pending.length ? 'orange' : 'secondary')}
      ${statCard('Approved', approved.length, 'circle-check', 'success')}
      ${statCard('People', users.length, 'users')}
    </div>
    <div class="row row-cards mb-3">
      <div class="col-12 col-lg-7">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Recently registered</h3></div>
          ${recent.length
            ? `<div class="list-group list-group-flush">${recent.map(recentRow).join('')}</div>`
            : `<div class="card-body">${emptyState('building-community', 'Nothing here', 'No gharmandirs registered yet.')}</div>`}
        </div>
      </div>
      <div class="col-12 col-lg-5">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Team</h3></div>
          <div class="card-body">
            <div class="text-secondary small text-uppercase">Platform admins</div>
            <div class="h3">${platformAdmins.length}</div>
            <div class="text-secondary small text-uppercase mt-3">Sevaks &amp; house admins</div>
            <div class="h3">${houseUsers.length}</div>
          </div>
          <div class="card-footer">
            <a href="platform-team.html" class="btn w-100"><i class="ti ti-users-group me-1"></i> Manage team &amp; users</a>
          </div>
        </div>
      </div>
    </div>`;
}

function recentRow(m) {
  return `<div class="list-group-item">
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="fw-medium">${esc(m.ghar_name)}</span>
      <span class="badge ${STATUS_BADGE[m.status]}">${esc(m.status)}</span>
    </div>
    <div class="text-secondary small mt-1">
      Registered ${esc(formatLong(m.created_at.slice(0, 10)))}
    </div>
  </div>`;
}

const STATUS_BADGE = {
  pending: 'bg-orange-lt',
  approved: 'bg-success-lt',
  rejected: 'bg-danger-lt'
};

/* ---------- people: join requests + blocked ---------- */

// A join request: someone picked an already-approved house from
// register.html instead of creating a new one — waiting on this specific
// person, not the house, which is why it's app_users.status and not
// mandirs.status. See sql/18-house-join-requests.sql.
function joinRequests() {
  return users.filter((u) => u.status === 'pending' && !u.platform_admin && u.mandir_id);
}

function blockedUsers() {
  return users.filter((u) => u.status === 'blocked' && !u.platform_admin);
}

function peopleSection() {
  const requests = joinRequests();
  const blocked = blockedUsers();
  if (!requests.length && !blocked.length) return '';

  return `<div class="row row-cards mb-3">
    ${requests.length ? `
      <div class="col-12 col-lg-6">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Join requests</h3>
            <div class="card-actions text-secondary small">${requests.length}</div>
          </div>
          <div class="list-group list-group-flush">${requests.map(joinRow).join('')}</div>
        </div>
      </div>` : ''}
    ${blocked.length ? `
      <div class="col-12 col-lg-6">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Blocked</h3>
            <div class="card-actions text-secondary small">${blocked.length}</div>
          </div>
          <div class="list-group list-group-flush">${blocked.map(blockedRow).join('')}</div>
        </div>
      </div>` : ''}
  </div>`;
}

function joinRow(u) {
  return `<div class="list-group-item">
    <div class="row align-items-center g-2">
      <div class="col">
        <div class="fw-medium">${esc(u.full_name)}</div>
        <div class="text-secondary small">
          Wants to join ${esc(u.mandirs?.ghar_name ?? 'a house')}
          &middot; ${esc(formatLong(u.created_at.slice(0, 10)))}
        </div>
      </div>
      <div class="col-auto btn-list">
        <button class="btn btn-sm btn-success" data-user-approve="${u.id}">
          <i class="ti ti-check me-1"></i> Approve</button>
        <button class="btn btn-sm btn-ghost-danger" data-user-decline="${u.id}">
          <i class="ti ti-x me-1"></i> Decline</button>
      </div>
    </div>
  </div>`;
}

function blockedRow(u) {
  if (reassigningId === u.id) return blockedMoveRow(u);

  return `<div class="list-group-item">
    <div class="row align-items-center g-2">
      <div class="col">
        <div class="fw-medium">${esc(u.full_name)} <span class="badge bg-danger-lt ms-1">Blocked</span></div>
        <div class="text-secondary small">Was ${esc(u.mandirs?.ghar_name ?? 'no house')}</div>
      </div>
      <div class="col-auto">
        <button class="btn btn-sm" data-unblock="${u.id}">
          <i class="ti ti-lock-open me-1"></i> Give access</button>
      </div>
    </div>
  </div>`;
}

function blockedMoveRow(u) {
  const approved = mandirs.filter((m) => m.status === 'approved');

  return `<div class="list-group-item">
    <div class="row g-2 align-items-center">
      <div class="col-12 col-md-auto fw-medium">${esc(u.full_name)}</div>
      <div class="col-7 col-md-5">
        <select class="form-select form-select-sm" id="unblock-mandir-${u.id}">
          ${approved.map((m) =>
            `<option value="${m.id}"${m.id === u.mandir_id ? ' selected' : ''}>${esc(m.ghar_name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="col-5 col-md-3">
        <select class="form-select form-select-sm" id="unblock-role-${u.id}">
          <option value="sevak"${u.role === 'sevak' ? ' selected' : ''}>Sevak</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="col-12 col-md-auto btn-list">
        <button class="btn btn-sm btn-primary" data-save-unblock="${u.id}">Save</button>
        <button class="btn btn-sm" data-cancel-unblock="${u.id}">Cancel</button>
      </div>
    </div>
  </div>`;
}

async function approveJoin(id) {
  try {
    await setUserStatus(id, 'approved');
    await load();
    toast('Approved', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function declineJoin(id) {
  if (!confirm('Decline this join request? The account is blocked until you give it access somewhere else.')) {
    return;
  }
  try {
    await setUserStatus(id, 'blocked');
    await load();
    toast('Declined', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function saveUnblock(id) {
  const mandirId = document.getElementById(`unblock-mandir-${id}`).value;
  const role = document.getElementById(`unblock-role-${id}`).value;
  try {
    await reassignUser(id, mandirId, role);
    reassigningId = null;
    await load();
    toast('Access granted', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function tabsBar() {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const m of mandirs) counts[m.status] = (counts[m.status] ?? 0) + 1;

  const tabs = [
    ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']
  ];

  return `<div class="gm-range mb-3">
    ${tabs.map(([key, label]) => `
      <button type="button" data-tab="${key}" aria-pressed="${tab === key}">
        ${label}${key !== 'all' ? ` (${counts[key] ?? 0})` : ''}
      </button>`).join('')}
  </div>`;
}

function visible() {
  return tab === 'all' ? mandirs : mandirs.filter((m) => m.status === tab);
}

function render() {
  const rows = visible();

  main.innerHTML = `
    ${pageHeader('Approvals', 'Review a new gharmandir before it can be used.')}
    ${summary()}
    ${peopleSection()}
    ${tabsBar()}
    <div class="card">
      ${rows.length
        ? `<div class="list-group list-group-flush">${rows.map(row).join('')}</div>`
        : `<div class="card-body">${emptyState('building-community', 'Nothing here', 'No gharmandirs in this list yet.')}</div>`}
    </div>`;

  main.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

  main.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', () => act(b.dataset.approve, 'approved')));
  main.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', () => act(b.dataset.reject, 'rejected')));

  main.querySelectorAll('[data-user-approve]').forEach((b) =>
    b.addEventListener('click', () => approveJoin(b.dataset.userApprove)));
  main.querySelectorAll('[data-user-decline]').forEach((b) =>
    b.addEventListener('click', () => declineJoin(b.dataset.userDecline)));
  main.querySelectorAll('[data-unblock]').forEach((b) =>
    b.addEventListener('click', () => { reassigningId = b.dataset.unblock; render(); }));
  main.querySelectorAll('[data-cancel-unblock]').forEach((b) =>
    b.addEventListener('click', () => { reassigningId = null; render(); }));
  main.querySelectorAll('[data-save-unblock]').forEach((b) =>
    b.addEventListener('click', () => saveUnblock(b.dataset.saveUnblock)));
}

function row(m) {
  const actions = [];
  if (m.status !== 'approved') {
    actions.push(`<button class="btn btn-sm btn-success" data-approve="${m.id}">
      <i class="ti ti-check me-1"></i> Approve</button>`);
  }
  if (m.status !== 'rejected') {
    actions.push(`<button class="btn btn-sm btn-ghost-danger" data-reject="${m.id}">
      <i class="ti ti-x me-1"></i> Reject</button>`);
  }

  return `<div class="list-group-item">
    <div class="row align-items-center g-2">
      <div class="col">
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <span class="fw-medium">${esc(m.ghar_name)}</span>
          <span class="badge ${STATUS_BADGE[m.status]}">${esc(m.status)}</span>
        </div>
        <div class="text-secondary small mt-1">
          ${m.address ? `${esc(m.address)} &middot; ` : ''}
          Registered ${esc(formatLong(m.created_at.slice(0, 10)))}
        </div>
        <div class="text-secondary small">
          ${esc(m.contact_name ?? '')}
          ${m.contact_email ? ` &middot; <a href="mailto:${esc(m.contact_email)}">${esc(m.contact_email)}</a>` : ''}
        </div>
      </div>
      <div class="col-auto btn-list">${actions.join('')}</div>
    </div>
  </div>`;
}

async function act(id, status) {
  if (status === 'rejected' && !confirm('Reject this gharmandir? Its admin will no longer be able to sign in.')) {
    return;
  }

  try {
    await setMandirStatus(id, status);
    const m = mandirs.find((x) => x.id === id);
    if (m) m.status = status;
    render();
    toast(status === 'approved' ? 'Approved' : 'Rejected', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}
