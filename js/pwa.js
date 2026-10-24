// Registers the service worker, which is what makes the portal
// installable. Kept out of ui.js so the login page gets it too.
//
// Nothing here is load-bearing: if registration fails — an old browser,
// a page opened over file://, a locked-down iOS build — the portal works
// exactly as it did before, just without the install prompt.

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // A new deploy should not wait for every tab to close. Tell the
      // waiting worker to take over, then reload once it does.
      if (reg.waiting) reg.waiting.postMessage('skip-waiting');

      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        fresh?.addEventListener('statechange', () => {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
            fresh.postMessage('skip-waiting');
          }
        });
      });
    }).catch(() => {});

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}
