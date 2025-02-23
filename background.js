chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: "togglePhysics" });
});

/*var mouseDownPos = {x: 0, y: 0};

var mousePositions = [];

var shakeTimer = null;

const shakeCheckTimeMilliseconds = 50;
const maxShakeThreshold = 50;

window.addEventListener("mousedown", handleMouseDown);
window.addEventListener("mouseup", handleMouseUp);
window.addEventListener("mousemove", handleMouseMove);

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  // Check if the message is a shake event
  if (message.type == "shake") {

    if(!usingPhysics) {

        // Count to 5 shakes before Initializing
        if(currentShakeCount < maxShakeCount) {
    
            if(resetShakeCountTimer != null) {
                clearInterval(resetShakeCountTimer);
                resetShakeCountTimer = null;
            }
    
            resetShakeCountTimer = setInterval(resetShakeCount, resetShakeCountTimeMilliseconds);
    
            currentShakeCount++;
    
            return;
        }
        else
        {
            resetShakeCount();
        }

        // Add physics to the HTML objects on the page
        initializeWorld();
    }

    if(usingPhysics) {
        // Add force relative to mouse velocity
        addForceToAllObjects(message.velocityX, message.velocityY);
    }
  }
});

// Add a listener for the chrome.runtime.onConnect event
chrome.runtime.onConnect.addListener(function(port) {
  // Check the name of the port
  if (port.name == "popup") {
    // Create a port to communicate with the pop-up
    var popupPort = port;

    // Add a listener for the message event
    popupPort.onMessage.addListener(function(message) {
      // Check the type of the message
      if (message.type == "get-variables") {
        // Send the current values of the global variables to the pop-up
        popupPort.postMessage({ type: "variables", gravity: gravity, mass: mass });
      } else if (message.type == "set-variables") {
        // Update the global variables with the values from the pop-up
        gravity = message.gravity;
        mass = message.mass;
      }});
    }
  });

function handleMouseUp(event) {
    // Set the dragging variable to false
    dragging = false;

    // Clear the array
    mousePositions = [];

    if(shakeTimer != null) {
        clearInterval(shakeTimer);
        shakeTimer = null;
    }
}
  
function handleMouseDown(event) {
    // Set the dragging variable to true
    dragging = true;
  
    // Store the current mouse position
    mouseDownPos = {x: event.clientX, y: event.clientY};

    // Start an array to hold the mouse positions over time
    mousePositions = [];
  
    // Start a timer to check for a shake event
    shakeTimer = setInterval(checkForShake, shakeCheckTimeMilliseconds);
}


function handleMouseMove(event) {
      // If an element is currently being dragged
      if (dragging && usingPhysics) {
        // Get the element being dragged
        var element = document.elementFromPoint(event.clientX, event.clientY);
    
        // If the element has a physics body
        if (element.physicsBody) {
          // Calculate the force to apply to the body based on the difference between the current mouse position and the previous mouse position
          var forceX = (event.clientX - mousePos.x) * element.physicsBody.mass;
          var forceY = (event.clientY - mousePos.y) * element.physicsBody.mass;
    
          // Apply the force to the body
          element.physicsBody.applyForce([forceX, forceY]);
        }
    
        // Store the current mouse position
        mousePos = {x: event.clientX, y: event.clientY};

        mousePositions.push(mousePos);
      }
}


function resetShakeCount() {

    currentShakeCount = 0;

    clearInterval(resetShakeCountTimer);
    resetShakeCountTimer = null;
}
*/