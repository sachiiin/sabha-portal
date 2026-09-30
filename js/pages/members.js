// Member management. Admins can add, edit and deactivate;
// sevaks get a read-only list.

import { requireAuth, isAdmin } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, emptyState, spinner
} from '../lib/ui.js';
import {
  listMembers, createMember, updateMember, deactivateMember, reactivateMember
} from '../api/members.js';
import { initials } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
const MANDALS = ['bal', 'kishore', 'yuvak', 'adult', 'senior'];

let profile, members, admin, editing = null;

init();

async function init() {
  try {
    profile = await requireAuth();
    admin = isAdmin(profile);
    renderChrome(profile, 'members');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  members = await listMembers(profile.mandirId, { includeInactive: true });
  render();
}

function render() {
  const active = members.filter((m) => m.is_active);
  const inactive = members.filter((m) => !m.is_active);

  main.innerHTML = `
    ${pageHeader('Members', `${active.length} active in ${esc(profile.gharName)}`)}

    <div class="row row-cards">
      <div class="col-12 ${admin ? 'col-lg-7' : ''}">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Active</h3></div>
          ${active.length
            ? `<div class="list-group list-group-flush">${active.map(rowHTML).join('')}</div>`
            : `<div class="card-body">${emptyState('users', 'No active members',
                 admin ? 'Add the first yuvak using the form.' : 'Ask an admin to add members.')}</div>`}
        </div>

        ${inactive.length ? `
          <div class="card mt-3">
            <div class="card-header">
              <h3 class="card-title text-secondary">Inactive</h3>
              <div class="card-actions text-secondary small">${inactive.length}</div>
            </div>
            <div class="list-group list-group-flush">${inactive.map(rowHTML).join('')}</div>
          </div>` : ''}
      </div>

      ${admin ? `<div class="col-12 col-lg-5">${formCard()}</div>` : ''}
    </div>`;

  if (admin) {
    document.getElementById('form').addEventListener('submit', onSubmit);
    document.getElementById('cancel')?.addEventListener('click', () => { editing = null; render(); });
  }
  wireRowButtons();
}

function formCard() {
  const e = editing ?? {};
  return `<div class="card sticky-top" style="top:1rem">
    <div class="card-header">
      <h3 class="card-title">${editing ? 'Edit member' : 'Add member'}</h3>
    </div>
    <div class="card-body">
      <form id="form" novalidate>
        <div class="mb-3">
          <label class="form-label required" for="name">Full name</label>
          <input type="text" id="name" class="form-control" required value="${esc(e.full_name ?? '')}">
        </div>
        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label" for="phone">Phone</label>
            <input type="tel" id="phone" class="form-control" value="${esc(e.phone ?? '')}">
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="email">Email</label>
            <input type="email" id="email" class="form-control" value="${esc(e.email ?? '')}">
          </div>
        </div>
        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label" for="mandal">Mandal</label>
            <select id="mandal" class="form-select text-capitalize">
              ${MANDALS.map((m) =>
                `<option value="${m}"${(e.mandal ?? 'yuvak') === m ? ' selected' : ''}>${m}</option>`
              ).join('')}
            </select>
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="joined">Joined</label>
            <input type="date" id="joined" class="form-control" value="${esc(e.joined_date ?? '')}">
          </div>
        </div>
        <label class="form-check mb-3">
          <input class="form-check-input" type="checkbox" id="sevak" ${e.is_sevak ? 'checked' : ''}>
          <span class="form-check-label">House sevak</span>
        </label>
        <div class="btn-list">
          <button type="submit" class="btn btn-primary">
            <i class="ti ti-${editing ? 'check' : 'plus'} me-1"></i>
            ${editing ? 'Save changes' : 'Add member'}
          </button>
          ${editing ? '<button type="button" class="btn" id="cancel">Cancel</button>' : ''}
        </div>
      </form>
    </div>
  </div>`;
}

function rowHTML(m) {
  return `<div class="list-group-item${m.is_active ? '' : ' opacity-75'}">
    <div class="row align-items-center g-2">
      <div class="col-auto">
        <span class="avatar avatar-sm bg-primary-lt">${esc(initials(m.full_name))}</span>
      </div>
      <div class="col text-truncate">
        <div class="text-truncate">
          ${esc(m.full_name)}
          ${m.is_sevak ? '<span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
        </div>
        <div class="text-secondary small text-truncate text-capitalize">
          ${esc(m.mandal)}${m.phone ? ` &middot; <span class="text-lowercase">${esc(m.phone)}</span>` : ''}
        </div>
      </div>
      ${admin ? `<div class="col-auto">
        ${m.is_active
          ? `<div class="btn-list flex-nowrap">
               <button class="btn btn-sm btn-icon" data-edit="${m.id}" aria-label="Edit ${esc(m.full_name)}">
                 <i class="ti ti-pencil"></i>
               </button>
               <button class="btn btn-sm btn-icon btn-ghost-danger" data-off="${m.id}"
                       aria-label="Deactivate ${esc(m.full_name)}">
                 <i class="ti ti-user-off"></i>
               </button>
             </div>`
          : `<button class="btn btn-sm" data-on="${m.id}">Reactivate</button>`}
      </div>` : ''}
    </div>
  </div>`;
}

function wireRowButtons() {
  main.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      editing = members.find((m) => m.id === b.dataset.edit);
      render();
      document.getElementById('form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));

  main.querySelectorAll('[data-off]').forEach((b) =>
    b.addEventListener('click', async () => {
      const m = members.find((x) => x.id === b.dataset.off);
      if (!confirm(`Deactivate ${m.full_name}? Their past attendance is kept.`)) return;
      try {
        await deactivateMember(m.id);
        toast(`${m.full_name} deactivated`, 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));

  main.querySelectorAll('[data-on]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await reactivateMember(b.dataset.on);
        toast('Reactivated', 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

async function onSubmit(ev) {
  ev.preventDefault();

  const nameInput = document.getElementById('name');
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.classList.add('is-invalid');
    nameInput.focus();
    toast('Enter a name', 'error');
    nameInput.addEventListener('input', () => nameInput.classList.remove('is-invalid'), { once: true });
    return;
  }

  const fields = {
    full_name: name,
    phone: document.getElementById('phone').value.trim() || null,
    email: document.getElementById('email').value.trim() || null,
    mandal: document.getElementById('mandal').value,
    is_sevak: document.getElementById('sevak').checked
  };
  const joined = document.getElementById('joined').value;
  if (joined) fields.joined_date = joined;

  try {
    if (editing) {
      await updateMember(editing.id, fields);
      toast('Member updated', 'success');
    } else {
      await createMember(profile.mandirId, fields);
      toast(`${name} added`, 'success');
    }
    editing = null;
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}
