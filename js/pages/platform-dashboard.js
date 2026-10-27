// Platform admin dashboard — the same PIN-viewer dashboard every house's
// own people see, either combined across every approved house, or
// narrowed to one with the House filter beside the page title.

import { requirePlatformAdmin } from '../auth.js';
import { renderPlatformChrome, applyTheme, pageHeader, esc, showError, spinner } from '../lib/ui.js';
import { mountHouseDashboard, fetchHouseScope, mergeHouseScopes } from '../lib/house-dashboard.js';
import { listMandirs } from '../api/mandirs.js';
import { nextSabha } from '../lib/schedule.js';
import { today, formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, mandirs, approved, pendingCount;
let houseId = 'all';

init();

async function init() {
  try {
    profile = await requirePlatformAdmin();
    renderPlatformChrome(profile, 'dashboard');

    mandirs = await listMandirs();
    approved = mandirs.filter((m) => m.status === 'approved');
    pendingCount = mandirs.filter((m) => m.status === 'pending').length;

    render();
    await loadScope();
  } catch (e) {
    showError(main, e.message);
  }
}

function render() {
  main.innerHTML = `
    ${pageHeader('Dashboard', 'The same dashboard a house’s own sevako see.', houseFilter())}
    ${pendingCount ? `
      <div class="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
        <span>
          <i class="ti ti-clock-hour-4 me-1"></i>
          ${pendingCount} ${pendingCount === 1 ? 'house is' : 'houses are'} waiting for review.
        </span>
        <a href="platform-approvals.html" class="btn btn-sm btn-warning">Review now</a>
      </div>` : ''}
    <div id="scope-root">${spinner}</div>`;

  document.getElementById('house-filter').addEventListener('change', (e) => {
    houseId = e.target.value;
    loadScope();
  });
}

function houseFilter() {
  return `<select id="house-filter" class="form-select" style="width:auto">
    <option value="all"${houseId === 'all' ? ' selected' : ''}>All Houses</option>
    ${approved.map((m) =>
      `<option value="${m.id}"${houseId === m.id ? ' selected' : ''}>${esc(m.ghar_name)}</option>`
    ).join('')}
  </select>`;
}

async function loadScope() {
  const root = document.getElementById('scope-root');
  root.innerHTML = spinner;

  try {
    if (houseId === 'all') {
      await loadAllHouses(root);
    } else {
      await loadOneHouse(root, houseId);
    }
  } catch (e) {
    showError(root, e.message);
  }
}

async function loadOneHouse(root, id) {
  const house = approved.find((m) => m.id === id);
  const scope = await fetchHouseScope(id);
  const threshold = scope.settings.followup_threshold ?? 65;
  const upcoming = nextSabha(today(), scope.settings.thursday_anchor);

  mountHouseDashboard(root, {
    gharName: house.ghar_name,
    members: scope.members,
    stats: scope.stats,
    trend: scope.trend,
    absences: scope.absences,
    historyRows: scope.historyRows,
    followUpCount: scope.stats.filter((s) => s.total > 0 && s.pct < threshold).length,
    nextSabhaText: upcoming
      ? `Next sabha · ${formatLong(upcoming)}`
      : 'No sabha scheduled in the next two weeks'
  });
}

async function loadAllHouses(root) {
  if (!approved.length) {
    root.innerHTML = `<div class="card"><div class="card-body text-center text-secondary py-6">
      No approved houses yet.
    </div></div>`;
    return;
  }

  const scoped = await Promise.all(
    approved.map(async (m) => ({ gharName: m.ghar_name, ...(await fetchHouseScope(m.id)) }))
  );
  const merged = mergeHouseScopes(scoped);

  // The soonest upcoming sabha across every house, so "All Houses" still
  // has a meaningful Next sabha line rather than a generic one — each
  // house keeps its own schedule, so there's no single shared date to
  // fall back on.
  let soonest = null;
  for (const s of scoped) {
    const d = nextSabha(today(), s.settings.thursday_anchor);
    if (d && (!soonest || d < soonest.date)) soonest = { date: d, gharName: s.gharName };
  }

  mountHouseDashboard(root, {
    gharName: 'All Houses',
    members: merged.members,
    stats: merged.stats,
    trend: merged.trend,
    absences: merged.absences,
    historyRows: merged.historyRows,
    followUpCount: merged.followUpCount,
    nextSabhaText: soonest
      ? `Next sabha · ${formatLong(soonest.date)} (${soonest.gharName})`
      : 'No sabha scheduled in the next two weeks across any house'
  });
}
