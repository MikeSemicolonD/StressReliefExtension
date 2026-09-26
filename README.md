# Screen Shake Stress Reliever Extension

Ever get so mad you grab and shake the browser window? Well this is the perfect extension for you!

This was greatly inspired by [Stress Reducers for Windows](https://www.mobygames.com/game/34040/stress-reducers/) made in 2000.

> Development assisted by Claude AI

## Installation

### Chrome/Edge/Brave

1. Download or clone this repository to your computer
2. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/` for Edge)
3. Enable "Developer mode" using the toggle in the top right corner
4. Click "Load unpacked" button
5. Select the folder containing this extension
6. The extension is now installed! You should see the extension icon in your toolbar

### Firefox

1. Download or clone this repository to your computer
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Navigate to the extension folder and select the `manifest.json` file
5. The extension is now installed temporarily (will be removed when Firefox restarts)

## Usage

1. Grab your browser window by its title bar and shake it side to side (or click the extension icon)
2. The page's content breaks loose -- drag and throw the pieces around
3. Keep moving the window while physics is on and everything sloshes around inside it
4. Press **Esc** or click the icon again to put the page back exactly as it was

Right-click the extension icon and choose **Options** to tune the physics and how hard you have to shake.

## Development and releasing

Work happens on the `staging` branch and reaches `main` through pull requests.

- **CI** (`.github/workflows/ci.yml`) builds, syntax-checks and lints the extension on every push to `staging` and every pull request into `main`.
- **Release** (`.github/workflows/release.yml`) runs on every push to `main`. If the `"version"` in `manifest.json` hasn't been released yet, it tags the commit `v<version>`, publishes a GitHub release with the packaged `.zip`, and submits that version to each extension store. Pushes that don't bump the version are built and checked but not released.

To cut a release: bump `"version"` in `manifest.json` on `staging`, then merge `staging` into `main`.

### Extension stores

Each store has its own workflow, called by Release and also runnable by hand from the Actions tab (to retry one store for an existing tag). Each one skips itself until its credentials exist, so stores can be added one at a time. The first upload to each store must be done by hand, which creates the listing. After that:

| Store | Workflow | Repository variable | Secrets |
|---|---|---|---|
| Firefox Add-ons | `publish-firefox.yml` | – | `AMO_API_KEY`, `AMO_API_SECRET` |
| Chrome Web Store | `publish-chrome.yml` | `CHROME_EXTENSION_ID` | `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` |
| Edge Add-ons | `publish-edge.yml` | `EDGE_PRODUCT_ID` | `EDGE_CLIENT_ID`, `EDGE_API_KEY` |

Where to get each credential is described at the top of its workflow file. Secrets can be stored on the matching GitHub environment (`firefox`, `chrome-web-store`, `edge-addons`), which also lets you require a manual approval before a store deployment.
