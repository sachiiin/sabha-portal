// My account — change password. Reachable by anyone signed in with a real
// password (sevak, admin, or platform admin); a PIN session has no
// password to change, so it never lands here.

import { getSession, getProfile, changePassword } from '../auth.js';
import {
  renderChrome, renderPlatformChrome, applyTheme, pageHeader, esc, toast, showError
} from '../lib/ui.js';

applyTheme();

const main = document.getElementById('main');
let profile, homeHref;

init();

async function init() {
  try {
    const session = await getSession();
    if (!session) { location.href = 'login.html'; return; }

    profile = await getProfile();
    if (!profile) { location.href = 'login.html?e=nolink'; return; }
    if (profile.role === 'viewer') { location.href = 'index.html'; return; }

    if (profile.platformAdmin) {
      homeHref = 'platform-dashboard.html';
      renderPlatformChrome(profile, 'account');
    } else {
      homeHref = 'index.html';
      renderChrome(profile, 'account');
    }

    render();
  } catch (e) {
    showError(main, e.message);
  }
}

function render() {
  main.innerHTML = `
    ${pageHeader('My account', esc(profile.name))}

    <div class="row justify-content-center">
      <div class="col-12 col-lg-6">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Change password</h3></div>
          <div class="card-body">
            <form id="password-form" novalidate>
              <div class="mb-3">
                <label class="form-label" for="password">New password</label>
                <input type="password" id="password" class="form-control"
                       autocomplete="new-password" minlength="6" required>
                <small class="form-hint">At least 6 characters.</small>
              </div>
              <div class="mb-3">
                <label class="form-label" for="password2">Confirm</label>
                <input type="password" id="password2" class="form-control"
                       autocomplete="new-password" required>
              </div>
              <div class="btn-list">
                <button type="submit" class="btn btn-primary">
                  <i class="ti ti-lock me-1"></i> Save password
                </button>
                <a href="${homeHref}" class="btn">Back</a>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('password-form').addEventListener('submit', onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const a = document.getElementById('password');
  const b = document.getElementById('password2');

  if (a.value.length < 6) return toast('The password needs at least 6 characters.', 'error');
  if (a.value !== b.value) return toast('The two passwords do not match.', 'error');

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await changePassword(a.value);
    a.value = '';
    b.value = '';
    toast('Password changed', 'success');
  } catch (ex) {
    toast(ex.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
