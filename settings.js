// Settings only need to be written to storage: every tab's content script
// listens to chrome.storage.onChanged and applies them live.
const DEFAULTS = self.PHYSICS_DEFAULTS;

// Units as read by screen readers
const SPOKEN_UNITS = { px: 'pixels', ms: 'milliseconds' };

// Each setting has a slider and a number field (id + "Value") kept in sync
function fieldFor(slider) {
  return document.getElementById(`${slider.id}Value`);
}

// Shows a slider's value in its number field (unless that's where it's being
// typed), gives screen readers the value with its unit spelled out, and
// fills the track up to the thumb (a CSS gradient driven by --fill).
function render(slider, { skipField = false } = {}) {
  if (!skipField) fieldFor(slider).value = slider.value;
  // Text elsewhere that quotes this setting (e.g. the shake count in a hint)
  for (const el of document.querySelectorAll(`[data-value-of="${slider.id}"]`)) {
    el.textContent = slider.value;
  }
  const unit = slider.dataset.unit;
  slider.setAttribute('aria-valuetext',
    unit ? `${slider.value} ${SPOKEN_UNITS[unit] ?? unit}` : slider.value);
  const fraction = (slider.value - slider.min) / (slider.max - slider.min);
  slider.style.setProperty('--fill', `${fraction * 100}%`);
}

function save(slider) {
  chrome.storage.local.set({ [slider.id]: parseFloat(slider.value) }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving settings:', chrome.runtime.lastError);
    }
  });
}

// Announces a message through the page's status region
function announce(message) {
  const status = document.getElementById('status');
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
}

function showSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    const control = document.getElementById(key);
    if (!control) continue;
    if (control.type === 'checkbox') {
      control.checked = value;
    } else {
      control.value = value;
      render(control);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sliders = [...document.querySelectorAll('.slider')];
  for (const slider of sliders) render(slider);

  chrome.storage.local.get(DEFAULTS, (settings) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading settings:', chrome.runtime.lastError);
      return;
    }
    showSettings(settings);
  });

  for (const slider of sliders) {
    const field = fieldFor(slider);

    slider.addEventListener('input', () => {
      render(slider);
      save(slider);
    });

    // While typing, follow along once the number is valid and in range
    field.addEventListener('input', () => {
      const value = field.valueAsNumber;
      if (Number.isNaN(value) || value < slider.min || value > slider.max) return;
      slider.value = value;
      render(slider, { skipField: true });
      save(slider);
    });

    // On Enter or leaving the field: clamp and snap it to the slider's steps
    // (the slider does both when assigned), or put back the last good value
    field.addEventListener('change', () => {
      if (!Number.isNaN(field.valueAsNumber)) slider.value = field.valueAsNumber;
      render(slider);
      save(slider);
    });
  }

  for (const box of document.querySelectorAll('input[type="checkbox"]')) {
    box.addEventListener('change', () => {
      chrome.storage.local.set({ [box.id]: box.checked }, () => {
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
