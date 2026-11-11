import {
  bornesDessin, carteOmbres, placerMotif, placerPoitrine, teinteReglee,
  type Cadre, type Gabarit, type Impression, type Point, type Rect, type Reglages, type Version,
} from './regles';

/**
 * Montage d'un mockup sur canvas, dans le navigateur comme sur le serveur. Les règles de placement vivent dans regles.ts.
 * Le serveur branche sa propre plateforme (`@napi-rs/canvas`, même API de dessin) avec `utiliserPlateforme`.
 */

export type Img = CanvasImageSource & { width: number; height: number };
export interface Plateforme {
  toile(largeur: number, hauteur: number): HTMLCanvasElement;
  chargerImage(source: string | Blob): Promise<Img>; // URL ou fichier
  exporter(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png'): Promise<Blob>;
}

const navigateur: Plateforme = {
  toile: (largeur, hauteur) => Object.assign(document.createElement('canvas'), { width: largeur, height: hauteur }),
  // <img> plutôt que createImageBitmap : Chrome ne décode pas les SVG avec ce dernier.
  async chargerImage(source) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // images du bucket : sans ça, le canvas serait « sali » et toBlob refusé
    // shortcut: l'URL locale d'un fichier n'est jamais révoquée (l'image la relit pour redessiner un SVG) ; quelques Ko par motif.
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
    await img.decode();
    return img;
  },
  exporter: (canvas, type) => new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Export impossible'))), type, 0.9)),
};

let plateforme = navigateur;
export function utiliserPlateforme(p: Plateforme): void { plateforme = p; }

export interface GabaritCharge {
  photo: Img; ombres: Record<Version, Img | null>; intensites: Record<Version, number>;
  masque: HTMLCanvasElement | null; // déjà converti : blanc → opaque, noir → transparent
  cadre: Cadre; poitrine: Point | null;
}
export interface Source { image: Img; dessin: Rect } // dessin = pixels non transparents de l'image

function toile(largeur: number, hauteur: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = plateforme.toile(largeur, hauteur);
  return [canvas, canvas.getContext('2d')!];
}

/** Fichier motif (PNG ou SVG) et le rectangle de son dessin, lu une fois. */
export async function chargerSource(fichier: Blob): Promise<Source> {
  const image = await plateforme.chargerImage(fichier);
  const { width: l, height: h } = image;
  if (!l || !h) throw new Error('Image sans dimensions (SVG sans largeur ni hauteur ?)');
  const [, ctx] = toile(l, h);
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, l, h).data;
  const alpha = new Uint8ClampedArray(l * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const dessin = bornesDessin(alpha, l, h);
  if (!dessin) throw new Error('Image vide : aucun pixel visible');
  return { image, dessin };
}

/** Masque de fusion façon Photoshop (gris) → toile dont l'opacité suit le gris, pour un « destination-in ». */
function masqueEnAlpha(image: Img): HTMLCanvasElement {
  const [canvas, ctx] = toile(image.width, image.height);
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 * (d[i + 3] / 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

export async function chargerGabarit(g: Pick<Gabarit, 'photo_url' | 'ombres' | 'masque_url' | 'intensites' | 'cadre' | 'poitrine'>): Promise<GabaritCharge> {
  const [photo, masque, clair, sombre] = await Promise.all([
    plateforme.chargerImage(g.photo_url),
    g.masque_url ? plateforme.chargerImage(g.masque_url).then(masqueEnAlpha) : null,
    g.ombres.CLAIR ? plateforme.chargerImage(g.ombres.CLAIR) : null,
    g.ombres.SOMBRE ? plateforme.chargerImage(g.ombres.SOMBRE) : null,
  ]);
  return { photo, ombres: { CLAIR: clair, SOMBRE: sombre }, masque, intensites: g.intensites, cadre: g.cadre, poitrine: g.poitrine };
}

/** Ombres calculées sur la photo du gabarit, recentrées sur le tissu du cadre. */
function ombresDeLaPhoto(photo: Img, cadre: Cadre, intensite: number): HTMLCanvasElement {
  const [canvas, ctx] = toile(photo.width, photo.height);
  ctx.drawImage(photo, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  image.data.set(carteOmbres(image.data, canvas.width, cadre, intensite));
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Le dessin rogné, à la taille demandée, peint de la couleur de la teinte (le noir ou blanc d'origine disparaît). */
export function peindre(source: Source, couleur: string, largeur: number, hauteur: number): HTMLCanvasElement {
  const { dessin } = source;
  const [canvas, ctx] = toile(Math.max(1, Math.round(largeur)), Math.max(1, Math.round(hauteur)));
  ctx.drawImage(source.image, dessin.x, dessin.y, dessin.w, dessin.h, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = couleur;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Photo + encre à l'opacité réglée + ombres du tissu limitées à l'encre. `hauteurCm` : null pour la marque et le DTF (taille réelle). */
export function composerMockup(g: GabaritCharge, source: Source, impression: Impression, reglages: Reglages, hauteurCm: number | null): HTMLCanvasElement {
  const teinte = teinteReglee(reglages, impression.teinte);
  if (!teinte) throw new Error(`Teinte ${impression.teinte} à régler`);
  const { dessin } = source;
  let place: Rect;
  if (impression.pose === 'motif') {
    if (hauteurCm === null) throw new Error('Hauteur à régler');
    place = placerMotif(g.cadre, dessin.w, dessin.h, hauteurCm);
  } else {
    if (!g.poitrine) throw new Error('Point poitrine à poser sur le gabarit');
    place = placerPoitrine(g.cadre, g.poitrine, dessin.w, dessin.h);
  }

  const { width: l, height: h } = g.photo;
  const [canvas, ctx] = toile(l, h);
  ctx.drawImage(g.photo, 0, 0);

  // L'encre à sa place, sur une toile de la taille de la photo, effacée là où le masque est noir.
  const [encre, e] = toile(l, h);
  e.drawImage(peindre(source, teinte.couleur, place.w, place.h), place.x, place.y, place.w, place.h);
  if (g.masque) {
    e.globalCompositeOperation = 'destination-in';
    e.drawImage(g.masque, 0, 0, l, h);
  }
  ctx.globalAlpha = reglages.opacite;
  ctx.drawImage(encre, 0, 0);

  // Un fichier d'ombres déposé l'emporte sur les ombres tirées de la photo.
  const intensite = g.intensites[teinte.version];
  const ombres = g.ombres[teinte.version] ?? (intensite > 0 ? ombresDeLaPhoto(g.photo, g.cadre, intensite) : null);
  if (ombres) {
    const [calque, c] = toile(l, h);
    c.drawImage(ombres, 0, 0, l, h);
    c.globalCompositeOperation = 'destination-in'; // les ombres ne tombent que sur l'encre
    c.drawImage(encre, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'hard-light';
    ctx.drawImage(calque, 0, 0);
  }
  return canvas;
}

export function versBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png'): Promise<Blob> {
  return plateforme.exporter(canvas, type);
}

