import path from 'node:path';

/** IVY en ligne : l'application n'affiche que lui. */
export const BASE = 'https://ivy.runesdechene.com';

/** Les seules pages d'IVY que l'application montre : la connexion et les commandes à imprimer. */
const PAGES = /^\/(login|ivy\/commandes\/boutique|ivy\/commandes\/stock(\/[^/]+(\/(impression|feuillet))?)?)?$/;

/** Vrai si l'adresse est une page permise de l'IVY servi à `base` (requête et ancre ignorées). */
export function adresseAutorisee(url: string, base: string = BASE): boolean {
  try {
    const u = new URL(url);
    return u.origin === new URL(base).origin && PAGES.test(u.pathname);
  } catch {
    return false;
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
