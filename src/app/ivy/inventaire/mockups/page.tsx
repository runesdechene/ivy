'use client';

import { useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import { useShop } from '@/context/ShopContext';
import { Reglages } from './Reglages';
import { Gabarits } from './Gabarits';
import { Motifs } from './Motifs';
import { Generer } from './Generer';
import { Galerie } from './Galerie';
import styles from './mockups.module.scss';

const ONGLETS = [
  { value: 'generer', label: 'Générer', sousTitre: 'Choisis un produit : IVY retrouve son motif et monte un mockup par couleur.' },
  { value: 'galerie', label: 'Galerie', sousTitre: 'Tous les mockups, par motif puis par produit : repère celui qui cloche, régénère-le, envoie ce qui n’est pas à jour.' },
  { value: 'motifs', label: 'Motifs', sousTitre: 'Les fichiers de chaque motif, déposés une fois dans IVY, et la hauteur de ses quatre tailles d’impression. Le vêtement reste le même pour les quatre tailles : seul le dessin change.' },
  { value: 'gabarits', label: 'Gabarits', sousTitre: 'Un gabarit = une photo (modèle × couleur × face) et son cadre maximal. Réglé une fois.' },
  { value: 'impression', label: 'Impression', sousTitre: 'Teintes et tailles d’impression de chaque produit, modifiables par lot.' },
  { value: 'reglages', label: 'Réglages', sousTitre: 'Couleur et dessin de chaque teinte, logo DTF commun.' },
] as const;
type Onglet = (typeof ONGLETS)[number]['value'];

export default function MockupsPage() {
  const { currentShop } = useShop();
  const [onglet, setOnglet] = useState<Onglet>('generer');
  const [motif, setMotif] = useState<string | null>(null); // motif ouvert dans Motifs ; Générer et Galerie peuvent y renvoyer
  const [produitId, setProduitId] = useState<string | null>(null); // produit ouvert dans Générer ; Galerie peut y renvoyer
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
      ) : (
        // Tous les onglets restent montés : on retrouve son travail en revenant sur un onglet.
        <>
          <div hidden={onglet !== 'generer'}>
            <Generer shopId={currentShop.id} produitId={produitId} setProduitId={setProduitId} onReglerTailles={(m) => { setMotif(m); setOnglet('motifs'); }} />
          </div>
          <div hidden={onglet !== 'galerie'}>
            <Galerie
              shopId={currentShop.id}
              visible={onglet === 'galerie'}
              ouvrirProduit={(id) => { setProduitId(id); setOnglet('generer'); }}
              ouvrirMotif={(m) => { setMotif(m); setOnglet('motifs'); }}
            />
          </div>
          <div hidden={onglet !== 'motifs'}><Motifs shopId={currentShop.id} choisi={motif} setChoisi={setMotif} /></div>
          <div hidden={onglet !== 'gabarits'}><Gabarits shopId={currentShop.id} /></div>
          <div hidden={onglet !== 'impression'} className={styles.vide}>Bientôt.</div>
          <div hidden={onglet !== 'reglages'}><Reglages shopId={currentShop.id} /></div>
        </>
      )}
    </div>
  );
}
