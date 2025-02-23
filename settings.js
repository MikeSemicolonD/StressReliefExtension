let physicsOn = false;

const DEFAULT_SETTINGS = {
    gravity: 0.5,
    restitution: 0.7,
    friction: 0.3,
    density: 0.001,
    stiffness: 0.2,
    shakeThreshold: 100,
    timeWindow: 1000,
    requiredShakes: 5
};

function updateToggleButton(isEnabled) {
  const toggleButton = document.getElementById('togglePhysics');
  toggleButton.textContent = isEnabled ? 'Disable Physics' : 'Enable Physics';
  toggleButton.classList.remove(isEnabled ? 'disabled' : 'enabled');
  toggleButton.classList.add(isEnabled ? 'enabled' : 'disabled');
}

document.addEventListener('DOMContentLoaded', () => {
  // Check current state when popup opens
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "getPhysicsState" }, (response) => {
      if (response && response.isEnabled !== undefined) {
        updateToggleButton(response.isEnabled);
      }
    });
  });

  // Load saved settings
  chrome.storage.local.get({
    gravity: 0.5,
    restitution: 0.7,
    friction: 0.3,
    density: 0.001,
    stiffness: 0.2
  }, (settings) => {
    Object.entries(settings).forEach(([key, value]) => {
      const slider = document.getElementById(key);
      const valueDisplay = document.getElementById(`${key}Value`);
      if (slider && valueDisplay) {
        slider.value = value;
        valueDisplay.textContent = value;
      }
    });
  });

  // Handle slider changes
  const sliders = document.querySelectorAll('.slider');
  sliders.forEach(slider => {
    slider.addEventListener('input', (e) => {
      const valueDisplay = document.getElementById(`${e.target.id}Value`);
      if (valueDisplay) {
        valueDisplay.textContent = e.target.value;
      }
      
      // Save settings
      chrome.storage.local.set({
        [e.target.id]: parseFloat(e.target.value)
      });

      // Send settings to content script
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateSettings",
          settings: {
            [e.target.id]: parseFloat(e.target.value)
          }
        });
      });
    });
  });

  // Handle toggle button
  // Listen for physics state changes from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "physicsStateChanged") {
      updateToggleButton(request.isEnabled);
    }
  });

  // Handle toggle button
  document.getElementById('togglePhysics').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      physicsOn = !physicsOn
      chrome.tabs.sendMessage(tabs[0].id, { action: "togglePhysics" });
    });
  });

  // Handle reset button
  document.getElementById('resetSettings').addEventListener('click', () => {
    // Show confirmation dialog
    const confirmed = confirm("Are you sure you want to reset all settings to their default values?");
    
    if (confirmed) {
      // Update UI
      Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
        const slider = document.getElementById(key);
        const valueDisplay = document.getElementById(`${key}Value`);
        if (slider && valueDisplay) {
          slider.value = value;
          valueDisplay.textContent = value;
        }
      });

      // Save default settings
      chrome.storage.local.set(DEFAULT_SETTINGS);

      // Send settings to content script
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: "updateSettings",
          settings: DEFAULT_SETTINGS
        });
      });
    }
  });
});