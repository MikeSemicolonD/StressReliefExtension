// Settings only need to be written to storage: every tab's content script
// listens to chrome.storage.onChanged and applies them live.
const DEFAULTS = self.PHYSICS_DEFAULTS;

// Units as shown in the value chip and as read by screen readers
const SPOKEN_UNITS = { px: 'pixels', ms: 'milliseconds' };

// Shows a slider's value (with its unit, if any), gives screen readers the
// same value with the unit spelled out, and fills the track up to the thumb
// (a CSS gradient driven by --fill).
function render(slider) {
  const unit = slider.dataset.unit;
  document.getElementById(`${slider.id}Value`).textContent =
    unit ? `${slider.value} ${unit}` : slider.value;
  slider.setAttribute('aria-valuetext',
    unit ? `${slider.value} ${SPOKEN_UNITS[unit] ?? unit}` : slider.value);
  const fraction = (slider.value - slider.min) / (slider.max - slider.min);
  slider.style.setProperty('--fill', `${fraction * 100}%`);
}

// Announces a message through the page's status region
function announce(message) {
  const status = document.getElementById('status');
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
}

function showSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    const slider = document.getElementById(key);
    if (!slider) continue;
    slider.value = value;
    render(slider);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  for (const slider of document.querySelectorAll('.slider')) render(slider);

  chrome.storage.local.get(DEFAULTS, (settings) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading settings:', chrome.runtime.lastError);
      return;
    }
    showSettings(settings);
  });

  for (const slider of document.querySelectorAll('.slider')) {
    slider.addEventListener('input', () => {
      render(slider);
      chrome.storage.local.set({ [slider.id]: parseFloat(slider.value) }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving settings:', chrome.runtime.lastError);
        }
      });
    });
  }

  document.getElementById('resetSettings').addEventListener('click', () => {
    if (!confirm('Reset all settings to their defaults?')) return;
    showSettings(DEFAULTS);
    chrome.storage.local.set(DEFAULTS, () => {
      if (chrome.runtime.lastError) {
        console.error('Error resetting settings:', chrome.runtime.lastError);
        alert('Couldn\'t reset the settings. Try again.');
        return;
      }
      announce('Settings reset to defaults.');
    });
  });
});
