// Platform admin dashboard — a bird's-eye view across every gharmandir.

import { requirePlatformAdmin } from '../auth.js';
import {
  renderPlatformChrome, applyTheme, pageHeader, esc, showError, spinner, emptyState
} from '../lib/ui.js';
import { listMandirs } from '../api/mandirs.js';
import { listAllUsers } from '../api/team.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs, users;

init();

async function init() {
  try {
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'dashboard');
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
  return `<div class="col-6 col-md-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto">
            <span class="bg-primary-lt avatar"><i class="ti ti-${icon} fs-2"></i></span>
          </div>
          <div class="col">
            <div class="text-secondary small">${esc(label)}</div>
            <div class="gm-stat text-${tone}">${esc(value)}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function render() {
  const pending = mandirs.filter((m) => m.status === 'pending');
  const approved = mandirs.filter((m) => m.status === 'approved');
  const platformAdmins = users.filter((u) => u.platform_admin);
  const houseUsers = users.filter((u) => !u.platform_admin);

  const recent = [...mandirs]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);

  main.innerHTML = `
    ${pageHeader('Dashboard', 'Every gharmandir on this platform, at a glance.')}

    <div class="row row-deck row-cards mb-3">
      ${statCard('Houses', String(mandirs.length), 'building-community')}
      ${statCard('Needs review', String(pending.length), 'clock-hour-4', pending.length ? 'watch' : 'secondary')}
      ${statCard('Approved', String(approved.length), 'circle-check', 'good')}
      ${statCard('People', String(users.length), 'users-group')}
    </div>

    ${pending.length ? `
      <div class="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <span>
          <i class="ti ti-clock-hour-4 me-1"></i>
          ${pending.length} ${pending.length === 1 ? 'house is' : 'houses are'} waiting for review.
        </span>
        <a href="platform-approvals.html" class="btn btn-sm btn-warning">Review now</a>
      </div>` : ''}

    <div class="row row-cards">
      <div class="col-12 col-lg-7">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Recently registered</h3></div>
          ${recent.length
            ? `<div class="list-group list-group-flush">${recent.map(recentRow).join('')}</div>`
            : `<div class="card-body">${emptyState('building-community', 'No gharmandirs yet')}</div>`}
        </div>
      </div>
      <div class="col-12 col-lg-5">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Team</h3></div>
          <div class="card-body">
            <div class="datagrid">
              <div class="datagrid-item">
                <div class="datagrid-title">Platform admins</div>
                <div class="datagrid-content">${platformAdmins.length}</div>
              </div>
              <div class="datagrid-item">
                <div class="datagrid-title">Sevaks &amp; house admins</div>
                <div class="datagrid-content">${houseUsers.length}</div>
              </div>
            </div>
            <a href="platform-team.html" class="btn w-100 mt-3">
              <i class="ti ti-users-group me-1"></i> Manage team &amp; users
            </a>
          </div>
        </div>
      </div>
    </div>`;
}

const STATUS_BADGE = { pending: 'bg-orange-lt', approved: 'bg-success-lt', rejected: 'bg-danger-lt' };

function recentRow(m) {
  return `<div class="list-group-item">
    <div class="row align-items-center g-2">
      <div class="col text-truncate">
        <span class="fw-medium">${esc(m.ghar_name)}</span>
        <span class="text-secondary">&middot; ${esc(m.name)}</span>
        <span class="badge ${STATUS_BADGE[m.status]} ms-1">${esc(m.status)}</span>
        <div class="text-secondary small">Registered ${esc(formatLong(m.created_at.slice(0, 10)))}</div>
      </div>
    </div>
  </div>`;
}
