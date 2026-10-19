// Utility Bills — admin only.
// Record a bill, see it split across the yuvaks by days actually in the
// house, and manage away periods that drive that split.

import { requireAuth, isAdmin } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, emptyState, spinner
} from '../lib/ui.js';
import { listMembers } from '../api/members.js';
import {
  listBills, createBill, deleteBill, billSplit,
  listAbsences, createAbsence, deleteAbsence,
  listCharges, createCharge, deleteCharge, setTransferred
} from '../api/utilities.js';
import { getHouseSettings, setMonthlyRent } from '../api/settings.js';
import { formatShort, formatLong, today, initials } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');

// The house has exactly these three. Keeping them fixed is what lets the
// owner-transfer table line a month's bills up into columns.
const BILL_TYPES = ['Toronto Hydro', 'Enbridge Gas', 'Water/Utility'];

let profile, members, bills, absences, settings, charges;
let openBill = null;          // id of the bill whose split is expanded
const splitCache = new Map(); // bill id -> rows, so reopening does not refetch

init();

async function init() {
  try {
    profile = await requireAuth({ write: true });

    if (!isAdmin(profile)) {
      location.href = 'index.html?e=readonly';
      return;
    }

    renderChrome(profile, 'utilities');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  [members, bills, absences, settings, charges] = await Promise.all([
    listMembers(profile.mandirId),
    listBills(profile.mandirId),
    listAbsences(profile.mandirId),
    getHouseSettings(profile.mandirId),
    listCharges(profile.mandirId)
  ]);
  render();
}

function money(n) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })
    .format(Number(n));
}

function days(aISO, bISO) {
  const ms = new Date(bISO) - new Date(aISO);
  return Math.round(ms / 86400000) + 1;
}

/* ---------- render ---------- */

const monthLabel = (iso) =>
  new Date(iso.slice(0, 7) + '-01T00:00:00')
    .toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

// Bills not yet collected for. These are what the next count will take.
const pending = () => bills.filter((b) => !b.charge_id);

function render() {
  main.innerHTML = `
    ${pageHeader('Utility bills', `${bills.length} recorded &middot; ${esc(profile.gharName)}`)}

    <div class="row row-cards">
      <div class="col-12 col-xl-8">
        ${transferCard()}
        ${billsCard()}
      </div>
      <div class="col-12 col-xl-4">
        ${addBillCard()}
        ${awayCard()}
      </div>
    </div>`;

  document.getElementById('bill-form').addEventListener('submit', onAddBill);
  document.getElementById('away-form').addEventListener('submit', onAddAway);
  document.getElementById('edit-rent')?.addEventListener('click', onEditRent);
  document.getElementById('count-total')?.addEventListener('click', onCountTotal);
  wireChargeRows();
  wireBillRows();
  wireAwayRows();
}

/* ---------- transfer to owner ---------- */

function transferCard() {
  const rent = Number(settings.monthly_rent ?? 0);
  const waiting = pending();
  const waitingTotal = waiting.reduce((a, b) => a + Number(b.amount), 0);

  const body = charges.length
    ? charges.map((c) => {
        const done = Boolean(c.transferred_at);
        return `<tr>
          <td class="text-nowrap">
            ${esc(monthLabel(c.charge_month))}
            ${c.note ? `<div class="small text-secondary">${esc(c.note)}</div>` : ''}
          </td>
          <td class="text-end text-nowrap text-secondary">${esc(money(c.rent_amount))}</td>
          <td class="text-end text-nowrap text-secondary">${esc(money(c.utilities_amount))}</td>
          <td class="text-end fw-medium text-nowrap">${esc(money(c.total))}</td>
          <td class="text-center">
            <label class="form-check form-check-single mb-0 d-inline-flex"
                   title="${done ? 'Transferred ' + esc(formatShort(c.transferred_at.slice(0, 10))) : 'Not transferred yet'}">
              <input class="form-check-input" type="checkbox" data-paid="${c.id}"
                     ${done ? 'checked' : ''}
                     aria-label="Transferred to owner for ${esc(monthLabel(c.charge_month))}">
            </label>
          </td>
          <td class="text-end">
            <button class="btn btn-sm btn-ghost-danger btn-icon" data-del-charge="${c.id}"
                    aria-label="Delete the ${esc(monthLabel(c.charge_month))} charge">
              <i class="ti ti-trash"></i>
            </button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="text-secondary text-center py-4">
         Nothing counted yet.
       </td></tr>`;

  const owing = charges.filter((c) => !c.transferred_at);
  const owed = owing.reduce((a, c) => a + Number(c.total), 0);

  return `<div class="card mb-3">
    <div class="card-header">
      <h3 class="card-title">Transfer to owner</h3>
      <div class="card-actions d-flex align-items-center gap-2">
        <span class="text-secondary small">Rent ${esc(money(rent))}</span>
        <button class="btn btn-sm btn-ghost-secondary btn-icon" id="edit-rent"
                aria-label="Change the monthly rent">
          <i class="ti ti-pencil"></i>
        </button>
      </div>
    </div>

    <div class="card-body border-bottom">
      ${waiting.length
        ? `<div class="text-secondary small mb-2">
             ${waiting.length} bill${waiting.length === 1 ? '' : 's'} waiting to be counted
           </div>
           <ul class="gm-pending">
             ${waiting.map((b) => `<li>
               <span>${esc(b.name)}</span>
               <span class="text-secondary">
                 ${esc(formatShort(b.period_start))} – ${esc(formatShort(b.period_end))}
               </span>
               <span class="fw-medium">${esc(money(b.amount))}</span>
             </li>`).join('')}
           </ul>
           <div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3">
             <div>
               <span class="text-secondary small">Rent ${esc(money(rent))} + bills ${esc(money(waitingTotal))}</span>
               <div class="h3 mb-0">${esc(money(rent + waitingTotal))}</div>
             </div>
             <button class="btn btn-primary" id="count-total">
               <i class="ti ti-calculator me-1"></i> Count total
             </button>
           </div>`
        : `<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
             <div>
               <div class="text-secondary small">No new bills since the last count</div>
               <div class="h3 mb-0">${esc(money(rent))}</div>
               <div class="text-secondary small">rent only</div>
             </div>
             <button class="btn" id="count-total">
               <i class="ti ti-calculator me-1"></i> Count total
             </button>
           </div>`}
    </div>

    <div class="table-responsive">
      <table class="table table-vcenter card-table">
        <thead>
          <tr>
            <th>Month</th>
            <th class="text-end">Rent</th>
            <th class="text-end">Utilities</th>
            <th class="text-end">Total</th>
            <th class="text-center">Paid</th>
            <th style="width:3rem"></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>

    <div class="card-footer text-secondary small">
      Counting a month takes every bill added since the last count and marks
      them as collected, so the water bill is never charged twice.
      ${owing.length
        ? `<span class="text-watch"> ${owing.length} month${owing.length === 1 ? '' : 's'}
           not yet transferred — ${esc(money(owed))}.</span>`
        : ' Everything recorded has been transferred.'}
    </div>
  </div>`;
}

async function onCountTotal() {
  const rent = Number(settings.monthly_rent ?? 0);
  const waiting = pending();
  const sum = waiting.reduce((a, b) => a + Number(b.amount), 0);

  // Default to this month; rent is collected in the first week for the
  // month ahead, so that is almost always the right answer.
  const guess = today().slice(0, 7);
  const answer = prompt(
    `Which month is this for? (YYYY-MM)\n\n`
    + `Rent ${money(rent)}\n`
    + waiting.map((b) => `${b.name}  ${money(b.amount)}`).join('\n')
    + (waiting.length ? '\n' : '')
    + `Total ${money(rent + sum)}`,
    guess
  );
  if (answer === null) return;

  const month = answer.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return toast('Use the form 2026-10', 'error');
  }

  const btn = document.getElementById('count-total');
  btn.disabled = true;

  try {
    await createCharge(`${month}-01`, null);
    toast(`${monthLabel(month + '-01')} counted — ${money(rent + sum)}`, 'success');
    await load();
  } catch (e) {
    // The unique constraint is the likely one; say so in plain words.
    toast(
      /duplicate|unique/i.test(e.message)
        ? 'That month has already been counted. Delete it first to recount.'
        : e.message,
      'error'
    );
    btn.disabled = false;
  }
}

function wireChargeRows() {
  main.querySelectorAll('[data-paid]').forEach((el) =>
    el.addEventListener('change', async () => {
      try {
        await setTransferred(el.dataset.paid, el.checked, profile.id);
        toast(el.checked ? 'Marked transferred' : 'Marked not transferred', 'success');
        await load();
      } catch (e) {
        el.checked = !el.checked;
        toast(e.message, 'error');
      }
    }));

  main.querySelectorAll('[data-del-charge]').forEach((b) =>
    b.addEventListener('click', async () => {
      const c = charges.find((x) => x.id === b.dataset.delCharge);
      if (!confirm(
        `Delete the ${monthLabel(c.charge_month)} charge?\n\n`
        + 'Its bills go back to waiting, so the next count will pick them up again.'
      )) return;

      try {
        await deleteCharge(c.id);
        toast('Charge deleted', 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

async function onEditRent() {
  const current = Number(settings.monthly_rent ?? 0);
  const answer = prompt('Monthly rent owed to the owner:', String(current));
  if (answer === null) return;

  const value = Number(answer.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value < 0) {
    return toast('Enter a number, like 3800', 'error');
  }

  try {
    await setMonthlyRent(value);
    toast(`Rent set to ${money(value)}`, 'success');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function billsCard() {
  if (!bills.length) {
    return `<div class="card">
      <div class="card-header"><h3 class="card-title">Bills</h3></div>
      <div class="card-body">
        ${emptyState('receipt', 'No bills yet',
          'Add one on the right. The split appears here once it is saved.')}
      </div>
    </div>`;
  }

  const rows = bills.map((b) => {
    const isOpen = openBill === b.id;
    const span = days(b.period_start, b.period_end);

    return `<tr class="gm-bill-row${isOpen ? ' is-open' : ''}" data-bill="${b.id}">
        <td>
          <button type="button" class="btn btn-ghost-secondary btn-icon btn-sm" data-toggle="${b.id}"
                  aria-expanded="${isOpen}" aria-label="Show the split for ${esc(b.name)}">
            <i class="ti ti-chevron-${isOpen ? 'down' : 'right'}"></i>
          </button>
        </td>
        <td class="text-nowrap">
          ${esc(b.name)}
          ${b.charge_id
            ? '<div class="small text-secondary">collected</div>'
            : '<div class="small text-watch">waiting</div>'}
        </td>
        <td class="text-nowrap text-secondary">
          ${esc(formatShort(b.period_start))} – ${esc(formatShort(b.period_end))}
          <div class="small">${span} ${span === 1 ? 'day' : 'days'}</div>
        </td>
        <td class="text-end fw-medium text-nowrap">${esc(money(b.amount))}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-ghost-danger btn-icon"
                  data-del-bill="${b.id}" aria-label="Delete ${esc(b.name)}">
            <i class="ti ti-trash"></i>
          </button>
        </td>
      </tr>
      ${isOpen ? `<tr class="gm-split-row"><td colspan="5" class="p-0">
        <div id="split-${b.id}">${spinner}</div>
      </td></tr>` : ''}`;
  }).join('');

  return `<div class="card">
    <div class="card-header">
      <h3 class="card-title">Bills</h3>
      <div class="card-actions text-secondary small">newest period first</div>
    </div>
    <div class="table-responsive">
      <table class="table table-vcenter card-table">
        <thead>
          <tr>
            <th style="width:2.5rem"></th>
            <th>Bill</th>
            <th>Period</th>
            <th class="text-end">Amount</th>
            <th style="width:3rem"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

function addBillCard() {
  return `<div class="card mb-3">
    <div class="card-header"><h3 class="card-title">Add a bill</h3></div>
    <div class="card-body">
      <form id="bill-form" novalidate>
        <div class="mb-3">
          <label class="form-label required" for="b-name">Bill</label>
          <select id="b-name" class="form-select" required>
            <option value="">Choose…</option>
            ${BILL_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="row">
          <div class="col-6 mb-3">
            <label class="form-label required" for="b-start">From</label>
            <input type="date" id="b-start" class="form-control" required>
          </div>
          <div class="col-6 mb-3">
            <label class="form-label required" for="b-end">To</label>
            <input type="date" id="b-end" class="form-control" required>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label required" for="b-amount">Amount</label>
          <div class="input-group">
            <span class="input-group-text">$</span>
            <input type="number" id="b-amount" class="form-control" step="0.01" min="0"
                   placeholder="0.00" required>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label" for="b-notes">Note</label>
          <input type="text" id="b-notes" class="form-control" placeholder="Optional">
        </div>
        <button type="submit" class="btn btn-primary w-100">
          <i class="ti ti-plus me-1"></i> Add bill
        </button>
      </form>
    </div>
  </div>`;
}

function awayCard() {
  const list = absences.length
    ? absences.map((a) => {
        const n = days(a.start_date, a.end_date);
        const over = a.end_date < today();
        return `<div class="list-group-item${over ? ' opacity-75' : ''}">
          <div class="row align-items-start g-2">
            <div class="col-auto">
              <span class="avatar avatar-xs bg-primary-lt">
                ${esc(initials(a.members.full_name))}
              </span>
            </div>
            <div class="col">
              <div class="d-flex align-items-center gap-2 flex-wrap">
                <span>${esc(a.members.full_name)}</span>
                <span class="badge bg-secondary-lt">${n} ${n === 1 ? 'day' : 'days'}</span>
              </div>
              <div class="text-secondary small">
                ${esc(formatShort(a.start_date))} – ${esc(formatShort(a.end_date))}
              </div>
              <div class="small mt-1">${esc(a.note)}</div>
            </div>
            <div class="col-auto">
              <button type="button" class="btn btn-sm btn-ghost-danger btn-icon"
                      data-del-away="${a.id}" aria-label="Delete this away period">
                <i class="ti ti-trash"></i>
              </button>
            </div>
          </div>
        </div>`;
      }).join('')
    : `<div class="list-group-item text-secondary small">
         Nothing recorded. Away days are skipped when a bill is split.
       </div>`;

  return `<div class="card">
    <div class="card-header">
      <h3 class="card-title">Away periods</h3>
      <div class="card-actions text-secondary small">${absences.length}</div>
    </div>
    <div class="card-body border-bottom">
      <form id="away-form" novalidate>
        <div class="mb-3">
          <label class="form-label required" for="a-member">Yuvak</label>
          <select id="a-member" class="form-select" required>
            <option value="">Choose…</option>
            ${members.map((m) =>
              `<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}
          </select>
        </div>
        <div class="row">
          <div class="col-6 mb-3">
            <label class="form-label required" for="a-start">From</label>
            <input type="date" id="a-start" class="form-control" required>
          </div>
          <div class="col-6 mb-3">
            <label class="form-label required" for="a-end">To</label>
            <input type="date" id="a-end" class="form-control" required>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label required" for="a-note">Where</label>
          <input type="text" id="a-note" class="form-control"
                 placeholder="India until 20 Dec" required>
          <small class="form-hint">Shown on the attendance page for sabhas in this range.</small>
        </div>
        <button type="submit" class="btn w-100">
          <i class="ti ti-plane me-1"></i> Add away period
        </button>
      </form>
    </div>
    <div class="list-group list-group-flush">${list}</div>
  </div>`;
}

/* ---------- the split ---------- */

async function showSplit(billId) {
  const host = document.getElementById(`split-${billId}`);
  if (!host) return;

  try {
    let rows = splitCache.get(billId);
    if (!rows) {
      rows = await billSplit(billId);
      splitCache.set(billId, rows);
    }

    const bill = bills.find((b) => b.id === billId);
    const span = days(bill.period_start, bill.period_end);
    const personDays = rows.reduce((a, r) => a + r.days_present, 0);
    const awayDays = rows.reduce((a, r) => a + r.days_away, 0);
    const perDay = personDays ? Number(bill.amount) / personDays : 0;

    if (!rows.length) {
      host.innerHTML = `<div class="p-3">${emptyState('users',
        'Nobody was living here during this period',
        'Set house start and end dates for each yuvak on the Members page.')}</div>`;
      return;
    }

    host.innerHTML = `
      <div class="p-3 bg-surface-secondary">
        <div class="row g-2 mb-3">
          ${chip('Period', `${span} ${span === 1 ? 'day' : 'days'}`)}
          ${chip('Person-days charged', String(personDays))}
          ${chip('Days away', String(awayDays))}
          ${chip('Rate', `${money(perDay)} per person-day`)}
        </div>

        <div class="table-responsive">
          <table class="table table-sm table-vcenter mb-0">
            <thead>
              <tr>
                <th>Yuvak</th>
                <th class="text-end">Days here</th>
                <th class="text-end">Days away</th>
                <th class="text-end">Share</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td>${esc(r.full_name)}</td>
                <td class="text-end">${r.days_present}</td>
                <td class="text-end ${r.days_away ? 'text-watch' : 'text-secondary'}">
                  ${r.days_away || '—'}
                </td>
                <td class="text-end fw-medium">${esc(money(r.share))}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr class="fw-medium">
                <td>Total</td>
                <td class="text-end">${personDays}</td>
                <td class="text-end">${awayDays || '—'}</td>
                <td class="text-end">${esc(money(
                  rows.reduce((a, r) => a + Number(r.share), 0)
                ))}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="btn-list mt-3">
          <button class="btn btn-sm" data-copy="${billId}">
            <i class="ti ti-copy me-1"></i> Copy as text
          </button>
          <button class="btn btn-sm" data-csv="${billId}">
            <i class="ti ti-download me-1"></i> CSV
          </button>
        </div>
      </div>`;

    host.querySelector('[data-copy]').addEventListener('click', () => copySplit(billId));
    host.querySelector('[data-csv]').addEventListener('click', () => csvSplit(billId));
  } catch (e) {
    showError(host, e.message);
  }
}

function chip(label, value) {
  return `<div class="col-6 col-md-3">
    <div class="p-2 rounded bg-surface">
      <div class="text-secondary small">${esc(label)}</div>
      <div class="fw-medium">${esc(value)}</div>
    </div>
  </div>`;
}

function splitLines(billId) {
  const bill = bills.find((b) => b.id === billId);
  const rows = splitCache.get(billId) ?? [];
  return { bill, rows };
}

async function copySplit(billId) {
  const { bill, rows } = splitLines(billId);
  const text = [
    `${bill.name} — ${formatLong(bill.period_start)} to ${formatLong(bill.period_end)}`,
    `Total ${money(bill.amount)}`,
    '',
    ...rows.map((r) => `${r.full_name}: ${money(r.share)}`
      + (r.days_away ? `  (away ${r.days_away} ${r.days_away === 1 ? 'day' : 'days'})` : ''))
  ].join('\n');

  try {
    await navigator.clipboard.writeText(text);
    toast('Copied — paste it into the group chat', 'success');
  } catch {
    toast('Could not copy. Select the table and copy by hand.', 'error');
  }
}

function csvSplit(billId) {
  const { bill, rows } = splitLines(billId);
  const esc2 = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = [
    ['Bill', 'From', 'To', 'Member', 'Days here', 'Days away', 'Share'].join(','),
    ...rows.map((r) => [
      bill.name, bill.period_start, bill.period_end,
      r.full_name, r.days_present, r.days_away, r.share
    ].map(esc2).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bill.name.toLowerCase().replace(/\s+/g, '-')}-${bill.period_end}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('Downloaded', 'success');
}

/* ---------- events ---------- */

function wireBillRows() {
  main.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      openBill = openBill === b.dataset.toggle ? null : b.dataset.toggle;
      render();
      if (openBill) showSplit(openBill);
    }));

  main.querySelectorAll('[data-del-bill]').forEach((b) =>
    b.addEventListener('click', async () => {
      const bill = bills.find((x) => x.id === b.dataset.delBill);
      if (!confirm(`Delete the ${bill.name} bill for ${formatShort(bill.period_start)} – ${formatShort(bill.period_end)}?`)) return;
      try {
        await deleteBill(bill.id);
        splitCache.delete(bill.id);
        if (openBill === bill.id) openBill = null;
        toast('Bill deleted', 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function wireAwayRows() {
  main.querySelectorAll('[data-del-away]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Delete this away period? Bill splits will change.')) return;
      try {
        await deleteAbsence(b.dataset.delAway);
        splitCache.clear();           // every split may now be different
        toast('Away period deleted', 'success');
        await load();
      } catch (e) { toast(e.message, 'error'); }
    }));
}

function invalid(field, msg) {
  field.classList.add('is-invalid');
  field.focus();
  field.addEventListener('input', () => field.classList.remove('is-invalid'), { once: true });
  toast(msg, 'error');
}

async function onAddBill(ev) {
  ev.preventDefault();

  const name = document.getElementById('b-name');
  const start = document.getElementById('b-start');
  const end = document.getElementById('b-end');
  const amount = document.getElementById('b-amount');

  if (!name.value) return invalid(name, 'Choose which bill this is.');
  if (!start.value) return invalid(start, 'Pick the start of the period.');
  if (!end.value) return invalid(end, 'Pick the end of the period.');
  if (end.value < start.value) return invalid(end, 'The end date is before the start date.');
  if (amount.value === '' || Number(amount.value) < 0) {
    return invalid(amount, 'Enter the amount.');
  }

  try {
    await createBill(profile.mandirId, {
      name: name.value,
      period_start: start.value,
      period_end: end.value,
      amount: Number(amount.value),
      notes: document.getElementById('b-notes').value.trim() || null
    }, profile.id);

    toast('Bill added', 'success');
    ev.target.reset();
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onAddAway(ev) {
  ev.preventDefault();

  const member = document.getElementById('a-member');
  const start = document.getElementById('a-start');
  const end = document.getElementById('a-end');
  const note = document.getElementById('a-note');

  if (!member.value) return invalid(member, 'Choose a yuvak.');
  if (!start.value) return invalid(start, 'Pick the first day away.');
  if (!end.value) return invalid(end, 'Pick the last day away.');
  if (end.value < start.value) return invalid(end, 'The end date is before the start date.');
  if (!note.value.trim()) return invalid(note, 'Say where he is going.');

  try {
    await createAbsence({
      member_id: member.value,
      start_date: start.value,
      end_date: end.value,
      note: note.value.trim()
    }, profile.id);

    splitCache.clear();
    toast('Away period added', 'success');
    ev.target.reset();
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}
