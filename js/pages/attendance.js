// Attendance marking page.

import { requireAuth } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, spinner
} from '../lib/ui.js';
import { listMembers } from '../api/members.js';
import { getSettings, getSabhaByDate, getOrCreateSabha, updateSabha } from '../api/sabhas.js';
import { getForSabha, markBulk, clearSabha } from '../api/attendance.js';
import { isSabhaDay, nextSabha, previousSabha, weekdayName, nearestScheduled }
  from '../lib/schedule.js';
import { today, formatLong, formatShort, initials } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
const STATUSES = [
  { k: 'present', label: 'Present', btn: 'success' },
  { k: 'late',    label: 'Late',    btn: 'warning' },
  { k: 'excused', label: 'Excused', btn: 'info' },
  { k: 'absent',  label: 'Absent',  btn: 'danger' }
];

let profile, settings, members, sabha;
let marks = {}, reasons = {}, dateISO;

init();

async function init() {
  try {
    profile = await requireAuth();
    renderChrome(profile, 'attendance');
    settings = await getSettings(profile.mandirId);
    members = await listMembers(profile.mandirId);

    const param = new URLSearchParams(location.search).get('date');
    dateISO = param || previousSabha(today(), settings.thursday_anchor) || today();

    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  marks = {}; reasons = {}; sabha = null;

  // A date is "open for marking" if a sabha already exists there, or if
  // it falls on a normally scheduled day. Any other date can still be
  // recorded — the sevak just confirms which series it belongs to first.
  sabha = await getSabhaByDate(profile.mandirId, dateISO);

  if (!sabha && isSabhaDay(dateISO, settings.thursday_anchor)) {
    sabha = await getOrCreateSabha(profile.mandirId, dateISO);
  }

  if (sabha) {
    for (const r of await getForSabha(sabha.id)) {
      marks[r.member_id] = r.status;
      if (r.reason) reasons[r.member_id] = r.reason;
    }
  }

  render();
}

function render() {
  const nxt = nextSabha(dateISO, settings.thursday_anchor);
  const prv = previousSabha(dateISO, settings.thursday_anchor);

  const nav = `
    ${prv && prv !== dateISO
      ? `<button class="btn btn-icon" data-goto="${prv}" aria-label="Previous sabha"><i class="ti ti-chevron-left"></i></button>` : ''}
    <input type="date" id="date" class="form-control" style="width:auto" value="${dateISO}">
    ${nxt && nxt !== dateISO
      ? `<button class="btn btn-icon" data-goto="${nxt}" aria-label="Next sabha"><i class="ti ti-chevron-right"></i></button>` : ''}`;

  main.innerHTML = `
    ${pageHeader(formatLong(dateISO), subtitleFor(), nav)}
    ${sabha ? markingCard() : offDayCard()}`;

  document.getElementById('date').addEventListener('change', (e) => goto(e.target.value));
  main.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => goto(b.dataset.goto)));

  if (!sabha) {
    document.getElementById('create-sabha')?.addEventListener('click', createHere);
    document.getElementById('series')?.addEventListener('change', (e) => {
      document.getElementById('moved-wrap').hidden = e.target.value === 'extra';
    });
    return;
  }

  wireRows(main);
  document.getElementById('save').addEventListener('click', save);
  document.getElementById('allpresent').addEventListener('click', () => {
    for (const m of members) marks[m.id] = 'present';
    refreshRows();
    refreshCount();
  });
  document.getElementById('clear').addEventListener('click', doClear);
  document.getElementById('topic').addEventListener('change', async (e) => {
    await updateSabha(sabha.id, { topic: e.target.value.trim() || null });
    toast('Topic saved', 'success');
  });
}

function subtitleFor() {
  if (!sabha) return `${esc(weekdayName(dateISO))} &middot; not a usual sabha day`;

  const label = sabha.sabha_type === 'extra'
    ? 'Extra sabha'
    : `${sabha.sabha_type[0].toUpperCase()}${sabha.sabha_type.slice(1)} sabha`;

  const moved = sabha.moved_from
    ? ` <span class="badge bg-orange-lt ms-1">moved from ${esc(formatShort(sabha.moved_from))}</span>`
    : '';

  return `<span class="badge bg-primary-lt">${esc(label)}</span>${moved}`;
}

async function goto(iso) {
  dateISO = iso;
  history.replaceState(null, '', `attendance.html?date=${iso}`);
  await load();
}

function markingCard() {
  return `<div class="row row-cards">
    <div class="col-12 col-lg-8">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Roster</h3>
          <div class="card-actions text-secondary small" id="count">
            ${countMarked()} of ${members.length} marked
          </div>
        </div>
        <div class="card-body">
          <div id="rows">${members.map(rowHTML).join('')}</div>
        </div>
        <div class="card-footer d-flex flex-wrap gap-2">
          <button class="btn btn-primary" id="save"><i class="ti ti-check me-1"></i> Save attendance</button>
          <button class="btn" id="allpresent"><i class="ti ti-users-group me-1"></i> All present</button>
          <button class="btn btn-ghost-danger ms-auto" id="clear"><i class="ti ti-trash me-1"></i> Clear</button>
        </div>
      </div>
    </div>

    <div class="col-12 col-lg-4">
      <div class="card">
        <div class="card-header"><h3 class="card-title">Sabha details</h3></div>
        <div class="card-body">
          <div class="mb-3">
            <label class="form-label" for="topic">Topic</label>
            <input type="text" id="topic" class="form-control"
                   value="${esc(sabha.topic ?? '')}" placeholder="Kirtan bhakti">
            <small class="form-hint">Saved as you type away from the field.</small>
          </div>
          <div class="hr-text">Legend</div>
          <div class="d-flex flex-column gap-1 small text-secondary">
            <div><span class="gm-dot gm-dot--present d-inline-grid align-middle me-2">P</span> Present</div>
            <div><span class="gm-dot gm-dot--late d-inline-grid align-middle me-2">L</span> Late, counts as attended</div>
            <div><span class="gm-dot gm-dot--excused d-inline-grid align-middle me-2">E</span> Excused</div>
            <div><span class="gm-dot gm-dot--absent d-inline-grid align-middle me-2">A</span> Absent</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function rowHTML(m) {
  const s = marks[m.id];
  const needsReason = s === 'absent' || s === 'excused';

  return `<div class="gm-mark-row" data-s="${s ?? ''}" id="row-${m.id}">
    <span class="avatar avatar-xs bg-primary-lt">${esc(initials(m.full_name))}</span>
    <div class="flex-fill text-truncate">
      <span class="text-truncate">${esc(m.full_name)}</span>
      ${m.is_sevak ? '<span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
    </div>
    <div class="gm-seg btn-group" role="group" aria-label="Status for ${esc(m.full_name)}">
      ${STATUSES.map((st) => `
        <button type="button"
                class="btn ${s === st.k ? `btn-${st.btn}` : 'btn-outline-secondary'}"
                data-m="${m.id}" data-s="${st.k}"
                aria-pressed="${s === st.k}" title="${st.label}">
          ${st.label[0]}
        </button>`).join('')}
    </div>
  </div>
  ${needsReason ? `<input class="form-control form-control-sm mb-2 gm-reason" data-m="${m.id}"
      type="text" placeholder="Reason (optional)" value="${esc(reasons[m.id] ?? '')}">` : ''}`;
}

function wireRows(scope) {
  scope.querySelectorAll('.gm-seg button').forEach((b) =>
    b.addEventListener('click', () => {
      const { m, s } = b.dataset;
      marks[m] = marks[m] === s ? undefined : s;
      if (marks[m] !== 'absent' && marks[m] !== 'excused') delete reasons[m];
      refreshRows();
      refreshCount();
    }));

  scope.querySelectorAll('.gm-reason').forEach((i) =>
    i.addEventListener('input', (e) => { reasons[e.target.dataset.m] = e.target.value; }));
}

// Twelve rows is small enough that re-rendering the whole list beats
// surgical DOM patching, and it keeps a single source of truth.
function refreshRows() {
  const host = document.getElementById('rows');
  if (!host) return;
  const focused = document.activeElement?.dataset?.m;
  host.innerHTML = members.map(rowHTML).join('');
  wireRows(host);
  if (focused) host.querySelector(`.gm-reason[data-m="${focused}"]`)?.focus();
}

function countMarked() {
  return Object.values(marks).filter(Boolean).length;
}

function refreshCount() {
  const el = document.getElementById('count');
  if (el) el.textContent = `${countMarked()} of ${members.length} marked`;
}

// Shown when the chosen date has no sabha and isn't a usual sabha day.
// The sevak says which series it belongs to, so a moved sabha still
// counts toward the right rate.
function offDayCard() {
  const near = nearestScheduled(dateISO, settings.thursday_anchor);
  const suggested = near?.type ?? 'extra';

  const options = [
    { v: 'thursday', label: 'Thursday sabha, moved here' },
    { v: 'sunday',   label: 'Sunday sabha, moved here' },
    { v: 'extra',    label: 'Extra sabha, not part of either series' }
  ];

  return `<div class="row justify-content-center">
    <div class="col-12 col-lg-7">
      <div class="card">
        <div class="card-body">
          <div class="text-center mb-4">
            <span class="avatar avatar-lg bg-orange-lt mb-3"><i class="ti ti-calendar-plus fs-1"></i></span>
            <h3 class="mb-1">Record a sabha on this ${esc(weekdayName(dateISO))}?</h3>
            <p class="text-secondary mb-0">
              ${near
                ? `The usual sabha nearby is ${esc(formatShort(near.date))}.`
                : 'No scheduled sabha falls near this date.'}
            </p>
          </div>

          <div class="mb-3">
            <label class="form-label" for="series">Which sabha is this?</label>
            <select id="series" class="form-select">
              ${options.map((o) =>
                `<option value="${o.v}"${o.v === suggested ? ' selected' : ''}>${o.label}</option>`
              ).join('')}
            </select>
            <small class="form-hint">
              A moved sabha keeps counting toward that series' attendance rate.
            </small>
          </div>

          <div class="mb-3" id="moved-wrap"${suggested === 'extra' ? ' hidden' : ''}>
            <label class="form-label" for="movedfrom">Originally scheduled for</label>
            <input type="date" id="movedfrom" class="form-control"
                   value="${near ? near.date : ''}">
            <small class="form-hint">Optional. Leave blank if it wasn't a reschedule.</small>
          </div>

          <button class="btn btn-primary w-100" id="create-sabha">
            <i class="ti ti-check me-1"></i> Record sabha and mark attendance
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

async function createHere() {
  const type = document.getElementById('series').value;
  const movedFrom = type === 'extra' ? null : (document.getElementById('movedfrom').value || null);

  const btn = document.getElementById('create-sabha');
  btn.disabled = true;

  try {
    sabha = await getOrCreateSabha(profile.mandirId, dateISO, { type, movedFrom });
    render();
    toast('Sabha recorded — mark attendance below', 'success');
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
  }
}

async function save() {
  const entries = members
    .filter((m) => marks[m.id])
    .map((m) => ({ memberId: m.id, status: marks[m.id], reason: reasons[m.id] }));

  if (!entries.length) return toast('Mark at least one yuvak first', 'error');

  const btn = document.getElementById('save');
  btn.disabled = true;
  try {
    await markBulk(sabha.id, entries, profile.id);
    const present = entries.filter((e) => e.status === 'present' || e.status === 'late').length;
    toast(`Saved — ${present} of ${members.length} attended`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function doClear() {
  if (!confirm('Clear all attendance for this sabha?')) return;
  try {
    await clearSabha(sabha.id);
    marks = {}; reasons = {};
    refreshRows();
    refreshCount();
    toast('Cleared', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}
