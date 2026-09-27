const CONTENT_FILES = ['defaults.js', 'lib.js', 'restore-button.js', 'matter.min.js', 'content.js'];

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePhysics' });
  } catch (e) {
    // No content script in this tab -- it was open before the extension was
    // installed or reloaded. Inject it now (activeTab grants access) and retry.
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      await chrome.tabs.sendMessage(tab.id, { action: 'togglePhysics' });
    } catch (err) {
      // Restricted page (chrome://, the Web Store, PDF viewer, ...)
      console.debug('Physics unavailable on this page:', err);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === 'physicsStateChanged' && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: request.isEnabled ? 'ON' : '' });
  }
});

// A navigation wipes the page (and its physics), so clear the badge with it
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#d32f2f' });
});
