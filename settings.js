// Settings only need to be written to storage: every tab's content script
// listens to chrome.storage.onChanged and applies them live.
const DEFAULTS = self.PHYSICS_DEFAULTS;

function showSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    const slider = document.getElementById(key);
    const valueDisplay = document.getElementById(`${key}Value`);
    if (!slider || !valueDisplay) continue;
    slider.value = value;
    valueDisplay.textContent = value;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(DEFAULTS, (settings) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading settings:', chrome.runtime.lastError);
      return;
    }
    showSettings(settings);
  });

  for (const slider of document.querySelectorAll('.slider')) {
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      document.getElementById(`${e.target.id}Value`).textContent = value;
      chrome.storage.local.set({ [e.target.id]: value }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving settings:', chrome.runtime.lastError);
        }
      });
    });
  }

  document.getElementById('resetSettings').addEventListener('click', () => {
    if (!confirm('Are you sure you want to reset all settings to their default values?')) return;
    showSettings(DEFAULTS);
    chrome.storage.local.set(DEFAULTS, () => {
      if (chrome.runtime.lastError) {
        console.error('Error resetting settings:', chrome.runtime.lastError);
        alert('Failed to reset settings. Please try again.');
      }
    });
  });
});
