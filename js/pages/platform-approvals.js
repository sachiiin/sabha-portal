// Approvals — platform admin only. Reviews every gharmandir's
// registration and approves or rejects it.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, toast, showError, spinner, emptyState
} from '../lib/ui.js';
import { listMandirs, setMandirStatus } from '../api/mandirs.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs;
let tab = 'pending';

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
  mandirs = await listMandirs();
  render();
}

const STATUS_BADGE = {
  pending: 'bg-orange-lt',
  approved: 'bg-success-lt',
  rejected: 'bg-danger-lt'
};

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
          <span class="fw-medium">${esc(m.name)}</span>
          <span class="text-secondary">&middot; ${esc(m.ghar_name)}</span>
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
