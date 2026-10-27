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

  // Charts bake their colours in at render time, so they need to hear
  // about this and redraw themselves.
  document.dispatchEvent(new CustomEvent('gm:theme', { detail: { theme: next } }));
}

function paintThemeIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  btn.innerHTML = `<i class="ti ti-${dark ? 'sun' : 'moon'} fs-3"></i>`;
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

/* ---------- chrome ---------- */

// `roles` lists who sees the link. A PIN session ('viewer') gets the two
// read-only pages; hiding the rest is courtesy, since row-level security
// is what actually stops a viewer writing.
const NAV = [
  { href: 'index.html',      label: 'Dashboard',  icon: 'chart-pie',      key: 'dashboard',  roles: ['admin', 'sevak', 'viewer'] },
  { href: 'attendance.html', label: 'Attendance', icon: 'checkbox',       key: 'attendance', roles: ['admin', 'sevak'] },
  { href: 'history.html',    label: 'History',    icon: 'calendar-stats', key: 'history',    roles: ['admin', 'sevak', 'viewer'] },
  // Viewers get the roster, read-only. Who lives in the house is not a
  // secret from the house; adding and editing stays admin-only, enforced
  // by the restrictive policies in 06-pin-login.sql, not by this list.
  { href: 'members.html',    label: 'Members',    icon: 'users',          key: 'members',    roles: ['admin', 'sevak', 'viewer'] },
  { href: 'utilities.html',  label: 'Utility bills', icon: 'receipt',     key: 'utilities',  roles: ['admin'] },
  { href: 'settings.html',   label: 'Settings',   icon: 'settings',       key: 'settings',   roles: ['admin'] },
  // Not a role — every mandir has its own admin. This is the one person
  // (or few) reviewing every mandir's registration, so it is filtered on
  // profile.platformAdmin below rather than added to any role's list.
  { href: 'admin.html',      label: 'All Houses', icon: 'building-community', key: 'admin', roles: [], platformOnly: true }
];

const ROLE_LABEL = { admin: 'Admin', sevak: 'Sevak', viewer: 'PIN access' };

// The mandir mark: a shikhara (temple spire) over an arched doorway.
// Inline rather than an <img> so the body inherits the chip's colour and
// stays crisp at any size. The kalash finial uses --gm-accent rather than
// a fixed hex, because this chip's own background is --tblr-primary and
// that swaps with --gm-accent between light and dark mode — a hardcoded
// finial colour would vanish into the chip in one of the two themes.
// The matching favicon.svg carries its own fixed navy tile.
export const MARK_SVG = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
  <circle cx="16" cy="6" r="1.5" fill="var(--gm-accent)"/>
  <path fill="currentColor" d="M16 7.5 C14.3 7.5 13 10 13.3 13 C13.5 15.3 14 17 14.6 18.6 L17.4 18.6 C18 17 18.5 15.3 18.7 13 C19 10 17.7 7.5 16 7.5 Z"/>
  <path fill="currentColor" fill-rule="evenodd" d="M7.5 18.4 H24.5 V27 a1.5 1.5 0 0 1 -1.5 1.5 H9 a1.5 1.5 0 0 1 -1.5 -1.5 Z M13 28.5 v-5 a3 3 0 0 1 6 0 v5 Z"/>
</svg>`;

export function renderChrome(profile, active) {
  const aside = document.getElementById('sidebar');
  const top = document.getElementById('topbar');
  if (!aside || !top) return;

  const nav = NAV.filter((n) => n.roles.includes(profile.role) || (n.platformOnly && profile.platformAdmin));
  const roleLabel = ROLE_LABEL[profile.role] ?? profile.role;
  const current = nav.find((n) => n.key === active);

  // The static <title> in each page's HTML is just a generic fallback for
  // the instant before this runs — once a profile loads, the tab should
  // say whose gharmandir it is, not every house's the same.
  if (current) document.title = `${current.label} · ${profile.gharName}`;

  const initials = profile.name
    .split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  // No Bootstrap collapse here. On a phone this is an off-canvas drawer
  // that slides over the page; Tabler's own collapse pushes the content
  // down instead, which is what made the mobile menu unusable.
  aside.innerHTML = `
    <aside class="navbar navbar-vertical gm-sidebar d-print-none">
      <div class="container-fluid">
        <div class="gm-brand">
          <span class="gm-mark">${MARK_SVG}</span>
          <span class="gm-wordmark">
            ${esc(profile.gharName)}<small>${esc(profile.mandirName)}</small>
          </span>
          <button type="button" class="gm-collapse" id="sidebar-collapse"
                  aria-label="Collapse the sidebar" aria-expanded="true">
            <i class="ti ti-chevron-left"></i>
          </button>
          <button type="button" class="gm-navclose" id="nav-close" aria-label="Close the menu">
            <i class="ti ti-x"></i>
          </button>
        </div>

        <div class="gm-sidebar__label">Pages</div>
        <ul class="navbar-nav">
          ${nav.map((n) => `
            <li class="nav-item${n.key === active ? ' active' : ''}">
              <a class="nav-link" href="${n.href}"${n.key === active ? ' aria-current="page"' : ''}>
                <span class="nav-link-icon"><i class="ti ti-${n.icon}"></i></span>
                <span class="nav-link-title">${n.label}</span>
              </a>
            </li>`).join('')}
        </ul>
      </div>
    </aside>`;

  top.innerHTML = `
    <header class="navbar navbar-expand-md gm-topbar d-print-none">
      <div class="container-xl">
        <button class="gm-hamburger" id="nav-toggle" aria-label="Open the menu"
                aria-expanded="false" aria-controls="sidebar">
          <i class="ti ti-menu-2"></i>
        </button>
        <div class="gm-topbar__title">${esc(current?.label ?? '')}</div>

        <div class="navbar-nav flex-row order-md-last align-items-center ms-auto">
          <button class="btn btn-ghost-secondary btn-icon me-1 d-none" id="pwa-install"
                  aria-label="Install this app">
            <i class="ti ti-download"></i>
          </button>
          <button class="btn btn-ghost-secondary btn-icon me-1" id="theme-toggle"></button>

          <div class="nav-item dropdown">
            <a href="#" class="nav-link d-flex lh-1 p-0 px-2" data-bs-toggle="dropdown"
               aria-label="Open account menu" aria-expanded="false">
              <span class="avatar avatar-sm bg-primary-lt">${esc(initials)}</span>
              <div class="d-none d-xl-block ps-2">
                <div>${esc(profile.name)}</div>
                <div class="mt-1 small text-secondary">${esc(roleLabel)}</div>
              </div>
            </a>
            <div class="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
              <span class="dropdown-header">${esc(profile.name)}</span>
              <span class="dropdown-item-text small text-secondary pb-2">
                ${esc(profile.gharName)} &middot; ${esc(roleLabel)}
              </span>
              <div class="dropdown-divider"></div>
              <a href="#" class="dropdown-item" id="signout">
                <i class="ti ti-logout me-2"></i> Sign out
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>`;

  paintThemeIcon();
  applyMini(readMini());
  wireDrawer();
  initInstall();

  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  document.getElementById('sidebar-collapse').addEventListener('click', () => {
    applyMini(!readMini(), true);
  });
  document.getElementById('signout').addEventListener('click', async (e) => {
    e.preventDefault();
    const { signOut } = await import('../auth.js');
    signOut();
  });
}

/* ---------- mobile drawer ---------- */

function setDrawer(open) {
  document.body.classList.toggle('gm-nav-open', open);
  document.getElementById('nav-toggle')?.setAttribute('aria-expanded', String(open));
  // Stop the page scrolling behind the drawer.
  document.body.style.overflow = open ? 'hidden' : '';
}

function wireDrawer() {
  let backdrop = document.querySelector('.gm-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'gm-backdrop';
    document.body.appendChild(backdrop);
  }

  document.getElementById('nav-toggle')?.addEventListener('click', () => setDrawer(true));
  document.getElementById('nav-close')?.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setDrawer(false);
  });

  // Returning to a wide screen should never leave the drawer state stuck.
  window.matchMedia('(min-width: 992px)').addEventListener('change', (e) => {
    if (e.matches) setDrawer(false);
  });
}

/* ---------- install prompt ---------- */

let installEvent = null;

function initInstall() {
  const btn = document.getElementById('pwa-install');
  if (!btn) return;

  if (installEvent) btn.classList.remove('d-none');

  btn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    btn.classList.add('d-none');
  });
}

// Chrome fires this before the chrome-provided install UI; holding onto it
// lets the portal offer its own button instead.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  document.getElementById('pwa-install')?.classList.remove('d-none');
});

window.addEventListener('appinstalled', () => {
  installEvent = null;
  document.getElementById('pwa-install')?.classList.add('d-none');
});

/* ---------- mini sidebar ---------- */

const MINI_KEY = 'gm-sidebar-mini';

function readMini() {
  try { return localStorage.getItem(MINI_KEY) === '1'; } catch { return false; }
}

// Collapsing is a class on <body>, so the sidebar width and the page
// offset move together and nothing has to measure anything.
function applyMini(on, persist = false) {
  document.body.classList.toggle('gm-mini', on);

  const btn = document.getElementById('sidebar-collapse');
  if (btn) {
    btn.setAttribute('aria-expanded', String(!on));
    btn.setAttribute('aria-label', on ? 'Expand the sidebar' : 'Collapse the sidebar');
    btn.innerHTML = `<i class="ti ti-chevron-${on ? 'right' : 'left'}"></i>`;
  }

  if (persist) {
    try { localStorage.setItem(MINI_KEY, on ? '1' : '0'); } catch {}
  }

  // Charts measure their container, so they need to re-fit once the
  // width transition has finished.
  setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
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

/* ---------- sharing ---------- */

// How the house opens a message. Kept as one constant so the attendance
// share and the utility bill messages always greet the same way.
export const GREETING = 'Jay Swaminarayan Das na Das Banavshoji 🙏';

/* ---------- attendance status ---------- */

// One definition of P/L/E/A, used by every page so the letters, colours
// and wording never drift apart.
export const STATUS = {
  present: { letter: 'P', label: 'Present', note: '' },
  late:    { letter: 'L', label: 'Late',    note: 'counts as attended' },
  excused: { letter: 'E', label: 'Excused', note: 'told us beforehand' },
  absent:  { letter: 'A', label: 'Absent',  note: '' }
};

export const STATUS_ORDER = ['present', 'late', 'excused', 'absent'];

export function statusDot(status, title = '') {
  const t = title ? ` title="${esc(title)}"` : '';
  const s = STATUS[status];
  if (!s) return `<span class="gm-dot gm-dot--none"${t}>–</span>`;
  return `<span class="gm-dot gm-dot--${status}"${t}>${s.letter}</span>`;
}

// `inline` lays the four out in a row for a card footer; otherwise they
// stack, which reads better in a narrow sidebar.
export function statusLegend({ inline = true, notes = true } = {}) {
  const items = STATUS_ORDER.map((k) => {
    const s = STATUS[k];
    return `<span class="gm-legend__item">
      ${statusDot(k)}
      <span class="gm-legend__text">
        ${s.label}${notes && s.note ? ` <span class="text-secondary">— ${s.note}</span>` : ''}
      </span>
    </span>`;
  }).join('');

  return `<div class="gm-legend${inline ? ' gm-legend--inline' : ''}">${items}</div>`;
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

  const dismiss = () => {
    el.classList.add('gm-toast-out');
    setTimeout(() => el.remove(), 160);
  };

  host.appendChild(el);
  el.querySelector('.btn-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 4000);
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
