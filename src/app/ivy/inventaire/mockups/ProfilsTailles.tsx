'use client';

import { useState } from 'react';
import { Button, Group, Select, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { authJson } from '@/lib/auth-fetch';
import { TAILLES_IMPRESSION, profilsDepuisExistants, rangTaille, type Profil, type TailleImpression } from '@/lib/mockups/regles';
import type { EtatLigne } from './Impression';
import styles from './mockups.module.scss';

type Edition = Omit<Profil, 'id'> & { id?: string };

/** Profils de tailles par modèle : la liste, l'éditeur de grille, et l'amorçage depuis les grilles déjà sur Shopify. */
export function ProfilsTailles({ shopId, etats, profils, recharger }: {
  shopId: string; etats: EtatLigne[]; profils: Profil[]; recharger: () => Promise<unknown>;
}) {
  const [edition, setEdition] = useState<Edition | null>(null);
  const [occupe, setOccupe] = useState(false);

  const modeles = [...new Set(etats.map((e) => e.ligne.modele).filter((m): m is string => !!m))].sort();
  const produitsSuivant = (p: Profil) => new Set(etats.filter((e) => e.profil?.id === p.id).map((e) => e.ligne.productId)).size;
  // Les tailles de vêtement du modèle en cours d'édition, plus celles déjà dans sa grille.
  const tailles = edition ? [...new Set([
    ...etats.filter((e) => e.ligne.modele === edition.modele).flatMap((e) => e.ligne.variantes.map((v) => v.taille)),
    ...Object.keys(edition.grille),
  ].filter((t): t is string => !!t))].sort((a, b) => rangTaille(a) - rangTaille(b)) : [];

  async function envoyer(action: () => Promise<unknown>, succes: string) {
    setOccupe(true);
    try {
      await action();
      await recharger();
      notifications.show({ color: 'green', message: succes });
      return true;
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
      return false;
    } finally {
      setOccupe(false);
    }
  }

  const enregistrer = (p: Edition) => authJson('/api/mockups/profils', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, profil: p }),
  });

  /** Une grille par produit (ses couleurs en ont souvent la même), puis les grilles portées par deux produits ou plus. */
  async function amorcer() {
    const parProduit = new Map<string, { modele: string; tailles: Record<string, TailleImpression> }>();
    for (const { ligne } of etats) {
      if (!ligne.modele || Object.keys(ligne.tailles).length === 0) continue;
      parProduit.set(`${ligne.productId}|${JSON.stringify(Object.entries(ligne.tailles).sort())}`, { modele: ligne.modele, tailles: ligne.tailles });
    }
    const nouveaux = profilsDepuisExistants([...parProduit.values()]);
    await envoyer(async () => { for (const p of nouveaux) await enregistrer(p); }, `${nouveaux.length} profils créés`);
  }

  function supprimer(p: Edition & { id: string }) {
    modals.openConfirmModal({
      title: `Supprimer « ${p.nom} » ?`,
      children: <div>Les produits qui le suivaient passeront « hors profil ». Shopify n’est pas touché.</div>,
      labels: { confirm: 'Supprimer', cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        if (await envoyer(() => authJson(`/api/mockups/profils?shopId=${shopId}&id=${p.id}`, { method: 'DELETE' }), 'Profil supprimé')) setEdition(null);
      },
    });
  }

  return (
    <div className={styles.panneau}>
      <h3 className={styles.panneauTitre}>Profils de tailles</h3>
      <div className={styles.aide}>La taille d’impression de chaque taille de vêtement, par modèle. Un produit qui n’en suit aucun est « hors profil ».</div>

      {profils.length === 0 && (
        <Button variant="light" fullWidth mt="sm" loading={occupe} onClick={amorcer}>Créer les profils depuis Shopify</Button>
      )}

      {modeles.map((m) => (
        <div key={m}>
          <div className={styles.groupe}>{m}</div>
          {profils.filter((p) => p.modele === m).map((p) => (
            <div key={p.id} className={`${styles.ligne} ${edition?.id === p.id ? styles.ligneActive : ''}`}>
              <button className={styles.ligneNom} onClick={() => setEdition(p)}>{p.nom}</button>
              <span className={styles.aide} style={{ marginRight: 8 }}>{produitsSuivant(p)} produits</span>
            </div>
          ))}
          <div className={styles.ligne}>
            <button className={styles.ligneNom} style={{ color: 'var(--mantine-color-blue-6)' }} onClick={() => setEdition({ modele: m, nom: '', grille: {} })}>
              + Nouveau profil
            </button>
          </div>
        </div>
      ))}

      {edition && (
        <div className={styles.editionProfil}>
          <div className={styles.panneauTitre}>{edition.modele}</div>
          <TextInput label="Nom" placeholder="D-Max dès M" value={edition.nom} mb="xs"
            onChange={(e) => setEdition({ ...edition, nom: e.currentTarget.value })} />
          {tailles.map((t) => (
            <Group key={t} justify="space-between" mb={6} wrap="nowrap">
              <strong style={{ fontSize: 13 }}>{t}</strong>
              <Select size="xs" w={150} data={TAILLES_IMPRESSION} value={edition.grille[t] ?? null} clearable placeholder="non touchée"
                onChange={(v) => {
                  const grille = { ...edition.grille };
                  if (v) grille[t] = v as TailleImpression; else delete grille[t];
                  setEdition({ ...edition, grille });
                }} />
            </Group>
          ))}
          <Group mt="sm" gap="xs">
            <Button size="xs" loading={occupe} disabled={!edition.nom.trim() || Object.keys(edition.grille).length === 0}
              onClick={async () => { if (await envoyer(() => enregistrer(edition), 'Profil enregistré')) setEdition(null); }}>
              Enregistrer
            </Button>
            {edition.id
              ? <Button size="xs" variant="default" onClick={() => supprimer({ ...edition, id: edition.id! })}>Supprimer</Button>
              : <Button size="xs" variant="default" onClick={() => setEdition(null)}>Annuler</Button>}
          </Group>
        </div>
      )}
    </div>
  );
}
