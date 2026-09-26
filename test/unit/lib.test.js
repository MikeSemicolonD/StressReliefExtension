const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createShakeDetector, groupLines, markerText } = require('../../lib.js');

const SETTINGS = { shakeDistance: 40, requiredShakes: 4, timeWindow: 1500 };

// Moves the window back and forth: `swings` legs of `distance` px along x,
// each split into `steps` polls `stepMs` apart. Returns the times at which
// the detector reported a shake.
function shakeWindow(detector, { swings, distance = 60, steps = 3, stepMs = 50, start = 0, axis = 'x' }) {
  const hits = [];
  let t = start;
  for (let i = 0; i < swings; i++) {
    const dir = i % 2 ? -1 : 1;
    for (let j = 0; j < steps; j++) {
      t += stepMs;
      const d = (dir * distance) / steps;
      if (axis === 'x' ? detector.move(d, 0, t) : detector.move(0, d, t)) hits.push(t);
    }
  }
  return hits;
}

test('shake: enough quick swings trigger it', () => {
  const detector = createShakeDetector(() => SETTINGS);
  // A swing counts when its leg reverses, so 4 swings need 5 legs
  assert.equal(shakeWindow(detector, { swings: 5 }).length, 1);
});

test('shake: too few swings do not', () => {
  const detector = createShakeDetector(() => SETTINGS);
  assert.equal(shakeWindow(detector, { swings: 4 }).length, 0);
});

test('shake: vertical shaking counts too', () => {
  const detector = createShakeDetector(() => SETTINGS);
  assert.equal(shakeWindow(detector, { swings: 5, axis: 'y' }).length, 1);
});

test('shake: legs shorter than shakeDistance are ignored', () => {
  const detector = createShakeDetector(() => SETTINGS);
  assert.equal(shakeWindow(detector, { swings: 10, distance: 30 }).length, 0);
});

test('shake: swings spread beyond timeWindow do not add up', () => {
  const detector = createShakeDetector(() => SETTINGS);
  // Each leg takes 600ms, so no four swings fit in 1500ms
  assert.equal(shakeWindow(detector, { swings: 10, stepMs: 200 }).length, 0);
});

test('shake: dragging the window in one direction is not a shake', () => {
  const detector = createShakeDetector(() => SETTINGS);
  let hits = 0;
  for (let t = 50; t <= 2000; t += 50) hits += detector.move(30, 0, t) ? 1 : 0;
  assert.equal(hits, 0);
});

test('shake: a long pause starts a fresh leg', () => {
  const detector = createShakeDetector(() => SETTINGS);
  detector.move(100, 0, 0);
  // 5s later, a short move back must not complete the old 100px leg
  detector.move(-10, 0, 5000);
  const hits = shakeWindow(detector, { swings: 4, start: 5000 });
  assert.equal(hits.length, 0);
});

test('shake: cooldown suppresses shakes until it ends', () => {
  const detector = createShakeDetector(() => SETTINGS);
  detector.cooldown(10_000);
  assert.equal(shakeWindow(detector, { swings: 5 }).length, 0);
  assert.equal(shakeWindow(detector, { swings: 5, start: 20_000 }).length, 1);
});

test('shake: settings are read live', () => {
  const settings = { ...SETTINGS };
  const detector = createShakeDetector(() => settings);
  settings.requiredShakes = 2;
  assert.equal(shakeWindow(detector, { swings: 3 }).length, 1);
});

const rect = (left, top, width, height) =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

test('groupLines: words on the same baseline form one line', () => {
  const tokens = [
    { rect: rect(0, 0, 40, 18) },
    { rect: rect(45, 0, 30, 18) },
    { rect: rect(0, 24, 50, 18) }
  ];
  const lines = groupLines(tokens, 24);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].tokens, tokens.slice(0, 2));
  assert.deepEqual([lines[0].left, lines[0].right, lines[0].top, lines[0].bottom], [0, 75, 0, 18]);
});

test('groupLines: superscripts and small icons stay on their line', () => {
  const tokens = [
    { rect: rect(0, 4, 40, 18) },
    { rect: rect(42, 0, 10, 12) },          // superscript, raised
    { atom: true, rect: rect(55, 2, 16, 16) } // inline icon
  ];
  assert.equal(groupLines(tokens, 24).length, 1);
});

test('groupLines: tall atoms become their own line without splitting the text', () => {
  const tokens = [
    { rect: rect(0, 0, 40, 18) },
    { atom: true, rect: rect(300, 0, 200, 150) }, // floated image
    { rect: rect(45, 0, 30, 18) }
  ];
  const lines = groupLines(tokens, 24);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].tokens.length, 2);
  assert.equal(lines[1].tokens[0].atom, true);
});

test('markerText: bullets', () => {
  assert.equal(markerText('disc', 1), '• ');
  assert.equal(markerText('circle', 1), '◦ ');
  assert.equal(markerText('square', 1), '▪ ');
});

test('markerText: numbers and letters', () => {
  assert.equal(markerText('decimal', 7), '7. ');
  assert.equal(markerText('lower-alpha', 1), 'a. ');
  assert.equal(markerText('upper-latin', 3), 'C. ');
});

test('markerText: letters continue past z like CSS counters', () => {
  assert.equal(markerText('lower-alpha', 26), 'z. ');
  assert.equal(markerText('lower-alpha', 27), 'aa. ');
  assert.equal(markerText('upper-alpha', 52), 'AZ. ');
  assert.equal(markerText('upper-alpha', 703), 'AAA. ');
});

test('markerText: unsupported types are skipped', () => {
  assert.equal(markerText('none', 1), null);
  assert.equal(markerText('lower-roman', 1), null);
  assert.equal(markerText('lower-alpha', 0), null);
});
