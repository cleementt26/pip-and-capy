#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'out');
const releases = path.join(root, 'releases');
const electronVersion = '45.4.1';

const targets = [
  { id: 'win32-x64', platform: 'win32', arch: 'x64', filename: 'Pip-Windows-x64.zip', aliases: ['windows', 'win', 'windows-x64'] },
  { id: 'darwin-arm64', platform: 'darwin', arch: 'arm64', filename: 'Pip-Mac-Apple-Silicon.zip', aliases: ['mac-arm64', 'mac-apple-silicon', 'apple-silicon'] },
  { id: 'darwin-x64', platform: 'darwin', arch: 'x64', filename: 'Pip-Mac-Intel.zip', aliases: ['mac-x64', 'mac-intel', 'intel'] },
];

const commonReadme = `PIP & CAPY — TES COMPAGNONS DE BUREAU
Version 1.3.0 · Créé pour Clément

COMMENT JOUER
• Au lancement, choisis Pip le hamster ou Capy le capybara.
• Ton compagnon se promène partout sur l’écran, dans toutes les directions.
• Passe doucement la souris sur lui pour le caresser : il ferme les yeux.
• Maintiens le clic gauche pour le déplacer.
• Double-clique pour lui donner une graine.
• Clic droit : personnalisation, taille, promenade, sieste et quitter.
• « Choisir mon compagnon… » permet de changer d’animal.
• Les accessoires sont mémorisés séparément pour chacun.
• Son icône près de l’horloge permet de retrouver le menu.

Pip fonctionne hors ligne, sans compte, publicité ni suivi.
Un dessin original inspiré de l’esprit des compagnons de bureau.
Le dossier contient le programme et ses composants : conserve-les ensemble.

Cette version est un prototype non signé. Les animations et la logique ont été
vérifiées dans l’environnement de développement ; le lancement sur Windows et
macOS doit encore être confirmé sur un ordinateur de chaque système.
`;

function readmeFor(target) {
  if (target.platform === 'win32') {
    return `${commonReadme}\nWINDOWS 10 / 11 — 64 BITS\n1. Fais clic droit sur le ZIP, puis « Extraire tout ».\n2. Ouvre le dossier extrait et lance « Pip.exe ».\n3. Pour fermer Pip, clic droit sur le compagnon > Quitter Pip.\n\nLe programme n’est pas signé par un certificat éditeur. Windows peut donc\nafficher un avertissement lors du premier lancement.\n`;
  }
  const chip = target.arch === 'arm64' ? 'Apple Silicon (M1, M2, M3, M4 et suivants)' : 'Intel';
  return `${commonReadme}\nMAC — ${chip}\nmacOS Ventura 13 ou version plus récente.\n1. Double-clique sur le ZIP pour le décompresser.\n2. Au premier lancement uniquement, ouvre « Ouvrir Pip.command » qui doit\n   rester à côté de « Pip.app ». Le Terminal explique la préparation et ouvre Pip.\n3. Ensuite, tu peux déplacer « Pip.app » dans Applications et l’ouvrir normalement.\n4. Son menu se trouve dans la barre des menus.\n\nCette application n’est ni signée par un éditeur Apple ni notariée par Apple.\nLe lanceur retire la quarantaine de Pip.app et crée une signature locale pour\ncette application uniquement. Il ne demande aucun mot de passe et ne modifie\npas les protections générales de macOS. Utilise ce lanceur seulement pour\ncette copie de Pip dont tu connais l’origine.\n\nSi macOS bloque le fichier .command, fais clic droit > Ouvrir. Après une tentative\nd’ouverture, l’autorisation peut aussi apparaître dans Réglages Système >\nConfidentialité et sécurité. Si la préparation échoue, le Terminal indique\nl’erreur ; conserve ce message pour le diagnostic.\n`;
}

const macLauncher = `#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
printf '%s\\n' 'Pip — préparation du premier lancement' ''
printf '%s\\n' 'Ce lanceur signe localement Pip.app et retire sa quarantaine.'
printf '%s\\n' 'Il ne modifie aucune protection générale de macOS.' ''
if [ ! -d "Pip.app" ]; then
  printf '%s\\n' 'Pip.app est introuvable. Garde ce lanceur à côté de Pip.app.'
  exit 1
fi
entitlements_path="$(/usr/bin/mktemp -t pip-entitlements)"
trap '/bin/rm -f "$entitlements_path"' EXIT
cat > "$entitlements_path" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
PLIST
/usr/bin/xattr -dr com.apple.quarantine "Pip.app" 2>/dev/null || true
/usr/bin/codesign --force --deep --sign - --options runtime --entitlements "$entitlements_path" "Pip.app"
/usr/bin/codesign --verify --deep --strict "Pip.app"
/usr/bin/open "Pip.app"
printf '%s\\n' '' 'Pip est prêt. Pour les prochains lancements, ouvre simplement Pip.app.'
`;

// Include only application code and license; development tools never ship.
function ignore(filePath) {
  // Packager's callback receives '' for the root and '/app/…' for children.
  const relative = filePath.replace(/^[\\/]+/, '');
  if (!relative) return false;
  const first = relative.split(/[\\/]/)[0];
  return !['app', 'package.json', 'LICENSE'].includes(first);
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function main() {
  const requested = process.argv[2];
  if (process.argv.length > 3 || requested === '--help' || requested === '-h') {
    console.log('Usage: node scripts/package.cjs [win32-x64|darwin-arm64|darwin-x64]');
    if (process.argv.length > 3) process.exitCode = 1;
    return;
  }
  const selected = requested ? targets.filter(target => target.id === requested || target.aliases.includes(requested)) : targets;
  if (!selected.length) throw new Error(`Cible inconnue : ${requested}. Utilise win32-x64, darwin-arm64 ou darwin-x64.`);

  // Packager 20 is ESM, while this project's runtime deliberately uses CJS.
  const { packager } = await import('@electron/packager');
  await fs.mkdir(releases, { recursive: true });
  await fs.mkdir(out, { recursive: true });

  for (const target of selected) {
    const icon = path.join(root, 'app', 'assets', target.platform === 'win32' ? 'icon.ico' : 'icon.icns');
    const options = {
      dir: root,
      name: 'Pip',
      executableName: 'Pip',
      platform: target.platform,
      arch: target.arch,
      electronVersion,
      appBundleId: 'fr.clement.pip',
      appCategoryType: 'public.app-category.entertainment',
      appCopyright: 'Copyright © 2026 Clément Vincent',
      asar: true,
      prune: false,
      ignore,
      overwrite: true,
      out,
      ...(await exists(icon) ? { icon } : {}),
      ...(target.platform === 'darwin' ? { extendInfo: { LSUIElement: true } } : {}),
    };
    console.log(`Préparation de ${target.id} avec Electron ${electronVersion}…`);
    const packaged = await packager(options);
    if (packaged.length !== 1) throw new Error(`Une seule sortie était attendue pour ${target.id}, reçu ${packaged.length}.`);
    const directory = packaged[0];
    const binary = path.join(directory, target.platform === 'win32' ? 'Pip.exe' : 'Pip.app');
    if (!(await exists(binary))) throw new Error(`Exécutable manquant : ${binary}`);
    await fs.writeFile(path.join(directory, 'LISEZ-MOI.txt'), readmeFor(target), 'utf8');
    if (target.platform === 'darwin') {
      const launcher = path.join(directory, 'Ouvrir Pip.command');
      await fs.writeFile(launcher, macLauncher, { encoding: 'utf8', mode: 0o755 });
      await fs.chmod(launcher, 0o755);
    }
    const archive = path.join(releases, target.filename);
    // Remove the old ZIP first: zip otherwise preserves obsolete entries.
    await fs.rm(archive, { force: true });
    await run('zip', ['-q', '-r', '-y', archive, '.'], { cwd: directory, maxBuffer: 2 * 1024 * 1024 });
    const { size } = await fs.stat(archive);
    if (size < 1024 * 1024) throw new Error(`Archive anormalement petite : ${archive}`);
    console.log(`${target.filename} · ${(size / 1024 / 1024).toFixed(1)} Mo`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
