'use client';

import { useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import { useShop } from '@/context/ShopContext';
import { Reglages } from './Reglages';
import { Gabarits } from './Gabarits';
import { Motifs } from './Motifs';
import styles from './mockups.module.scss';

const ONGLETS = [
  { value: 'generer', label: 'Générer', sousTitre: 'Pose un motif sur tous les gabarits, vérifie, envoie sur Shopify.' },
  { value: 'motifs', label: 'Motifs', sousTitre: 'Règle la hauteur de chaque taille d’impression en la voyant sur le vêtement.' },
  { value: 'gabarits', label: 'Gabarits', sousTitre: 'Un gabarit = une photo (modèle × couleur × face) et son cadre maximal. Réglé une fois.' },
  { value: 'impression', label: 'Impression', sousTitre: 'Teintes et tailles d’impression de chaque produit, modifiables par lot.' },
  { value: 'reglages', label: 'Réglages', sousTitre: 'Couleur et dessin de chaque teinte, logo DTF commun.' },
] as const;
type Onglet = (typeof ONGLETS)[number]['value'];

export default function MockupsPage() {
  const { currentShop } = useShop();
  const [onglet, setOnglet] = useState<Onglet>('generer');
  const courant = ONGLETS.find((o) => o.value === onglet)!;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrow}>Inventaire · {currentShop?.name ?? 'Runes de Chêne'}</div>
          <h1 className={styles.title}><em>Mockups</em></h1>
          <div className={styles.sousTitre}>{courant.sousTitre}</div>
        </div>
        <SegmentedControl
          size="xs"
          value={onglet}
          onChange={(v) => setOnglet(v as Onglet)}
          data={ONGLETS.map(({ value, label }) => ({ value, label }))}
        />
      </div>

      {!currentShop ? (
        <div className={styles.vide}>Chargement de la boutique…</div>
      ) : onglet === 'reglages' ? (
        <Reglages shopId={currentShop.id} />
      ) : onglet === 'gabarits' ? (
        <Gabarits shopId={currentShop.id} />
      ) : onglet === 'motifs' ? (
        <Motifs shopId={currentShop.id} />
      ) : (
        <div className={styles.vide}>Bientôt.</div>
      )}
    </div>
  );
}
