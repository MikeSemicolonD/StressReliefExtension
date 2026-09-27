// Pure logic (no DOM access), shared by content.js and the unit tests in
// test/unit. Loaded as a content script before content.js, where it sets
// `globalThis.PhysicsLib`; in Node it's require()d.
(() => {
  // Dragging the window by its title bar happens outside the page, so no mouse
  // events arrive; content.js feeds this the window's position changes. A
  // "swing" is a run of movement in one direction, at least `shakeDistance`
  // long and averaging at least `minShakeSpeed` px/s (so slowly moving the
  // window around doesn't count), that then reverses. `requiredShakes` swings
  // within `timeWindow` ms make a shake. `getSettings` is read on every call
  // so changes apply live.
  function createShakeDetector(getSettings) {
    const axes = {
      x: { dir: 0, travel: 0, legStart: 0, lastMove: -Infinity },
      y: { dir: 0, travel: 0, legStart: 0, lastMove: -Infinity }
    };
    let swings = [];
    let cooldownUntil = -Infinity;

    // Returns true when this movement ends a long and fast enough leg by
    // reversing
    function track(axis, d, now, s) {
      if (!d) return false;
      const prev = axis.lastMove;
      axis.lastMove = now;
      // A long pause starts a fresh leg rather than extending a stale one
      const fresh = now - prev > s.timeWindow;
      if (fresh) {
        axis.dir = 0;
        axis.travel = 0;
      }

      const dir = Math.sign(d);
      if (dir === axis.dir) {
        axis.travel += Math.abs(d);
        return false;
      }
      // The leg ended at the previous poll
      const seconds = (prev - axis.legStart) / 1000;
      const swung = axis.travel >= s.shakeDistance &&
        axis.travel >= s.minShakeSpeed * seconds;
      axis.dir = dir;
      axis.travel = Math.abs(d);
      // This movement happened since the previous poll, so the new leg starts
      // there. After a pause that poll is stale, so the leg is timed from now
      // (missing its first interval, which only makes it read a little fast).
      axis.legStart = fresh ? now : prev;
      return swung;
    }

    return {
      // Feed one window movement (px since the last call) at time `now` (ms).
      // Returns true when it completes a shake.
      move(dx, dy, now) {
        const s = getSettings();
        let swung = false;
        for (const axisSwung of [track(axes.x, dx, now, s), track(axes.y, dy, now, s)]) {
          if (!axisSwung) continue;
          swings = swings.filter(t => now - t <= s.timeWindow);
          swings.push(now);
          swung = true;
        }
        // Only a new swing can complete a shake: swings left over from a
        // cooldown mustn't fire on the next small movement after it ends.
        if (swung && swings.length >= s.requiredShakes && now >= cooldownUntil) {
          swings = [];
          return true;
        }
        return false;
      },

      // Ignore shakes until `until`, e.g. right after physics is turned off
      // so the tail of a shake doesn't turn it straight back on.
      cooldown(until) {
        cooldownUntil = until;
        swings = [];
      }
    };
  }

  // Groups measured tokens ({ rect, atom? }, in document order) into visual
  // lines: a token joins the current line if its vertical midpoint falls
  // within the line's extent. Tall atoms (floated images, block-sized
  // inline-blocks) become lines of their own without breaking the current one.
  function groupLines(tokens, lineHeight) {
    const lines = [];
    let line = null;
    for (const t of tokens) {
      const r = t.rect;
      if (t.atom && r.height > lineHeight * 2) {
        lines.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, tokens: [t] });
        continue;
      }
      const mid = (r.top + r.bottom) / 2;
      if (line && mid >= line.top && mid <= line.bottom) {
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        line.tokens.push(t);
      } else {
        line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, tokens: [t] };
        lines.push(line);
      }
    }
    return lines;
  }

  const MARKER_GLYPHS = { disc: '•', circle: '◦', square: '▪' };

  // Bijective base-26, like CSS alphabetic counters: 1 → a, 26 → z, 27 → aa
  function alphabetic(n, base) {
    let s = '';
    for (; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(base + ((n - 1) % 26)) + s;
    }
    return s;
  }

  // The text of a list item's ::marker for `list-style-type` and 1-based
  // position `n`, including its trailing space; null for types not rebuilt.
  function markerText(type, n) {
    if (MARKER_GLYPHS[type]) return `${MARKER_GLYPHS[type]} `;
    if (type === 'decimal') return `${n}. `;
    if (n < 1) return null;
    if (type === 'lower-alpha' || type === 'lower-latin') return `${alphabetic(n, 97)}. `;
    if (type === 'upper-alpha' || type === 'upper-latin') return `${alphabetic(n, 65)}. `;
    return null;
  }

  const lib = { createShakeDetector, groupLines, markerText };
  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  else globalThis.PhysicsLib = lib;
})();
