// Team & Users — platform admin only. Add fellow platform admins, create
// a sevak/admin login for any house directly, and move an existing one to
// a different house or role.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, toast, showError, spinner
} from '../lib/ui.js';
import { listMandirs } from '../api/mandirs.js';
import { listAllUsers, createUser, reassignUser, setPlatformAdmin } from '../api/team.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs, users;
let editingId = null;

init();

async function init() {
  try {
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'team');
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

function render() {
  main.innerHTML = `
    ${pageHeader('Team & Users', 'Platform admins see this page; everyone else signs into their own house.')}
    ${platformAdminsCard()}
    ${houseUsersCard()}`;

  main.querySelectorAll('[data-demote]').forEach((b) =>
    b.addEventListener('click', () => demote(b.dataset.demote)));
  main.querySelectorAll('[data-move]').forEach((b) =>
    b.addEventListener('click', () => { editingId = b.dataset.move; render(); }));
  main.querySelectorAll('[data-cancel-move]').forEach((b) =>
    b.addEventListener('click', () => { editingId = null; render(); }));
  main.querySelectorAll('[data-save-move]').forEach((b) =>
    b.addEventListener('click', () => saveMove(b.dataset.saveMove)));

  document.getElementById('add-admin-form').addEventListener('submit', onAddAdmin);
  document.getElementById('add-user-form').addEventListener('submit', onAddUser);
}

/* ---------- platform admins ---------- */

function platformAdminsCard() {
  const admins = users.filter((u) => u.platform_admin);

  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title">Platform admins</h3></div>
    <div class="list-group list-group-flush">${admins.map(adminRow).join('')}</div>
    <div class="card-body border-top">
      <div class="hr-text hr-text-left mb-2">Add a platform admin</div>
      <form id="add-admin-form" class="row g-2">
        <div class="col-12 col-md-4">
          <input type="text" id="pa-name" class="form-control" placeholder="Full name" required>
        </div>
        <div class="col-12 col-md-4">
          <input type="email" id="pa-email" class="form-control" placeholder="Email" required>
        </div>
        <div class="col-12 col-md-3">
          <input type="password" id="pa-password" class="form-control" placeholder="Starting password"
                 minlength="6" required>
        </div>
        <div class="col-12 col-md-1">
          <button type="submit" class="btn btn-primary w-100" aria-label="Add">
            <i class="ti ti-plus"></i>
          </button>
        </div>
      </form>
      <small class="form-hint">
        They can change this password from their own account menu once signed in.
      </small>
    </div>
  </div>`;
}

function adminRow(u) {
  const self = u.id === profile.id;
  return `<div class="list-group-item d-flex align-items-center justify-content-between gap-2">
    <div>
      <div class="fw-medium">
        ${esc(u.full_name)}${self ? ' <span class="badge bg-primary-lt ms-1">You</span>' : ''}
      </div>
      <div class="text-secondary small">Since ${esc(formatLong(u.created_at.slice(0, 10)))}</div>
    </div>
    ${self ? '' : `<button class="btn btn-sm btn-ghost-danger" data-demote="${u.id}">
      <i class="ti ti-user-minus me-1"></i> Remove</button>`}
  </div>`;
}

async function demote(id) {
  if (!confirm('Remove platform admin access for this account?')) return;
  try {
    await setPlatformAdmin(id, false);
    await load();
    toast('Platform admin access removed', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onAddAdmin(e) {
  e.preventDefault();
  const fullName = document.getElementById('pa-name').value.trim();
  const email = document.getElementById('pa-email').value.trim();
  const password = document.getElementById('pa-password').value;
  if (!fullName || !email || !password) return toast('Fill in every field.', 'error');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await createUser({ email, password, fullName, platformAdmin: true });
    await load();
    toast(`${fullName} can now sign in as a platform admin.`, 'success');
  } catch (ex) {
    toast(ex.message, 'error');
    btn.disabled = false;
  }
}

/* ---------- house users ---------- */

const ROLE_BADGE = { admin: 'bg-primary-lt', sevak: 'bg-secondary-lt' };

function houseUsersCard() {
  const rows = users.filter((u) => !u.platform_admin && u.role !== 'viewer');

  return `<div class="card">
    <div class="card-header"><h3 class="card-title">Sevaks &amp; house admins</h3></div>
    <div class="list-group list-group-flush">
      ${rows.map(houseUserRow).join('')}
    </div>
    <div class="card-body border-top">
      <div class="hr-text hr-text-left mb-2">Add a user</div>
      <form id="add-user-form" class="row g-2">
        <div class="col-12 col-md-3">
          <input id="hu-name" class="form-control" placeholder="Full name" required>
        </div>
        <div class="col-12 col-md-3">
          <input id="hu-email" type="email" class="form-control" placeholder="Email" required>
        </div>
        <div class="col-12 col-md-2">
          <input id="hu-password" type="password" class="form-control" placeholder="Password"
                 minlength="6" required>
        </div>
        <div class="col-6 col-md-2">
          <select id="hu-mandir" class="form-select" required>
            <option value="" disabled selected>House</option>
            ${mandirs.map((m) => `<option value="${m.id}">${esc(m.ghar_name)} (${esc(m.status)})</option>`).join('')}
          </select>
        </div>
        <div class="col-6 col-md-1">
          <select id="hu-role" class="form-select">
            <option value="sevak">Sevak</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="col-12 col-md-1">
          <button type="submit" class="btn btn-primary w-100" aria-label="Add">
            <i class="ti ti-plus"></i>
          </button>
        </div>
      </form>
      <small class="form-hint">
        They can change this password from their own account menu once signed in.
      </small>
    </div>
  </div>`;
}

function houseUserRow(u) {
  if (editingId === u.id) return moveRow(u);

  return `<div class="list-group-item d-flex align-items-center justify-content-between gap-2 flex-wrap">
    <div>
      <div class="fw-medium">
        ${esc(u.full_name)} <span class="badge ${ROLE_BADGE[u.role]} ms-1">${esc(u.role)}</span>
      </div>
      <div class="text-secondary small">
        ${esc(u.mandirs?.ghar_name ?? 'No house')} &middot; since ${esc(formatLong(u.created_at.slice(0, 10)))}
      </div>
    </div>
    <button class="btn btn-sm" data-move="${u.id}">
      <i class="ti ti-arrows-exchange me-1"></i> Move
    </button>
  </div>`;
}

function moveRow(u) {
  return `<div class="list-group-item">
    <div class="row g-2 align-items-center">
      <div class="col-12 col-md-auto fw-medium">${esc(u.full_name)}</div>
      <div class="col-7 col-md-4">
        <select class="form-select form-select-sm" id="move-mandir-${u.id}">
          ${mandirs.map((m) =>
            `<option value="${m.id}"${m.id === u.mandir_id ? ' selected' : ''}>${esc(m.ghar_name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="col-5 col-md-3">
        <select class="form-select form-select-sm" id="move-role-${u.id}">
          <option value="sevak"${u.role === 'sevak' ? ' selected' : ''}>Sevak</option>
          <option value="admin"${u.role === 'admin' ? ' selected' : ''}>Admin</option>
        </select>
      </div>
      <div class="col-12 col-md-auto btn-list">
        <button class="btn btn-sm btn-primary" data-save-move="${u.id}">Save</button>
        <button class="btn btn-sm" data-cancel-move="${u.id}">Cancel</button>
      </div>
    </div>
  </div>`;
}

async function saveMove(id) {
  const mandirId = document.getElementById(`move-mandir-${id}`).value;
  const role = document.getElementById(`move-role-${id}`).value;
  try {
    await reassignUser(id, mandirId, role);
    editingId = null;
    await load();
    toast('Moved', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onAddUser(e) {
  e.preventDefault();
  const fullName = document.getElementById('hu-name').value.trim();
  const email = document.getElementById('hu-email').value.trim();
  const password = document.getElementById('hu-password').value;
  const mandirId = document.getElementById('hu-mandir').value;
  const role = document.getElementById('hu-role').value;
  if (!fullName || !email || !password || !mandirId) return toast('Fill in every field.', 'error');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await createUser({ email, password, fullName, mandirId, role });
    await load();
    toast(`${fullName} can now sign in.`, 'success');
  } catch (ex) {
    toast(ex.message, 'error');
    btn.disabled = false;
  }
}
