// Settings — admin only. House PIN management and the sabha schedule anchor.

import { requireAuth, isAdmin } from '../auth.js';
import {
  renderChrome, applyTheme, pageHeader, esc, toast, showError, spinner
} from '../lib/ui.js';
import {
  getHouseSettings, setHousePin, clearHousePin, revokePinSessions, countPinSessions
} from '../api/settings.js';
import { formatLong } from '../lib/dates.js';

applyTheme();

const main = document.getElementById('main');
let profile, settings, sessions;

init();

async function init() {
  try {
    profile = await requireAuth({ write: true });

    if (!isAdmin(profile)) {
      location.href = 'index.html?e=readonly';
      return;
    }

    renderChrome(profile, 'settings');
    await load();
  } catch (e) {
    showError(main, e.message);
  }
}

async function load() {
  main.innerHTML = spinner;
  [settings, sessions] = await Promise.all([
    getHouseSettings(profile.mandirId),
    countPinSessions(profile.mandirId)
  ]);
  render();
}

function render() {
  const pinOn = Boolean(settings.pin_set_at);

  main.innerHTML = `
    ${pageHeader('Settings', esc(profile.gharName))}

    <div class="row row-cards">
      <div class="col-12 col-lg-7">

        <div class="card mb-3">
          <div class="card-header">
            <h3 class="card-title">House PIN</h3>
            <div class="card-actions">
              <span class="badge ${pinOn ? 'bg-success-lt' : 'bg-secondary-lt'}">
                ${pinOn ? 'On' : 'Off'}
              </span>
            </div>
          </div>
          <div class="card-body">
            <p class="text-secondary">
              Anyone with your ghar name and this PIN can open the dashboard and
              history. They cannot record attendance or change the roster.
            </p>

            <div class="datagrid mb-3">
              <div class="datagrid-item">
                <div class="datagrid-title">Ghar name</div>
                <div class="datagrid-content">${esc(profile.gharName)}</div>
              </div>
              ${pinOn
                ? `<div class="datagrid-item">
                     <div class="datagrid-title">Last changed</div>
                     <div class="datagrid-content">${esc(formatLong(settings.pin_set_at.slice(0, 10)))}</div>
                   </div>
                   <div class="datagrid-item">
                     <div class="datagrid-title">Active PIN sessions</div>
                     <div class="datagrid-content">${sessions}</div>
                   </div>`
                : ''}
            </div>

            <form id="pin-form" novalidate>
              <div class="mb-3">
                <label class="form-label" for="pin">
                  ${pinOn ? 'New PIN' : 'Set a PIN'}
                </label>
                <input type="text" id="pin" class="form-control" autocomplete="off"
                       inputmode="numeric" placeholder="At least 4 characters">
                <small class="form-hint">
                  Six digits is plenty. Share it with the sevako along with your ghar
                  name, "${esc(profile.gharName)}" — signing in with the PIN takes
                  both, and this page cannot show the PIN to you again.
                </small>
              </div>
              <div class="mb-3">
                <label class="form-label" for="pin2">Confirm</label>
                <input type="text" id="pin2" class="form-control" autocomplete="off"
                       inputmode="numeric">
              </div>
              <div class="btn-list">
                <button type="submit" class="btn btn-primary">
                  <i class="ti ti-key me-1"></i> ${pinOn ? 'Change PIN' : 'Set PIN'}
                </button>
                ${pinOn ? `
                  <button type="button" class="btn" id="revoke">
                    <i class="ti ti-refresh me-1"></i> Sign out PIN users
                  </button>
                  <button type="button" class="btn btn-ghost-danger ms-auto" id="clear">
                    <i class="ti ti-lock-off me-1"></i> Turn off
                  </button>` : ''}
              </div>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Sabha schedule</h3></div>
          <div class="card-body">
            <div class="datagrid">
              <div class="datagrid-item">
                <div class="datagrid-title">Sunday</div>
                <div class="datagrid-content">Every week</div>
              </div>
              <div class="datagrid-item">
                <div class="datagrid-title">Thursday</div>
                <div class="datagrid-content">
                  Every second week from ${esc(formatLong(settings.thursday_anchor))}
                </div>
              </div>
            </div>
            <p class="text-secondary small mt-3 mb-0">
              A sabha moved to another day is recorded from the attendance page —
              pick the date and say which series it belongs to.
            </p>
          </div>
        </div>

      </div>

      <div class="col-12 col-lg-5">
        <div class="card">
          <div class="card-header"><h3 class="card-title">How PIN access works</h3></div>
          <div class="card-body text-secondary">
            <p>
              Signing in with the PIN takes the ghar name too, since this portal can
              serve more than one gharmandir. The PIN itself is stored as a hash, so
              nobody — including you — can read it back out of the database. If it
              is forgotten, set a new one.
            </p>
            <p>
              <strong class="text-body">Sign out PIN users</strong> ends every current
              PIN session but keeps the same PIN, so everyone simply enters it again.
            </p>
            <p class="mb-0">
              <strong class="text-body">Turn off</strong> disables PIN sign-in entirely
              and ends those sessions. Sevak accounts are unaffected.
            </p>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('pin-form').addEventListener('submit', onSetPin);
  document.getElementById('clear')?.addEventListener('click', onClear);
  document.getElementById('revoke')?.addEventListener('click', onRevoke);
}

async function onSetPin(ev) {
  ev.preventDefault();

  const a = document.getElementById('pin');
  const b = document.getElementById('pin2');
  const pin = a.value.trim();

  const invalid = (field, msg) => {
    field.classList.add('is-invalid');
    field.focus();
    field.addEventListener('input', () => field.classList.remove('is-invalid'), { once: true });
    toast(msg, 'error');
  };

  if (pin.length < 4) return invalid(a, 'The PIN needs at least 4 characters.');
  if (pin !== b.value.trim()) return invalid(b, 'The two PINs do not match.');

  try {
    await setHousePin(pin);
    toast(`PIN saved. Tell the sevako the new number, along with "${profile.gharName}".`, 'success');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onClear() {
  if (!confirm('Turn off PIN sign-in? Everyone using the PIN loses access.')) return;
  try {
    await clearHousePin();
    toast('PIN sign-in turned off', 'success');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function onRevoke() {
  if (!confirm('Sign out everyone using the PIN? They can sign back in with the same PIN.')) return;
  try {
    const n = await revokePinSessions();
    toast(n === 1 ? '1 session signed out' : `${n} sessions signed out`, 'success');
    await load();
  } catch (e) {
    toast(e.message, 'error');
  }
}
