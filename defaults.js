// Shared by content.js and settings.js. Assigned to `self` (not a const) so a
// second injection into the same page doesn't throw a redeclaration error.
self.PHYSICS_DEFAULTS = Object.freeze({
  gravity: 0,          // Top-down by default: no pull toward the bottom
  frictionAir: 0.02,   // Air drag so thrown clones decelerate naturally
  restitution: 0.5,
  friction: 0.1,
  density: 0.001,
  stiffness: 0.2,
  shakeDistance: 40,   // Window travel (px) a swing needs before reversing to count
  minShakeSpeed: 150,  // Average speed (px/s) a swing needs, so slow window moves don't count
  requiredShakes: 4,   // Swings (direction reversals) needed to activate
  timeWindow: 1500,    // ms within which those swings must happen
  hideRestoreButton: false // The on-page "Restore page" button shows while physics is on
});
