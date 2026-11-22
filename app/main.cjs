'use strict';
const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, dialog, powerMonitor, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PetWorld } = require('./world.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'pip', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Pip Hamster');
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let pet, tray, world, ticker, lastTick, ignoring, launcher, quitting = false, petStarted = false, menuOpen = false, settings = {}, settingsPath;
const SPECIES = new Set(['hamster', 'capybara']);
let species = 'hamster';
const APPEARANCE_OPTIONS = {
  hat: [['none', 'Sans couvre-chef'], ['beanie', 'Bonnet'], ['cap', 'Casquette'], ['crown', 'Couronne'], ['flower', 'Fleur'], ['cowboy', 'Chapeau de cowboy']],
  glasses: [['none', 'Sans lunettes'], ['round', 'Rondes'], ['sun', 'De soleil'], ['heart', 'En cœur']],
  outfit: [['none', 'Sans vêtement'], ['hoodie', 'Sweat à capuche'], ['mariniere', 'Marinière'], ['scarf', 'Écharpe'], ['overalls', 'Salopette']],
  color: [['sage', 'Vert sauge'], ['blue', 'Bleu'], ['rose', 'Rose'], ['lavender', 'Lilas'], ['orange', 'Orange']]
};
function normalizeAppearance(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(Object.entries(APPEARANCE_OPTIONS).map(([key, options]) => [key,
    options.some(([id]) => source[key] === id) ? source[key] : options[0][0]
  ]));
}
let appearance = normalizeAppearance();
let appearances = { hamster: normalizeAppearance(), capybara: normalizeAppearance() };
function setAppearance(next) {
  appearance = normalizeAppearance(next);
  appearances[species] = { ...appearance };
  world.hat = appearance.hat;
  saveSettings();
}
function appearanceCategory(key, label) {
  return { label, submenu: APPEARANCE_OPTIONS[key].map(([id, title]) => ({
    label: title, type: 'radio', checked: appearance[key] === id,
    click: () => setAppearance({ ...appearance, [key]: id })
  })) };
}
function appearanceMenu() {
  return { label: 'Personnaliser mon compagnon', submenu: [
    appearanceCategory('hat', 'Couvre-chefs'),
    appearanceCategory('glasses', 'Lunettes'),
    appearanceCategory('outfit', 'Vêtements'),
    appearanceCategory('color', 'Couleur de la tenue'),
    { type: 'separator' },
    { label: 'Surprends-moi', click: () => {
      const next = Object.fromEntries(Object.entries(APPEARANCE_OPTIONS).map(([key, options]) => {
        const choices = key === 'hat' || key === 'outfit' ? options.slice(1) : options;
        return [key, choices[Math.floor(Math.random() * choices.length)][0]];
      }));
      setAppearance(next);
    } },
    { label: 'Retirer les accessoires', click: () => setAppearance() }
  ] };
}

function saveSettings() {
  settings = { behaviorVersion: 2, scale: world.scale, roam: world.roam, speed: world.speed, alwaysOnTop: pet.isAlwaysOnTop(), species, appearance: { ...appearance }, appearances: { hamster: { ...appearances.hamster }, capybara: { ...appearances.capybara } } };
  try { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(settings)); } catch { /* Pet still works on a read-only profile. */ }
}
function publish(state) {
  if (pet && !pet.isDestroyed() && !pet.webContents.isLoading()) pet.webContents.send('pet:state', { ...state, species, appearance: { ...appearance } });
}
function setInput(ignore) {
  if (ignore !== ignoring && pet && !pet.isDestroyed()) {
    pet.setIgnoreMouseEvents(ignore, { forward: true });
    ignoring = ignore;
  }
}
function tick() {
  if (!pet || pet.isDestroyed()) return;
  const now = performance.now();
  const cursor = screen.getCursorScreenPoint();
  if (world.drag) world.setArea(screen.getDisplayNearestPoint(cursor).workArea);
  const choosing = Boolean(launcher && !launcher.isDestroyed());
  const state = world.tick({ now, dt: (now - lastTick) / 1000, cursor, menuOpen: menuOpen || choosing || !petStarted });
  lastTick = now;
  const bounds = world.bounds();
  const current = pet.getBounds();
  if (bounds.x !== current.x || bounds.y !== current.y || bounds.width !== current.width) pet.setBounds(bounds, false);
  setInput(choosing || !petStarted || (!world.drag && !world.hitTest(cursor)));
  publish(state);
}
function showPet() { if (!petStarted) return openLauncher(); pet.showInactive(); }
function validLauncher(event) {
  return launcher && !launcher.isDestroyed() && event.sender === launcher.webContents && event.senderFrame === launcher.webContents.mainFrame;
}
function launcherState() {
  if (launcher && !launcher.isDestroyed()) launcher.webContents.send('launcher:state', { species });
}
function openLauncher() {
  if (!pet || pet.isDestroyed()) return;
  if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); return; }
  if (world.drag) world.endDrag(performance.now());
  launcher = new BrowserWindow({
    width: 560, height: 700, title: 'Choisis ton compagnon · Pip', backgroundColor: '#faf7f0',
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged }
  });
  launcher.setMenu(null);
  launcher.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  launcher.webContents.on('will-navigate', event => event.preventDefault());
  launcher.once('ready-to-show', () => { if (launcher && !launcher.isDestroyed()) { launcherState(); launcher.show(); launcher.focus(); } });
  launcher.on('closed', () => { launcher = null; if (!petStarted && !quitting) app.quit(); });
  launcher.loadURL('pip://app/launcher.html');
}
function chooseSpecies(next) {
  if (!SPECIES.has(next)) return;
  species = next;
  appearance = normalizeAppearance(appearances[species]);
  world.species = species;
  world.hat = appearance.hat;
  world.manualSleep = false;
  world.petUntil = 0;
  world.feedUntil = 0;
  world.naturalMode = 'idle';
  world.nextChange = performance.now() + 1800;
  petStarted = true;
  saveSettings();
  publish({ mode: 'idle', direction: world.direction, phase: world.phase, affection: world.affection, paused: world.paused });
  launcher?.close();
  pet.showInactive();
}
function help() {
  dialog.showMessageBox({ type: 'info', title: 'Pip & Capy, tes compagnons', message: 'Un peu de douceur sur ton bureau.', detail: 'Passe doucement la souris sur ton compagnon : il ferme les yeux.\n\n• Maintiens le clic gauche pour le déplacer.\n• Double-clique pour lui donner une graine.\n• Clic droit > Personnaliser mon compagnon : couvre-chefs, lunettes et vêtements.\n• Choisir mon compagnon permet de passer du hamster au capybara.\n• Le menu propose aussi taille, promenade, sieste et quitter.\n• L’icône près de l’horloge permet de le retrouver.\n\nChaque compagnon garde ses propres accessoires. Pip fonctionne hors ligne et ne demande aucun compte.', buttons: ['Compris !'] });
}
function menu() {
  const displays = screen.getAllDisplays();
  const items = [
    { label: species === 'capybara' ? 'Capy · ton petit capybara' : 'Pip · ton petit hamster', enabled: false },
    { type: 'separator' },
    { label: 'Choisir mon compagnon…', click: openLauncher },
    { label: 'Lui donner une graine', click: () => world.feed(performance.now()) },
    { label: world.manualSleep ? 'Réveiller mon compagnon' : 'Faire une sieste', click: () => { world.manualSleep = !world.manualSleep; world.ignoreTouchUntilLeave = world.manualSleep; world.petUntil = 0; world.feedUntil = 0; } },
    { label: 'Pause de la promenade', type: 'checkbox', checked: world.paused, click: item => { world.paused = item.checked; } },
    appearanceMenu(),
    { label: 'Taille', submenu: [['Tout petit', 0.55], ['Petit', 0.75], ['Grand câlin', 1]].map(([label, scale]) => ({ label, type: 'radio', checked: world.scale === scale, click: () => { world.setScale(scale); saveSettings(); } })) },
    { label: 'Promenade', submenu: [
      { label: 'En bas de l’écran', type: 'radio', checked: !world.roam, click: () => { world.setRoam(false); saveSettings(); } },
      { label: 'Partout sur l’écran', type: 'radio', checked: world.roam, click: () => { world.setRoam(true); saveSettings(); } },
      { type: 'separator' },
      ...[['Tranquille', 22], ['Curieux', 34], ['Petites pattes pressées', 52]].map(([label, speed]) => ({ label, type: 'radio', checked: world.speed === speed, click: () => { world.speed = speed; saveSettings(); } }))
    ] },
    ...(displays.length > 1 ? [{ label: 'Déplacer sur un écran', submenu: displays.map((display, index) => ({ label: display.label || `Écran ${index + 1}`, click: () => { world.setArea(display.workArea); world.x = display.workArea.x + display.workArea.width / 2 - world.size / 2; world.y = world.floor; } })) }] : []),
    { label: 'Toujours au premier plan', type: 'checkbox', checked: pet.isAlwaysOnTop(), click: item => { pet.setAlwaysOnTop(item.checked, 'floating'); saveSettings(); } },
    { label: pet.isVisible() ? 'Masquer Pip' : 'Retrouver Pip', click: () => pet.isVisible() ? pet.hide() : showPet() },
    ...(process.platform === 'darwin' || process.platform === 'win32' ? [{ label: 'Ouvrir à la connexion', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) }] : []),
    { type: 'separator' },
    { label: 'Comment jouer ?', click: help },
    { label: 'Quitter Pip', click: () => app.quit() }
  ];
  return Menu.buildFromTemplate(items);
}
function openMenu() {
  if (menuOpen) return;
  // End an interrupted pointer gesture before opening a native menu.
  if (world.drag) world.endDrag(performance.now());
  menuOpen = true;
  menu().popup({ window: pet, callback: () => { menuOpen = false; } });
}

if (singleInstance) app.whenReady().then(() => {
  const rendererRoot = path.join(__dirname, 'renderer');
  protocol.handle('pip', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const isAsset = pathname.startsWith('/assets/');
    const allowedRoot = isAsset ? path.join(__dirname, 'assets') : rendererRoot;
    const relativePath = isAsset ? pathname.slice('/assets'.length) : pathname;
    const filePath = path.resolve(allowedRoot, `.${relativePath === '/' ? '/index.html' : relativePath}`);
    if (!filePath.startsWith(allowedRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).href);
  });
  settingsPath = path.join(app.getPath('userData'), 'preferences.json');
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  species = SPECIES.has(settings.species) ? settings.species : 'hamster';
  appearances = {
    hamster: normalizeAppearance(settings.appearances?.hamster ?? settings.appearance),
    capybara: normalizeAppearance(settings.appearances?.capybara)
  };
  appearance = { ...appearances[species] };
  const scale = [0.55, 0.75, 1].includes(settings.scale) ? settings.scale : 0.75;
  const roam = settings.behaviorVersion === 2 ? settings.roam !== false : true;
  world = new PetWorld(screen.getPrimaryDisplay().workArea, { scale, roam, speed: [22, 34, 52].includes(settings.speed) ? settings.speed : 34 });
  world.hat = appearance.hat;
  world.species = species;
  pet = new BrowserWindow({ ...world.bounds(), title: 'Pip & Capy', transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: settings.alwaysOnTop !== false, show: false, acceptFirstMouse: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false, devTools: !app.isPackaged } });
  pet.setMenu(null);
  saveSettings();
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pet.webContents.on('will-navigate', event => event.preventDefault());
  pet.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  pet.loadURL('pip://app/index.html');
  pet.once('ready-to-show', () => { if (petStarted) pet.showInactive(); });
  if (process.platform === 'darwin') { app.dock?.hide(); pet.setHiddenInMissionControl(true); }
  const iconPath = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon.resize({ width: process.platform === 'darwin' ? 18 : 24, height: process.platform === 'darwin' ? 18 : 24 }));
  tray.setToolTip('Pip · caresse-moi avec la souris');
  tray.on('right-click', openMenu);
  tray.on('click', openMenu);
  tray.on('double-click', showPet);
  ipcMain.on('pet:action', (event, action) => {
    if (event.sender !== pet.webContents || event.senderFrame !== pet.webContents.mainFrame) return;
    if (!petStarted || launcher) return;
    const now = performance.now();
    if (action === 'drag-start') world.startDrag(screen.getCursorScreenPoint());
    else if (action === 'drag-end' && world.drag) {
      const display = screen.getDisplayMatching(world.bounds());
      world.setArea(display.workArea);
      world.endDrag(now);
    } else if (action === 'feed') world.feed(now);
    else if (action === 'menu') openMenu();
  });
  ipcMain.on('pet:choose-species', (event, next) => { if (validLauncher(event) && SPECIES.has(next)) chooseSpecies(next); });
  ipcMain.on('launcher:ready', event => { if (validLauncher(event)) launcherState(); });
  ipcMain.on('launcher:cancel', event => { if (validLauncher(event)) launcher.close(); });
  const recoverDisplay = () => { if (!world.drag) world.setArea(screen.getDisplayMatching(world.bounds()).workArea); };
  screen.on('display-removed', recoverDisplay);
  screen.on('display-metrics-changed', recoverDisplay);
  powerMonitor.on('resume', () => { lastTick = performance.now(); recoverDisplay(); });
  app.on('second-instance', openLauncher);
  app.on('activate', showPet);
  lastTick = performance.now();
  ticker = setInterval(tick, 1000 / 30);
  app.on('before-quit', () => { quitting = true; clearInterval(ticker); tray?.destroy(); });
  openLauncher();
});
app.on('window-all-closed', () => app.quit());
