'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, type Cadre, type Point } from '@/lib/mockups/regles';
import styles from './mockups.module.scss';

const LARGEUR_AFFICHEE = 440;
const RATIO = CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM;
const HAUTEUR_MIN = 40; // px de la photo, pour garder une poignée saisissable

type Prise = 'cadre' | 'poignee' | 'poitrine';

interface Props {
  photoUrl: string;
  apercuUrl?: string | null; // montage à la place de la photo (même taille), le cadre reste par-dessus
  cadre: Cadre;
  poitrine: Point | null;
  onChange: (cadre: Cadre, poitrine: Point | null) => void;
}

/** Photo du gabarit avec son cadre maximal (déplaçable, redimensionnable) et le point poitrine.
 *  Toutes les coordonnées sont en pixels de la photo d'origine. */
export function CadreEditeur({ photoUrl, apercuUrl, cadre, poitrine, onChange }: Props) {
  const [largeurPhoto, setLargeurPhoto] = useState<number | null>(null);
  const depart = useRef<{ prise: Prise; x: number; y: number; cadre: Cadre; poitrine: Point | null } | null>(null);
  const echelle = largeurPhoto ? LARGEUR_AFFICHEE / largeurPhoto : 1;

  function saisir(prise: Prise) {
    return (e: PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      depart.current = { prise, x: e.clientX, y: e.clientY, cadre, poitrine };
    };
  }

  function bouger(e: PointerEvent<HTMLDivElement>) {
    const d = depart.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / echelle;
    const dy = (e.clientY - d.y) / echelle;
    if (d.prise === 'cadre') onChange({ ...d.cadre, x: d.cadre.x + dx, y: d.cadre.y + dy }, d.poitrine);
    // La poignée bas-droite agrandit le cadre en gardant son ratio : on suit le plus grand des deux gestes.
    if (d.prise === 'poignee') onChange({ ...d.cadre, hauteur: Math.max(HAUTEUR_MIN, d.cadre.hauteur + Math.max(dy, dx / RATIO)) }, d.poitrine);
    if (d.prise === 'poitrine' && d.poitrine) onChange(d.cadre, { x: d.poitrine.x + dx, y: d.poitrine.y + dy });
  }

  const lacher = () => { depart.current = null; };
  const px = (v: number) => `${v * echelle}px`;

  return (
    <div className={styles.editeur} style={{ width: LARGEUR_AFFICHEE }} onPointerMove={bouger} onPointerUp={lacher} onPointerCancel={lacher}>
      {/* eslint-disable-next-line @next/next/no-img-element -- photo du bucket, taille d'origine requise */}
      <img src={apercuUrl ?? photoUrl} alt="" draggable={false} width={LARGEUR_AFFICHEE} onLoad={(e) => setLargeurPhoto(e.currentTarget.naturalWidth)} />
      {largeurPhoto && (
        <>
          <div
            className={styles.cadre}
            style={{ left: px(cadre.x), top: px(cadre.y), width: px(cadre.hauteur * RATIO), height: px(cadre.hauteur) }}
            onPointerDown={saisir('cadre')}
          >
            <div className={styles.poignee} onPointerDown={saisir('poignee')} />
            <span className={styles.cadreLegende}>Cadre maximal · {CADRE_HAUTEUR_CM} × {CADRE_LARGEUR_CM.toFixed(1)} cm</span>
          </div>
          {poitrine && (
            <div className={styles.poitrine} style={{ left: px(poitrine.x), top: px(poitrine.y) }} onPointerDown={saisir('poitrine')} title="Point poitrine (marque, logo DTF)" />
          )}
        </>
      )}
    </div>
  );
}
