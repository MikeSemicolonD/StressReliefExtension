# Project Overview

A browser extension (Chrome/Firefox, Manifest V3) that turns the visible content of a web page into physics objects, powered by Matter.js. Shake the browser window (or click the toolbar icon) to activate; drag and throw the pieces around; moving the window while active sloshes them around inside it. Esc or the icon restores the page.

The view is top-down: gravity defaults to 0 and bodies coast to a stop via air friction.

## Architecture

- **[defaults.js](defaults.js)** -- `self.PHYSICS_DEFAULTS`, the single source of setting defaults. Loaded before content.js and settings.js.
- **[content.js](content.js)** -- everything that runs in the page (wrapped in an IIFE guarded against double injection).
- **[background.js](background.js)** -- toolbar click → `togglePhysics` message. If the tab has no content script (opened before install/reload), injects it via `chrome.scripting` and retries. Shows an ON badge from `physicsStateChanged` messages.
- **[settings.html](settings.html) / [settings.js](settings.js) / [settings.css](settings.css)** -- the options page. It only writes to `chrome.storage.local`; content scripts apply changes through `chrome.storage.onChanged`.
- **[styles.css](styles.css)** -- injected into every page, so every selector must be `physics-` prefixed.

### Clone, don't move

Originals are never moved. Everything thrown is a clone in a fixed overlay (appended to `<html>`, not `<body>`); the originals are hidden without shifting layout, in one of three ways depending on the piece kind:

- **whole / split** -- inline `visibility: hidden !important`.
- **shell** -- inline `!important` styles that strip only its box painting (background, border color, shadow); its children are unaffected.
- **loose** -- its direct text nodes are blanked through a CSS Custom Highlight (`::highlight(physics-hidden-text)`), so the page's text nodes are never touched. Shadow roots with hidden loose text adopt a one-rule stylesheet, since document CSS doesn't reach them.

Hiding uses inline styles rather than classes because the extension stylesheet can't reach inside shadow roots. Each element's original `style` attribute is saved and restored verbatim on teardown (`restoreOriginals`), along with removing the highlight and adopted sheets.

Cloning details (`makeClone` / `freezeClone`):

- `freezeClone` builds the copy node by node from the composed tree: shadow content is flattened in, `<slot>`s are replaced by their assigned nodes, and custom elements / shadow hosts become plain `div`s so the page's component code never runs on a copy. `display: none` subtrees are skipped.
- Computed styles are copied onto every node of the clone so it looks right outside its original selector context; `::before`/`::after` are reified as real spans. Live form state (select index, input value/checked) is copied too.
- `pin()` overrides `transition`, `animation`, margins and min/max sizes; `markPiece()` also resets `translate/rotate/scale` on top-level pieces only (nested icons keep their rotation).
- `iframe`/`embed`/`object` become placeholder boxes; `video`/`canvas` become canvas snapshots (cloning them would reload/restart/blank them).
- `id` and `name` attributes are stripped (duplicate ids; cloned radios would uncheck originals).
- Unstyled elements are sized by `visualRect()` -- the extent of their text lines, not the layout box -- so a paragraph beside a float doesn't reflow wider once detached.

### Line splitting (`splitLines`)

Plain text blocks (no background/border/shadow) are thrown one visual line at a time. Every word's rect is measured with a `Range`, words are grouped into lines by vertical midpoint, and each line piece holds one absolutely positioned span per word (so wrapping, justification and mixed fonts are exact). Inline-blocks, images and form controls inside a line are cloned whole as tokens; tall ones (floats) become pieces of their own. List items get their `::marker` rebuilt as a token (`listMarkerToken`). Line boxes are padded vertically because the `will-change` layer clips descenders.

### Shadow DOM

Selection, cloning and line splitting all walk the composed ("flat") tree: `composedChildren` descends into shadow roots and through slots, `composedParent` climbs out of them. `walkComposed` visits everything rendered under `<body>` once, in flat-tree order, and every pass works from that list. Closed shadow roots are reached with `chrome.dom.openOrClosedShadowRoot` (Chrome) or `element.openOrClosedShadowRoot` (Firefox). Because `textContent` and `querySelector` can't see shadow content, `indexShadowContent` records which elements contain shadow hosts (and block-level shadow content).

### Element selection (`selectElements`)

Returns `{ el, kind, order }` picks (`order` is the flat-tree position, used for stacking). Passes 1-3 claim non-overlapping elements (each skips anything claimed, inside a claim, or wrapping one); passes 4-5 sweep up the rest:

1. **Cards** (`article`, or a styled box whose class matches `CARD_CLASS_PATTERN`) -- outermost wins, thrown whole.
2. **Text blocks** (`p`, headings, `li`, `td`, `a`, ..., plus plain `div`/`span` text containers) with no block-level descendants -- outermost wins; split into lines if plain, else whole.
3. **Atoms** (`img`, `svg`, form controls, leaf-ish `div`/`span`) -- innermost wins.
4. **Styled boxes** nothing took: containers of claimed pieces become empty **shells** (the box alone); others are thrown whole.
5. **Loose text**: text nodes sitting directly in an unclaimed element, split into lines (needs the Highlight API).

Every candidate is first filtered by `overlapsViewport` (a cheap rect read) before any computed-style check. Pieces may be partly off-screen; elements larger than 90% of the viewport are treated as layout and skipped. Capped at `MAX_PHYSICS_BODIES`, smallest first, all-or-nothing per element.

### Spawning and the physics loop

- `spawnClones` runs in two phases: build every piece from detached nodes (reads only), then hide originals and attach clones (writes only). Interleaving them made each `getComputedStyle` recalculate the whole page's styles. Pieces are attached in document order so stacking matches the page (a shell sits under its contents); a grabbed piece is brought to the front.
- **Ghost pairs**: bodies overlapping at spawn (a shell and its contents, a cut-off piece and a wall) ignore each other until their bounds separate. Implemented by patching `Matter.Detector.canCollide` to consult a per-body `collisionFilter.ghosts` set. Any piece that ends up fully outside the viewport is pulled back inside.
- Fixed-step `Matter.Runner`; walls are thick static bodies just outside the viewport, rebuilt on resize (bodies are pulled back inside). Bodies are at least `MIN_BODY_SIZE` thick so 1px rules stay grabbable.
- `renderFrame` writes only `transform: translate() rotate()` per clone -- no layout reads.
- Settings changes update bodies in place with `Matter.Body.set` (no rebuild, positions preserved).

### Shake detection

Title-bar drags happen outside the page, so no mouse events arrive. Instead `pollWindowPosition` watches `window.screenX/Y` every animation frame. A *swing* is movement in one direction of at least `shakeDistance` px that then reverses; `requiredShakes` swings within `timeWindow` ms activates physics. While active, window movement is applied to body velocities (`slosh`). After deactivation, shakes are ignored for `SHAKE_COOLDOWN` ms.

## Development

Chrome needs `background.service_worker`; Firefox (140+) uses `background.scripts` and ignores the other key. `npx web-ext lint --source-dir .` checks Firefox compatibility; two warnings are expected (the ignored `service_worker` key, and the Chrome-only `chrome.dom` call, which is feature-detected).

Branches and CI: work goes to `staging` (CI: `ci.yml` → reusable `build.yml`, which syntax-checks, packages an explicit file list, and lints the package), then to `main` via pull request. Every push to `main` runs `release.yml`, which releases only when `manifest.json`'s version has no `v<version>` tag yet: it creates the GitHub release, then calls `publish-firefox.yml`, `publish-chrome.yml` and `publish-edge.yml` directly (a release made with `GITHUB_TOKEN` can't trigger other workflows). Store workflows skip themselves until their secrets/variables exist. Add any new runtime file to the package list in `build.yml`.

Load unpacked from `chrome://extensions/` (Developer mode), or in Firefox via `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json`. After editing, reload the extension and refresh the target tab.

`matter.min.js` (0.20.0) is the library actually loaded; `matter.js` is the unminified copy for reference only.
