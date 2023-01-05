var mouseDownPos = {x: 0, y: 0};

var mousePositions = [];

var shakeTimer = null;

const shakeCheckTimeMilliseconds = 50;
const maxShakeThreshold = 50;



window.addEventListener("mousedown", handleMouseDown);
window.addEventListener("mouseup", handleMouseUp);
window.addEventListener("mousemove", handleMouseMove);



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

function checkForShake() {

    // Calculate the average velocity of the mouse over the last few positions
    var totalVelocity = 0;
    var totalXVelocity = 0;
    var totalYVelocity = 0;

    for (var i = 1; i < mousePositions.length; i++) {
      var xVelocity = mousePositions[i].x - mousePositions[i - 1].x;
      var yVelocity = mousePositions[i].y - mousePositions[i - 1].y;

      totalXVelocity += xVelocity;
      totalYVelocity += yVelocity;

      totalVelocity += Math.sqrt(Math.pow(xVelocity, 2) + Math.pow(yVelocity, 2));
    }

    var averageVelocity = totalVelocity / mousePositions.length;

    var averageXVelocity = totalXVelocity / mousePositions.length;
    var averageYVelocity = totalYVelocity / mousePositions.length;
  
    // If the average velocity is above a certain threshold, send the shake message
    if (averageVelocity > maxShakeThreshold) {

      // Send a message to the content script
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {type: "shake", velocityX: averageXVelocity, averageYVelocity: velocityY }, function(response) {});
      });
    }
}