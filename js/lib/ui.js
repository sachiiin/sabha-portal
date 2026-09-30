// Shared UI: navbar, page header, toasts, escaping.
// Markup follows Tabler's component classes.

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/* ---------- theme ---------- */

const THEME_KEY = 'gm-theme';

export function applyTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const dark = saved
    ? saved === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  return dark;
}

function toggleTheme() {
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-bs-theme', next);
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  paintThemeIcon();
}

function paintThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  btn.innerHTML = `<i class="ti ti-${dark ? 'sun' : 'moon'} fs-3"></i>`;
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

/* ---------- chrome ---------- */

const NAV = [
  { href: 'index.html',      label: 'Dashboard',  icon: 'chart-pie',  key: 'dashboard' },
  { href: 'attendance.html', label: 'Attendance', icon: 'checkbox',   key: 'attendance' },
  { href: 'history.html',    label: 'History',    icon: 'calendar-stats', key: 'history' },
  { href: 'members.html',    label: 'Members',    icon: 'users',      key: 'members' }
];

export function renderChrome(profile, active) {
  const host = document.getElementById('chrome');
  if (!host) return;

  const initials = profile.name
    .split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  host.innerHTML = `
    <header class="navbar navbar-expand-md d-print-none">
      <div class="container-xl">
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse"
                data-bs-target="#nav-menu" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>

        <div class="navbar-brand navbar-brand-autodark d-flex align-items-center gap-2 pe-0 pe-md-3">
          <span class="gm-mark">ઘ</span>
          <span class="gm-wordmark">
            ${esc(profile.mandirName)}<small>${esc(profile.gharName)}</small>
          </span>
        </div>

        <div class="navbar-nav flex-row order-md-last align-items-center">
          <button class="btn btn-ghost-secondary btn-icon me-1" id="theme-toggle"></button>

          <div class="nav-item dropdown">
            <a href="#" class="nav-link d-flex lh-1 p-0 px-2" data-bs-toggle="dropdown"
               aria-label="Open account menu" aria-expanded="false">
              <span class="avatar avatar-sm bg-primary-lt">${esc(initials)}</span>
              <div class="d-none d-xl-block ps-2">
                <div>${esc(profile.name)}</div>
                <div class="mt-1 small text-secondary text-capitalize">${esc(profile.role)}</div>
              </div>
            </a>
            <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
              <span class="dropdown-header">${esc(profile.name)}</span>
              <span class="dropdown-item-text small text-secondary pb-2">
                ${esc(profile.gharName)} &middot; ${esc(profile.role)}
              </span>
              <div class="dropdown-divider"></div>
              <a href="#" class="dropdown-item" id="signout">
                <i class="ti ti-logout me-2"></i> Sign out
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>

    <header class="navbar-expand-md">
      <div class="collapse navbar-collapse" id="nav-menu">
        <div class="navbar">
          <div class="container-xl">
            <ul class="navbar-nav">
              ${NAV.map((n) => `
                <li class="nav-item${n.key === active ? ' active' : ''}">
                  <a class="nav-link" href="${n.href}">
                    <span class="nav-link-icon d-md-none d-lg-inline-block">
                      <i class="ti ti-${n.icon} fs-2"></i>
                    </span>
                    <span class="nav-link-title">${n.label}</span>
                  </a>
                </li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </header>`;

  paintThemeIcon();
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('signout').addEventListener('click', async (e) => {
    e.preventDefault();
    const { signOut } = await import('../auth.js');
    signOut();
  });
}

// Page title block, placed at the top of #main by each page.
export function pageHeader(title, subtitle, actions = '') {
  return `<div class="page-header d-print-none mb-3">
    <div class="row g-2 align-items-center">
      <div class="col">
        <h2 class="page-title">${esc(title)}</h2>
        ${subtitle ? `<div class="text-secondary mt-1">${subtitle}</div>` : ''}
      </div>
      ${actions ? `<div class="col-auto ms-auto d-print-none"><div class="btn-list">${actions}</div></div>` : ''}
    </div>
  </div>`;
}

/* ---------- toasts ---------- */

export function toast(message, kind = 'info') {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    host.style.zIndex = '1080';
    document.body.appendChild(host);
  }

  const icon = { success: 'circle-check', error: 'alert-circle', info: 'info-circle' }[kind];
  const colour = { success: 'text-good', error: 'text-low', info: 'text-secondary' }[kind];

  const el = document.createElement('div');
  el.className = 'toast show align-items-center';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="d-flex align-items-center gap-2 p-2 px-3">
    <i class="ti ti-${icon} ${colour} fs-3"></i>
    <div class="flex-fill small">${esc(message)}</div>
    <button type="button" class="btn-close ms-2" data-bs-dismiss="toast" aria-label="Close"></button>
  </div>`;

  host.appendChild(el);
  el.querySelector('.btn-close').addEventListener('click', () => el.remove());
  setTimeout(() => el.remove(), 4000);
}

/* ---------- states ---------- */

export function showError(container, message) {
  container.innerHTML = `<div class="empty">
    <div class="empty-icon"><i class="ti ti-alert-triangle fs-1 text-low"></i></div>
    <p class="empty-title">Something went wrong</p>
    <p class="empty-subtitle text-secondary">${esc(message)}</p>
  </div>`;
}

export function emptyState(icon, title, subtitle = '', action = '') {
  return `<div class="empty">
    <div class="empty-icon"><i class="ti ti-${icon} fs-1 text-secondary"></i></div>
    <p class="empty-title">${esc(title)}</p>
    ${subtitle ? `<p class="empty-subtitle text-secondary">${esc(subtitle)}</p>` : ''}
    ${action ? `<div class="empty-action">${action}</div>` : ''}
  </div>`;
}

export const spinner = `<div class="text-center py-5 text-secondary">
  <span class="spinner-border spinner-border-sm me-2"></span>Loading
</div>`;
