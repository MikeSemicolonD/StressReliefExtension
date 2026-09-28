# Project Overview

A browser extension (Chrome/Firefox, Manifest V3) that turns the visible content of a web page into physics objects, powered by Matter.js. Shake the browser window (or click the toolbar icon) to activate; drag and throw the pieces around; moving the window while active sloshes them around inside it. Esc or the icon restores the page.

The view is top-down: gravity defaults to 0 and bodies coast to a stop via air friction.

## Architecture

- **[defaults.js](defaults.js)** -- `self.PHYSICS_DEFAULTS`, the single source of setting defaults. Loaded before content.js and settings.js.
- **[lib.js](lib.js)** -- `PhysicsLib`: DOM-free logic (shake detection, line grouping, list-marker text), loaded before content.js and unit-tested in Node.
- **[restore-button.js](restore-button.js)** -- `PhysicsRestoreButton`: the on-page "Restore page" button shown while physics is on (in a shadow root, so its CSS is a string there rather than a web-accessible file sites could probe). Loaded before content.js, which decides when to show it.
- **[content.js](content.js)** -- everything that runs in the page (wrapped in an IIFE guarded against double injection).
- **[background.js](background.js)** -- toolbar click → `togglePhysics` message. If the tab has no content script (opened before install/reload), injects it via `chrome.scripting` and retries. Shows an ON badge from `physicsStateChanged` messages.
- **[settings.html](settings.html) / [settings.js](settings.js) / [settings.css](settings.css)** -- the options page. It only writes to `chrome.storage.local`; content scripts apply changes through `chrome.storage.onChanged`.
- **[styles.css](styles.css)** -- injected into every page, so every selector must be `physics-` prefixed.
- **[_locales/](_locales/)** -- every user-facing string (see Localization).

### Localization

One build serves every language: the browser picks `_locales/<language>/messages.json` from its UI language and falls back to English (`default_locale`) message by message. English is the source text; no user-facing string is written anywhere else.

- The manifest uses `__MSG_extName__` / `__MSG_extDescription__` (the stores take the localized name and description from these).
- JS uses `chrome.i18n.getMessage` (restore button, badge, settings dialogs and spoken units).
- `settings.html` holds keys, not text: `localize()` in `settings.js` fills `data-i18n` (text; child elements already in place fill the placeholders in order, e.g. the live shake count), `data-i18n-html` (only `<strong>`, `<i>`, `<kbd>` survive, rebuilt as fresh nodes) and `data-i18n-aria-label`, and sets `lang`/`dir` from the `locale` message and `@@bidi_dir`.
- Shipped languages: every language Chrome's own UI comes in, plus `nb` (Firefox's code for Norwegian Bokmål; `no` is the same text under Chrome's code). English messages have a `description` for translators; the translations carry only `message` (and `placeholders`, copied verbatim).
- Every translation must have every English message (the unit test enforces it), so adding or rewording an English string means updating all of them. Keep placeholders and the allowed tags; `locale` is the folder's code; `badgeOn` is 4 characters or fewer.
- Right-to-left (`ar`, `fa`, `he`, `ur`): direction comes from `@@bidi_dir`. The settings page uses logical properties, with `:dir(rtl)` rules for what can't be logical (the slider fill gradient, the switch knob's travel). The Restore page button takes the extension's `lang`/`dir`, not the page's, and sits in the top-left corner (`inset-inline-end`), which the RTL translations of `hideRestoreButtonHint` say.
- The bundled Fredoka font covers Latin only, so other scripts fall back to the system font.

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
- Unstyled elements are sized by `visualRect()` -- the extent of their text lines, not the layout box -- so a paragraph beside a float doesn't reflow wider once detached. Flex and grid containers keep their full box (their items would move in a narrower copy).
- Content drawn scaled (its own or an ancestor's `scale`/`transform`, from `screenScale()`) is built in its own unscaled units and scaled back in the piece transform (`pieceTransform` appends `scale()`), since measured rects are on screen but copied styles aren't. Rotation isn't carried over.

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
- If spawning throws or yields no pieces, activation is undone at once (`setPhysicsEnabled`): the invisible canvas would otherwise cover an untouched-looking page and swallow every click.
- Fixed-step `Matter.Runner`; walls are thick static bodies just outside the viewport, rebuilt on resize (bodies are pulled back inside). Bodies are at least `MIN_BODY_SIZE` thick so 1px rules stay grabbable.
- `renderFrame` writes only `transform: translate() rotate()` per clone -- no layout reads.
- Settings changes update bodies in place with `Matter.Body.set` (no rebuild, positions preserved).
- Restoring (`glideHome`) stops the simulation and CSS-transitions every clone back to its spawn transform (rotation unwound the short way, shifted by however far its original has moved since spawn, e.g. by scrolling), then tears down; the clones match the page at home, so the swap is invisible. Instant with `prefers-reduced-motion`, a second Esc, turning physics back on mid-flight, or an orphaned script. `restoreOriginals` finishes any CSS transitions the restored styles start, so a page's `transition: all` doesn't fade boxes back in.

### Shake detection

Title-bar drags happen outside the page, so no mouse events arrive. Instead `pollWindowPosition` checks `window.screenX/Y` on a 50 ms timer (`POSITION_POLL_MS`; a timer rather than `requestAnimationFrame`, which would keep every idle tab rendering) and, while physics is on, every frame. Movements go to `PhysicsLib.createShakeDetector` in `lib.js`: a *swing* is movement in one direction of at least `shakeDistance` px, averaging at least `minShakeSpeed` px/s (so slowly repositioning the window doesn't count), that then reverses; `requiredShakes` swings within `timeWindow` ms is a shake. While active, window movement is applied to body velocities (`slosh`). After deactivation, shakes are ignored for `SHAKE_COOLDOWN` ms. When the extension is updated, reloaded or disabled, content scripts in open tabs keep running but lose their `chrome.*` APIs; the poll notices (`chrome.runtime.id` is gone) and `retire()` restores the page and stops polling, so an orphaned copy can't be shaken on.

## Development

Both browsers get a Manifest V3 build, from one source. `manifest.json` is the Chrome manifest (`background.service_worker`); Firefox's MV3 doesn't support service workers and uses `background.scripts`, which Chrome warns about, so `scripts/package.js --firefox` writes a Firefox manifest with the service worker swapped for scripts. Load the repo folder unpacked in Chrome; in Firefox, load the Firefox build. Builds: `npm run build:chrome` / `npm run build:firefox` (or the VS Code tasks "Build: Chrome", "Build: Firefox", "Build: All", the default build task) write `build/chrome/` and `build/firefox/` (git-ignored). `npx web-ext lint --source-dir build/firefox` checks Firefox compatibility; one warning is expected (the Chrome-only `chrome.dom` call, which is feature-detected).

Tests: `npm install`, `npx playwright install chromium`, then `npm test` (or the VS Code tasks "Test: All", the default test task, "Test: E2E", "Test: E2E Current File", its headed variant, and "Test: E2E UI Mode").
- `test/unit` (Node's test runner) covers the pure logic in `lib.js`: shake detection, line grouping, list-marker text. Keep DOM-free logic there so it stays unit-testable. `locales.test.js` checks the translations: every message the code uses exists in English and every English message is used, and every other locale has exactly English's messages with the same placeholders and markup.
- `test/e2e` (Playwright) loads the packaged extension (`scripts/package.js`) into Chromium and runs it on the pages in `test/fixtures`, served at `http://physics.test/` by a route handler. Physics is toggled by messaging the tab from the service worker. Tests check spawn appearance (4x4-block screenshot comparison, tolerant of sub-pixel antialiasing), that every visible text node is covered, no duplicates, exact DOM restore, dragging (also under CPU throttling and after the tab is frozen, as Chrome does to background tabs), not activating on a page with nothing to throw, scaled content keeping its size and position, a slow connection (physics on and off while an image is still loading; it arrives in its piece), live settings, form state, the badge, and shadow DOM handling. `locales.spec.js` opens the settings page in every translation (the browser's `--lang`, via the `lang` fixture option) and checks it's in that language, fully filled in and not overflowing at desktop and phone widths, plus right-to-left mirroring. `settings.spec.js` checks the settings page's accessibility: an axe scan (`@axe-core/playwright`) in light and dark mode, Tab order, visible focus, arrow keys, spoken values (`aria-valuetext` with units) and the reset announcement. The browser runs with `--lang=en-US` (the tests match English text) and `--disable-lcd-text` because pieces on GPU layers can't use subpixel antialiasing.
- Chrome quirks worth knowing: CSSOM style changes are written back to the `style` attribute lazily (see `restoreOriginals`), and a page's `transition: all` would animate our hiding (hence `transition: none` in `HIDE_ELEMENT`).

Branches and CI: work goes to `staging` (CI: `ci.yml` → reusable `build.yml`, which packages a Chrome and a Firefox build via `scripts/package.js`, syntax-checks, runs the unit and browser tests, lints the Firefox build, and uploads both as artifacts), then to `main` via pull request. Every push to `main` runs `release.yml`, which packages and lints but doesn't rerun the tests (`run-tests: false`; `main` only takes pull requests whose CI tested the merged result, with branch protection requiring up-to-date branches), and releases only when `manifest.json`'s version has no `v<version>` tag yet: it creates the GitHub release with a `-chrome.zip` and a `-firefox.zip`, then calls `publish-firefox.yml`, `publish-chrome.yml` and `publish-edge.yml` directly (a release made with `GITHUB_TOKEN` can't trigger other workflows). Store workflows skip themselves until their secrets/variables exist. Third-party Actions are pinned to commit SHAs (with a `# vX.Y.Z` comment) and the `npx` tools to exact versions, because the store workflows run with publishing secrets; update pins deliberately rather than loosening them. Dependabot (`.github/dependabot.yml`) opens weekly grouped pull requests against `staging` for the pinned Actions and the npm dev dependencies; the `npx` tool versions inside `run:` steps aren't visible to it and are bumped by hand. Add any new runtime file to the list in `scripts/package.js`.

Load unpacked from `chrome://extensions/` (Developer mode) using the repo folder, or in Firefox run `npm run build:firefox` and load `build/firefox/manifest.json` via `about:debugging#/runtime/this-firefox` → Load Temporary Add-on. After editing, reload the extension and refresh the target tab.

Icons: `images/icon*.png` are exported from `design/icon.svg` (48, 128) and `design/icon-small.svg` (16, 32; simplified so it stays legible in the toolbar). Edit the SVGs and re-export the PNGs at those sizes with any SVG tool. The settings page bundles the Fredoka font (`fonts/`, OFL) rather than loading it remotely.

`matter.min.js` (0.20.0) is the library actually loaded; `matter.js` is the unminified copy for reference only.

## Development and releasing

Work happens on the `staging` branch and reaches `main` through pull requests.

- **CI** (`.github/workflows/ci.yml`) builds, syntax-checks and lints the extension on every push to `staging` and every pull request into `main`.
- **Release** (`.github/workflows/release.yml`) runs on every push to `main`. If the `"version"` in `manifest.json` hasn't been released yet, it tags the commit `v<version>`, publishes a GitHub release with the packaged `.zip`, and submits that version to each extension store. Pushes that don't bump the version are built and checked but not released.

To cut a release: bump `"version"` in `manifest.json` on `staging`, then merge `staging` into `main`.

### Extension stores

Each store has its own workflow, called by Release and also runnable by hand from the Actions tab (to retry one store for an existing tag). Each one skips itself until its credentials exist, so stores can be added one at a time. The first upload to each store must be done by hand, which creates the listing. After that:

| Store | Workflow | Repository variable | Secrets |
| --- | --- | --- | --- |
| Firefox Add-ons | `publish-firefox.yml` | – | `AMO_API_KEY`, `AMO_API_SECRET` |
| Chrome Web Store | `publish-chrome.yml` | `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID` | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Edge Add-ons | `publish-edge.yml` | `EDGE_PRODUCT_ID` | `EDGE_CLIENT_ID`, `EDGE_API_KEY` |

Where to get each credential is described at the top of its workflow file. Secrets can be stored on the matching GitHub environment (`firefox`, `chrome-web-store`, `edge-addons`), which also lets you require a manual approval before a store deployment.
