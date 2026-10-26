// Attendance marking page.

import { requireAuth } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, spinner, statusLegend
} from '../lib/ui.js';
import { listMembers, livedHereOn } from '../api/members.js';
import { getSettings, getSabhaByDate, getOrCreateSabha, updateSabha } from '../api/sabhas.js';
import { getForSabha, markBulk, clearSabha } from '../api/attendance.js';
import { absencesOn } from '../api/utilities.js';
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

let profile, settings, roster, sabha;
let members = [];   // the roster narrowed to whoever lived here on dateISO
let marks = {}, reasons = {}, dateISO;
let away = {};      // memberId -> { note, start_date, end_date }

// livedHereOn comes from the members API so the dashboard, history and
// this page all agree on who was here. Note it is checked against the
// sabha's own date, not today, so reopening an old sabha still shows the
// people who were actually in the house back then.

init();

async function init() {
  try {
    // write: true bounces a PIN session back to the dashboard.
    profile = await requireAuth({ write: true });
    renderChrome(profile, 'attendance');
    settings = await getSettings(profile.mandirId);
    roster = await listMembers(profile.mandirId);

    const param = new URLSearchParams(location.search).get('date');
    dateISO = param || previousSabha(today(), settings.thursday_anchor) || today();

    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  marks = {}; reasons = {}; sabha = null; away = {};

  members = roster.filter((m) => livedHereOn(m, dateISO));

  // Who is recorded as away on this date. Shown on the roster, but the
  // buttons stay live — being away is a reason, not a verdict.
  try {
    for (const a of await absencesOn(profile.mandirId, dateISO)) {
      away[a.member_id] = a;
    }
  } catch {
    // A sevak with no access to absences should still be able to mark.
  }

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
    // Anyone recorded as away is left untouched — marking him present
    // would be the one mistake this button could quietly make.
    let skipped = 0;
    for (const m of members) {
      if (away[m.id]) { skipped++; continue; }
      marks[m.id] = 'present';
    }
    refreshRows();
    refreshCount();
    if (skipped) {
      toast(
        skipped === 1
          ? '1 yuvak is away — left unmarked'
          : `${skipped} yuvaks are away — left unmarked`,
        'info'
      );
    }
  });
  document.getElementById('clear').addEventListener('click', doClear);
  document.getElementById('share').addEventListener('click', toggleShare);
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
          ${excludedNote()}
          <div id="rows">${members.map(rowHTML).join('')}</div>
        </div>
        <div class="card-footer d-flex flex-wrap gap-2">
          <button class="btn btn-primary" id="save"><i class="ti ti-check me-1"></i> Save attendance</button>
          <button class="btn" id="allpresent"><i class="ti ti-users-group me-1"></i> All present</button>
          <button class="btn" id="share"><i class="ti ti-brand-whatsapp me-1"></i> Share</button>
          <button class="btn btn-ghost-danger ms-auto" id="clear"><i class="ti ti-trash me-1"></i> Clear</button>
        </div>
        <div id="share-pane" hidden></div>
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
          ${statusLegend({ inline: false })}
          <p class="text-secondary small mt-3 mb-0">
            Marking someone excused or absent opens a reason box. Whatever you
            type there shows up under Notes on the history page.
          </p>
        </div>
      </div>
    </div>
  </div>`;
}

// Says why the roster is shorter than the member list, so a missing name
// reads as deliberate rather than as a bug.
function excludedNote() {
  const out = roster.filter((m) => !livedHereOn(m, dateISO));
  if (!out.length) return '';

  const gone = out.filter((m) => m.house_end && dateISO > m.house_end);
  const notYet = out.filter((m) => m.house_start && dateISO < m.house_start);

  const bits = [];
  if (gone.length) bits.push(`${gone.map((m) => m.full_name).join(', ')} had moved out`);
  if (notYet.length) bits.push(`${notYet.map((m) => m.full_name).join(', ')} had not moved in`);

  return `<p class="text-secondary small mb-3">
    <i class="ti ti-info-circle" aria-hidden="true"></i>
    Not on this roster: ${esc(bits.join('; '))} by this date.
  </p>`;
}

function rowHTML(m) {
  const s = marks[m.id];
  const needsReason = s === 'absent' || s === 'excused';
  const trip = away[m.id];

  return `<div class="gm-mark-row${trip ? ' gm-mark-row--away' : ''}" data-s="${s ?? ''}" id="row-${m.id}">
    <span class="avatar avatar-xs bg-primary-lt">${esc(initials(m.full_name))}</span>
    <div class="flex-fill text-truncate">
      <span class="text-truncate">${esc(m.full_name)}</span>
      ${m.is_sevak ? '<span class="badge bg-primary-lt ms-1">Sevak</span>' : ''}
      ${trip ? `<div class="gm-away-note">
        <i class="ti ti-plane" aria-hidden="true"></i>
        <span>${esc(trip.note)}</span>
        <span class="text-secondary">
          ${esc(formatShort(trip.start_date))} – ${esc(formatShort(trip.end_date))}
        </span>
      </div>` : ''}
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

      if (marks[m] !== 'absent' && marks[m] !== 'excused') {
        delete reasons[m];
      } else if (!reasons[m] && away[m]) {
        // He is away and we know why — start the reason box with that
        // rather than making the sevak retype it.
        reasons[m] = away[m].note;
      }

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

/* ---------- sharing ---------- */

// Builds the summary as plain text with WhatsApp's own formatting marks
// (*bold*). Reads whatever is on screen right now, so a sevak can share
// straight after marking without saving first.
// How the house opens a message. Kept as one constant so the attendance
// share and the utility bill messages always greet the same way.
const GREETING = 'Jay Swaminarayan Das na Das Banavshoji 🙏';

function shareText() {
  const label = { sunday: 'Sunday Sabha', thursday: 'Thursday Sabha', extra: 'Sabha' };
  const lines = [];

  lines.push(GREETING);
  lines.push('');
  lines.push(`*${label[sabha.sabha_type] ?? 'Sabha'}*`);
  lines.push(formatLong(dateISO));
  if (sabha.topic) lines.push(`Topic: ${sabha.topic}`);
  if (sabha.moved_from) lines.push(`(moved from ${formatShort(sabha.moved_from)})`);

  const groups = [
    { key: 'present', title: 'Present' },
    { key: 'late',    title: 'Late' },
    { key: 'excused', title: 'Excused' },
    { key: 'absent',  title: 'Absent' }
  ];

  // Anyone recorded away is kept out of the status groups and listed on
  // his own. Being in India is not an attendance verdict, and counting
  // him absent would drag the sabha's numbers down for no reason.
  const here = members.filter((m) => !away[m.id]);
  const trips = members.filter((m) => away[m.id]);

  for (const g of groups) {
    const who = here.filter((m) => marks[m.id] === g.key);
    if (!who.length) continue;

    lines.push('');
    lines.push(`*${g.title} (${who.length})*`);

    for (const m of who) {
      const why = (reasons[m.id] ?? '').trim();
      lines.push(`• ${m.full_name}${why ? ` — ${why}` : ''}`);
    }
  }

  const unmarked = here.filter((m) => !marks[m.id]);
  const notMarked = [...unmarked, ...trips];

  if (notMarked.length) {
    lines.push('');
    lines.push(`*Not marked (${notMarked.length})*`);

    for (const m of unmarked) {
      lines.push(`• ${m.full_name}`);
    }
    for (const m of trips) {
      // A typed reason wins over the stored note — the sevak may have
      // corrected it while marking.
      const why = (reasons[m.id] ?? '').trim() || away[m.id].note;
      lines.push(`• ${m.full_name} — away, ${why}`);
    }
  }

  const attended = here.filter(
    (m) => marks[m.id] === 'present' || marks[m.id] === 'late'
  ).length;

  lines.push('');
  lines.push(
    `*Attended ${attended} of ${here.length}*`
    + (trips.length ? ` (${trips.length} away)` : '')
  );

  return lines.join('\n');
}

function toggleShare() {
  const pane = document.getElementById('share-pane');
  if (!pane) return;

  if (!pane.hidden) {
    pane.hidden = true;
    pane.innerHTML = '';
    return;
  }

  if (!countMarked()) {
    toast('Mark the roster first, then share.', 'error');
    return;
  }

  const text = shareText();

  pane.innerHTML = `
    <div class="gm-share">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <span class="small text-secondary">Preview — edit after it opens in WhatsApp</span>
        <button type="button" class="btn-close" id="share-close" aria-label="Close preview"></button>
      </div>
      <pre class="gm-share__text" id="share-text">${esc(text)}</pre>
      <div class="btn-list mt-2">
        <a class="btn btn-primary" id="share-wa"
           href="https://wa.me/?text=${encodeURIComponent(text)}"
           target="_blank" rel="noopener">
          <i class="ti ti-brand-whatsapp me-1"></i> Open WhatsApp
        </a>
        <button type="button" class="btn" id="share-copy">
          <i class="ti ti-copy me-1"></i> Copy
        </button>
      </div>
    </div>`;

  pane.hidden = false;

  document.getElementById('share-close').addEventListener('click', toggleShare);
  document.getElementById('share-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', 'success');
    } catch {
      // Clipboard is blocked outside a secure context; select it instead
      // so the sevak can copy by hand.
      const el = document.getElementById('share-text');
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Selected — press Ctrl+C to copy', 'info');
    }
  });

  pane.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
