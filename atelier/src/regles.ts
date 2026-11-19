import path from 'node:path';

/** IVY en ligne : l'application n'affiche que lui. */
export const BASE = 'https://ivy.runesdechene.com';

/** Les sections d'IVY que l'application n'ouvre pas : l'atelier n'a que faire des festivals, de l'inventaire et du hub. */
const INTERDITES = /^\/ivy\/(inventaire|stand|hub)(\/|$)/;

/** Vrai si l'adresse est une page d'IVY servi à `base` hors des sections interdites (requête et ancre ignorées). */
export function adresseAutorisee(url: string, base: string = BASE): boolean {
  try {
    const u = new URL(url);
    return u.origin === new URL(base).origin && !INTERDITES.test(u.pathname);
  } catch {
    return false;
  }
}

/** Ce qu'on peut ouvrir dans le navigateur de Windows : un site web, jamais un programme (`file:`, `ms-settings:`…). */
export function adresseExterne(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Adresse signée d'un fichier d'impression d'IVY : `…/sign/impression/…/<base>.<empreinte>.png`. */
const FICHIER_IVY = /^https:\/\/monessruufklcrrhzvub\.supabase\.co\/storage\/v1\/object\/sign\/impression\/.*\.([0-9a-f]{16})\.png$/;

/**
 * Où garder un fichier d'impression sur le disque : rangé sous l'empreinte de son contenu, pour qu'un motif
 * modifié (même nom, autre contenu) ne soit jamais pris pour l'ancien. null si l'adresse ou le nom sont refusés.
 */
export function cheminCache(url: string, nom: string, racine: string): string | null {
  if (/[/\\]|\.\./.test(nom)) return null;
  const empreinte = FICHIER_IVY.exec(url.split('?')[0])?.[1];
  return empreinte ? path.join(racine, empreinte, nom) : null;
}
