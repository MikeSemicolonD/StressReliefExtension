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

## Releasing

Releases are built by the GitHub Actions workflow in `.github/workflows/release.yml`.

1. Bump `"version"` in `manifest.json` (e.g. to `1.1`) and commit it
2. Tag that commit with the same version and push the tag:
   ```bash
   git tag v1.1
   git push origin v1.1
   ```
3. The workflow checks the tag matches the manifest, packages only the extension's files, lints the package for Firefox, and publishes a GitHub release with the `.zip` attached. The same zip can be uploaded to the Chrome Web Store and to addons.mozilla.org.

To also attach a signed Firefox `.xpi` (installable without the store), add `AMO_API_KEY` and `AMO_API_SECRET` repository secrets using keys from [addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/).
