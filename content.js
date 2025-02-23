let engine, render, runner, mouse, world, isPhysicsEnabled = false;
let bodies = new Map();
let shakeDetector = {
  lastMouseX: 0,
  lastMouseY: 0,
  shakeCount: 0,
  lastShakeTime: 0,
  threshold: 100,
  timeWindow: 1000,
  requiredShakes: 5
};

// Load shake detection settings
chrome.storage.local.get({
  shakeThreshold: 100,
  timeWindow: 1000,
  requiredShakes: 5
}, (savedSettings) => {
  shakeDetector.threshold = savedSettings.shakeThreshold;
  shakeDetector.timeWindow = savedSettings.timeWindow;
  shakeDetector.requiredShakes = savedSettings.requiredShakes;
});

let settings = {
  gravity: 0,
  restitution: 0.7,
  friction: 0.3,
  density: 0.001,
  stiffness: 0.2
};

// Initialize Matter.js
function initPhysics() {
  engine = Matter.Engine.create();
  world = engine.world;
  world.gravity.y = settings.gravity;

  render = Matter.Render.create({
    element: document.body,
    engine: engine,
    options: {
      width: window.innerWidth,
      height: window.innerHeight,
      wireframes: false,
      background: 'transparent'
    }
  });
  render.canvas.style.display = 'none';

  //Matter.Engine.run(engine);
  Matter.Render.run(render);

  runner = Matter.Runner.create()
  Matter.Runner.run(runner,engine);

  const wallOptions = {
    isStatic: true,
    render: { visible: false }
  };

  Matter.World.add(world, [
    Matter.Bodies.rectangle(
      window.innerWidth / 2,
      window.innerHeight + 50,
      window.innerWidth,
      100,
      wallOptions
    ),
    Matter.Bodies.rectangle(
      window.innerWidth / 2,
      -50,
      window.innerWidth,
      100,
      wallOptions
    ),
    Matter.Bodies.rectangle(
      -50,
      window.innerHeight / 2,
      100,
      window.innerHeight,
      wallOptions
    ),
    Matter.Bodies.rectangle(
      window.innerWidth + 50,
      window.innerHeight / 2,
      100,
      window.innerHeight,
      wallOptions
    )
  ]);
}

function createPhysicsBodies() {
  const elements = document.querySelectorAll('div, p, img, button');
  
  elements.forEach(element => {
    if (!bodies.has(element)) {
      const rect = element.getBoundingClientRect();
      
      if (rect.width < 10 || rect.height < 10 || !element.offsetParent) {
        return;
      }

      const body = Matter.Bodies.rectangle(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width,
        rect.height,
        {
          restitution: settings.restitution,
          friction: settings.friction,
          density: settings.density
        }
      );

      bodies.set(element, body);
      Matter.World.add(world, body);
      element.classList.add('physics-enabled');
    }
  });
}

function updateElements() {
  bodies.forEach((body, element) => {
    const pos = body.position;
    const angle = body.angle;
    
    element.style.position = 'fixed';
    element.style.left = `${pos.x - element.offsetWidth / 2}px`;
    element.style.top = `${pos.y - element.offsetHeight / 2}px`;
    element.style.transform = `rotate(${angle}rad)`;
    element.style.zIndex = '1000';
  });

  if (isPhysicsEnabled) {
    requestAnimationFrame(updateElements);
  }
}

function enableDragging() {
  mouse = Matter.Mouse.Create(render.canvas)
  let mouseConstraint = Matter.MouseConstraint.create(engine, {
    mouse: mouse,
    element: document.body,
    constraint: {
      stiffness: settings.stiffness,
      render: {
        visible: false
      }
    }
  });

  Matter.World.add(world, mouseConstraint);
  render.mouse = mouse;
}

function togglePhysics() {
  isPhysicsEnabled = !isPhysicsEnabled;

  if (isPhysicsEnabled) {
    if (!engine) {
      initPhysics();
      enableDragging();
      Matter.Render.lookAt(render, {
        min: { x: 0, y: 0 },
        max: { x: 800, y: 600 }
      })
    }
    createPhysicsBodies();
    updateElements();
    
    document.body.classList.add('physics-mode');
    
    // Prevent default behaviors when physics is enabled
    document.addEventListener('dragstart', preventDefaultBehavior, true);
    document.addEventListener('drop', preventDefaultBehavior, true);
    document.addEventListener('contextmenu', preventDefaultBehavior, true);
    document.addEventListener('mousedown', handleMouseDown, true);
  } else {
    bodies.forEach((body, element) => {
      element.style.position = '';
      element.style.left = '';
      element.style.top = '';
      element.style.transform = '';
      element.style.zIndex = '';
      element.classList.remove('physics-enabled');
    });

    Matter.World.clear(world);
    bodies.clear();
    document.body.classList.remove('physics-mode');
    
    Matter.Render.stop(render);
    Matter.Runner.stop(runner);

    // Remove event listeners when physics is disabled
    document.removeEventListener('dragstart', preventDefaultBehavior, true);
    document.removeEventListener('drop', preventDefaultBehavior, true);
    document.removeEventListener('contextmenu', preventDefaultBehavior, true);
    document.removeEventListener('mousedown', handleMouseDown, true);
  }

  // Notify popup about state change
  chrome.runtime.sendMessage({
    action: "physicsStateChanged",
    isEnabled: isPhysicsEnabled
  });
}

// Prevent default behavior for events
function preventDefaultBehavior(e) {
  e.preventDefault();
  e.stopPropagation();
}

// Handle mousedown events
function handleMouseDown(e) {
  // Only prevent default if we're clicking a physics-enabled element
  const physicsElement = e.target.closest('.physics-enabled');
  if (physicsElement) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function updatePhysicsSettings(newSettings) {
  Object.assign(settings, newSettings);
  
  if (world) {
    world.gravity.y = settings.gravity;
  }
  
  if (isPhysicsEnabled) {
    // Re-create bodies with new settings
    Matter.World.clear(world);
    bodies.clear();
    createPhysicsBodies();
    enableDragging();
  }
}

// Load saved settings
chrome.storage.local.get({
  gravity: 0.5,
  restitution: 0.7,
  friction: 0.3,
  density: 0.001,
  stiffness: 0.2
}, (savedSettings) => {
  Object.assign(settings, savedSettings);
});

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "togglePhysics") {
    togglePhysics();
  } else if (request.action === "updateSettings") {
    if (request.settings.hasOwnProperty('shakeThreshold')) {
      shakeDetector.threshold = request.settings.shakeThreshold;
    }
    if (request.settings.hasOwnProperty('timeWindow')) {
      shakeDetector.timeWindow = request.settings.timeWindow;
    }
    if (request.settings.hasOwnProperty('requiredShakes')) {
      shakeDetector.requiredShakes = request.settings.requiredShakes;
    }
    updatePhysicsSettings(request.settings);
  } else if (request.action === "getPhysicsState") {
    sendResponse({ isEnabled: isPhysicsEnabled });
  }
});

// Shake detection
function detectShake(event) {
  const currentTime = Date.now();
  const deltaX = Math.abs(event.screenX - shakeDetector.lastMouseX);
  const deltaY = Math.abs(event.screenY - shakeDetector.lastMouseY);
  
  // Reset shake count if too much time has passed
  if (currentTime - shakeDetector.lastShakeTime > shakeDetector.timeWindow) {
    shakeDetector.shakeCount = 0;
  }
  
  // Check if movement is large enough to count as a shake
  if (deltaX > shakeDetector.threshold || deltaY > shakeDetector.threshold) {
    shakeDetector.shakeCount++;
    shakeDetector.lastShakeTime = currentTime;
    
    // If we've reached the required number of shakes, toggle physics
    if (shakeDetector.shakeCount >= shakeDetector.requiredShakes) {
      togglePhysics();
      shakeDetector.shakeCount = 0; // Reset count after triggering
    }
  }
  
  shakeDetector.lastMouseX = event.screenX;
  shakeDetector.lastMouseY = event.screenY;
}

// Track window dragging
let isDraggingWindow = false;

// Detect when window starts being dragged
window.addEventListener('mousedown', (e) => {
  // Check if click is near window edges or title bar
  const edgeThreshold = 50;
  if (e.clientY < edgeThreshold || // Top edge/title bar
      e.clientY > window.innerHeight - edgeThreshold || // Bottom edge
      e.clientX < edgeThreshold || // Left edge
      e.clientX > window.innerWidth - edgeThreshold) { // Right edge
    isDraggingWindow = true;
  }
});

window.addEventListener('mouseup', () => {
  isDraggingWindow = false;
});

window.addEventListener('mousemove', (e) => {
  if (isDraggingWindow) {
    detectShake(e);
  }
});

window.addEventListener('resize', () => {
  if (render) {
    render.canvas.width = window.innerWidth;
    render.canvas.height = window.innerHeight;
  }
});

/*var usingPhysics = false;
var dragging = false;

var world = null;
var effectedObjects = [];

const minObjectWidth = 40;
const minObjectHeight = 40;
const maxObjectWidth = 800;
const maxObjectHeight = 800;

const resetShakeCountTimeMilliseconds = 3000;
var resetShakeCountTimer = null;

const maxShakeCount = 5;
var currentShakeCount = 0;

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
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          type: "shake",
          velocityX: averageXVelocity,
          velocityY: averageYVelocity
        },
        function (response) {}
      );
    });
  }
}

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
*/