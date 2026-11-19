'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PetWorld } = require('../app/world.cjs');

const desktop = { x: 0, y: 0, width: 1440, height: 860 };
const away = { x: -99999, y: -99999 };
function make(options = {}, area = desktop) {
  return new PetWorld(area, { random: () => 0.25, ...options });
}
function center(pet) {
  const b = pet.bounds();
  return { x: b.x + 120 * pet.scale, y: b.y + 145 * pet.scale };
}
function step(pet, now, cursor = away, dt = 1 / 30, extra = {}) {
  return pet.tick({ now, dt, cursor, ...extra });
}
function assertOnScreen(pet, area) {
  const b = pet.bounds();
  assert.ok(b.x >= area.x && b.y >= area.y, 'top and left remain on screen');
  assert.ok(b.x + b.width <= area.x + area.width, 'right remains on screen');
  assert.ok(b.y + b.height <= area.y + area.height, 'bottom remains on screen');
}

test('Pip explores the whole screen by default', () => {
  const pet = make();
  assert.equal(pet.roam, true);
  const before = { x: pet.x, y: pet.y };
  for (let i = 0; i < 30; i++) step(pet, i * 100, away, 0.1);
  assert.notEqual(pet.x, before.x, 'he walks horizontally');
  assert.notEqual(pet.y, before.y, 'he leaves the bottom edge without a menu change');
});

test('transparent corners do not catch input; face and ears do at all menu sizes', () => {
  for (const scale of [0.55, 0.75, 1]) {
    const pet = make({ scale });
    const b = pet.bounds();
    assert.equal(pet.hitTest(center(pet)), true);
    assert.equal(pet.hitTest({ x: b.x + 78 * scale, y: b.y + 86 * scale }), true);
    assert.equal(pet.hitTest({ x: b.x + 162 * scale, y: b.y + 86 * scale }), true);
    assert.equal(pet.hitTest({ x: b.x + 2, y: b.y + 2 }), false);
    assert.equal(pet.hitTest({ x: b.x + b.width - 2, y: b.y + b.height - 2 }), false);
  }
});

test('hovering pets Pip immediately and stops walking, with a short release grace', () => {
  const pet = make();
  step(pet, 0);
  const before = pet.bounds();
  const cursor = center(pet);
  assert.equal(step(pet, 100, cursor).mode, 'pet');
  assert.equal(step(pet, 800, cursor).mode, 'pet');
  assert.deepEqual(pet.bounds(), before);
  assert.equal(step(pet, 1000).mode, 'pet');
  assert.equal(step(pet, 1600).mode, 'walk');
  assert.notEqual(pet.bounds().x, before.x);
});

test('pause stops roaming while caresses and feeding remain available', () => {
  const pet = make();
  pet.paused = true;
  const before = pet.bounds();
  assert.equal(step(pet, 1000).mode, 'idle');
  assert.deepEqual(pet.bounds(), before);
  assert.equal(step(pet, 1100, center(pet)).mode, 'pet');
  pet.feed(2000);
  assert.equal(step(pet, 2100).mode, 'feed');
  assert.equal(step(pet, 4500).mode, 'idle');
  assert.deepEqual(pet.bounds(), before);
});

test('manual sleep persists and caresses wake Pip', () => {
  const pet = make();
  pet.manualSleep = true;
  assert.equal(step(pet, 100).mode, 'sleep');
  assert.equal(step(pet, 100000).mode, 'sleep');
  assert.equal(step(pet, 100100, center(pet)).mode, 'pet');
  assert.equal(pet.manualSleep, false);
  assert.equal(step(pet, 101000).mode, 'walk');
});

test('choosing sleep while the pointer rests on Pip waits for a fresh caress', () => {
  const pet = make();
  const cursor = center(pet);
  pet.manualSleep = true;
  pet.ignoreTouchUntilLeave = true;
  assert.equal(step(pet, 100, cursor).mode, 'sleep');
  assert.equal(step(pet, 1000, cursor).mode, 'sleep');
  assert.equal(step(pet, 1100).mode, 'sleep');
  assert.equal(step(pet, 1200, cursor).mode, 'pet');
  assert.equal(pet.manualSleep, false);
});

test('a drag starts only on Pip, keeps the grab offset, and ignores click jitter', () => {
  const pet = make({ roam: true });
  assert.equal(pet.startDrag(away), false);
  const grab = center(pet);
  const before = pet.bounds();
  assert.equal(pet.startDrag(grab), true);
  assert.equal(step(pet, 100, { x: grab.x + 2, y: grab.y + 1 }).mode, 'pet');
  assert.deepEqual(pet.bounds(), before);
  assert.equal(step(pet, 200, { x: grab.x - 100, y: grab.y - 120 }).mode, 'drag');
  assert.equal(pet.bounds().x, before.x - 100);
  assert.equal(pet.bounds().y, before.y - 120);
  pet.endDrag(250);
  assert.equal(pet.drag, null);
  assert.equal(step(pet, 300).mode, 'pet');
  assert.equal(step(pet, 1100).mode, 'idle');
});

test('dragging beyond a display edge never loses Pip outside its work area', () => {
  const pet = make();
  pet.startDrag(center(pet));
  step(pet, 100, { x: -100000, y: -100000 });
  assertOnScreen(pet, desktop);
  step(pet, 200, { x: 100000, y: 100000 });
  assertOnScreen(pet, desktop);
});

test('walking reflects at either horizontal edge', () => {
  const pet = make({ roam: false });
  pet.x = desktop.x;
  pet.direction = -1;
  step(pet, 100, away, 0.1);
  assert.equal(pet.direction, 1);
  assert.equal(pet.x, desktop.x);
  pet.x = desktop.x + desktop.width - pet.size;
  pet.direction = 1;
  step(pet, 200, away, 0.1);
  assert.equal(pet.direction, -1);
  assertOnScreen(pet, desktop);
});

test('roaming stays inside negative-coordinate displays across repeated behavior changes', () => {
  const area = { x: -1920, y: -200, width: 1920, height: 1080 };
  let seed = 9;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const pet = make({ roam: true, random, speed: 52 }, area);
  const observed = new Set();
  for (let i = 0; i < 18000; i++) {
    observed.add(step(pet, i * 100, away, 0.1).mode);
    assertOnScreen(pet, area);
  }
  assert.ok(observed.has('walk') && observed.has('idle') && observed.has('sleep'));
});

test('free roaming travels in all four directions and reaches broad screen positions', () => {
  let seed = 728;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const pet = make({ random, speed: 52 });
  const signs = new Set();
  let minX = pet.x;
  let maxX = pet.x;
  let minY = pet.y;
  let maxY = pet.y;
  for (let i = 0; i < 18000; i++) {
    const before = { x: pet.x, y: pet.y };
    step(pet, i * 100, away, 0.1);
    if (pet.x > before.x + 0.001) signs.add('right');
    if (pet.x < before.x - 0.001) signs.add('left');
    if (pet.y > before.y + 0.001) signs.add('down');
    if (pet.y < before.y - 0.001) signs.add('up');
    minX = Math.min(minX, pet.x);
    maxX = Math.max(maxX, pet.x);
    minY = Math.min(minY, pet.y);
    maxY = Math.max(maxY, pet.y);
    assertOnScreen(pet, desktop);
  }
  assert.deepEqual([...signs].sort(), ['down', 'left', 'right', 'up']);
  const width = desktop.width - pet.size;
  const height = desktop.height - pet.size;
  assert.ok(minX < width * 0.25 && maxX > width * 0.75, 'he explores both sides of the screen');
  assert.ok(minY < height * 0.25 && maxY > height * 0.75, 'he explores top and bottom of the screen');
});

test('caress, pause and a held click stop autonomous movement in both axes', () => {
  const pet = make();
  for (let i = 0; i < 20; i++) step(pet, i * 100, away, 0.1);
  const before = pet.bounds();
  const cursor = center(pet);
  for (let i = 0; i < 20; i++) assert.equal(step(pet, 2000 + i * 100, cursor, 0.1).mode, 'pet');
  assert.deepEqual(pet.bounds(), before);
  pet.paused = true;
  for (let i = 0; i < 20; i++) step(pet, 5000 + i * 100, away, 0.1);
  assert.deepEqual(pet.bounds(), before);
  pet.paused = false;
  assert.equal(pet.startDrag(cursor), true);
  for (let i = 0; i < 20; i++) step(pet, 8000 + i * 100, cursor, 0.1);
  assert.deepEqual(pet.bounds(), before);
});

test('a natural rest preserves a distant destination until Pip resumes walking', () => {
  const values = [0.5, 0.2, 0.1, 0.1, 0.1, 0.8, 0.1, 0.2, 0.1];
  const pet = make({ random: () => values.length ? values.shift() : 0.25 });
  assert.equal(step(pet, 0, away, 0.1).mode, 'walk');
  const destination = { x: pet.targetX, y: pet.targetY };
  let now = 0;
  while (pet.mode === 'walk' && now < 10000) {
    now += 100;
    step(pet, now, away, 0.1);
  }
  assert.equal(pet.mode, 'idle', 'Pip takes a natural rest before reaching the distant goal');
  const resting = { x: pet.x, y: pet.y };
  while (pet.mode === 'idle' && now < 20000) {
    now += 100;
    step(pet, now, away, 0.1);
  }
  assert.equal(pet.mode, 'walk');
  assert.deepEqual({ x: pet.targetX, y: pet.targetY }, destination);
  assert.ok(Math.hypot(pet.x - destination.x, pet.y - destination.y) < Math.hypot(resting.x - destination.x, resting.y - destination.y));
});

test('roaming can switch to the bottom edge and back to whole-screen travel', () => {
  const pet = make({ speed: 52 });
  for (let i = 0; i < 40; i++) step(pet, i * 100, away, 0.1);
  assert.ok(pet.y < pet.floor);
  pet.setRoam(false);
  for (let i = 40; i < 240; i++) step(pet, i * 100, away, 0.1);
  assert.equal(pet.y, pet.floor);
  pet.setRoam(true);
  for (let i = 240; i < 270; i++) step(pet, i * 100, away, 0.1);
  assert.ok(pet.y < pet.floor, 'free movement resumes without restarting the app');
  assertOnScreen(pet, desktop);
});

test('resizing and display removal recover a visible Pip', () => {
  const pet = make();
  const bottom = pet.y + pet.size;
  pet.setScale(1);
  assert.equal(pet.y + pet.size, bottom, 'feet remain at the same screen height');
  assertOnScreen(pet, desktop);
  const replacement = { x: -1280, y: 140, width: 1280, height: 720 };
  pet.setArea(replacement);
  assertOnScreen(pet, replacement);
  for (let i = 0; i < 300; i++) step(pet, i * 100, away, 0.1);
  assertOnScreen(pet, replacement);
});

test('a delayed timer after system sleep cannot teleport Pip', () => {
  const pet = make();
  const before = pet.x;
  step(pet, 100000, away, 3600);
  assert.ok(Math.abs(pet.x - before) <= pet.speed * 0.1 + 1e-9);
  assertOnScreen(pet, desktop);
});

test('native menus freeze movement until dismissed', () => {
  const pet = make();
  step(pet, 10);
  const before = pet.bounds();
  assert.equal(step(pet, 200, center(pet), 0.1, { menuOpen: true }).mode, 'idle');
  assert.deepEqual(pet.bounds(), before);
  assert.equal(step(pet, 300).mode, 'walk');
});
