# IVY Atelier — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application Windows « IVY Atelier » qui affiche seulement les pages Commandes d'IVY en ligne et fait glisser les vrais fichiers d'impression dans ArtCraft / Graphics Lab.

**Architecture:** Une coquille Electron (dossier `atelier/` du dépôt IVY, hors du build Next) charge `https://ivy.runesdechene.com`, filtre les adresses et ajoute un pont `window.ivyAtelier` (préparer / glisser un fichier). IVY détecte la coquille par son User-Agent : menu réduit à deux onglets + Synchroniser, et les étiquettes de fichiers passent par le pont. Les versions sont publiées dans un bucket public Supabase lu par `electron-updater`.

**Tech Stack:** Electron, electron-builder (NSIS), electron-updater, TypeScript, `node:test` ; Next.js 16 / React côté IVY.

**Spec:** `docs/superpowers/specs/2026-11-19-ivy-atelier-design.md`

## Global Constraints

- L'application n'a aucune logique métier : elle affiche l'IVY en ligne, `https://ivy.runesdechene.com`.
- Adresses permises : `/login`, `/`, `/ivy/commandes/boutique` (exact), `/ivy/commandes/stock`, `/ivy/commandes/stock/<id>`, `/ivy/commandes/stock/<id>/impression`, `/ivy/commandes/stock/<id>/feuillet`. Toute autre navigation est refusée ; les liens externes s'ouvrent dans le navigateur par défaut.
- Signal de la coquille : suffixe `IvyAtelier/<version>` dans le User-Agent.
- Menu en mode Atelier : onglets « Commandes » et « Commandes stock », plus « Synchroniser », l'heure de la dernière synchro et les compteurs de commandes en attente.
- Cache local : `%LOCALAPPDATA%\IVY Atelier\impression\<empreinte>\<nom>` ; l'empreinte se lit dans le chemin de l'adresse signée (`<base>.<empreinte>.png`) ; seules les adresses du stockage d'IVY (`https://monessruufklcrrhzvub.supabase.co/storage/v1/object/sign/impression/`) sont acceptées.
- Dans un navigateur, rien ne change : clic pour télécharger, glisser `DownloadURL`.
- Le build Netlify d'IVY ne doit pas voir `atelier/` (exclu de `tsconfig.json`).
- Pas de certificat de signature (atelier seul).
- Conventional Commits en français ; un bump de `src/config/version.ts` à chaque commit qui touche l'app IVY.

## Review Focus

- **Glisser avant que le fichier soit en cache** (page tout juste ouverte) : l'étiquette reste « préparation… » et non glissable tant que le fichier n'est pas sur le disque — jamais un glisser vide. → Task 3 : les étiquettes ne deviennent glissables qu'après `preparer` résolu.
- **Session expirée** : IVY renvoie vers `/login`, permis ; après connexion, retour aux commandes, jamais une page hors liste. → Task 1 : `adresseAutorisee` couvre `/login` et `/`.
- **Lien vers une page interdite** (logo, lien d'un produit) : la fenêtre reste sur la page courante, ou revient à `/ivy/commandes/boutique` si la navigation a déjà eu lieu (navigation interne de Next). → Task 1 (tests) et Task 2 (garde).
- **Adresse signée expirée** (page ouverte depuis plus d'1 h, fichier pas encore en cache) : l'étiquette dit « recharger la page » au lieu de rester bloquée. → Task 3.
- **Pas de réseau au démarrage** : un message clair et un bouton « Réessayer », pas une fenêtre blanche. → Task 2.

---

### Task 1 : Les règles de la coquille, testées

**Files:**
- Create: `atelier/package.json`, `atelier/tsconfig.json`, `atelier/src/regles.ts`, `atelier/src/regles.test.ts`
- Modify: `tsconfig.json` (ajouter `"atelier"` à `exclude`)

**Interfaces:**
- Produces :
  - `export const BASE = 'https://ivy.runesdechene.com'`
  - `export function adresseAutorisee(url: string, base: string = BASE): boolean` — vrai pour `base` + un chemin de la liste des Global Constraints (requête et ancre ignorées), faux pour tout autre hôte ou chemin.
  - `export function cheminCache(url: string, nom: string, racine: string): string | null` — `null` si l'adresse n'est pas une adresse signée du bucket `impression` d'IVY, ou si son dernier segment n'a pas la forme `<base>.<empreinte 16 hex>.png` ; sinon `path.join(racine, empreinte, nom)`. Refuse un `nom` contenant `/`, `\` ou `..` (renvoie `null`).

- [ ] **Step 1 : Préparer `atelier/`** — `package.json` (`"name": "ivy-atelier"`, `"private": true`, `"main": "dist/main.js"`, scripts `build: tsc`, `test: node --test src/regles.test.ts`, `start: tsc && electron .`), dépendances `electron`, `electron-updater` ; dev `typescript`, `electron-builder`. `tsconfig.json` CommonJS, `outDir: dist`, strict. Ajouter `"atelier"` à `exclude` du `tsconfig.json` racine. `pnpm install` dans `atelier/`.
- [ ] **Step 2 : Écrire les tests**

```ts
test('adresseAutorisee', () => {
  for (const p of ['/', '/login', '/ivy/commandes/boutique', '/ivy/commandes/boutique?x=1', '/ivy/commandes/stock',
    '/ivy/commandes/stock/17258688-6e46-475f-9445-75a2135900f0', '/ivy/commandes/stock/abc/impression', '/ivy/commandes/stock/abc/feuillet'])
    assert.equal(adresseAutorisee(BASE + p), true, p);
  for (const u of [BASE + '/ivy/commandes/boutique/facturation', BASE + '/ivy/inventaire/mockups', BASE + '/ivy/commandes',
    BASE + '/ivy/commandes/stock/abc/autre', 'https://evil.example/ivy/commandes/boutique', 'http://ivy.runesdechene.com/'])
    assert.equal(adresseAutorisee(u), false, u);
});
test('cheminCache', () => {
  const s = 'https://monessruufklcrrhzvub.supabase.co/storage/v1/object/sign/impression/99c/LOKI/LOKI-DTG-OPA-C-LARGE.0123456789abcdef.png?token=t';
  assert.equal(cheminCache(s, 'LOKI DTG-OPA C-LARGE.png', 'C:\\c'), path.join('C:\\c', '0123456789abcdef', 'LOKI DTG-OPA C-LARGE.png'));
  assert.equal(cheminCache(s.replace('/impression/', '/mockups/'), 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache('https://autre.example/storage/v1/object/sign/impression/a.0123456789abcdef.png', 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache(s.replace('.0123456789abcdef', ''), 'x.png', 'C:\\c'), null);
  assert.equal(cheminCache(s, '..\\x.png', 'C:\\c'), null);
});
```

- [ ] **Step 3 : Lancer** `pnpm test` dans `atelier/` → FAIL (fonctions absentes).
- [ ] **Step 4 : Écrire `atelier/src/regles.ts`** (avec `URL` ; une seule expression régulière par liste de chemins).
- [ ] **Step 5 : Lancer** `pnpm test` → PASS ; `pnpm exec tsc --noEmit` à la racine d'IVY → aucune erreur venant de `atelier/`.
- [ ] **Step 6 : Commit** `feat(atelier): règles de la coquille (adresses permises, cache des fichiers)`.

### Task 2 : La coquille Electron

**Files:**
- Create: `atelier/src/main.ts`, `atelier/src/preload.ts`, `atelier/src/hors-ligne.html`

**Interfaces:**
- Consumes : `BASE`, `adresseAutorisee`, `cheminCache` (Task 1).
- Produces (pont exposé par `contextBridge.exposeInMainWorld('ivyAtelier', …)`) :
  - `preparer(url: string, nom: string): Promise<boolean>` — télécharge dans le cache si absent ; `true` si le fichier est sur le disque, `false` sinon (adresse refusée, expirée, réseau).
  - `glisser(url: string, nom: string): void` — `webContents.startDrag({ file, icon })` si le fichier est en cache, rien sinon.
  - Canaux IPC : `atelier:preparer` (invoke), `atelier:glisser` (send).

- [ ] **Step 1 : `main.ts`** — fenêtre unique (1400×900, mémorise taille/position inutile : non), `webPreferences: { preload, contextIsolation: true, sandbox: true }`, `userAgent` = UA par défaut + ` IvyAtelier/<app.getVersion()>`, charge `BASE + '/ivy/commandes/boutique'`. Racine du cache : `path.join(app.getPath('appData')… )` → `%LOCALAPPDATA%\IVY Atelier\impression` (`process.env.LOCALAPPDATA`). Gardes : `will-navigate` → `preventDefault()` si `!adresseAutorisee` (et `shell.openExternal` si l'hôte n'est pas `BASE`) ; `did-navigate-in-page` → `loadURL(BASE + '/ivy/commandes/boutique')` si `!adresseAutorisee` ; `setWindowOpenHandler` → `shell.openExternal`, `{ action: 'deny' }`. `did-fail-load` (code ≠ -3) → charge `hors-ligne.html`. Handlers IPC `atelier:preparer` (fetch → écrire en `.part` puis renommer ; `false` sur réponse non OK ou `cheminCache` null) et `atelier:glisser` (`event.sender.startDrag({ file, icon: nativeImage.createFromPath(file).resize({ width: 64 }) })`).
- [ ] **Step 2 : `preload.ts`** — `contextBridge` avec les deux fonctions ci-dessus, rien d'autre.
- [ ] **Step 3 : `hors-ligne.html`** — « IVY Atelier ne joint pas IVY. Vérifie la connexion. » et un bouton « Réessayer » qui recharge `BASE + '/ivy/commandes/boutique'`.
- [ ] **Step 4 : Vérifier à la main** — `pnpm start` dans `atelier/` : la fenêtre s'ouvre sur les commandes (connexion demandée la première fois) ; un lien vers l'Inventaire ne change pas de page ; couper le réseau puis relancer → page hors ligne, « Réessayer » marche une fois le réseau revenu. Dans la console de la fenêtre (Ctrl+Maj+I), `navigator.userAgent` finit par `IvyAtelier/0.1.0` et `typeof window.ivyAtelier.glisser === 'function'`.
- [ ] **Step 5 : Commit** `feat(atelier): coquille Electron, gardes de navigation et pont de glisser`.

### Task 3 : IVY en mode Atelier

**Files:**
- Create: `src/lib/atelier.ts`, `src/types/atelier.d.ts`
- Modify: `src/layout/IvyLayout.tsx`, `src/components/FichiersImpression/FichiersImpression.tsx`, `src/config/version.ts`

**Interfaces:**
- Consumes : le pont `window.ivyAtelier` (Task 2).
- Produces :
  - `src/types/atelier.d.ts` : `interface Window { ivyAtelier?: { preparer(url: string, nom: string): Promise<boolean>; glisser(url: string, nom: string): void } }`.
  - `export function estAtelier(): boolean` (`src/lib/atelier.ts`) — `typeof navigator !== 'undefined' && navigator.userAgent.includes('IvyAtelier/')`.

- [ ] **Step 1 : Menu** — dans `IvyLayout`, si `estAtelier()` : pas de barre du haut (Atelier/Festivals/Inventaire/Hub) ni des autres entrées ; à la place, deux liens « Commandes » (`/ivy/commandes/boutique`, badge `orderCounts.atelier`) et « Commandes stock » (`/ivy/commandes/stock`, badge `orderCounts.stock`), et le bloc Synchroniser existant tel quel. Lire `estAtelier()` après le montage (état initial `false`) pour ne pas casser l'hydratation.
- [ ] **Step 2 : Étiquettes** — dans `FichiersDeLaLigne`, si `window.ivyAtelier` : pour chaque fichier dont l'adresse est connue, appeler `preparer(url, nom)` une fois (au montage, pas au survol) ; état par nom : `préparation` → `prêt` → `échec` ; l'étiquette n'est glissable qu'à `prêt` ; `onDragStart` → `e.preventDefault()` puis `glisser(url, nom)` ; à `échec`, texte « recharger la page » et clic qui recharge. Sans le pont, comportement actuel inchangé (clic + `DownloadURL`).
- [ ] **Step 3 : Vérifier** — `pnpm exec tsc --noEmit` et `pnpm build` passent ; dans Brave, la page Commandes est inchangée ; dans la coquille (Task 2, pointée sur `http://localhost:3000` le temps du test via `IVY_ATELIER_BASE`), menu réduit, étiquettes qui passent de « préparation » à glissables, glisser vers le Bureau puis vers ArtCraft dépose `LOKI DTG-OPA C-LARGE.png` (300 dpi).
- [ ] **Step 4 : Commit** (+ bump) `feat(atelier): mode Atelier dans IVY (menu réduit, glisser natif)`.

### Task 4 : Installateur et mises à jour

**Files:**
- Create: `supabase/migrations/071_atelier_versions.sql`, `atelier/electron-builder.yml`, `atelier/scripts/publier.mjs`, `atelier/build/icon.ico`
- Modify: `atelier/src/main.ts`, `atelier/package.json`

**Interfaces:**
- Produces : bucket public `atelier-versions` ; flux de mises à jour `https://monessruufklcrrhzvub.supabase.co/storage/v1/object/public/atelier-versions/` (`latest.yml`, `IVY-Atelier-Setup-<version>.exe`, `.blockmap`).

- [ ] **Step 1 : Migration 071** — bucket `atelier-versions`, `public = true`, en tête le POURQUOI ; appliquer par `supabase db push --linked` (CLI de Fellowship, `--workdir` IVY) ; vérifier `select public from storage.buckets where id = 'atelier-versions'` → `true`.
- [ ] **Step 2 : `electron-builder.yml`** — `appId: fr.runesdechene.ivy-atelier`, `productName: IVY Atelier`, cible `nsis` (installation par utilisateur, raccourci Bureau), `artifactName: IVY-Atelier-Setup-${version}.${ext}`, `publish: { provider: generic, url: <flux ci-dessus> }`. Icône `build/icon.ico` (le « Ivy. » de l'en-tête sur fond clair, 256 px).
- [ ] **Step 3 : Mises à jour** — dans `main.ts`, si `app.isPackaged` : `autoUpdater.checkForUpdatesAndNotify()` au démarrage (installation à la fermeture).
- [ ] **Step 4 : `scripts/publier.mjs`** — après `electron-builder --win`, dépose `latest.yml`, l'`.exe` et le `.blockmap` de `atelier/dist-installer/` dans `atelier-versions` (clé de service lue dans `../.env.local`, `upsert: true`) ; script `publier` dans `atelier/package.json`.
- [ ] **Step 5 : Vérifier** — publier `0.1.0`, installer sur le PC d'Uriel, la lancer ; monter la version à `0.1.1`, publier ; relancer l'application installée → elle annonce la mise à jour et l'installe à la fermeture ; la relancer → `0.1.1` (à lire dans `navigator.userAgent`).
- [ ] **Step 6 : Commit** `feat(atelier): installateur Windows et mises à jour automatiques`.

### Task 5 : À l'atelier

- [ ] **Step 1 :** pousser IVY sur `main` (le mode Atelier doit être en ligne) et attendre la nouvelle version sur `ivy.runesdechene.com`.
- [ ] **Step 2 :** installer IVY Atelier sur le PC de Tanguy, connexion avec son compte IVY.
- [ ] **Step 3 :** sur une vraie commande : glisser chaque fichier dans Graphics Lab → bonne image, bonne taille (300 dpi), bon nom.
- [ ] **Step 4 :** noter l'installation et la suite (certificat de signature avant de vendre) dans le `_État.md` d'IVY du vault ; le protocole `Nouveau motif` n'a rien à changer.
