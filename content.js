// Wrapped so a second injection (background.js falls back to executeScript on
// tabs that were open before the extension loaded) is a no-op instead of a
// redeclaration error.
(() => {
  if (window.__physicsExtensionLoaded) return;
  window.__physicsExtensionLoaded = true;

  const DEFAULTS = self.PHYSICS_DEFAULTS;

  const CONFIG = {
    MAX_PHYSICS_BODIES: 400,
    // Minimum size for elements thrown whole; text lines only need MIN_LINE_SIZE
    MIN_ELEMENT_SIZE: 20,
    MIN_LINE_SIZE: 4,
    // Physics bodies are at least this thick, so 1px rules can still be grabbed
    MIN_BODY_SIZE: 8,
    HIDDEN_TEXT_HIGHLIGHT: 'physics-hidden-text',
    // Elements wider/taller than this fraction of the viewport can't move
    // freely between the walls, so they're treated as layout, not content.
    MAX_VIEWPORT_FRACTION: 0.9,
    WALL_THICKNESS: 500,
    // How strongly window movement carries over to bodies while physics is on
    // (1 = bodies stay put on screen while the window slides under them).
    WINDOW_INERTIA: 0.8,
    MAX_SLOSH_SPEED: 40,
    // After physics is turned off, ignore shakes for this long so the tail of
    // a shake doesn't immediately turn it back on.
    SHAKE_COOLDOWN: 1500,
    // Restoring glides each piece home over this long, scaled by how far it
    // has to go (instant with prefers-reduced-motion)
    RESTORE_MIN_MS: 250,
    RESTORE_MAX_MS: 600,
    RESTORE_MS_PER_PX: 0.4,
    // How often the window position is checked while physics is off. A timer
    // rather than requestAnimationFrame, which would keep every idle tab
    // rendering 60 frames a second.
    POSITION_POLL_MS: 50,

    // Cards: atomic containers thrown as one unit along with everything inside.
    CARD_CANDIDATE_SELECTOR: 'article, div, li, section, a',
    CARD_TAGS: new Set(['article']),
    CARD_CLASS_PATTERN: /\b(card|tile|post|product|entry|item|teaser|thumb)\b/i,

    // Text blocks: claim everything inside them, as long as they don't wrap
    // other block-level content. Plain ones are split into one piece per line;
    // styled ones (background, border, shadow) are thrown whole.
    BLOCK_TAGS: [
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'li', 'dt', 'dd', 'td', 'th', 'caption', 'figcaption',
      'blockquote', 'pre', 'figure', 'label', 'button', 'a'
    ],
    // Never split into lines, even when unstyled
    UNSPLITTABLE_TAGS: new Set(['button', 'figure', 'input', 'select', 'textarea']),

    // Atoms: standalone content, where the innermost match wins.
    ATOM_TAGS: new Set([
      'img', 'picture', 'video', 'canvas', 'svg',
      'input', 'textarea', 'select'
    ]),
    // Only eligible if they contain no block-level descendants
    LEAFISH_TAGS: new Set(['div', 'span']),

    BLOCK_DESCENDANT_SELECTOR: 'div, section, article, aside, header, footer, nav, main, form, table, ul, ol, li, p, h1, h2, h3, h4, h5, h6, blockquote, figure, hr',
    // Never rendered, so never walked or cloned
    NON_RENDERED_TAGS: new Set(['script', 'style', 'noscript', 'template', 'link', 'meta', 'title', 'head']),
    SKIP_TAGS: new Set([
      'script', 'style', 'noscript', 'template', 'link', 'meta', 'title',
      'br', 'wbr', 'option', 'optgroup', 'textarea', 'iframe'
    ]),
    MEDIA_SELECTOR: 'img, svg, video, canvas, picture, iframe, input, select, textarea',

    // Inside a line, these keep their own box and are cloned whole
    INLINE_ATOM_TAGS: new Set([
      'img', 'svg', 'video', 'canvas', 'picture', 'iframe', 'math',
      'input', 'select', 'textarea', 'button'
    ]),
    // Inherited text properties copied onto each word of a line
    TEXT_STYLE_PROPS: [
      'color', 'font-family', 'font-size', 'font-weight', 'font-style',
      'font-variant', 'font-stretch', 'font-kerning', 'font-feature-settings',
      'font-variation-settings', 'letter-spacing', 'word-spacing',
      'text-transform', 'text-shadow', '-webkit-text-fill-color', '-webkit-text-stroke'
    ]
  };

  let engine, runner, world, mouseConstraint, canvas, overlay, frameId;
  let walls = [];
  let items = []; // { clone, body, w, h, fx, fy, homeX, homeY, el, anchor }
  let ghostPairs = []; // [bodyA, bodyB] that ignore each other until apart
  let viewport = { width: 0, height: 0 };
  let isPhysicsEnabled = false;
  let restoreTimer = null; // Set while the pieces glide home
  const settings = { ...DEFAULTS };

  // --- Settings ---------------------------------------------------------------

  chrome.storage.local.get(DEFAULTS, (saved) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading settings:', chrome.runtime.lastError);
      return;
    }
    applySettings(saved);
  });

  // The settings page only writes to storage; every tab picks changes up here.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const updated = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) updated[key] = newValue ?? DEFAULTS[key];
    }
    applySettings(updated);
  });

  // Updates the live world in place so thrown items keep their positions.
  function applySettings(changed) {
    Object.assign(settings, changed);
    if ('hideRestoreButton' in changed && isPhysicsEnabled) {
      if (settings.hideRestoreButton) removeRestoreButton();
      else showRestoreButton();
    }
    if (!engine) return;

    engine.gravity.y = settings.gravity;
    mouseConstraint.constraint.stiffness = settings.stiffness;
    for (const { body } of items) {
      Matter.Body.set(body, {
        restitution: settings.restitution,
        friction: settings.friction,
        frictionAir: settings.frictionAir,
        density: settings.density
      });
    }
  }

  // --- Engine setup -------------------------------------------------------------

  function viewportSize() {
    const de = document.documentElement;
    return {
      width: de.clientWidth || window.innerWidth,
      height: document.compatMode === 'CSS1Compat' ? de.clientHeight : window.innerHeight
    };
  }

  // Pairs of bodies that overlapped when spawned -- a box and its contents, or
  // a partly off-screen piece and a wall -- skip colliding until they've
  // separated, instead of violently pushing each other apart. Each body gets
  // its own collisionFilter carrying a `ghosts` set of filters it ignores.
  // Matter warns (once) when the runner hits its maxFrameTime budget on a heavy
  // page. That throttling is intended, and the warning would show up as an
  // error on the extensions page.
  Matter.Common.logLevel = 0;

  const baseCanCollide = Matter.Detector.canCollide;
  Matter.Detector.canCollide = (a, b) =>
    baseCanCollide(a, b) && !(a.ghosts && a.ghosts.has(b));

  function newFilter() {
    return { group: 0, category: 0x0001, mask: 0xFFFFFFFF, ghosts: new Set() };
  }

  function boundsOverlap(a, b) {
    const e = 0.5; // touching edges don't count
    return a.min.x < b.max.x - e && a.max.x > b.min.x + e &&
      a.min.y < b.max.y - e && a.max.y > b.min.y + e;
  }

  function ghost(a, b) {
    a.collisionFilter.ghosts.add(b.collisionFilter);
    b.collisionFilter.ghosts.add(a.collisionFilter);
    ghostPairs.push([a, b]);
  }

  function ghostSpawnOverlaps() {
    const all = [...items.map(i => i.body), ...walls];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (boundsOverlap(all[i].bounds, all[j].bounds)) ghost(all[i], all[j]);
      }
    }
  }

  function afterStep() {
    ghostPairs = ghostPairs.filter(([a, b]) => {
      if (boundsOverlap(a.bounds, b.bounds)) return true;
      a.collisionFilter.ghosts.delete(b.collisionFilter);
      b.collisionFilter.ghosts.delete(a.collisionFilter);
      return false;
    });

    // Anything that slipped fully out of view (thrown out through a wall it
    // was ghosting) comes back just inside the nearest edge.
    const { width: vw, height: vh } = viewport;
    for (const item of items) {
      const b = item.body.bounds;
      if (b.max.x > 0 && b.min.x < vw && b.max.y > 0 && b.min.y < vh) continue;
      Matter.Body.setPosition(item.body, insidePosition(item, vw, vh));
      Matter.Body.setVelocity(item.body, { x: 0, y: 0 });
    }
  }

  function initPhysics() {
    viewport = viewportSize();
    engine = Matter.Engine.create();
    Matter.Events.on(engine, 'afterUpdate', afterStep);
    world = engine.world;
    engine.gravity.x = 0;
    engine.gravity.y = settings.gravity;

    // Appended to <html> rather than <body>: a transform or filter on body
    // would otherwise turn position: fixed into position: absolute.
    overlay = document.createElement('div');
    overlay.className = 'physics-overlay';
    overlay.inert = true; // keeps cloned links/inputs out of the tab order
    document.documentElement.appendChild(overlay);

    // Transparent, full-viewport canvas on top -- Matter MouseConstraint reads
    // mouse events from here, hit-tests bodies, and handles dragging.
    canvas = document.createElement('canvas');
    canvas.className = 'physics-canvas';
    sizeCanvas();
    document.documentElement.appendChild(canvas);

    runner = Matter.Runner.create({ delta: 1000 / 60, maxUpdates: 10, maxFrameTime: 1000 / 30 });
    Matter.Runner.run(runner, engine);

    buildWalls();

    mouseConstraint = Matter.MouseConstraint.create(engine, {
      mouse: Matter.Mouse.create(canvas),
      constraint: { stiffness: settings.stiffness, render: { visible: false } }
    });
    Matter.Composite.add(world, mouseConstraint);

    // A grabbed piece comes to the front
    Matter.Events.on(mouseConstraint, 'startdrag', ({ body }) => {
      const item = items.find(i => i.body === body);
      if (item) overlay.appendChild(item.clone);
    });

    // Matter only looks for a body to grab on its next step, at wherever the
    // pointer is by then; a quick flick can already have left a thin line of
    // text. Grab at the press itself instead (these listeners run after
    // Matter's own, so mouse.position is the press position).
    canvas.addEventListener('mousedown', grabAtPointer);
    canvas.addEventListener('touchstart', grabAtPointer);
  }

  // Same as MouseConstraint's own grab, but immediate. Picks the topmost
  // piece under the pointer.
  function grabAtPointer() {
    const { mouse, constraint } = mouseConstraint;
    if (mouseConstraint.body) return;
    const hits = new Set(Matter.Query.point(items.map(i => i.body), mouse.position));
    let item = null;
    for (const clone of overlay.children) {
      const candidate = items.find(i => i.clone === clone);
      if (candidate && hits.has(candidate.body)) item = candidate;
    }
    if (!item) return;
    const { body } = item;
    constraint.pointA = mouse.position;
    constraint.bodyB = mouseConstraint.body = body;
    constraint.pointB = { x: mouse.position.x - body.position.x, y: mouse.position.y - body.position.y };
    constraint.angleB = body.angle;
    Matter.Sleeping.set(body, false);
    Matter.Events.trigger(mouseConstraint, 'startdrag', { mouse, body });
  }

  function sizeCanvas() {
    const { width, height } = viewportSize();
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }

  function buildWalls() {
    if (walls.length) Matter.Composite.remove(world, walls);
    const { width: w, height: h } = viewportSize();
    const t = CONFIG.WALL_THICKNESS;
    const opts = () => ({ isStatic: true, collisionFilter: newFilter() });
    walls = [
      Matter.Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts()),
      Matter.Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, opts()),
      Matter.Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, opts()),
      Matter.Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, opts())
    ];
    for (const wall of walls) wall.collisionFilter.ghosts = new Set();
    // Ghost pairs with the old walls die with them
    ghostPairs = ghostPairs.filter(([a, b]) => !a.isStatic && !b.isStatic);
    Matter.Composite.add(world, walls);
  }

  // The nearest position that keeps a piece's box (as drawn) inside the viewport
  function insidePosition({ body, w, h, scale }, vw, vh) {
    const hw = w * scale.x / 2;
    const hh = h * scale.y / 2;
    return {
      x: clamp(body.position.x, hw, Math.max(hw, vw - hw)),
      y: clamp(body.position.y, hh, Math.max(hh, vh - hh))
    };
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  window.addEventListener('resize', () => {
    if (!engine || !isPhysicsEnabled) return;
    viewport = viewportSize();
    sizeCanvas();
    buildWalls();
    // Pull back anything the shrinking viewport left outside the new walls
    const { width, height } = viewportSize();
    for (const item of items) {
      const { x, y } = insidePosition(item, width, height);
      if (x !== item.body.position.x || y !== item.body.position.y) {
        Matter.Body.setPosition(item.body, { x, y });
      }
    }
  });

  // --- Element selection --------------------------------------------------------

  // A card is a visible box: a class name alone (every `list-item` matches
  // "item") would turn plain navigation entries into big whole clones.
  function isCard(el) {
    if (CONFIG.CARD_TAGS.has(el.tagName.toLowerCase())) return true;
    // className is a SVGAnimatedString on SVG elements, not a plain string -- guard.
    const cls = typeof el.className === 'string' ? el.className : '';
    return CONFIG.CARD_CLASS_PATTERN.test(cls) && !isPlainBox(window.getComputedStyle(el));
  }

  function isEligibleAtom(el) {
    const tag = el.tagName.toLowerCase();
    if (CONFIG.ATOM_TAGS.has(tag)) return true;
    return CONFIG.LEAFISH_TAGS.has(tag) && !hasBlockDescendant(el);
  }

  function hasText(el) {
    return shadowContent.has(el) || /\S/.test(el.textContent);
  }

  function isTransparent(color) {
    return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  }

  // No background, border or shadow: the element is just its contents
  function isPlainBox(cs) {
    return isTransparent(cs.backgroundColor) && cs.backgroundImage === 'none' &&
      cs.boxShadow === 'none' &&
      !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderRightWidth) &&
      !parseFloat(cs.borderBottomWidth) && !parseFloat(cs.borderLeftWidth);
  }

  // Plain text containers are thrown one line at a time
  function canSplit(el) {
    return !CONFIG.UNSPLITTABLE_TAGS.has(el.tagName.toLowerCase()) &&
      hasText(el) && isPlainBox(window.getComputedStyle(el));
  }

  // An empty wrapper with no styling would be an invisible body
  function isVisuallyEmpty(el, cs) {
    return !CONFIG.ATOM_TAGS.has(el.tagName.toLowerCase()) && !hasText(el) &&
      isPlainBox(cs) && !shadowContent.has(el) && !el.querySelector(CONFIG.MEDIA_SELECTOR);
  }

  function isShown(cs) {
    return cs.display !== 'none' && cs.visibility === 'visible' && parseFloat(cs.opacity) !== 0;
  }

  // Too big to move freely between the walls: that's layout, not content
  function isOversized(rect) {
    return rect.width > viewport.width * CONFIG.MAX_VIEWPORT_FRACTION ||
      rect.height > viewport.height * CONFIG.MAX_VIEWPORT_FRACTION;
  }

  // `splittable` elements are checked line by line later; everything else is
  // thrown as one piece, so it must be a sensible size. Pieces may be partly
  // off-screen: they start overlapping the walls and pass through them until
  // they're fully inside (see ghostSpawnOverlaps).
  function isUsable(el, splittable = false) {
    if (el.closest('.physics-overlay')) return false;

    const cs = window.getComputedStyle(el);
    if (!isShown(cs)) return false;
    if (splittable) return true;
    if (isVisuallyEmpty(el, cs)) return false;

    const rect = visualRect(el);
    if (rect.width < CONFIG.MIN_ELEMENT_SIZE || rect.height < CONFIG.MIN_ELEMENT_SIZE) return false;
    return !isOversized(rect);
  }

  // Cheap first filter: most of a page is off-screen, and a rect read is far
  // cheaper than the computed-style checks that follow. Every selection pass
  // asks again, so answers are kept for the spawn (which reads, never writes,
  // until the pieces are built).
  let overlapCache = new Map(); // element -> boolean, reset each spawn

  function overlapsViewport(el) {
    let overlaps = overlapCache.get(el);
    if (overlaps === undefined) {
      const r = el.getBoundingClientRect();
      overlaps = r.bottom > 0 && r.top < viewport.height && r.right > 0 && r.left < viewport.width;
      overlapCache.set(el, overlaps);
    }
    return overlaps;
  }

  // --- Composed tree (shadow DOM) -----------------------------------------------

  // Web components render content from shadow roots that querySelectorAll,
  // parentElement and cloneNode don't see. Selection and cloning walk the
  // composed ("flat") tree instead: into shadow roots, and through <slot>s to
  // the light-DOM nodes assigned to them.

  function getShadowRoot(el) {
    if (el.shadowRoot) return el.shadowRoot;
    // Closed roots are only reachable by extensions, and only custom elements
    // realistically have them.
    if (!el.localName.includes('-')) return null;
    try {
      return chrome.dom?.openOrClosedShadowRoot?.(el) ?? el.openOrClosedShadowRoot ?? null;
    } catch (e) {
      return null;
    }
  }

  function composedChildren(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const root = getShadowRoot(node);
      if (root) return root.childNodes;
      if (node.localName === 'slot') {
        const assigned = node.assignedNodes({ flatten: true });
        if (assigned.length) return assigned;
      }
    }
    return node.childNodes;
  }

  // Selection climbs ancestors for every candidate, and assignedSlot is slow
  // to read, so parents are kept for the spawn (the tree doesn't change
  // until the pieces are built).
  let parentCache = new Map(); // node -> composed parent, reset each spawn

  function composedParent(node) {
    let parent = parentCache.get(node);
    if (parent === undefined) {
      parent = findComposedParent(node);
      parentCache.set(node, parent);
    }
    return parent;
  }

  function findComposedParent(node) {
    if (node.assignedSlot) return node.assignedSlot;
    const parent = node.parentNode;
    if (!parent) return null;
    if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) return parent.host ?? null;
    // (Slotted into a closed root, assignedSlot is hidden; the host will do.)
    return parent.nodeType === Node.ELEMENT_NODE ? parent : null;
  }

  // Everything rendered under <body>, in flat-tree order (ancestors first).
  // Light children a shadow root doesn't slot aren't rendered, so they're
  // not visited.
  function walkComposed() {
    const elements = [];
    const texts = [];
    const hosts = [];
    const visit = (node) => {
      for (const child of composedChildren(node)) {
        if (child.nodeType === Node.TEXT_NODE) {
          texts.push(child);
        } else if (child.nodeType === Node.ELEMENT_NODE && !CONFIG.NON_RENDERED_TAGS.has(child.localName)) {
          elements.push(child);
          if (getShadowRoot(child)) hosts.push(child);
          if (child.localName !== 'svg') visit(child);
        }
      }
    };
    visit(document.body);
    return { elements, texts, hosts };
  }

  // Shadow content is invisible to el.textContent and el.querySelector, so
  // record which elements contain some (any shadow host and its ancestors),
  // and which contain block-level shadow content.
  let shadowContent = new Set();
  let shadowBlocks = new Set();

  function indexShadowContent(hosts) {
    shadowContent = new Set();
    shadowBlocks = new Set();
    for (const host of hosts) {
      const hasBlocks = !!getShadowRoot(host).querySelector(CONFIG.BLOCK_DESCENDANT_SELECTOR);
      for (let el = host; el; el = composedParent(el)) {
        shadowContent.add(el);
        if (hasBlocks) shadowBlocks.add(el);
      }
    }
  }

  function hasBlockDescendant(el) {
    return shadowBlocks.has(el) || !!el.querySelector(CONFIG.BLOCK_DESCENDANT_SELECTOR);
  }

  function hasAncestorIn(el, set) {
    for (let p = composedParent(el); p; p = composedParent(p)) {
      if (set.has(p)) return true;
    }
    return false;
  }

  // Picks what to throw, as { el, kind, order }:
  //   whole -- cloned with everything inside it
  //   split -- a plain text block, thrown one line at a time
  //   shell -- a styled box (background, border, shadow) whose contents are
  //            thrown separately; only the empty box is cloned
  //   loose -- text sitting directly in an element nothing else took
  // `order` is the element's flat-tree position, used for stacking.
  // Passes 1-3 claim non-overlapping elements; each skips anything inside --
  // or wrapping -- an element an earlier pass claimed. Passes 4-5 sweep up
  // what's left.
  function selectElements() {
    const { elements, texts, hosts } = walkComposed();
    indexShadowContent(hosts);
    const order = new Map(elements.map((el, i) => [el, i]));

    const claimed = new Set();
    const claimedAncestors = new Set();
    const picks = [];
    const pick = (el, kind) => picks.push({ el, kind, order: order.get(el) ?? Infinity });
    const claim = (el, kind) => {
      claimed.add(el);
      pick(el, kind);
      for (let p = composedParent(el); p && !claimedAncestors.has(p); p = composedParent(p)) claimedAncestors.add(p);
    };
    const isFree = (el) => !claimed.has(el) && !claimedAncestors.has(el) && !hasAncestorIn(el, claimed);
    const unclaimed = (el) => !claimed.has(el) && !hasAncestorIn(el, claimed);
    const matching = (tags) => elements.filter(el => tags.has(el.localName));

    // 1. Cards, outermost wins (.card > .card-body keeps only .card)
    const cards = elements.filter(el => el.matches(CONFIG.CARD_CANDIDATE_SELECTOR) &&
      overlapsViewport(el) && isCard(el) && isUsable(el));
    const cardSet = new Set(cards);
    cards.filter(el => !hasAncestorIn(el, cardSet)).forEach(el => claim(el, 'whole'));

    // 2. Text blocks, outermost wins (a <p> takes its links along). Plain
    //    div/span text containers count too, so a <div>text <span>more</span></div>
    //    goes as one block instead of just the span.
    const blockTags = new Set(CONFIG.BLOCK_TAGS);
    const blocks = [];
    for (const el of matching(new Set([...blockTags, ...CONFIG.LEAFISH_TAGS]))) {
      if (!isFree(el) || !overlapsViewport(el) || hasBlockDescendant(el)) continue;
      const splittable = canSplit(el);
      if (!blockTags.has(el.localName) && !splittable) continue;
      if (isUsable(el, splittable)) blocks.push({ el, kind: splittable ? 'split' : 'whole' });
    }
    const blockSet = new Set(blocks.map(b => b.el));
    blocks.filter(b => !hasAncestorIn(b.el, blockSet)).forEach(b => claim(b.el, b.kind));

    // 3. Atoms, innermost wins (an <img> beats the <div> wrapping it)
    const atoms = [];
    for (const el of matching(new Set([...CONFIG.ATOM_TAGS, ...CONFIG.LEAFISH_TAGS]))) {
      if (!isFree(el) || !overlapsViewport(el) || !isEligibleAtom(el)) continue;
      const splittable = canSplit(el);
      if (isUsable(el, splittable)) atoms.push({ el, kind: splittable ? 'split' : 'whole' });
    }
    const wrapsAtom = new Set();
    for (const { el } of atoms) {
      for (let p = composedParent(el); p && !wrapsAtom.has(p); p = composedParent(p)) wrapsAtom.add(p);
    }
    atoms.filter(a => !wrapsAtom.has(a.el)).forEach(a => claim(a.el, a.kind));

    // 4. Styled boxes nothing took. Containers of claimed pieces go as empty
    //    shells (the infobox frame, a search field's outline, a header's rule);
    //    anything else goes whole. Flat-tree order visits ancestors first, so
    //    a box taken whole here keeps its styled descendants.
    for (const el of elements) {
      if (CONFIG.SKIP_TAGS.has(el.localName)) continue;
      if (!overlapsViewport(el) || !unclaimed(el)) continue;
      const cs = window.getComputedStyle(el);
      if (!isShown(cs) || isPlainBox(cs)) continue;

      const rect = el.getBoundingClientRect();
      if (isOversized(rect) || Math.max(rect.width, rect.height) < CONFIG.MIN_ELEMENT_SIZE) continue;
      if (claimedAncestors.has(el)) {
        pick(el, 'shell');
      } else if (rect.width >= CONFIG.MIN_LINE_SIZE && rect.height >= CONFIG.MIN_LINE_SIZE) {
        claim(el, 'whole');
      }
    }

    // 5. Loose text: text nodes sitting directly in an unclaimed element.
    //    Hidden via the CSS Custom Highlight API, so it needs that API.
    if (window.Highlight && CSS.highlights) {
      const seen = new Set();
      for (const text of texts) {
        // The composed parent owns the text: the host for text directly in a
        // shadow root, the slot for slotted text
        const el = composedParent(text);
        if (!el || seen.has(el) || !/\S/.test(text.data)) continue;
        seen.add(el);
        if (CONFIG.SKIP_TAGS.has(el.localName) || el.closest('svg')) continue;
        if (!overlapsViewport(el) || !unclaimed(el)) continue;
        if (isShown(window.getComputedStyle(el))) pick(el, 'loose');
      }
    }

    return picks;
  }

  // --- Clone creation -----------------------------------------------------------

  // A detached, style-frozen copy of `source` as it renders. Shadow trees are
  // flattened in (a clone can't carry them), slots are replaced by what's
  // assigned to them, and ::before/::after become real spans. Elements that
  // render nothing (display: none) are left out.
  function freezeClone(source) {
    if (source.nodeType === Node.TEXT_NODE) return document.createTextNode(source.data);
    if (source.nodeType !== Node.ELEMENT_NODE || CONFIG.NON_RENDERED_TAGS.has(source.localName)) return null;

    if (source.localName === 'slot') {
      const fragment = document.createDocumentFragment();
      for (const child of composedChildren(source)) {
        const copy = freezeClone(child);
        if (copy) fragment.appendChild(copy);
      }
      return fragment;
    }

    const snapshot = makeSnapshot(source);
    if (snapshot) return snapshot;

    const cs = window.getComputedStyle(source);
    if (cs.display === 'none') return null;
    const clone = shallowCopy(source);
    copyComputedStyles(source, clone, cs);
    for (const child of composedChildren(source)) {
      const copy = freezeClone(child);
      if (copy) clone.appendChild(copy);
    }
    copyFormState(source, clone); // after children: a select needs its options

    let frozenAny = synthesizePseudo(source, clone, '::before');
    if (synthesizePseudo(source, clone, '::after')) frozenAny = true;
    if (frozenAny) clone.setAttribute('data-physics-pseudo-frozen', '');
    return clone;
  }

  // Custom elements and shadow hosts are copied as plain divs: a real copy
  // would be upgraded by the page's component definition and run its code.
  // Other elements are created fresh with the source's attributes, minus
  // those a copy must not carry (see copiesAttribute).
  function shallowCopy(source) {
    if (source.localName.includes('-') || getShadowRoot(source)) return document.createElement('div');
    const copy = document.createElementNS(source.namespaceURI, source.localName);
    for (const attr of source.attributes) {
      // Cloning the Attr keeps its namespace as is: setAttributeNS would throw
      // on a prefixed name a script set without one (e.g. xmlns:xlink)
      if (copiesAttribute(attr.name)) copy.setAttributeNode(attr.cloneNode());
    }
    return copy;
  }

  // Duplicate ids confuse page scripts, a copied radio button sharing a name
  // with the original would uncheck it, and inline event handlers (onload,
  // onerror, ...) would rerun the page's code when a copy loads, e.g.
  // double-counting analytics. They're left off at creation: removing a
  // handler afterwards doesn't cancel a load event already queued for it.
  function copiesAttribute(name) {
    return name !== 'id' && name !== 'name' && !name.startsWith('on');
  }

  // Attributes aren't live state: a copied select would show its first
  // option and inputs their default values.
  function copyFormState(source, clone) {
    if (source instanceof HTMLSelectElement) {
      clone.selectedIndex = source.selectedIndex;
    } else if (source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement) {
      clone.value = source.value;
      if ('checked' in source) clone.checked = source.checked;
    }
  }

  // Cloning live media is wasteful or broken: an iframe clone reloads its page,
  // a video clone restarts (possibly with sound), a canvas clone is blank.
  // Replace them with a static snapshot instead.
  function makeSnapshot(source) {
    const tag = source.tagName.toLowerCase();

    if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
      const box = document.createElement('div');
      copyComputedStyles(source, box);
      box.style.background = 'rgba(128, 128, 128, 0.25)';
      return box;
    }

    if (tag === 'video' || tag === 'canvas') {
      const snap = document.createElement('canvas');
      snap.width = source.videoWidth || source.width || source.clientWidth;
      snap.height = source.videoHeight || source.height || source.clientHeight;
      try {
        snap.getContext('2d').drawImage(source, 0, 0, snap.width, snap.height);
      } catch (e) {
        // Not ready yet or zero-sized -- a blank box is fine
      }
      copyComputedStyles(source, snap);
      return snap;
    }

    return null;
  }

  // What a clone copies: every standard property. The list is the same for
  // every element, so it's read once. Custom properties (--*) are left out:
  // the properties that use them are copied with var() already resolved, and
  // design systems define thousands, which every element would otherwise
  // carry inline.
  let copiedProps = null;

  function copiedProperties() {
    if (!copiedProps) {
      const cs = window.getComputedStyle(document.documentElement);
      copiedProps = [];
      for (let i = 0; i < cs.length; i++) {
        if (!cs[i].startsWith('--')) copiedProps.push(cs[i]);
      }
    }
    return copiedProps;
  }

  function copyComputedStyles(source, clone, computed = window.getComputedStyle(source)) {
    const defaults = nativeControlDefaults(source, computed);
    let css = '';
    for (const prop of copiedProperties()) {
      const value = computed.getPropertyValue(prop);
      if (defaults && defaults.get(prop) === value) continue;
      css += `${prop}:${value};`;
    }
    clone.style.cssText = css;
  }

  // Natively drawn form controls switch to plain author styling as soon as a
  // border or background is set on them, so a clone given its original's
  // computed defaults would look different. Returns the browser's default
  // border/background values for this kind of control (measured once on a
  // probe inside a shadow root, out of reach of page CSS), so equal values
  // can be skipped. Values the page customized differ and are still copied.
  const CONTROL_TAGS = new Set(['input', 'button', 'select', 'textarea']);
  const controlDefaults = new Map();
  let probeRoot = null;

  function nativeControlDefaults(source, computed) {
    if (!CONTROL_TAGS.has(source.localName) || computed.appearance === 'none' || !overlay) return null;
    const key = `${source.localName}:${source.type ?? ''}`;
    if (!controlDefaults.has(key)) {
      if (!probeRoot) {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;visibility:hidden;';
        overlay.appendChild(host);
        probeRoot = host.attachShadow({ mode: 'closed' });
      }
      const probe = document.createElement(source.localName);
      if (source.localName === 'input') probe.type = source.type;
      probeRoot.appendChild(probe);
      const cs = window.getComputedStyle(probe);
      const values = new Map();
      for (const prop of copiedProperties()) {
        if (prop.startsWith('border') || prop.startsWith('background')) values.set(prop, cs.getPropertyValue(prop));
      }
      probe.remove();
      controlDefaults.set(key, values);
    }
    return controlDefaults.get(key);
  }

  // Decode CSS string escape sequences like "\f005" -> the icon-font character.
  function decodeCssString(s) {
    return s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
  }

  // Reify a ::before or ::after pseudo-element as a real span child of the clone.
  // Returns true if a span was inserted, false if there's no meaningful pseudo.
  function synthesizePseudo(source, clone, pseudo) {
    const cs = window.getComputedStyle(source, pseudo);
    const rawContent = cs.getPropertyValue('content');
    if (!rawContent || rawContent === 'none' || rawContent === 'normal' ||
        rawContent === '""' || rawContent === "''") {
      return false;
    }

    const span = document.createElement('span');
    let css = '';
    for (const prop of copiedProperties()) {
      css += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    span.style.cssText = css;
    // It's a real element now; clear 'content' so it doesn't act like a pseudo.
    span.style.content = 'normal';

    // Quoted strings (with possible \HEX escapes) become textContent. url(...)
    // is rendered via background-image, which was copied above.
    const strMatch = rawContent.match(/^["'](.*)["']$/);
    if (strMatch) {
      span.textContent = decodeCssString(strMatch[1]);
    }

    if (pseudo === '::before') {
      clone.insertBefore(span, clone.firstChild);
    } else {
      clone.appendChild(span);
    }
    return true;
  }

  // Overrides for copied computed styles that would fight the physics layout
  const PINNED_STYLES = {
    position: 'absolute',
    left: '0',
    top: '0',
    right: 'auto',
    bottom: 'auto',
    margin: '0',
    boxSizing: 'border-box',
    minWidth: '0',
    minHeight: '0',
    maxWidth: 'none',
    maxHeight: 'none',
    // A copied `transition: all .2s` would make the clone lag its body
    transition: 'none',
    animation: 'none',
    pointerEvents: 'none'
  };

  function pin(node, w, h) {
    Object.assign(node.style, PINNED_STYLES, { width: `${w}px`, height: `${h}px` });
  }

  // Top-level nodes moved by the frame loop. Their own translate/rotate/scale
  // would compose with the physics transform; nested nodes keep theirs (a
  // rotated chevron icon).
  function markPiece(node) {
    Object.assign(node.style, { translate: 'none', rotate: 'none', scale: 'none' });
    node.classList.add('physics-clone');
    node.style.transformOrigin = 'center center';
  }

  function makeClone(el, w, h) {
    const clone = freezeClone(el);
    pin(clone, w, h);
    keepCellAlignment(el, clone);
    markPiece(clone);
    return clone;
  }

  // An absolutely positioned clone of a table cell is a plain block, so its
  // vertical-align (middle by default) stops centering the content; a flex
  // column reproduces it. (Collapsed borders are handled by pieceRect.)
  function keepCellAlignment(el, clone) {
    const cs = window.getComputedStyle(el);
    if (cs.display !== 'table-cell') return;
    if (cs.verticalAlign === 'middle' || cs.verticalAlign === 'bottom') {
      Object.assign(clone.style, {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: cs.verticalAlign === 'middle' ? 'center' : 'flex-end'
      });
    }
  }

  // The box a whole clone occupies. A collapsed table border is shared with
  // the neighbouring cell and centred on the grid line, so the cell's box
  // holds only half of it; a clone draws its full border inside its own box.
  // Grow the box by half a border on each side so the line and the content
  // land exactly where they were.
  function pieceRect(el, rect) {
    const cs = window.getComputedStyle(el);
    if (cs.display !== 'table-cell' || cs.borderCollapse !== 'collapse') return rect;
    const half = (side) => parseFloat(cs[`border${side}Width`]) / 2;
    const left = rect.left - half('Left');
    const top = rect.top - half('Top');
    return {
      left,
      top,
      width: rect.width + half('Left') + half('Right'),
      height: rect.height + half('Top') + half('Bottom')
    };
  }

  // The box an element visibly occupies. A block's layout box can be much wider
  // than its text: a <p> beside a float spans the full column while its lines
  // are pushed narrower, and centered text only fills the middle. Sizing the
  // clone to the layout box would let text reflow across the float's space.
  function visualRect(el) {
    const rect = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const content = range.getBoundingClientRect();
    if (!content.width || content.width >= rect.width - 1) return rect;

    // A styled box (background, border) is visible at its full size. Flex
    // and grid items are placed by the container, not by text flow: in a
    // narrower copy they'd move (and the content rect includes their
    // relative offsets, which the copy would apply again).
    const cs = window.getComputedStyle(el);
    if (!isPlainBox(cs) || /flex|grid/.test(cs.display)) return rect;
    const left = Math.max(rect.left, content.left - parseFloat(cs.paddingLeft) - parseFloat(cs.borderLeftWidth));
    // +1px slack so subpixel rounding can't wrap the longest line
    const right = Math.min(rect.right, content.right + parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth) + 1);
    return { left, top: rect.top, width: right - left, height: rect.height };
  }

  // How much an element is drawn scaled on screen: its own `scale` and
  // `transform` times every ancestor's. Measured rects are in screen pixels
  // but copied styles (font sizes, widths) aren't, so a piece is built in the
  // original's own units and scaled by this (see pieceTransform). Rotation
  // doesn't change the length of a matrix's axes, so it doesn't count.
  let scaleCache = new Map(); // element -> { x, y }, reset each spawn

  function screenScale(el) {
    if (!el || el === document.documentElement) return { x: 1, y: 1 };
    let s = scaleCache.get(el);
    if (s) return s;
    const parent = screenScale(composedParent(el));
    const cs = window.getComputedStyle(el);
    let x = parent.x;
    let y = parent.y;
    if (cs.scale && cs.scale !== 'none') {
      const [sx, sy = sx] = cs.scale.split(' ').map(parseFloat);
      x *= sx;
      y *= sy;
    }
    if (cs.transform && cs.transform !== 'none') {
      const m = new DOMMatrixReadOnly(cs.transform);
      x *= Math.hypot(m.a, m.b);
      y *= Math.hypot(m.c, m.d);
    }
    // Absorb floating-point noise, so unscaled pieces stay pixel-exact
    s = { x: Math.abs(x - 1) < 1e-3 ? 1 : x, y: Math.abs(y - 1) < 1e-3 ? 1 : y };
    scaleCache.set(el, s);
    return s;
  }

  // --- Line splitting -----------------------------------------------------------

  // Elements that keep their own box inside a line and are cloned whole
  function isInlineAtom(el, cs) {
    return CONFIG.INLINE_ATOM_TAGS.has(el.tagName.toLowerCase()) ||
      cs.display.startsWith('inline-') || cs.float !== 'none' ||
      cs.position === 'absolute' || cs.position === 'fixed';
  }

  // Collects the block's visible contents in document order as tokens: one per
  // word (with its measured rect) and one per inline atom.
  function collectTokens(node, tokens, range, vh) {
    for (const child of composedChildren(node)) {
      if (child.nodeType === Node.TEXT_NODE) {
        collectWords(child, tokens, range, vh);
      } else if (child.nodeType === Node.ELEMENT_NODE && !CONFIG.NON_RENDERED_TAGS.has(child.localName)) {
        const cs = window.getComputedStyle(child);
        if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) continue;
        if (isInlineAtom(child, cs)) {
          const rect = child.getBoundingClientRect();
          if (rect.width && rect.height) tokens.push({ atom: child, rect });
        } else {
          collectTokens(child, tokens, range, vh);
        }
      }
    }
  }

  function collectWords(textNode, tokens, range, vh) {
    const text = textNode.data;
    if (!/\S/.test(text)) return;
    // Skip text entirely off-screen without measuring each word
    range.selectNodeContents(textNode);
    const whole = range.getBoundingClientRect();
    if (whole.bottom < 0 || whole.top > vh) return;

    const words = /\S+/g;
    let m;
    while ((m = words.exec(text))) {
      range.setStart(textNode, m.index);
      range.setEnd(textNode, m.index + m[0].length);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        // Keep a following space from the same text node, so decorations and
        // inline backgrounds span it (an underlined "a link") and the piece's
        // text reads normally
        const space = /\s/.test(text[m.index + m[0].length] ?? '') ? ' ' : '';
        if (rects[0].width) tokens.push({ textNode, text: m[0] + space, rect: rects[0] });
      } else if (rects.length > 1) {
        // Broken across lines (hyphenation, overflow-wrap): measure per character
        let offset = m.index;
        for (const ch of m[0]) {
          range.setStart(textNode, offset);
          range.setEnd(textNode, offset + ch.length);
          const rect = range.getBoundingClientRect();
          if (rect.width) tokens.push({ textNode, text: ch, rect });
          offset += ch.length;
        }
      }
    }
  }

  let measureCtx = null;
  const MARKER_SHAPES = new Set(['disc', 'circle', 'square']);

  // A list item's bullet or number is a ::marker, not a text node, so a split
  // <li> would lose it. Rebuild it as a token beside the first line: outside
  // markers end at the content edge, inside ones just before the first word.
  function listMarkerToken(li, cs, tokens) {
    if (cs.display !== 'list-item' || cs.listStyleImage !== 'none' || !tokens.length) return null;
    const siblings = [...li.parentElement.children].filter(c => c.tagName === 'LI');
    const start = li.parentElement instanceof HTMLOListElement ? li.parentElement.start : 1;
    const n = li.value > 0 ? li.value : start + siblings.indexOf(li);
    const text = PhysicsLib.markerText(cs.listStyleType, n);
    if (!text) return null;
    const type = cs.listStyleType;

    measureCtx ||= document.createElement('canvas').getContext('2d');
    // Built from longhands: Firefox returns an empty computed `font`
    measureCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const width = measureCtx.measureText(text).width;
    const first = tokens[0].rect;
    const rect = li.getBoundingClientRect();
    const outside = cs.listStylePosition !== 'inside';
    const right = outside
      ? rect.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft)
      : first.left;
    return {
      markerOf: li,
      text,
      // Outside markers are drawn by the browser (see splitLines): the exact
      // shape for bullets, the list's own counter style for numbers
      outside,
      listStyleType: MARKER_SHAPES.has(type) ? type : JSON.stringify(text),
      contentLeft: right,
      rect: { left: right - width, top: first.top, right, bottom: first.bottom, width, height: first.height }
    };
  }

  // Text styling for words whose text node lives in `parent`. Inherited
  // properties come from the parent; decorations and inline backgrounds (link
  // underlines, <mark>, <code>) are drawn by ancestors, so look up for those.
  function wordStyle(parent, block) {
    const cs = window.getComputedStyle(parent);
    let css = 'all:initial;position:absolute;white-space:pre;';
    for (const prop of CONFIG.TEXT_STYLE_PROPS) {
      css += `${prop}:${cs.getPropertyValue(prop)};`;
    }
    let decorated = false;
    let background = false;
    for (let el = parent; el; el = el === block ? null : composedParent(el)) {
      const acs = el === parent ? cs : window.getComputedStyle(el);
      if (!decorated && acs.textDecorationLine !== 'none') {
        // Longhands: Firefox returns an empty computed `text-decoration`
        css += `text-decoration-line:${acs.textDecorationLine};` +
          `text-decoration-style:${acs.textDecorationStyle};` +
          `text-decoration-color:${acs.textDecorationColor};` +
          `text-decoration-thickness:${acs.textDecorationThickness};`;
        decorated = true;
      }
      if (!background && el !== block && !isTransparent(acs.backgroundColor)) {
        css += `background-color:${acs.backgroundColor};`;
        background = true;
      }
    }
    return css;
  }

  // Splits a plain text block into one piece per visual line. Each word is
  // absolutely positioned at its measured offset, so wrapping, justification
  // and mixed fonts come out exactly as on the page.
  // With `directOnly`, only the block's own text nodes are used (loose text in
  // an element whose children are thrown separately).
  function splitLines(block, directOnly = false) {
    const { width: vw, height: vh } = viewport;
    const tokens = [];
    const range = document.createRange();
    if (directOnly) {
      for (const child of composedChildren(block)) {
        if (child.nodeType === Node.TEXT_NODE) collectWords(child, tokens, range, vh);
      }
    } else {
      collectTokens(block, tokens, range, vh);
    }

    const cs = window.getComputedStyle(block);
    const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    if (!directOnly) {
      const marker = listMarkerToken(block, cs, tokens);
      if (marker) tokens.unshift(marker);
    }

    const lines = PhysicsLib.groupLines(tokens, lineHeight);
    // Tokens are measured on screen; the piece is laid out in the block's
    // own (unscaled) units and scaled back by its transform
    const scale = screenScale(block);

    const styles = new Map();
    const pieces = [];
    for (const l of lines) {
      const w = l.right - l.left;
      const h = l.bottom - l.top;
      if (w < CONFIG.MIN_LINE_SIZE || h < CONFIG.MIN_LINE_SIZE) continue;
      // Off-screen lines stay hidden with their block; partly visible ones
      // are thrown and pass through the walls until they're inside.
      if (l.bottom <= 0 || l.top >= vh || l.right <= 0 || l.left >= vw) continue;

      // The piece's box is padded vertically: its compositing layer (from
      // will-change) clips glyph ink, and descenders hang below the tight
      // line box. The physics body still uses the exact line size.
      const pad = Math.ceil(h / scale.y * 0.3);
      const wrap = document.createElement('div');
      wrap.style.cssText = 'all:initial;display:block;';
      // Screen position within the line -> the piece's own units
      const localX = (x) => (x - l.left) / scale.x;
      const localY = (y) => (y - l.top) / scale.y;
      for (const t of l.tokens) {
        let node;
        let left;
        if (t.atom) {
          // Size by the untransformed layout box and center on the measured
          // one, so a copied transform (a rotated chevron) applies once, not twice.
          const aw = t.atom.offsetWidth ?? t.rect.width / scale.x;
          const ah = t.atom.offsetHeight ?? t.rect.height / scale.y;
          node = freezeClone(t.atom);
          pin(node, aw, ah);
          left = localX(t.rect.left + t.rect.width / 2) - aw / 2;
          node.style.top = `${localY(t.rect.top + t.rect.height / 2) - ah / 2 + pad}px`;
        } else {
          // Composed parent: text directly in a shadow root has no parentElement,
          // and slotted text inherits its styles through the slot
          const parent = t.markerOf ?? composedParent(t.textNode);
          if (!styles.has(parent)) {
            styles.set(parent, {
              css: wordStyle(parent, block),
              lineHeight: parseFloat(window.getComputedStyle(parent).lineHeight)
            });
          }
          const style = styles.get(parent);
          node = document.createElement('span');
          node.style.cssText = style.css;
          // The original line height, offset by the same half-leading, puts
          // the glyph box (t.rect) exactly where it was and rounds the
          // baseline to pixels the same way. Chrome floors the leading above
          // the glyphs to whole pixels. (`normal` line height: use the glyph
          // box itself.)
          const glyphHeight = t.rect.height / scale.y;
          const lineHeight = Number.isFinite(style.lineHeight) ? style.lineHeight : glyphHeight;
          const leadingAbove = Math.floor((lineHeight - glyphHeight) / 2);
          node.style.lineHeight = `${lineHeight}px`;
          node.textContent = t.text;
          node.style.top = `${localY(t.rect.top) - leadingAbove + pad}px`;
          left = localX(t.rect.left);
          if (t.outside) {
            // A zero-width list item at the content edge: the browser draws
            // its marker just outside it, exactly where the original's was
            Object.assign(node.style, {
              display: 'list-item',
              listStylePosition: 'outside',
              listStyleType: t.listStyleType,
              width: '0px'
            });
            node.textContent = '\u200b';
            left = localX(t.contentLeft);
          }
        }
        node.style.left = `${left}px`;
        wrap.appendChild(node);
      }
      pin(wrap, w / scale.x, h / scale.y + pad * 2);
      markPiece(wrap);
      pieces.push({ node: wrap, pad, scale, rect: { left: l.left, top: l.top, width: w, height: h } });
    }
    return pieces;
  }

  // --- Spawning -----------------------------------------------------------------

  // An empty copy of a styled box: its background, border and shadow, but
  // none of the contents, which are thrown as pieces of their own.
  function makeShell(el, w, h) {
    const shell = shallowCopy(el);
    copyComputedStyles(el, shell);
    pin(shell, w, h);
    markPiece(shell);
    return shell;
  }

  // rect is on screen; a whole piece is built at its unscaled size (see
  // screenScale)
  function piecesFor(el, kind, rect) {
    switch (kind) {
      case 'split': return splitLines(el);
      case 'loose': return splitLines(el, true);
      case 'shell': {
        const scale = screenScale(el);
        return [{ node: makeShell(el, rect.width / scale.x, rect.height / scale.y), rect, scale }];
      }
      default: {
        const box = pieceRect(el, rect);
        const scale = screenScale(el);
        return [{ node: makeClone(el, box.width / scale.x, box.height / scale.y), rect: box, scale }];
      }
    }
  }

  // Hides what a piece replaced without changing layout: whole elements and
  // split blocks go invisible, shells lose their box painting, and loose text
  // is blanked through a CSS highlight (no DOM changes to the text itself).
  // Hiding uses inline !important styles rather than classes: the extension's
  // stylesheet doesn't reach inside shadow roots, and inline !important beats
  // page rules. The original style attribute is restored verbatim.
  // transition: none -- a page's `transition: all` would otherwise animate
  // the hiding, leaving the original visible under its piece for a moment
  const HIDE_ELEMENT = { visibility: 'hidden', transition: 'none' };
  const HIDE_BOX = {
    transition: 'none',
    background: 'none',
    'border-color': 'transparent',
    'box-shadow': 'none',
    'outline-color': 'transparent'
  };
  let hiddenStyles = new Map(); // element -> original style attribute (or null)
  let highlightSheet = null;
  let highlightRoots = new Set();

  function hideWith(el, props) {
    if (!hiddenStyles.has(el)) hiddenStyles.set(el, el.getAttribute('style'));
    for (const [prop, value] of Object.entries(props)) el.style.setProperty(prop, value, 'important');
  }

  function hideOriginal(el, kind, hiddenText) {
    if (kind === 'shell') {
      hideWith(el, HIDE_BOX);
    } else if (kind === 'loose') {
      for (const child of composedChildren(el)) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.selectNodeContents(child);
        hiddenText.push(range);
        const root = child.getRootNode();
        if (root instanceof ShadowRoot) adoptHighlightRule(root);
      }
    } else {
      hideWith(el, HIDE_ELEMENT);
    }
  }

  // The ::highlight rule in styles.css doesn't reach into shadow roots either,
  // so roots with hidden loose text adopt a one-rule sheet of their own.
  function adoptHighlightRule(root) {
    if (highlightRoots.has(root)) return;
    try {
      if (!highlightSheet) {
        highlightSheet = new CSSStyleSheet();
        highlightSheet.replaceSync(`::highlight(${CONFIG.HIDDEN_TEXT_HIGHLIGHT}) {
          color: transparent; text-shadow: none; text-decoration-color: transparent; }`);
      }
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, highlightSheet];
      highlightRoots.add(root);
    } catch (e) {
      // Constructable stylesheets unavailable here; that text just stays put
    }
  }

  function restoreOriginals() {
    for (const [el, style] of hiddenStyles) {
      // Set the attribute even when removing it: Chrome writes CSSOM changes
      // back to the attribute lazily, and a bare removeAttribute would leave a
      // pending write-back that later reappears as style="".
      el.setAttribute('style', style ?? '');
      if (style === null) el.removeAttribute('style');
    }
    // A page's `transition: all` would fade a box's background and border
    // back in (hiding sets transition: none for the same reason); jump them
    // to the end so the page is back as it was at once. getAnimations()
    // flushes styles, which is what starts those transitions.
    for (const el of hiddenStyles.keys()) {
      for (const animation of el.getAnimations()) {
        if (animation instanceof CSSTransition) animation.finish();
      }
    }
    hiddenStyles = new Map();
    if (window.CSS?.highlights) CSS.highlights.delete(CONFIG.HIDDEN_TEXT_HIGHLIGHT);
    for (const root of highlightRoots) {
      root.adoptedStyleSheets = root.adoptedStyleSheets.filter(sheet => sheet !== highlightSheet);
    }
    highlightRoots = new Set();
  }

  function clearSpawnCaches() {
    overlapCache = new Map();
    parentCache = new Map();
    scaleCache = new Map();
  }

  function spawnClones() {
    clearSpawnCaches();
    const selected = selectElements()
      .map(({ el, kind, order }) => ({ el, kind, order, rect: kind === 'shell' ? el.getBoundingClientRect() : visualRect(el) }))
      // Smallest first -- when capped, keep granular pieces over big chunks
      .sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));

    // Phase 1, reads only: build every piece as a detached node. Any DOM write
    // here (hiding an original, attaching a clone) would invalidate styles and
    // make the next getComputedStyle recalculate the whole page.
    const planned = [];
    let count = 0;
    for (const { el, kind, order, rect } of selected) {
      if (count >= CONFIG.MAX_PHYSICS_BODIES) break;
      const pieces = piecesFor(el, kind, rect);
      // All of an element's pieces or none: hiding the original with only
      // some of its lines spawned would make the rest vanish.
      if (!pieces.length || count + pieces.length > CONFIG.MAX_PHYSICS_BODIES) continue;
      // Where the original is now, to find it again when restoring (the page
      // may have scrolled by then)
      planned.push({ el, kind, order, pieces, anchor: el.getBoundingClientRect() });
      count += pieces.length;
    }
    clearSpawnCaches(); // phase 2 changes what they describe

    // Phase 2, writes. Attach in flat-tree order so stacking matches the page:
    // a shell comes before (under) the pieces that were inside it.
    planned.sort((a, b) => a.order - b.order);
    const hiddenText = [];
    for (const { el, kind, pieces, anchor } of planned) {
      hideOriginal(el, kind, hiddenText);
      for (const { node, rect: r, pad = 0, scale = { x: 1, y: 1 } } of pieces) {
        overlay.appendChild(node);
        const body = Matter.Bodies.rectangle(
          r.left + r.width / 2,
          r.top + r.height / 2,
          Math.max(r.width, CONFIG.MIN_BODY_SIZE),
          Math.max(r.height, CONFIG.MIN_BODY_SIZE),
          {
            restitution: settings.restitution,
            friction: settings.friction,
            frictionAir: settings.frictionAir,
            density: settings.density,
            collisionFilter: newFilter()
          }
        );
        body.collisionFilter.ghosts = new Set();
        Matter.Composite.add(world, body);
        // w/h are the DOM box (centered on the body), including any padding,
        // in the piece's own units (scaled on screen by `scale`).
        // The box's sub-pixel offset goes into left/top rather than the
        // transform: a fractional translation stops Chrome snapping borders
        // to pixels, so crisp 1px lines would render blurred. At spawn the
        // transform then carries whole pixels only.
        const w = r.width / scale.x;
        const h = r.height / scale.y + pad * 2;
        // Where the unscaled box's corner goes (r.left, r.top - pad unscaled)
        const left = r.left + (r.width - w) / 2;
        const top = r.top + (r.height - h) / 2;
        const fx = left - Math.floor(left);
        const fy = top - Math.floor(top);
        node.style.left = `${fx}px`;
        node.style.top = `${fy}px`;
        items.push({ clone: node, body, w, h, fx, fy, scale, homeX: body.position.x, homeY: body.position.y, el, anchor });
      }
    }

    if (hiddenText.length) {
      CSS.highlights.set(CONFIG.HIDDEN_TEXT_HIGHLIGHT, new Highlight(...hiddenText));
    }
    ghostSpawnOverlaps();
    console.debug(`Physics: created ${items.length} pieces.`);
  }

  // --- Frame loop ---------------------------------------------------------------

  // Moving pieces get their own GPU layer (will-change) so animating them is
  // cheap; resting ones are painted normally, because a layer rounds its
  // sub-pixel offset differently and shifts text by a pixel. So pieces at
  // their spawn position are pixel-identical to the page they replace.
  const MOVING_SPEED = 0.05;
  const RESTING_SPEED = 0.01;

  function updateLayer(item) {
    const motion = item.body.speed + Math.abs(item.body.angularSpeed) * 20;
    const moving = item.moving ? motion > RESTING_SPEED : motion > MOVING_SPEED;
    if (moving !== !!item.moving) {
      item.moving = moving;
      item.clone.style.willChange = moving ? 'transform' : 'auto';
    }
  }

  // Absorbs floating-point noise so a piece at rest in its spawn position gets
  // an exactly whole-pixel translation
  function snapToPixel(v) {
    const rounded = Math.round(v);
    return Math.abs(v - rounded) < 0.01 ? rounded : v;
  }

  // The transform that puts a piece's center at (x, y), turned by `angle`,
  // at the size the page drew it (scaled about its center)
  function pieceTransform({ w, h, fx, fy, scale }, x, y, angle) {
    const t = `translate(${snapToPixel(x - w / 2 - fx)}px, ${snapToPixel(y - h / 2 - fy)}px) rotate(${angle}rad)`;
    return scale.x === 1 && scale.y === 1 ? t : `${t} scale(${scale.x}, ${scale.y})`;
  }

  // Transform-only writes: no layout reads, no left/top reflow. Also checks the
  // window position every frame so sloshing is smooth.
  function renderFrame() {
    pollWindowPosition();
    if (!isPhysicsEnabled) return; // Orphaned and shut down by the poll
    for (const item of items) {
      const { x, y } = item.body.position;
      item.clone.style.transform = pieceTransform(item, x, y, item.body.angle);
      updateLayer(item);
    }
    frameId = requestAnimationFrame(renderFrame);
  }

  // --- Toggle + teardown --------------------------------------------------------

  // --- Restore button -----------------------------------------------------------

  // The on-page "Restore page" button (restore-button.js), unless hidden in
  // the settings
  function showRestoreButton() {
    if (!settings.hideRestoreButton) PhysicsRestoreButton.show(() => setPhysicsEnabled(false));
  }

  function removeRestoreButton() {
    PhysicsRestoreButton.hide();
  }

  function setPhysicsEnabled(on, { animate = true } = {}) {
    if (on === isPhysicsEnabled || !document.body) return;
    // An orphaned copy (see retire) can't start: the restore button needs
    // chrome.i18n, which throws "Extension context invalidated" there
    if (on && !chrome.runtime?.id) return retire();
    isPhysicsEnabled = on;

    if (on) {
      finishRestoring();
      try {
        initPhysics();
        spawnClones();
      } catch (e) {
        console.error('Physics: failed to start.', e);
      }
      // Nothing to throw (or it broke partway): don't leave the canvas
      // covering a page that looks untouched but no longer takes clicks
      if (!items.length) {
        tearDown();
        isPhysicsEnabled = false;
        notifyState();
        return;
      }
      renderFrame();
      showRestoreButton();
      document.body.classList.add('physics-mode');
      document.addEventListener('contextmenu', preventDefault, true);
      document.addEventListener('keydown', onKeyDown, true);
    } else {
      if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) glideHome();
      else tearDown();
      shakeDetector.cooldown(performance.now() + CONFIG.SHAKE_COOLDOWN);
    }

    notifyState();
  }

  // Stops the simulation and animates every piece back to its original, then
  // tears down. The pieces look exactly like the page at home, so the swap
  // back to the real page doesn't show.
  function glideHome() {
    cancelAnimationFrame(frameId);
    Matter.Runner.stop(runner);
    canvas.remove(); // Nothing left to grab; the page is usable again
    removeRestoreButton();

    // Reads first: where each original is now, relative to when it spawned.
    // One layout for all of them (nothing has been written yet).
    const shifts = new Map();
    for (const { el, anchor } of items) {
      if (shifts.has(el)) continue;
      const now = el.getBoundingClientRect();
      // Gone from the layout since (display: none): go back to where it was
      shifts.set(el, now.width || now.height
        ? { x: now.left - anchor.left, y: now.top - anchor.top }
        : { x: 0, y: 0 });
    }

    // Unwind rotation the short way (a piece that spun 3.5 turns turns back
    // half a turn), committing that angle before the transition starts from it
    for (const item of items) {
      const { x, y } = item.body.position;
      const a = item.body.angle % (2 * Math.PI);
      item.angle = a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a;
      item.clone.style.transform = pieceTransform(item, x, y, item.angle);
      item.clone.style.willChange = 'transform';
    }
    getComputedStyle(overlay).transform; // Style flush: starts the transitions from here

    let longest = 0;
    for (const item of items) {
      const shift = shifts.get(item.el);
      const x = item.homeX + shift.x;
      const y = item.homeY + shift.y;
      const { position } = item.body;
      const distance = Math.hypot(x - position.x, y - position.y) + Math.abs(item.angle) * Math.max(item.w, item.h) / 2;
      const ms = clamp(CONFIG.RESTORE_MIN_MS + distance * CONFIG.RESTORE_MS_PER_PX, CONFIG.RESTORE_MIN_MS, CONFIG.RESTORE_MAX_MS);
      longest = Math.max(longest, ms);
      item.clone.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.3, 1)`;
      item.clone.style.transform = pieceTransform(item, x, y, 0);
    }
    restoreTimer = setTimeout(finishRestoring, longest + 50);
  }

  // Ends a glide home now (if one is running)
  function finishRestoring() {
    if (!restoreTimer) return;
    clearTimeout(restoreTimer);
    restoreTimer = null;
    tearDown();
  }

  function tearDown() {
    cancelAnimationFrame(frameId);
    removeRestoreButton();
    restoreOriginals();
    items = [];
    walls = [];
    ghostPairs = [];

    overlay?.remove();
    canvas?.remove();
    if (runner) Matter.Runner.stop(runner);
    if (engine) Matter.Engine.clear(engine);
    engine = runner = world = mouseConstraint = overlay = canvas = probeRoot = null;

    document.body.classList.remove('physics-mode');
    if (!document.body.classList.length) document.body.removeAttribute('class');
    document.removeEventListener('contextmenu', preventDefault, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function preventDefault(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      preventDefault(e);
      if (restoreTimer) finishRestoring();
      else setPhysicsEnabled(false);
    }
  }

  // Lets the background worker show an ON badge on the toolbar icon.
  function notifyState() {
    try {
      chrome.runtime.sendMessage({ action: 'physicsStateChanged', isEnabled: isPhysicsEnabled })
        .catch(() => {});
    } catch (e) {
      // Extension was reloaded; this content script is orphaned
    }
  }

  // --- Messaging ----------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'togglePhysics') {
      setPhysicsEnabled(!isPhysicsEnabled);
      sendResponse({ isEnabled: isPhysicsEnabled });
    } else if (request.action === 'getPhysicsState') {
      sendResponse({ isEnabled: isPhysicsEnabled });
    }
  });

  // --- Shake detection ----------------------------------------------------------

  // Title-bar drags happen outside the page, so no mouse events arrive: watch
  // the window's own screen position instead (see PhysicsLib.createShakeDetector).
  const shakeDetector = PhysicsLib.createShakeDetector(() => settings);
  let lastX = window.screenX;
  let lastY = window.screenY;

  function pollWindowPosition() {
    if (!chrome.runtime?.id) {
      retire();
      return;
    }
    const dx = window.screenX - lastX;
    const dy = window.screenY - lastY;
    if (!dx && !dy) return;
    lastX += dx;
    lastY += dy;
    if (isPhysicsEnabled) {
      slosh(dx, dy);
    } else if (shakeDetector.move(dx, dy, performance.now())) {
      setPhysicsEnabled(true);
    }
  }

  // While physics is on, moving the window drags the walls under the bodies,
  // so the contents slosh around like they're in a box being shaken.
  function slosh(dx, dy) {
    const k = CONFIG.WINDOW_INERTIA;
    const max = CONFIG.MAX_SLOSH_SPEED;
    for (const { body } of items) {
      const v = Matter.Body.getVelocity(body);
      Matter.Body.setVelocity(body, {
        x: clamp(v.x - dx * k, -max, max),
        y: clamp(v.y - dy * k, -max, max)
      });
    }
  }

  const pollTimer = setInterval(pollWindowPosition, CONFIG.POSITION_POLL_MS);

  // After the extension is updated, reloaded or disabled, this script keeps
  // running in tabs that were already open, but its chrome.* APIs are gone.
  // Give the page back and stop watching for shakes; the new version takes
  // over when the tab is reloaded or the toolbar icon injects it.
  function retire() {
    clearInterval(pollTimer);
    setPhysicsEnabled(false, { animate: false });
    finishRestoring();
    window.__physicsExtensionLoaded = false;
  }
})();
