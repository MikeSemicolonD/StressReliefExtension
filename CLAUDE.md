# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser extension (Chrome/Firefox compatible, Manifest V3) that adds interactive physics to web page elements. Users can shake their browser window to activate physics mode, then drag and throw page elements around with realistic physics simulation powered by Matter.js.

## Architecture

### Extension Structure

The extension follows the standard Chrome Extension Manifest V3 architecture with three main components:

1. **Background Service Worker** ([background.js](background.js))
   - Minimal implementation that listens for extension icon clicks
   - Forwards toggle messages to content script

2. **Content Script** ([content.js](content.js))
   - Core physics engine implementation using Matter.js
   - Runs on all web pages (`<all_urls>`)
   - Manages physics world lifecycle and element tracking
   - Handles shake detection via mouse movement monitoring
   - Preserves original page state for restoration

3. **Settings Popup** ([settings.html](settings.html), [settings.js](settings.js))
   - Provides UI for adjusting physics parameters and shake detection
   - Persists settings via chrome.storage.local
   - Real-time updates to active content scripts

### Physics Implementation

The extension uses Matter.js for 2D physics simulation. Key implementation details:

- **Physics Bodies**: Created for `div`, `p`, `img`, and `button` elements that meet minimum size requirements (10px x 10px)
- **World Boundaries**: Static walls on all four edges prevent elements from escaping viewport
- **Element Mapping**: A Map structure tracks DOM elements to their corresponding physics bodies
- **Style Preservation**: Original inline styles are saved before physics activation and fully restored on deactivation
- **Rendering Loop**: Uses `requestAnimationFrame` to sync DOM element positions/rotations with physics body state

### Shake Detection

Window shaking activates physics mode through mouse movement tracking:

- Monitors mouse movement when near window edges (within 50px threshold)
- Tracks rapid position changes above configurable threshold
- Requires multiple shakes within time window before activation
- Configurable parameters: threshold (px), time window (ms), required shake count

### Settings Management

All settings persist via `chrome.storage.local`:
- **Physics parameters**: gravity, restitution, friction, density, stiffness
- **Shake detection**: shakeThreshold, timeWindow, requiredShakes
- Settings changes trigger physics body recreation with new parameters
- Default values defined in DEFAULT_SETTINGS constant in [settings.js](settings.js:3-12)

## Development

### Testing the Extension

**Chrome/Edge/Brave:**
```bash
# Navigate to chrome://extensions/
# Enable "Developer mode"
# Click "Load unpacked" and select this directory
```

**Firefox:**
```bash
# Navigate to about:debugging#/runtime/this-firefox
# Click "Load Temporary Add-on"
# Select manifest.json
```

### File Dependencies

- **matter.min.js**: External physics engine library (Matter.js)
- **manifest.json**: Extension configuration and permissions
- All content scripts and styles inject into every page via manifest

### Key Code Patterns

**Toggling Physics** ([content.js](content.js:161-217)):
- `togglePhysics()` manages complete lifecycle
- Creates/destroys physics engine
- Adds/removes event listeners
- Restores original DOM state on disable

**Body Creation** ([content.js](content.js:94-125)):
- `createPhysicsBodies()` scans DOM for eligible elements
- Stores original inline styles before modification
- Creates Matter.js bodies with current settings
- Maintains Map of element-to-body associations

**Settings Updates** ([content.js](content.js:235-263)):
- `updatePhysicsSettings()` rebuilds physics world with new parameters
- Temporarily restores DOM state during rebuild
- Recreates all bodies and constraints

## Important Notes

- Physics bodies are created only for visible elements with minimum dimensions
- Original page layout is preserved and fully restored when physics is disabled
- The extension intercepts drag/drop and context menu events when physics is active
- Mouse constraints use invisible canvas overlay for drag interactions
- Shake detection only activates when mouse is near window edges (simulating title bar drag)
