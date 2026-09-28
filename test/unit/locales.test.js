// Checks the translations in _locales against the code that uses them:
// English (the default locale) has every message the extension asks for and
// none it doesn't, and every other language matches English.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FILES } = require('../../scripts/package.js');

const ROOT = path.resolve(__dirname, '../..');
const LOCALES = path.join(ROOT, '_locales');
const DEFAULT_LOCALE = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).default_locale;

// Languages written right to left
const RTL = new Set(['ar', 'fa', 'he', 'ur']);

// Messages the browser defines itself
const PREDEFINED = /^@@/;

function readMessages(locale) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES, locale, 'messages.json'), 'utf8'));
}

// The shipped source files that can use messages
function sources() {
  return FILES
    .filter(file => /\.(js|html|json|css)$/.test(file) && file !== 'matter.min.js')
    .map(file => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n');
}

// Message names in the order $1, $2, ... are substituted
function placeholders(entry) {
  return Object.entries(entry.placeholders ?? {})
    .map(([name, { content }]) => [name.toLowerCase(), content])
    .sort();
}

const english = readMessages(DEFAULT_LOCALE);
const code = sources();

test('locales: every message the code asks for is in English', () => {
  const used = new Set([
    ...[...code.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map(m => m[1]),
    ...[...code.matchAll(/(?:getMessage|msg)\('([^']+)'/g)].map(m => m[1]),
    ...[...code.matchAll(/__MSG_(\w+)__/g)].map(m => m[1])
  ]);
  const missing = [...used].filter(name => !PREDEFINED.test(name) && !(name in english));
  assert.deepEqual(missing, []);
});

test('locales: every English message is used', () => {
  // Some names are looked up from a table (e.g. units), so any quoted mention counts
  const unused = Object.keys(english).filter(name =>
    !new RegExp(`['"]${name}['"]|__MSG_${name}__`).test(code));
  assert.deepEqual(unused, []);
});

for (const locale of fs.readdirSync(LOCALES)) {
  const messages = readMessages(locale);

  test(`locales: ${locale} names its own language and direction`, () => {
    assert.equal(messages.locale?.message, locale);
    assert.equal(messages.direction?.message, RTL.has(locale.split('_')[0]) ? 'rtl' : 'ltr');
  });

  test(`locales: ${locale} messages are non-empty`, () => {
    const empty = Object.keys(messages).filter(name => !messages[name].message?.trim());
    assert.deepEqual(empty, []);
  });

  test(`locales: ${locale} badge fits on the toolbar icon`, () => {
    assert.ok((messages.badgeOn ?? english.badgeOn).message.length <= 4);
  });

  if (locale === DEFAULT_LOCALE) continue;

  test(`locales: ${locale} has every English message and no others`, () => {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(english).sort());
  });

  test(`locales: ${locale} keeps each message's placeholders and markup`, () => {
    for (const [name, entry] of Object.entries(messages)) {
      if (!(name in english)) continue;
      assert.deepEqual(placeholders(entry), placeholders(english[name]), name);
      // Every placeholder is used, and every $name$ is a placeholder
      for (const [placeholder] of placeholders(entry)) {
        assert.match(entry.message, new RegExp(`\\$${placeholder}\\$`, 'i'), name);
      }
      for (const [, used] of entry.message.matchAll(/\$(\w+)\$/g)) {
        assert.ok(entry.placeholders?.[used] || entry.placeholders?.[used.toLowerCase()], `${name}: $${used}$`);
      }
      // Only the tags English uses (the settings page drops any others)
      const tags = (text) => [...new Set([...text.matchAll(/<\/?(\w+)/g)].map(m => m[1].toLowerCase()))].sort();
      assert.ok(tags(entry.message).every(tag => tags(english[name].message).includes(tag)), `${name}: ${entry.message}`);
    }
  });
}
