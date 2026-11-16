// One clock for the whole simulation. Everything that cares about "now" — reaction delays, burst
// pauses, reloads, the fuse — reads this instead of performance.now(), so a paused game is truly
// paused and the headless capture can fast-forward a match without the AI falling asleep.

export const clock = { t: 0 };

export function tickClock(dt) {
  clock.t += dt;
}

export function resetClock() {
  clock.t = 0;
}
