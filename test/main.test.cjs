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
async function boot(savedSettings, { autoChoose = true } = {}) {
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
        send: (channel, value) => state.sends.push({ channel, value, window: this }),
        setWindowOpenHandler: callback => { this.openHandler = callback; },
        session: { setPermissionRequestHandler: callback => { this.permissionHandler = callback; } }
      });
      state.windows.push(this);
    }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; }
    isDestroyed() { return this.destroyed === true; }
    isAlwaysOnTop() { return this.top; }
    setAlwaysOnTop(value) { this.top = value; }
    setMenu() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents(value, options) { state.input.push({ value, options }); }
    loadURL(url) {
      this.loadedURL = url;
      setImmediate(() => { if (!this.isDestroyed()) { this.webContents.emit('did-finish-load'); this.emit('ready-to-show'); } });
      return Promise.resolve();
    }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    close() {
      let cancelled = false;
      this.emit('close', { preventDefault() { cancelled = true; } });
      if (cancelled) return;
      this.destroyed = true;
      this.visible = false;
      this.emit('closed');
    }
    destroy() { this.close(); }
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
  await new Promise(resolve => setImmediate(resolve));
  state.pet = state.windows[0];
  state.getLauncher = () => state.windows.find(window => window.loadedURL?.includes('launcher.html') && !window.isDestroyed());
  state.choose = (species, event) => {
    const launcher = state.getLauncher();
    const sender = event || { sender: launcher.webContents, senderFrame: launcher.webContents.mainFrame };
    ipcMain.emit('pet:choose-species', sender, species);
  };
  state.app = app;
  state.cancel = event => {
    const launcher = state.getLauncher();
    ipcMain.emit('launcher:cancel', event || { sender: launcher.webContents, senderFrame: launcher.webContents.mainFrame });
  };
  state.tick = () => { state.now += 34; state.timer(); return state.sends.filter(message => message.channel === 'pet:state' && message.window === state.pet).at(-1)?.value; };
  state.pointAtPet = () => {
    const b = state.pet.bounds;
    state.cursor = { x: b.x + b.width / 2, y: b.y + b.height * 145 / 240 };
  };
  state.action = (action, event = { sender: state.pet.webContents, senderFrame: state.pet.webContents.mainFrame }) => ipcMain.emit('pet:action', event, action);
  if (autoChoose && state.getLauncher()) state.choose(savedSettings?.species === 'capybara' ? 'capybara' : 'hamster');
  return state;
}

const plain = value => JSON.parse(JSON.stringify(value));
const defaultAppearance = { hat: 'none', glasses: 'none', outfit: 'none', color: 'sage' };
function customization(state) {
  state.popup?.callback();
  state.tray.emit('right-click');
  const menu = state.menus.at(-1).items.find(item => /^Personnaliser/.test(item.label));
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
function openChooser(state) {
  state.popup?.callback();
  state.tray.emit('right-click');
  const item = state.menus.at(-1).items.find(item => /^Choisir mon compagnon/.test(item.label));
  assert.ok(item, 'the native menu can reopen the companion chooser');
  item.click();
  state.popup.callback();
  return state.getLauncher();
}

test('desktop startup uses a transparent, unfocused, sandboxed local window', async () => {
  const state = await boot();
  assert.equal(state.windows.length, 2);
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
  const quit = state.menus.at(-1).items.find(item => /^Quitter/.test(item.label));
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

test('startup keeps the pet hidden while a normal chooser offers the last selected species', async () => {
  const state = await boot({ species: 'capybara' }, { autoChoose: false });
  assert.equal(state.pet.visible, false);
  const launcher = state.getLauncher();
  assert.ok(launcher);
  assert.notEqual(launcher.options.focusable, false);
  assert.notEqual(launcher.options.transparent, true);
  assert.equal(launcher.visible, true);
  assert.equal(launcher.options.webPreferences.sandbox, true);
  assert.equal(launcher.options.webPreferences.contextIsolation, true);
  assert.equal(launcher.options.webPreferences.nodeIntegration, false);
  assert.match(launcher.loadedURL, /^pip:\/\/app\/launcher\.html/);
  assert.equal(state.writes.at(-1).content.species, 'capybara');
  const selection = state.sends.filter(message => message.channel === 'launcher:state' && message.window === launcher).at(-1)?.value;
  assert.equal(selection?.species, 'capybara', 'the last choice is preselected');
  const invalid = await boot({ species: 'ferret' }, { autoChoose: false });
  assert.equal(invalid.writes.at(-1).content.species, 'hamster');
});

test('only the current chooser main frame can select a supported species', async () => {
  const state = await boot(undefined, { autoChoose: false });
  const initial = state.getLauncher();
  const petSender = { sender: state.pet.webContents, senderFrame: state.pet.webContents.mainFrame };
  for (const event of [petSender, { sender: {}, senderFrame: {} }, { sender: initial.webContents, senderFrame: {} }]) {
    state.choose('capybara', event);
    assert.equal(initial.isDestroyed(), false);
    assert.equal(state.pet.visible, false);
  }
  for (const species of ['ferret', null, { species: 'capybara' }, '../capybara']) {
    state.choose(species);
    assert.equal(initial.isDestroyed(), false);
  }
  state.choose('capybara');
  assert.equal(initial.isDestroyed(), true);
  assert.equal(state.pet.visible, true);
  assert.equal(state.writes.at(-1).content.species, 'capybara');
  assert.equal(state.tick().species, 'capybara');
  const reopened = openChooser(state);
  state.choose('hamster', { sender: initial.webContents, senderFrame: initial.webContents.mainFrame });
  assert.equal(reopened.isDestroyed(), false, 'an old closed chooser cannot change the selection');
  assert.equal(state.writes.at(-1).content.species, 'capybara');
  state.choose('hamster');
  assert.equal(state.writes.at(-1).content.species, 'hamster');
  assert.equal(state.tick().species, 'hamster');
});

test('closing the initial chooser quits, but cancelling a later chooser resumes the pet', async () => {
  const initial = await boot(undefined, { autoChoose: false });
  initial.getLauncher().close();
  assert.equal(initial.quit, 1);
  const active = await boot();
  active.tick();
  const before = { ...active.pet.bounds };
  const reopened = openChooser(active);
  for (let i = 0; i < 100; i++) active.tick();
  assert.deepEqual(active.pet.bounds, before, 'opening the chooser suspends wandering');
  reopened.close();
  assert.equal(active.quit, 0);
  assert.equal(active.pet.visible, true);
  for (let i = 0; i < 30; i++) active.tick();
  assert.notDeepEqual(active.pet.bounds, before, 'cancelling resumes wandering');
});

test('hamster and capybara retain independent wardrobes when switching companions', async () => {
  const state = await boot();
  selectAppearance(state, 'Couvre-chefs', 'Casquette');
  selectAppearance(state, 'Vêtements', 'Sweat à capuche');
  selectAppearance(state, 'Couleur de la tenue', 'Rose');
  const hamsterLook = { hat: 'cap', glasses: 'none', outfit: 'hoodie', color: 'rose' };
  openChooser(state);
  state.choose('capybara');
  assert.deepEqual(plain(state.tick().appearance), defaultAppearance);
  selectAppearance(state, 'Lunettes', 'De soleil');
  selectAppearance(state, 'Vêtements', 'Marinière');
  selectAppearance(state, 'Couleur de la tenue', 'Bleu');
  const capybaraLook = { hat: 'none', glasses: 'sun', outfit: 'mariniere', color: 'blue' };
  openChooser(state);
  state.choose('hamster');
  assert.deepEqual(plain(state.tick().appearance), hamsterLook);
  assert.deepEqual(state.writes.at(-1).content.appearances, { hamster: hamsterLook, capybara: capybaraLook });
  openChooser(state);
  state.choose('capybara');
  assert.deepEqual(plain(state.tick().appearance), capybaraLook);
  assert.deepEqual(state.writes.at(-1).content.appearance, capybaraLook, 'legacy compatibility follows the active look');
});

test('legacy wardrobe preferences migrate to the hamster and a capybara keeps its saved look', async () => {
  const hamsterLook = { hat: 'flower', glasses: 'heart', outfit: 'scarf', color: 'lavender' };
  const capybaraLook = { hat: 'beanie', glasses: 'round', outfit: 'overalls', color: 'blue' };
  const state = await boot({ species: 'capybara', appearance: hamsterLook, appearances: { capybara: capybaraLook } });
  assert.equal(state.tick().species, 'capybara');
  assert.deepEqual(plain(state.tick().appearance), capybaraLook);
  openChooser(state);
  state.choose('hamster');
  assert.deepEqual(plain(state.tick().appearance), hamsterLook);
  assert.deepEqual(state.writes.at(-1).content.appearances.capybara, capybaraLook);
});

test('tray activation cannot bypass the chooser and pet actions are blocked while choosing', async () => {
  const initial = await boot(undefined, { autoChoose: false });
  initial.tray.emit('double-click');
  initial.app.emit('activate');
  initial.app.emit('second-instance');
  assert.equal(initial.pet.visible, false);
  assert.equal(initial.windows.length, 2, 'activation reuses the existing chooser');
  initial.action('feed');
  assert.notEqual(initial.tick().mode, 'feed');
  const active = await boot();
  active.pointAtPet();
  const before = { ...active.pet.bounds };
  openChooser(active);
  active.action('drag-start');
  active.cursor = { x: active.cursor.x - 200, y: active.cursor.y - 200 };
  active.tick();
  assert.deepEqual(active.pet.bounds, before);
  assert.equal(active.input.at(-1).value, true, 'the paused pet lets input through');
  const chooser = active.getLauncher();
  active.cancel({ sender: active.pet.webContents, senderFrame: active.pet.webContents.mainFrame });
  assert.equal(chooser.isDestroyed(), false, 'the pet cannot cancel the chooser');
  active.cancel();
  assert.equal(chooser.isDestroyed(), true);
  assert.equal(active.quit, 0);
});

test('resetting one companion keeps the other wardrobe saved', async () => {
  const hamsterLook = { hat: 'crown', glasses: 'heart', outfit: 'hoodie', color: 'rose' };
  const capybaraLook = { hat: 'cowboy', glasses: 'sun', outfit: 'overalls', color: 'blue' };
  const state = await boot({ species: 'capybara', appearances: { hamster: hamsterLook, capybara: capybaraLook } });
  customization(state).find(item => item.label === 'Retirer les accessoires').click();
  state.popup.callback();
  assert.deepEqual(state.writes.at(-1).content.appearances, { hamster: hamsterLook, capybara: defaultAppearance });
  openChooser(state);
  state.choose('hamster');
  assert.deepEqual(plain(state.tick().appearance), hamsterLook);
});
