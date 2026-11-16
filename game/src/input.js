// Keyboard, mouse and pointer lock. The game only looks at input while the canvas holds the
// lock, and losing it is a pause signal. Just-pressed keys are queued so a tap is never lost
// between fixed steps.

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'KeyC',
  'KeyE', 'KeyB', 'KeyR', 'KeyQ', 'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
]);

export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, aim: false, lookX: 0, lookY: 0, wheel: 0 };

  function down(event) {
    if (MOVE_KEYS.has(event.code)) event.preventDefault();
    if (event.repeat) return;
    keys.add(event.code);
    pressed.add(event.code);
    if (!state.locked) return;
    if (event.code === 'Escape') document.exitPointerLock();
  }

  function up(event) {
    keys.delete(event.code);
  }

  window.addEventListener('keydown', down, { passive: false });
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => {
    keys.clear();
    pressed.clear();
    state.firing = false;
    state.aim = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX || 0;
    state.lookY += event.movementY || 0;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aim = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aim = false;
  });
  window.addEventListener('wheel', (event) => {
    if (state.locked) state.wheel += Math.sign(event.deltaY);
  }, { passive: true });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    state.locked = locked;
    if (!locked) {
      keys.clear();
      pressed.clear();
      state.firing = false;
      state.aim = false;
      state.lookX = 0;
      state.lookY = 0;
    }
    onLockChange(locked);
  });
  document.addEventListener('pointerlockerror', () => {
    state.locked = false;
    onLockChange(false);
  });

  return {
    state,
    requestLock() {
      let request;
      try {
        request = canvas.requestPointerLock();
      } catch {
        onLockChange(false);
        return;
      }
      // Newer Chrome returns a promise; a refusal must not become an unhandled rejection.
      if (request && typeof request.catch === 'function') request.catch(() => onLockChange(false));
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    takePress(code) {
      if (!pressed.has(code)) return false;
      pressed.delete(code);
      return true;
    },
    clearPresses() {
      pressed.clear();
    },
    clearKeys() {
      keys.clear();
    },
  };
}
