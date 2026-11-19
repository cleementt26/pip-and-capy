'use strict';

const BASE_SIZE = 240;
const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));

// Screen coordinates are DIP (Electron's logical pixels), including negative
// coordinates on monitors to the left or above the primary display.
class PetWorld {
  constructor(area, { random = Math.random, scale = 0.75, roam = true, speed = 34 } = {}) {
    this.random = random;
    this.area = { ...area };
    this.scale = scale;
    this.roam = roam;
    this.speed = speed;
    this.direction = random() > 0.5 ? 1 : -1;
    this.x = area.x + area.width * 0.65;
    this.y = area.y + area.height - this.size;
    this.mode = 'idle';
    this.paused = false;
    this.manualSleep = false;
    this.ignoreTouchUntilLeave = false;
    this.drag = null;
    this.dragMoved = false;
    this.petUntil = 0;
    this.feedUntil = 0;
    this.nextChange = 0;
    this.naturalMode = 'walk';
    this.affection = 0;
    this.hat = 'none';
    this.phase = 0;
    this.clamp();
    this.targetX = this.x;
    this.targetY = this.y;
  }
  get size() { return Math.round(BASE_SIZE * this.scale); }
  get floor() { return this.area.y + this.area.height - this.size; }
  bounds() { return { x: Math.round(this.x), y: Math.round(this.y), width: this.size, height: this.size }; }
  clamp() {
    this.x = clamp(this.x, this.area.x, this.area.x + this.area.width - this.size);
    this.y = clamp(this.y, this.area.y, this.floor);
  }
  clampTarget() {
    this.targetX = clamp(this.targetX, this.area.x, this.area.x + this.area.width - this.size);
    this.targetY = clamp(this.targetY, this.area.y, this.floor);
  }
  setArea(area) { this.area = { ...area }; this.clamp(); this.clampTarget(); }
  setRoam(roam) {
    this.roam = roam;
    this.targetX = this.x;
    this.targetY = this.y;
    this.nextChange = 0;
  }
  chooseTarget() {
    const width = Math.max(0, this.area.width - this.size);
    const height = Math.max(0, this.area.height - this.size);
    this.targetX = this.area.x + this.random() * width;
    this.targetY = this.area.y + this.random() * height;
    // Keep the destination through pauses so Pip can reach the edges too.
    const minimumTravel = Math.min(60, Math.max(width, height) / 2);
    if (Math.hypot(this.targetX - this.x, this.targetY - this.y) < minimumTravel) {
      this.targetX = this.area.x + (this.x < this.area.x + width / 2 ? width : 0);
      this.targetY = this.area.y + (this.y < this.area.y + height / 2 ? height : 0);
    }
  }
  setScale(scale) {
    const oldSize = this.size;
    this.scale = clamp(scale, 0.45, 1.5);
    this.x -= (this.size - oldSize) / 2;
    this.y -= this.size - oldSize;
    this.clamp();
    this.clampTarget();
  }
  // These ellipses match the original SVG. Transparent corners let clicks
  // reach the user's apps; hearts and shadow never catch the mouse.
  hitTest(cursor) {
    const x = (cursor.x - Math.round(this.x)) / this.scale;
    const y = (cursor.y - Math.round(this.y)) / this.scale;
    const ellipse = (cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    const body = ellipse(120, 145, 77, 69) || ellipse(78, 86, 25, 25) || ellipse(162, 86, 25, 25);
    const hat = this.hat === 'flower' ? ellipse(154, 75, 23, 23)
      : this.hat !== 'none' && ellipse(120, 76, 61, 37);
    return body || hat;
  }
  startDrag(cursor) {
    if (!this.hitTest(cursor)) return false;
    this.drag = { offsetX: cursor.x - this.x, offsetY: cursor.y - this.y, startX: cursor.x, startY: cursor.y };
    this.dragMoved = false;
    this.manualSleep = false;
    return true;
  }
  endDrag(now) {
    this.drag = null;
    this.petUntil = now + 650;
    this.nextChange = now + 2000;
    this.naturalMode = 'idle';
    this.targetX = this.x;
    this.targetY = this.y;
  }
  feed(now) { this.feedUntil = now + 2400; this.manualSleep = false; }
  tick({ now, dt, cursor, menuOpen = false }) {
    dt = clamp(dt, 0, 0.1);
    this.phase += dt;
    const hovering = cursor ? this.hitTest(cursor) : false;
    if (!hovering) this.ignoreTouchUntilLeave = false;
    const touching = hovering && !this.ignoreTouchUntilLeave;
    if (this.drag) {
      this.dragMoved ||= Math.hypot(cursor.x - this.drag.startX, cursor.y - this.drag.startY) > 4;
      if (this.dragMoved) {
        this.x = cursor.x - this.drag.offsetX;
        this.y = cursor.y - this.drag.offsetY;
        this.clamp();
      }
      this.mode = this.dragMoved ? 'drag' : 'pet';
    } else if (menuOpen) {
      this.mode = 'idle';
    } else {
      if (touching) { this.petUntil = now + 700; this.manualSleep = false; }
      if (this.feedUntil > now) this.mode = 'feed';
      else if (this.petUntil > now) this.mode = 'pet';
      else if (this.manualSleep) this.mode = 'sleep';
      else if (this.paused) this.mode = 'idle';
      else {
        if (now >= this.nextChange) {
          const r = this.random();
          this.naturalMode = r < 0.68 ? 'walk' : r < 0.94 ? 'idle' : 'sleep';
          this.nextChange = now + (this.naturalMode === 'walk' ? 5000 + this.random() * 7000 : 2000 + this.random() * 5000);
        }
        this.mode = this.naturalMode;
        if (this.mode === 'walk') {
          if (this.roam) {
            if (Math.hypot(this.targetX - this.x, this.targetY - this.y) < 0.01) this.chooseTarget();
            const dx = this.targetX - this.x;
            const dy = this.targetY - this.y;
            const distance = Math.hypot(dx, dy);
            if (distance > 0) {
              const travel = Math.min(distance, this.speed * dt);
              this.x += dx / distance * travel;
              this.y += dy / distance * travel;
              if (Math.abs(dx) > 0.01) this.direction = dx > 0 ? 1 : -1;
            }
          } else {
            this.x += this.direction * this.speed * dt;
            if (this.x <= this.area.x) { this.x = this.area.x; this.direction = 1; }
            if (this.x >= this.area.x + this.area.width - this.size) {
              this.x = Math.max(this.area.x, this.area.x + this.area.width - this.size);
              this.direction = -1;
            }
            this.y += clamp(this.floor - this.y, -this.speed * dt * 0.55, this.speed * dt * 0.55);
          }
        }
      }
    }
    this.affection = clamp(this.affection + (this.mode === 'pet' ? dt * 0.13 : -dt * 0.04), 0, 1);
    this.clamp();
    return { mode: this.mode, direction: this.direction, phase: this.phase, affection: this.affection, paused: this.paused };
  }
}

module.exports = { PetWorld, BASE_SIZE };
