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
let pet, tray, world, ticker, lastTick, ignoring, menuOpen = false, settings = {}, settingsPath;

function saveSettings() {
  settings = { behaviorVersion: 2, scale: world.scale, roam: world.roam, speed: world.speed, alwaysOnTop: pet.isAlwaysOnTop() };
  try { fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(settings)); } catch { /* Pet still works on a read-only profile. */ }
}
function publish(state) {
  if (pet && !pet.isDestroyed() && !pet.webContents.isLoading()) pet.webContents.send('pet:state', state);
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
  const state = world.tick({ now, dt: (now - lastTick) / 1000, cursor, menuOpen });
  lastTick = now;
  const bounds = world.bounds();
  const current = pet.getBounds();
  if (bounds.x !== current.x || bounds.y !== current.y || bounds.width !== current.width) pet.setBounds(bounds, false);
  setInput(!world.drag && !world.hitTest(cursor));
  publish(state);
}
function showPet() { pet.showInactive(); }
function help() {
  dialog.showMessageBox({ type: 'info', title: 'Pip, ton petit hamster', message: 'Un peu de douceur sur ton bureau.', detail: 'Passe doucement la souris sur Pip : il ferme les yeux.\n\n• Maintiens le clic gauche pour le déplacer.\n• Double-clique pour lui donner une graine.\n• Clic droit : taille, promenade, sieste et quitter.\n• L’icône près de l’horloge permet de le retrouver.\n\nPip fonctionne hors ligne et ne demande aucun compte.', buttons: ['Compris !'] });
}
function menu() {
  const displays = screen.getAllDisplays();
  const items = [
    { label: 'Pip · ton petit hamster', enabled: false },
    { type: 'separator' },
    { label: 'Lui donner une graine', click: () => world.feed(performance.now()) },
    { label: world.manualSleep ? 'Réveiller Pip' : 'Faire une sieste', click: () => { world.manualSleep = !world.manualSleep; world.ignoreTouchUntilLeave = world.manualSleep; world.petUntil = 0; world.feedUntil = 0; } },
    { label: 'Pause de la promenade', type: 'checkbox', checked: world.paused, click: item => { world.paused = item.checked; } },
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
    const filePath = path.resolve(rendererRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filePath.startsWith(rendererRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).href);
  });
  settingsPath = path.join(app.getPath('userData'), 'preferences.json');
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  const scale = [0.55, 0.75, 1].includes(settings.scale) ? settings.scale : 0.75;
  const roam = settings.behaviorVersion === 2 ? settings.roam !== false : true;
  world = new PetWorld(screen.getPrimaryDisplay().workArea, { scale, roam, speed: [22, 34, 52].includes(settings.speed) ? settings.speed : 34 });
  pet = new BrowserWindow({ ...world.bounds(), title: 'Pip Hamster', transparent: true, backgroundColor: '#00000000', frame: false, hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, alwaysOnTop: settings.alwaysOnTop !== false, show: false, acceptFirstMouse: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false, devTools: !app.isPackaged } });
  pet.setMenu(null);
  saveSettings();
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pet.webContents.on('will-navigate', event => event.preventDefault());
  pet.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  pet.loadURL('pip://app/index.html');
  pet.once('ready-to-show', showPet);
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
    const now = performance.now();
    if (action === 'drag-start') world.startDrag(screen.getCursorScreenPoint());
    else if (action === 'drag-end' && world.drag) {
      const display = screen.getDisplayMatching(world.bounds());
      world.setArea(display.workArea);
      world.endDrag(now);
    } else if (action === 'feed') world.feed(now);
    else if (action === 'menu') openMenu();
  });
  const recoverDisplay = () => { if (!world.drag) world.setArea(screen.getDisplayMatching(world.bounds()).workArea); };
  screen.on('display-removed', recoverDisplay);
  screen.on('display-metrics-changed', recoverDisplay);
  powerMonitor.on('resume', () => { lastTick = performance.now(); recoverDisplay(); });
  app.on('second-instance', showPet);
  app.on('activate', showPet);
  lastTick = performance.now();
  ticker = setInterval(tick, 1000 / 30);
  app.on('before-quit', () => { clearInterval(ticker); tray?.destroy(); });
});
app.on('window-all-closed', () => app.quit());
