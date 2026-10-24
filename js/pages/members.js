// Member management. Admins can add, edit and deactivate; sevaks and PIN
// sessions get a read-only list. The read-only part is not a UI promise —
// the restrictive policies in 06-pin-login.sql block the writes outright.

import { requireAuth, isAdmin, canWrite } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, emptyState, spinner
} from '../lib/ui.js';
import {
  listMembers, createMember, updateMember, deactivateMember, reactivateMember
} from '../api/members.js';
import { initials, formatShort, today } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
const MANDALS = ['bal', 'kishore', 'yuvak', 'adult', 'senior'];

let profile, members, admin, sevak, editing = null;

init();

async function init() {
  try {
    profile = await requireAuth();
    admin = isAdmin(profile);
    sevak = canWrite(profile);
    renderChrome(profile, 'members');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  // A PIN session has no use for deleted members — that is bookkeeping.
  members = await listMembers(profile.mandirId, { includeInactive: admin });
  render();
}

function render() {
  const now = today();

  // A yuvak whose "Until" date has passed has moved out. He stays on the
  // books — his old sabhas and his share of bills covering the months he
  // lived here are still real — he just moves to his own table.
  const moved = (m) => Boolean(m.house_end) && m.house_end < now;

  const active = members.filter((m) => m.is_active && !moved(m));
  const previous = members.filter((m) => m.is_active && moved(m));
  const removed = members.filter((m) => !m.is_active);

  main.innerHTML = `
    ${pageHeader('Members',
      `${active.length} living in ${esc(profile.gharName)}`
      + (previous.length ? ` &middot; ${previous.length} moved out` : '')
      + (sevak ? '' : ' &middot; view only'))}

    <div class="row row-cards">
      <div class="col-12 ${admin ? 'col-lg-7' : ''}">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Active</h3>
            <div class="card-actions text-secondary small">${active.length}</div>
          </div>
          ${active.length
            ? `<div class="list-group list-group-flush">${active.map((m) => rowHTML(m, 'active')).join('')}</div>`
            : `<div class="card-body">${emptyState('users', 'No active members',
                 admin ? 'Add the first yuvak using the form.' : 'Ask an admin to add members.')}</div>`}
        </div>

        ${previous.length ? `
          <div class="card mt-3">
            <div class="card-header">
              <h3 class="card-title">Previous members</h3>
              <div class="card-actions text-secondary small">${previous.length}</div>
            </div>
            <div class="list-group list-group-flush">
              ${previous.map((m) => rowHTML(m, 'previous')).join('')}
            </div>
            <div class="card-footer text-secondary small">
              Not shown on the attendance page from the day after they left.
              Still counted on utility bills for the days they were here —
              deleting one takes them off those bills entirely.
            </div>
          </div>` : ''}

        ${removed.length ? `
          <div class="card mt-3">
            <div class="card-header">
              <h3 class="card-title text-secondary">Deleted</h3>
              <div class="card-actions text-secondary small">${removed.length}</div>
            </div>
            <div class="list-group list-group-flush">
              ${removed.map((m) => rowHTML(m, 'removed')).join('')}
            </div>
            <div class="card-footer text-secondary small">
              Left out of every bill split and roster. Their past attendance is kept.
            </div>
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
            <label class="form-label" for="joined">Joined mandal</label>
            <input type="date" id="joined" class="form-control" value="${esc(e.joined_date ?? '')}">
          </div>
        </div>

        <div class="hr-text">In the house</div>
        <div class="row">
          <div class="col-md-6 mb-3">
            <label class="form-label" for="hstart">From</label>
            <input type="date" id="hstart" class="form-control" value="${esc(e.house_start ?? '')}">
          </div>
          <div class="col-md-6 mb-3">
            <label class="form-label" for="hend">Until</label>
            <input type="date" id="hend" class="form-control" value="${esc(e.house_end ?? '')}">
            <small class="form-hint">Leave blank if still here.</small>
          </div>
        </div>
        <p class="text-secondary small">
          These dates decide how a utility bill is split — only the days a yuvak
          was actually living here are charged.
        </p>
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

// When this yuvak was in the house — the dates the bill split runs on.
function houseSpan(m) {
  if (!m.house_start && !m.house_end) {
    return `<div class="text-secondary small">
      <i class="ti ti-home-off" style="font-size:0.9em" aria-hidden="true"></i>
      House dates not set
    </div>`;
  }

  const from = m.house_start ? formatShort(m.house_start) : 'always';
  const to = m.house_end ? formatShort(m.house_end) : 'now';

  return `<div class="text-secondary small">
    <i class="ti ti-home" style="font-size:0.9em" aria-hidden="true"></i>
    ${esc(from)} – ${esc(to)}
  </div>`;
}

function rowHTML(m, table = 'active') {
  return `<div class="list-group-item${table === 'active' ? '' : ' opacity-75'}">
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
          ${esc(m.mandal)}${sevak && m.phone
            ? ` &middot; <span class="text-lowercase">${esc(m.phone)}</span>`
            : ''}
        </div>
        ${houseSpan(m)}
      </div>
      ${admin ? `<div class="col-auto">${actions(m, table)}</div>` : ''}
    </div>
  </div>`;
}

// Which buttons a row gets depends on the table it is in.
//   active    edit only — someone still here should not be deletable by
//             accident; set an "Until" date instead and he moves down.
//   previous  edit and delete
//   removed   restore
function actions(m, table) {
  const edit = `<button class="btn btn-sm btn-icon" data-edit="${m.id}"
                        aria-label="Edit ${esc(m.full_name)}">
                  <i class="ti ti-pencil"></i>
                </button>`;

  if (table === 'removed') {
    return `<button class="btn btn-sm" data-on="${m.id}">Restore</button>`;
  }

  if (table === 'previous') {
    return `<div class="btn-list flex-nowrap">
      ${edit}
      <button class="btn btn-sm btn-icon btn-ghost-danger" data-off="${m.id}"
              aria-label="Delete ${esc(m.full_name)}">
        <i class="ti ti-trash"></i>
      </button>
    </div>`;
  }

  return edit;
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
      if (!confirm(
        `Delete ${m.full_name}?\n\n`
        + 'He comes off every utility bill, including ones already recorded '
        + 'for months he lived here. His past attendance is kept and he can '
        + 'be restored later.'
      )) return;

      try {
        await deactivateMember(m.id);
        toast(`${m.full_name} deleted`, 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));

  main.querySelectorAll('[data-on]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await reactivateMember(b.dataset.on);
        toast('Restored', 'success');
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

  // Blank clears the date rather than leaving the old one in place.
  fields.house_start = document.getElementById('hstart').value || null;
  fields.house_end = document.getElementById('hend').value || null;

  if (fields.house_start && fields.house_end && fields.house_end < fields.house_start) {
    const f = document.getElementById('hend');
    f.classList.add('is-invalid');
    f.focus();
    f.addEventListener('input', () => f.classList.remove('is-invalid'), { once: true });
    toast('The house end date is before the start date.', 'error');
    return;
  }

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
