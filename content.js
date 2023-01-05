var usingPhysics = false;
var dragging = false;

var world = null;
var effectedObjects = [];

const minObjectWidth = 40;
const minObjectHeight = 40;
const maxObjectWidth = 800;
const maxObjectHeight = 800;

const resetShakeCountTimeMilliseconds = 3000;
var resetShakeCountTimer = null

const maxShakeCount = 5;
var currentShakeCount = 0;



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



function initializeWorld() {

  // Set the usingPhysics variable to true
  usingPhysics = true;

  if(world == null){
    // Create a physics world
    world = new p2.World();

    // Set the gravity of the world
    world.gravity = [0, 9.81];
  }

  // Create a reset button
  if (!document.getElementsByClassName("ResetButton").length == 0) {

    var resetButton = document.createElement("button");

    resetButton.innerHTML = "Reset";

    resetButton.className = "ResetButton";

    resetButton.style.position = "fixed";
    resetButton.style.top = "20px";
    resetButton.style.right = "20px";
    resetButton.style.zIndex = "9999";
    resetButton.style.display = "none";

    document.body.appendChild(resetButton);

    resetButton.addEventListener("click", function () {
      // Set the usingPhysics variable to false
      usingPhysics = false;

      // Hide the reset button
      resetButton.style.display = "none";
    });

  }else{
    // If we already created a reset button, show it
    document.getElementsByClassName("ResetButton")[0].style.display = "block"
  }

  // Start updating the physics world
  update();
}

function update() {
  if (!usingPhysics) {
    removePhysicsToObjects();
    return;
  }

  world.step(1 / 60);
  requestAnimationFrame(update);
}

function addPhysicsToObjects(){
  
  // Get the HTML objects that matter
  var allObjects = document.querySelectorAll("div");

  //Check if they're in a certain size range
  for (var i = 0; i < allObjects.length; i++) {
    if(allObjects[i].offsetWidth >= minObjectWidth && allObjects[i].offsetWidth <= maxObjectWidth && allObjects[i].offsetHeight >= minObjectHeight && allObjects[i].offsetHeight <= maxObjectHeight) 
        effectedObjects.push(allObjects[i])
  }

  // Add physics bodies to the HTML objects
  for (var i = 0; i < effectedObjects.length; i++) {
    // Create a physics body for the object
    var body = new p2.Body(
        {
            mass: 1, // Set the mass to 1 so that the objects fall at the same rate
            position: [
                effectedObjects[i].offsetLeft + effectedObjects[i].offsetWidth / 2, 
                effectedObjects[i].offsetTop + effectedObjects[i].offsetHeight / 2
            ], // Set the position based on the position of the object
        }
    );

    // Add the body to the world
    world.addBody(body);

    body.angle = effectedObjects[i].style.transform
      ? (parseFloat(effectedObjects[i].style.transform.split("rotate(")[1].split("deg")[0]) * Math.PI) / 180
      : 0;

    body.addShape(new p2.Box(
        {
            width: effectedObjects[i].offsetWidth,
            height: effectedObjects[i].offsetHeight,
        }
    ));

    // Add an event listener to update the position and rotation of the object when the body moves
    body.on("sleep", function () {
      this.object.style.left = this.position[0] - this.object.offsetWidth / 2 + "px";
      this.object.style.top = this.position[1] - this.object.offsetHeight / 2 + "px";
      this.object.style.transform = "rotate(" + (this.angle * 180) / Math.PI + "deg)";
    });

    // Store the body on the object
    effectedObjects[i].physicsBody = body;
  }
}

function removePhysicsToObjects(){

    for (var i = 0; i < effectedObjects.length; i++) {
      effectedObjects[i].physicsBody = null;
      effectedObjects[i].style.left = "";
      effectedObjects[i].style.top = "";
      effectedObjects[i].style.transform = "";
    }

    effectedObjects = [];
}

function addForceToAllObjects(velocityX, velocityY) {

    // Use the mouse velocity to calculate the force to apply to the physics body of the element being dragged
    var forceX = velocityX * element.physicsBody.mass;
    var forceY = velocityY * element.physicsBody.mass;

    // Apply the force to all physics bodies
    for (var i = 0; i < effectedObjects.length; i++) {
        if(effectedObjects[i].physicsBody) {
            element.physicsBody.applyForce([forceX, forceY]);
        }
    }
}

function resetShakeCount() {

    currentShakeCount = 0;

    clearInterval(resetShakeCountTimer);
    resetShakeCountTimer = null;
}
