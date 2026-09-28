// Settings only need to be written to storage: every tab's content script
// listens to chrome.storage.onChanged and applies them live.
const DEFAULTS = self.PHYSICS_DEFAULTS;

const msg = (name, substitutions) => chrome.i18n.getMessage(name, substitutions);

// Messages for a value with its unit spelled out, as read by screen readers
const SPOKEN_UNITS = { px: 'valuePx', 'px/s': 'valuePxPerSecond', ms: 'valueMs' };

// Tags a translation may use in data-i18n-html text
const ALLOWED_TAGS = new Set(['STRONG', 'I', 'KBD']);

// Copies parsed markup as fresh nodes: allowed tags without their attributes,
// any other element reduced to its contents
function rebuild(parent) {
  return [...parent.childNodes].flatMap(node => {
    if (node.nodeType === Node.TEXT_NODE) return [node.data];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    if (!ALLOWED_TAGS.has(node.tagName)) return rebuild(node);
    const copy = document.createElement(node.tagName);
    copy.append(...rebuild(node));
    return [copy];
  });
}

// Fills in the page's text from _locales/<language>/messages.json, in the
// browser's language (falling back to English message by message):
// - data-i18n: text. Child elements already in place fill the message's
//   placeholders in order ($1 is the first), so they keep their behaviour.
// - data-i18n-html: text with the simple formatting in ALLOWED_TAGS.
// - data-i18n-aria-label: the aria-label attribute.
function localize() {
  document.documentElement.lang = msg('locale').replace('_', '-');
  document.documentElement.dir = msg('@@bidi_dir');

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const slots = [...el.children];
    // Each placeholder becomes a marker around its index, then the split
    // leaves the indexes at the odd positions
    const text = msg(el.dataset.i18n, slots.map((_, i) => `\uE000${i}\uE000`));
    el.replaceChildren(...text.split('\uE000').map((part, i) => i % 2 ? slots[part] : part));
  }

  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    const parsed = new DOMParser().parseFromString(msg(el.dataset.i18nHtml), 'text/html');
    el.replaceChildren(...rebuild(parsed.body));
  }

  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', msg(el.dataset.i18nAriaLabel));
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 3, useGrouping: false }).format(value);
}

// Each setting has a slider and a number field (id + "Value") kept in sync
function fieldFor(slider) {
  return document.getElementById(`${slider.id}Value`);
}

// Shows a slider's value in its number field (unless that's where it's being
// typed), gives screen readers the value with its unit spelled out, and
// fills the track up to the thumb (a CSS gradient driven by --fill).
function render(slider, { skipField = false } = {}) {
  if (!skipField) fieldFor(slider).value = slider.value;
  // Written in the language's digits, as the number fields show them
  const value = formatNumber(slider.value);
  // Text elsewhere that quotes this setting (e.g. the shake count in a hint)
  for (const el of document.querySelectorAll(`[data-value-of="${slider.id}"]`)) {
    el.textContent = value;
  }
  const unit = slider.dataset.unit;
  slider.setAttribute('aria-valuetext', unit ? msg(SPOKEN_UNITS[unit], [value]) : value);
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

// Straight away rather than on DOMContentLoaded (this script is at the end
// of the body), so the page never paints without its text
localize();

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
    if (!confirm(msg('resetConfirm'))) return;
    showSettings(DEFAULTS);
    chrome.storage.local.set(DEFAULTS, () => {
      if (chrome.runtime.lastError) {
        console.error('Error resetting settings:', chrome.runtime.lastError);
        alert(msg('resetFailed'));
        return;
      }
      announce(msg('resetDone'));
    });
  });
});
