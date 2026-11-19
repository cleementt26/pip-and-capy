'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { PetWorld } = require('../app/world.cjs');

// Run the real main process against a small native-API boundary. This verifies
// our integration contract, not Chromium or the host window manager itself.
async function boot(savedSettings) {
  const primary = { id: 1, label: 'Primary', workArea: { x: 0, y: 0, width: 1440, height: 860 } };
  const second = { id: 2, label: 'Second', workArea: { x: 1440, y: 0, width: 1280, height: 860 } };
  const state = { now: 0, cursor: { x: 0, y: 0 }, windows: [], menus: [], sends: [], input: [], fetches: [], writes: [], quit: 0, nearestQueries: 0, intervalCleared: false };
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: true,
    setName() {},
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => '/test-profile',
    quit: () => { state.quit++; app.emit('before-quit'); },
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings() {}
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false;
      this.top = options.alwaysOnTop;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: {},
        isLoading: () => false,
        send: (channel, value) => state.sends.push({ channel, value }),
        setWindowOpenHandler: callback => { this.openHandler = callback; },
        session: { setPermissionRequestHandler: callback => { this.permissionHandler = callback; } }
      });
      state.windows.push(this);
    }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; }
    isDestroyed() { return false; }
    isAlwaysOnTop() { return this.top; }
    setAlwaysOnTop(value) { this.top = value; }
    setMenu() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(value, options) { state.input.push({ value, options }); }
    loadURL(url) { this.loadedURL = url; }
    showInactive() { this.visible = true; }
    isVisible() { return this.visible; }
    hide() { this.visible = false; }
  }
  class Tray extends EventEmitter {
    constructor() { super(); state.tray = this; }
    setToolTip(value) { this.tooltip = value; }
    destroy() { this.destroyed = true; }
  }
  const screen = new EventEmitter();
  Object.assign(screen, {
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => [primary, second],
    getCursorScreenPoint: () => ({ ...state.cursor }),
    getDisplayNearestPoint: point => { state.nearestQueries++; return point.x >= 1440 ? second : primary; },
    getDisplayMatching: rect => rect.x + rect.width / 2 >= 1440 ? second : primary
  });
  const ipcMain = new EventEmitter();
  const electron = {
    app, BrowserWindow, screen, ipcMain, Tray,
    Menu: { buildFromTemplate: items => {
      const nativeMenu = { items, popup: options => { state.popup = options; } };
      state.menus.push(nativeMenu);
      return nativeMenu;
    } },
    nativeImage: { createFromPath: () => ({ resize() { return this; }, setTemplateImage() {} }) },
    dialog: { showMessageBox() {} },
    powerMonitor: new EventEmitter(),
    protocol: {
      registerSchemesAsPrivileged: value => { state.schemes = value; },
      handle: (scheme, handler) => { state.protocolScheme = scheme; state.protocolHandler = handler; }
    },
    net: { fetch: url => { state.fetches.push(url); return Promise.resolve({ status: 200 }); } }
  };
  const dirname = path.resolve(__dirname, '../app');
  class DeterministicWorld extends PetWorld {
    constructor(area, options) { super(area, { ...options, random: () => 0.25 }); }
  }
  const sandbox = {
    require: name => {
      if (name === 'electron') return electron;
      if (name === './world.cjs') return { PetWorld: DeterministicWorld };
      if (name === 'node:fs') return {
        readFileSync() { if (savedSettings !== undefined) return JSON.stringify(savedSettings); throw new Error('No saved preferences'); },
        mkdirSync() {},
        writeFileSync(filename, content) { state.writes.push({ filename, content: JSON.parse(content) }); }
      };
      return require(name.startsWith('./') ? path.resolve(dirname, name) : name);
    },
    __dirname: dirname,
    process: { platform: 'win32' },
    performance: { now: () => state.now },
    setInterval: callback => { state.timer = callback; return 7; },
    clearInterval: id => { state.intervalCleared = id === 7; },
    URL, Response, console
  };
  vm.runInNewContext(fs.readFileSync(path.join(dirname, 'main.cjs'), 'utf8'), sandbox, { filename: 'main.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  state.pet = state.windows[0];
  state.tick = () => { state.now += 34; state.timer(); return state.sends.at(-1)?.value; };
  state.pointAtPet = () => {
    const b = state.pet.bounds;
    state.cursor = { x: b.x + b.width / 2, y: b.y + b.height * 145 / 240 };
  };
  state.action = (action, event = { sender: state.pet.webContents, senderFrame: state.pet.webContents.mainFrame }) => ipcMain.emit('pet:action', event, action);
  return state;
}

const plain = value => JSON.parse(JSON.stringify(value));
const defaultAppearance = { hat: 'none', glasses: 'none', outfit: 'none', color: 'sage' };
function customization(state) {
  state.popup?.callback();
  state.tray.emit('right-click');
  const menu = state.menus.at(-1).items.find(item => item.label === 'Personnaliser Pip');
  assert.ok(menu, 'the native menu exposes customization');
  return menu.submenu;
}
function selectAppearance(state, category, label) {
  const submenu = customization(state).find(item => item.label === category)?.submenu;
  assert.ok(submenu, `category ${category} exists`);
  const option = submenu.find(item => item.label === label);
  assert.ok(option, `option ${label} exists`);
  assert.equal(option.type, 'radio');
  option.click();
  state.popup.callback();
}

test('desktop startup uses a transparent, unfocused, sandboxed local window', async () => {
  const state = await boot();
  assert.equal(state.windows.length, 1);
  const options = state.pet.options;
  assert.equal(options.transparent, true);
  assert.equal(options.frame, false);
  assert.equal(options.focusable, false);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(state.pet.loadedURL, 'pip://app/index.html');
  assert.equal(state.protocolScheme, 'pip');
  assert.equal(state.schemes[0].privileges.secure, true);
  assert.equal(state.pet.openHandler().action, 'deny');
  let permission;
  state.pet.permissionHandler(null, 'media', value => { permission = value; });
  assert.equal(permission, false);
  await state.protocolHandler({ url: 'pip://app/index.html' });
  assert.match(state.fetches[0], /\/renderer\/index\.html$/);
  assert.equal((await state.protocolHandler({ url: 'pip://other/index.html' })).status, 404);
  assert.equal((await state.protocolHandler({ url: 'pip://app/%2e%2e%2fmain.cjs' })).status, 403);
});

test('native input passes through the background and caresses stop Pip', async () => {
  const state = await boot();
  state.tick();
  assert.equal(state.input.at(-1).value, true);
  state.pointAtPet();
  const before = { ...state.pet.bounds };
  assert.equal(state.tick().mode, 'pet');
  assert.equal(state.input.at(-1).value, false);
  assert.deepEqual(state.pet.bounds, before);
  state.cursor = { x: before.x + 2, y: before.y + 2 };
  state.tick();
  assert.equal(state.input.at(-1).value, true);
});

test('a held drag follows the cursor onto another monitor', async () => {
  const state = await boot();
  state.pointAtPet();
  state.action('drag-start');
  state.cursor = { x: 1650, y: 400 };
  assert.equal(state.tick().mode, 'drag');
  assert.ok(state.nearestQueries > 0);
  assert.ok(state.pet.bounds.x >= 1440);
  assert.ok(state.pet.bounds.x + state.pet.bounds.width <= 2720);
  state.action('drag-end');
  assert.equal(state.tick().mode, 'pet');
});

test('IPC ignores foreign senders, while the tray menu can quit cleanly', async () => {
  const state = await boot();
  state.action('menu', { sender: {}, senderFrame: state.pet.webContents.mainFrame });
  state.action('menu', { sender: state.pet.webContents, senderFrame: {} });
  assert.equal(state.menus.length, 0);
  state.action('feed', { sender: {}, senderFrame: {} });
  assert.notEqual(state.tick().mode, 'feed');
  state.tray.emit('right-click');
  const quit = state.menus.at(-1).items.find(item => item.label === 'Quitter Pip');
  assert.equal(typeof quit.click, 'function');
  quit.click();
  assert.equal(state.quit, 1);
  assert.equal(state.tray.destroyed, true);
  assert.equal(state.intervalCleared, true);
});

test('startup migrates the old bottom-edge default once and preserves new choices', async () => {
  for (const oldSettings of [undefined, { roam: false }, { behaviorVersion: 1, roam: false }]) {
    const state = await boot(oldSettings);
    assert.equal(state.writes.at(-1).content.behaviorVersion, 2);
    assert.equal(state.writes.at(-1).content.roam, true);
    state.tray.emit('right-click');
    const walkMenu = state.menus.at(-1).items.find(item => item.label === 'Promenade');
    assert.equal(walkMenu.submenu.find(item => item.label === 'Partout sur l’écran').checked, true);
  }
  const state = await boot({ behaviorVersion: 2, roam: false });
  assert.equal(state.writes.at(-1).content.roam, false);
  state.tray.emit('right-click');
  const walkMenu = state.menus.at(-1).items.find(item => item.label === 'Promenade');
  assert.equal(walkMenu.submenu.find(item => item.label === 'En bas de l’écran').checked, true);
  walkMenu.submenu.find(item => item.label === 'Partout sur l’écran').click();
  assert.equal(state.writes.at(-1).content.roam, true);
  walkMenu.submenu.find(item => item.label === 'En bas de l’écran').click();
  assert.equal(state.writes.at(-1).content.roam, false);
});

test('saved accessories restore and are forwarded to the renderer with behavior settings intact', async () => {
  const appearance = { hat: 'crown', glasses: 'round', outfit: 'hoodie', color: 'blue' };
  const state = await boot({ behaviorVersion: 2, roam: false, scale: 0.55, speed: 22, alwaysOnTop: false, appearance });
  assert.deepEqual(state.writes.at(-1).content.appearance, appearance);
  assert.equal(state.writes.at(-1).content.roam, false);
  assert.equal(state.writes.at(-1).content.scale, 0.55);
  assert.equal(state.writes.at(-1).content.speed, 22);
  assert.equal(state.writes.at(-1).content.alwaysOnTop, false);
  assert.deepEqual(plain(state.tick().appearance), appearance);
  const categories = customization(state);
  assert.equal(categories.find(item => item.label === 'Couvre-chefs').submenu.find(item => item.label === 'Couronne').checked, true);
  assert.equal(categories.find(item => item.label === 'Lunettes').submenu.find(item => item.label === 'Rondes').checked, true);
  state.popup.callback();
});

test('invalid appearance preferences normalize per category without leaking extra keys', async () => {
  const state = await boot({ appearance: { hat: '<script>', glasses: 'heart', outfit: 27, color: 'neon', injected: true } });
  const expected = { ...defaultAppearance, glasses: 'heart' };
  assert.deepEqual(state.writes.at(-1).content.appearance, expected);
  assert.deepEqual(plain(state.tick().appearance), expected);
  for (const appearance of [null, [], 'not-an-appearance']) {
    const invalid = await boot({ appearance });
    assert.deepEqual(plain(invalid.tick().appearance), defaultAppearance);
  }
  const invalidSettings = await boot(null);
  assert.deepEqual(plain(invalidSettings.tick().appearance), defaultAppearance);
});

test('choosing accessories composes the look and saves it without clearing movement preferences', async () => {
  const state = await boot({ behaviorVersion: 2, roam: false, scale: 1, speed: 52 });
  selectAppearance(state, 'Couvre-chefs', 'Bonnet');
  selectAppearance(state, 'Lunettes', 'Rondes');
  selectAppearance(state, 'Vêtements', 'Sweat à capuche');
  selectAppearance(state, 'Couleur de la tenue', 'Rose');
  selectAppearance(state, 'Couvre-chefs', 'Couronne');
  const expected = { hat: 'crown', glasses: 'round', outfit: 'hoodie', color: 'rose' };
  assert.deepEqual(state.writes.at(-1).content.appearance, expected);
  assert.deepEqual(plain(state.tick().appearance), expected);
  assert.equal(state.writes.at(-1).content.roam, false);
  assert.equal(state.writes.at(-1).content.scale, 1);
  assert.equal(state.writes.at(-1).content.speed, 52);
});

test('random looks use supported accessories and reset restores Pip while keeping behavior', async () => {
  const state = await boot({ behaviorVersion: 2, roam: false, speed: 22 });
  customization(state).find(item => item.label === 'Surprends-moi').click();
  state.popup.callback();
  const look = state.writes.at(-1).content.appearance;
  assert.ok(['beanie', 'cap', 'crown', 'flower', 'cowboy'].includes(look.hat));
  assert.ok(['none', 'round', 'sun', 'heart'].includes(look.glasses));
  assert.ok(['hoodie', 'mariniere', 'scarf', 'overalls'].includes(look.outfit));
  assert.ok(['sage', 'blue', 'rose', 'lavender', 'orange'].includes(look.color));
  customization(state).find(item => item.label === 'Retirer les accessoires').click();
  state.popup.callback();
  assert.deepEqual(state.writes.at(-1).content.appearance, defaultAppearance);
  assert.deepEqual(plain(state.tick().appearance), defaultAppearance);
  assert.equal(state.writes.at(-1).content.roam, false);
  assert.equal(state.writes.at(-1).content.speed, 22);
});

test('a customized Pip follows the same wandering behavior as an unadorned Pip', async () => {
  const normal = await boot();
  const dressed = await boot({ appearance: { hat: 'cowboy', glasses: 'sun', outfit: 'overalls', color: 'orange' } });
  for (let i = 0; i < 600; i++) {
    const normalState = normal.tick();
    const dressedState = dressed.tick();
    assert.deepEqual(dressed.pet.bounds, normal.pet.bounds);
    assert.equal(dressedState.mode, normalState.mode);
    assert.equal(dressedState.direction, normalState.direction);
  }
});
