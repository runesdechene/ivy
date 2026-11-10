import {
  bornesDessin, placerMotif, placerPoitrine, teinteReglee, OPACITE_ENCRE,
  type Cadre, type Gabarit, type Impression, type Point, type Rect, type Reglages, type Version,
} from './regles';

/** Montage d'un mockup dans le navigateur (canvas). Les règles de placement vivent dans regles.ts. */

export interface GabaritCharge { photo: HTMLImageElement; ombres: Record<Version, HTMLImageElement | null>; cadre: Cadre; poitrine: Point | null }
export interface Source { image: HTMLImageElement; dessin: Rect } // dessin = pixels non transparents de l'image

/** <img> plutôt que createImageBitmap : Chrome ne décode pas les SVG avec ce dernier. */
async function chargerImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // images du bucket : sans ça, le canvas serait « sali » et toBlob refusé
  img.src = url;
  await img.decode();
  return img;
}

function toile(largeur: number, hauteur: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  return [canvas, canvas.getContext('2d')!];
}

/** Fichier motif (PNG ou SVG) et le rectangle de son dessin, lu une fois. */
export async function chargerSource(fichier: Blob): Promise<Source> {
  // shortcut: l'URL locale n'est jamais révoquée (l'image la relit pour redessiner un SVG) ; quelques Ko par motif chargé.
  const image = await chargerImage(URL.createObjectURL(fichier));
  const { naturalWidth: l, naturalHeight: h } = image;
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

export async function chargerGabarit(g: Pick<Gabarit, 'photo_url' | 'ombres' | 'cadre' | 'poitrine'>): Promise<GabaritCharge> {
  const [photo, clair, sombre] = await Promise.all([
    chargerImage(g.photo_url),
    g.ombres.CLAIR ? chargerImage(g.ombres.CLAIR) : null,
    g.ombres.SOMBRE ? chargerImage(g.ombres.SOMBRE) : null,
  ]);
  return { photo, ombres: { CLAIR: clair, SOMBRE: sombre }, cadre: g.cadre, poitrine: g.poitrine };
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

/** Photo + encre à 75 % + ombres du tissu limitées à l'encre. `hauteurCm` : null pour la marque et le DTF (taille réelle). */
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

  const { naturalWidth: l, naturalHeight: h } = g.photo;
  const [canvas, ctx] = toile(l, h);
  ctx.drawImage(g.photo, 0, 0);

  const encre = peindre(source, teinte.couleur, place.w, place.h);
  ctx.globalAlpha = OPACITE_ENCRE;
  ctx.drawImage(encre, place.x, place.y, place.w, place.h);

  const ombres = g.ombres[teinte.version];
  if (ombres) {
    const [calque, c] = toile(l, h);
    c.drawImage(ombres, 0, 0, l, h);
    c.globalCompositeOperation = 'destination-in'; // les ombres ne tombent que sur l'encre
    c.drawImage(encre, place.x, place.y, place.w, place.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'hard-light';
    ctx.drawImage(calque, 0, 0);
  }
  return canvas;
}

export function versBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/png'): Promise<Blob> {
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('Export impossible'))), type, 0.9));
}
