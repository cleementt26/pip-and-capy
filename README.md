# Pip, ton petit hamster de bureau

Une petite application de bureau pour Windows et macOS, créée pour Clément.
Pip est un personnage original : il se promène, cligne des yeux, respire,
fait des siestes et ferme les yeux quand on le caresse avec la souris.

Version 1.1 : Pip explore toute la surface de l'écran par défaut, vers la gauche,
la droite, le haut et le bas. Il choisit des destinations aléatoires et garde sa
destination pendant ses pauses, pour visiter aussi les bords. Les anciennes
préférences sont mises à jour une fois pour activer cette promenade libre.

## Lancer l'application

Télécharge l'archive correspondant à ton ordinateur et décompresse-la.

| Ordinateur | Archive | Premier lancement |
| --- | --- | --- |
| Windows 10 / 11, 64 bits | `Pip-Windows-x64.zip` | Ouvrir `Pip.exe` dans le dossier extrait. |
| Mac avec puce Apple M1 ou plus récente | `Pip-Mac-Apple-Silicon.zip` | Ouvrir `Ouvrir Pip.command` à côté de `Pip.app`. |
| Mac Intel | `Pip-Mac-Intel.zip` | Ouvrir `Ouvrir Pip.command` à côté de `Pip.app`. |

Sur Mac, macOS Ventura 13 ou plus récent est nécessaire. Pour connaître la puce,
ouvre le menu Apple > À propos de ce Mac.

Les versions sont portables et non signées par un éditeur. Windows peut afficher
un avertissement au premier lancement. Sur Mac, le lanceur prépare uniquement
`Pip.app` : il retire la quarantaine et applique une signature locale pour cette
application. Il ne demande pas de mot de passe et ne modifie pas les réglages
généraux de sécurité. Après ce premier lancement, déplace `Pip.app` dans
Applications si tu le souhaites et ouvre-le normalement.

Si macOS bloque le lanceur, fais clic droit > Ouvrir ; après une tentative,
une autorisation peut apparaître dans Réglages Système > Confidentialité et
sécurité. Le fichier `LISEZ-MOI.txt` de chaque archive contient les détails.

## Jouer avec Pip

- **Caresser :** passer doucement la souris sur lui. Il s'arrête, ferme les
  yeux et laisse apparaître de petits cœurs.
- **Déplacer :** maintenir le clic gauche et faire glisser Pip.
- **Nourrir :** double-cliquer pour lui donner une graine de tournesol.
- **Régler :** clic droit sur Pip ou clic sur son icône près de l'horloge.
- **Quitter :** choisir « Quitter Pip » dans ce menu.

Le menu propose trois tailles, trois vitesses, une promenade partout par défaut
ou au bas de l'écran, une pause, une sieste et le choix d'un écran. Le démarrage à la
connexion est facultatif et désactivé par défaut. Taille, vitesse, zone de
promenade et premier plan sont mémorisés dans les préférences locales.

Pip passe au-dessus des fenêtres par défaut. Les coins transparents laissent
les clics atteindre les applications placées derrière. Une application en
plein écran exclusif peut le masquer.

## Fonctionnement et validation

L'application fonctionne hors ligne. Pas de compte, de publicité ni de suivi.
Elle ne lit ni tes documents ni le contenu de ton écran ; elle utilise la
position du pointeur pour réagir aux caresses et aux déplacements.

Les tests automatiques couvrent les interactions, les limites de l'écran,
les écrans placés à des coordonnées négatives, le redimensionnement et la
reprise après veille. Les archives ont été générées depuis Linux. Le lancement
natif sous Windows et macOS reste à confirmer sur ces systèmes : cette
livraison est une première version à essayer, pas une version signée et notariée.

## Modifier et reconstruire

Installer Node.js 22.12 ou plus récent, puis dans ce dossier :

```sh
npm ci
npm exec install-electron
npm start
```

L'installation explicite d'Electron est nécessaire avec sa version 45.

```sh
npm test
npm run package
```

Les ZIP sont créés dans `releases/`. `npm run package -- windows`,
`npm run package -- mac-arm64` et `npm run package -- mac-intel` limitent la
construction à une cible. La commande `zip` doit être disponible pour cette
construction depuis Linux/macOS. Les exécutions sur Windows et les versions
signées nécessitent une adaptation du conditionnement.

Le code applicatif n'a aucune dépendance de production. Le rendu utilise un SVG
original, CSS et JavaScript dans une fenêtre Electron transparente, avec un
processus de rendu isolé et sandboxé. Les versions de développement sont fixées
dans `package-lock.json`. Licence MIT pour le code et le dessin originaux ; les
licences tierces sont conservées dans les applications distribuées.
