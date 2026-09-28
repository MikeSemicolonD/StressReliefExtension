// The on-page "Restore page" button shown while physics is on, loaded as a
// content script before content.js (which decides when to show it and what
// clicking does). A visible way out: Esc and the toolbar icon aren't
// discoverable, least of all when a shake turned physics on by accident.
//
// Rendered in a shadow root so page CSS can't restyle it, which is also why
// its CSS lives here as a string: a separate file loaded into the shadow root
// would have to be web-accessible, letting any site detect the extension.
// It sits above the physics canvas (same z-index, later in the DOM) and is
// never a throwable piece. The first time, a note under it explains what
// happened.
(() => {
  if (globalThis.PhysicsRestoreButton) return;

  const CSS = `
    :host { all: initial; }
    .wrap {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    button {
      all: initial;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font: 600 15px/1.2 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: #000;
      background: #f2665e;
      border: 2.5px solid #000;
      border-radius: 10px;
      box-shadow: 3px 3px 0 #000;
      cursor: pointer;
    }
    button:hover { background: #e24f47; }
    button:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #000; }
    button:focus-visible { outline: 3px solid #2f6fe4; outline-offset: 3px; }
    kbd {
      padding: 0 5px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.4;
      background: #fff;
      border: 2px solid #000;
      border-radius: 4px;
    }
    .note {
      box-sizing: border-box;
      max-width: 270px;
      margin: 0;
      padding: 10px 12px;
      font-size: 14px;
      line-height: 1.45;
      color: #2b2b35;
      background: #fff1b8;
      border: 2.5px solid #000;
      border-radius: 6px;
      box-shadow: 3px 3px 0 #000;
    }
    /* Announced by screen readers, not shown */
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `;

  let host = null;

  // Shows the button (if it isn't already showing); onRestore runs on click
  function show(onRestore) {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-physics-restore', '');
    // In the extension's language rather than the page's (lang also picks
    // the right glyphs for CJK text). In right-to-left languages it sits in
    // the top-left corner, the mirror image of top-right.
    const dir = chrome.i18n.getMessage('@@bidi_dir');
    host.lang = chrome.i18n.getMessage('locale').replace('_', '-');
    host.dir = dir;
    host.style.cssText = `all: initial; direction: ${dir}; position: fixed; top: 16px; ` +
      'inset-inline-end: 16px; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    // Named by its text alone ("Restore page"): the key hint is visual, and
    // the shortcut is declared for screen readers with aria-keyshortcuts
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-keyshortcuts', 'Escape');
    const key = document.createElement('kbd');
    key.setAttribute('aria-hidden', 'true');
    key.textContent = chrome.i18n.getMessage('escKey');
    button.append(chrome.i18n.getMessage('restorePage'), key);
    button.addEventListener('click', onRestore);
    // A live region, in place (empty) before its text is set so it's announced
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.className = 'visually-hidden';
    wrap.append(button, status);
    root.append(style, wrap);
    document.documentElement.appendChild(host);

    announce(status);
  }

  // While physics is on, the page's content is hidden from screen readers,
  // so every time it starts they hear why and how to undo it. The first time,
  // the message is also shown as a note explaining what happened.
  function announce(status) {
    chrome.storage.local.get({ restoreHintSeen: false }, ({ restoreHintSeen }) => {
      if (!status.isConnected) return;
      if (chrome.runtime.lastError || restoreHintSeen) {
        status.textContent = chrome.i18n.getMessage('physicsOnStatus');
        return;
      }
      status.className = 'note';
      status.textContent = chrome.i18n.getMessage('physicsOnNote');
      chrome.storage.local.set({ restoreHintSeen: true });
    });
  }

  function hide() {
    host?.remove();
    host = null;
  }

  globalThis.PhysicsRestoreButton = { show, hide };
})();
