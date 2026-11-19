/**
 * IVY Atelier : une fenêtre sur les commandes d'IVY en ligne, et le vrai glisser des fichiers d'impression.
 * Aucune logique métier ici : IVY fait tout, l'application ne fait que montrer ses pages d'impression
 * et poser les fichiers sur le disque pour qu'un logiciel d'impression les reçoive.
 */
import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { BASE, adresseAutorisee, adresseExterne, cheminCache } from './regles';

// En développement, on peut viser l'IVY local (`IVY_ATELIER_BASE=http://localhost:3000`).
const ivy = (!app.isPackaged && process.env.IVY_ATELIER_BASE) || BASE;
const ACCUEIL = `${ivy}/ivy/commandes/boutique`;
const CACHE = path.join(process.env.LOCALAPPDATA ?? app.getPath('userData'), 'IVY Atelier', 'impression');

function ouvrir(): void {
  const fenetre = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'IVY Atelier',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  const page = fenetre.webContents;
  // IVY se met en mode Atelier quand il lit cette signature.
  page.setUserAgent(`${page.getUserAgent()} IvyAtelier/${app.getVersion()}`);

  // Seul un site web part dans le navigateur de Windows, jamais un programme (`file:`, `ms-settings:`…).
  const ouvrirAilleurs = (url: string) => {
    const externe = adresseExterne(url);
    if (externe && new URL(externe).origin !== new URL(ivy).origin) void shell.openExternal(externe);
  };
  // Une page hors liste ne s'ouvre pas ; un lien d'un autre site part dans le navigateur.
  // (La page hors ligne, chargée par loadFile, ne passe pas par ici ; son « Réessayer » si, et vise IVY.)
  const garder = (e: Electron.Event, url: string) => {
    if (adresseAutorisee(url, ivy)) return;
    e.preventDefault();
    ouvrirAilleurs(url);
  };
  page.on('will-navigate', garder);
  page.on('will-redirect', garder);
  // La navigation interne de Next ne passe pas par will-navigate : on revient aux commandes après coup.
  page.on('did-navigate-in-page', (_e, url, principale) => {
    if (principale && !adresseAutorisee(url, ivy)) void fenetre.loadURL(ACCUEIL);
  });
  page.setWindowOpenHandler(({ url }) => {
    ouvrirAilleurs(url);
    return { action: 'deny' };
  });
  // Pas de réseau : un message et « Réessayer », plutôt qu'une fenêtre blanche (-3 = navigation annulée).
  page.on('did-fail-load', (_e, code, _desc, _url, principale) => {
    if (principale && code !== -3) void fenetre.loadFile(path.join(__dirname, '..', 'src', 'hors-ligne.html'), { query: { accueil: ACCUEIL } });
  });

  void fenetre.loadURL(ACCUEIL);
}

/** Télécharge un fichier d'impression dans le cache s'il n'y est pas ; vrai s'il est sur le disque. */
ipcMain.handle('atelier:preparer', async (_e, url: string, nom: string): Promise<boolean> => {
  const fichier = cheminCache(url, nom, CACHE);
  if (!fichier) return false;
  if (existsSync(fichier)) return true;
  try {
    const r = await fetch(url);
    if (!r.ok) return false; // adresse expirée ou refusée
    await mkdir(path.dirname(fichier), { recursive: true });
    // Écrit à côté puis renomme : un fichier à moitié téléchargé n'est jamais pris pour un fichier prêt.
    await writeFile(`${fichier}.part`, Buffer.from(await r.arrayBuffer()));
    await rename(`${fichier}.part`, fichier);
    return true;
  } catch {
    return false;
  }
});

/** Lance le glisser natif d'un fichier déjà en cache : le logiciel d'impression reçoit un vrai fichier. */
ipcMain.on('atelier:glisser', (e, url: string, nom: string) => {
  const fichier = cheminCache(url, nom, CACHE);
  if (!fichier || !existsSync(fichier)) return;
  e.sender.startDrag({ file: fichier, icon: nativeImage.createFromPath(fichier).resize({ width: 64 }) });
});

app.whenReady().then(() => {
  ouvrir();
  // Une nouvelle version se télécharge en fond, s'annonce, et s'installe à la fermeture.
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
});
app.on('window-all-closed', () => app.quit());
