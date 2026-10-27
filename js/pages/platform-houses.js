// All Houses — platform admin only. A browsing directory of every
// gharmandir on the platform. Read-only on purpose: Approvals is the one
// place with approve/reject actions, so there is exactly one place to act
// and one place to look things up.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, showError, spinner, emptyState
} from '../lib/ui.js';
import { listMandirs } from '../api/mandirs.js';
import { listAllUsers } from '../api/team.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs, usersByMandir;
let tab = 'approved';

init();

async function init() {
  try {
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'houses');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  const [allMandirs, users] = await Promise.all([listMandirs(), listAllUsers()]);
  mandirs = allMandirs;

  usersByMandir = new Map();
  for (const u of users) {
    if (!u.mandir_id) continue;
    usersByMandir.set(u.mandir_id, (usersByMandir.get(u.mandir_id) ?? 0) + 1);
  }

  render();
}

const STATUS_BADGE = { pending: 'bg-orange-lt', approved: 'bg-success-lt', rejected: 'bg-danger-lt' };

function tabsBar() {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const m of mandirs) counts[m.status] = (counts[m.status] ?? 0) + 1;

  const tabs = [
    ['approved', 'Approved'], ['pending', 'Pending'], ['rejected', 'Rejected'], ['all', 'All']
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
    ${pageHeader('All Houses', 'Every gharmandir registered on this platform.')}
    ${tabsBar()}
    ${rows.length
      ? `<div class="row row-cards">${rows.map(card).join('')}</div>`
      : `<div class="card"><div class="card-body">
          ${emptyState('building-community', 'Nothing here', 'No gharmandirs in this list yet.')}
         </div></div>`}`;

  main.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
}

function card(m) {
  const people = usersByMandir.get(m.id) ?? 0;

  return `<div class="col-12 col-md-6 col-xl-4">
    <div class="card h-100">
      <div class="card-body">
        <div class="d-flex align-items-start justify-content-between gap-2 mb-2">
          <div>
            <div class="fw-medium">${esc(m.ghar_name)}</div>
            <div class="text-secondary small">${esc(m.name)}</div>
          </div>
          <span class="badge ${STATUS_BADGE[m.status]}">${esc(m.status)}</span>
        </div>

        ${m.address ? `<div class="text-secondary small mb-2">
          <i class="ti ti-map-pin me-1"></i>${esc(m.address)}
        </div>` : ''}

        <div class="text-secondary small mb-1">
          <i class="ti ti-users-group me-1"></i>
          ${people} ${people === 1 ? 'account' : 'accounts'}
        </div>
        <div class="text-secondary small mb-1">
          <i class="ti ti-calendar me-1"></i>
          Registered ${esc(formatLong(m.created_at.slice(0, 10)))}
        </div>
        ${m.contact_name || m.contact_email ? `<div class="text-secondary small">
          <i class="ti ti-user me-1"></i>${esc(m.contact_name ?? '')}
          ${m.contact_email ? ` &middot; <a href="mailto:${esc(m.contact_email)}">${esc(m.contact_email)}</a>` : ''}
        </div>` : ''}
      </div>
      <div class="card-footer">
        ${m.status === 'pending'
          ? `<a href="platform-approvals.html" class="btn btn-sm w-100">
               <i class="ti ti-clipboard-check me-1"></i> Review in Approvals
             </a>`
          : `<a href="platform-house.html?id=${m.id}" class="btn btn-sm w-100">
               <i class="ti ti-eye me-1"></i> View
             </a>`}
      </div>
    </div>
  </div>`;
}
