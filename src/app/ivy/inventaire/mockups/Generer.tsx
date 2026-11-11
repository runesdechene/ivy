'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Anchor, Badge, Button, Group, SegmentedControl, Select } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { zipSync } from 'fflate';
import { authJson } from '@/lib/auth-fetch';
import {
  lireImpression, planifierApercus, teinteReglee, trouverFichier,
  type Apercu, type Face, type Gabarit, type Impression, type VarianteImpression,
} from '@/lib/mockups/regles';
import { chargerGabarit, chargerSource, composerMockup, versBlob, type GabaritCharge, type Source } from '@/lib/mockups/composer';
import type { DossierMotif } from '@/lib/mockups/dossier';
import { useReglages } from './Reglages';
import { useGabarits } from './Gabarits';
import { useFiches } from './Motifs';
import { ChoixDossier } from './ChoixDossier';
import styles from './mockups.module.scss';

interface ReponseProduit { produit: { id: string; title: string; shopify_id: string }; variantes: VarianteImpression[] }
const AUCUNE_VARIANTE: VarianteImpression[] = [];
const AUCUN_GABARIT: Gabarit[] = [];
const MANQUES: Record<NonNullable<Apercu['manque']>, string> = {
  teinte: 'teinte à régler', hauteur: 'hauteur à régler', gabarit: 'gabarit manquant',
  poitrine: 'point poitrine à poser', fichier: 'fichier manquant',
};
const cle = (a: Pick<Apercu, 'couleur' | 'face'>) => `${a.couleur}|${a.face}`;

/** Mot attendu en fin de nom du fichier source : CLAIR / SOMBRE pour un motif, MARQUE, DTF. */
function motFichier(impression: Impression, version: string | undefined): string {
  return impression.pose === 'motif' ? version ?? impression.teinte : impression.pose === 'marque' ? 'MARQUE' : 'DTF';
}

export function Generer({ shopId, dossier, setDossier, onReglerTailles }: {
  shopId: string; dossier: DossierMotif | null; setDossier: (d: DossierMotif | null) => void; onReglerTailles: () => void;
}) {
  const { reglages, dtfUrl } = useReglages(shopId);
  const { data: donneesGabarits } = useGabarits(shopId);
  const fiches = useFiches(shopId);
  const produits = useQuery({
    queryKey: ['mockups-produits', shopId],
    queryFn: () => authJson<{ products: { id: string; title: string }[] }>(`/api/inventory/products-list?shopId=${shopId}`),
  });

  const [produitId, setProduitId] = useState<string | null>(null);
  const [faceChoisie, setFace] = useState<Face | null>(null);
  const [images, setImages] = useState<Record<string, { url: string; blob: Blob } | { erreur: string }>>({});
  const urls = useRef<string[]>([]);

  const produit = useQuery({
    queryKey: ['mockups-produit', shopId, produitId],
    queryFn: () => authJson<ReponseProduit>(`/api/mockups/produit?shopId=${shopId}&productId=${produitId}`),
    enabled: !!produitId,
  });
  // Références stables : le montage se relance seulement quand une entrée change vraiment.
  const variantes = produit.data?.variantes ?? AUCUNE_VARIANTE;
  const gabarits = donneesGabarits?.gabarits ?? AUCUN_GABARIT;
  const noms = useMemo(() => (dossier ? [...dossier.fichiers.keys()] : []), [dossier]);
  const fiche = (dossier && fiches.data?.fiches.find((f) => f.nom === dossier.nom)) || null;

  const faces = useMemo(() => (['recto', 'verso'] as Face[]).filter((f) => variantes.some((v) => lireImpression(v[f], f))), [variantes]);
  const face = faceChoisie && faces.includes(faceChoisie) ? faceChoisie : faces[0] ?? null;

  // Fichiers attendus dans le dossier, d'après les impressions du produit.
  const attendus = useMemo(() => {
    if (!reglages) return [];
    const parMot = new Map<string, Impression>();
    for (const v of variantes) for (const f of faces) {
      const imp = lireImpression(v[f], f);
      if (imp) parMot.set(motFichier(imp, teinteReglee(reglages, imp.teinte)?.version), imp);
    }
    return [...parMot].map(([mot, imp]) => ({ mot, trouve: !!trouverFichier(noms, imp, reglages), dtf: imp.pose === 'dtf' }));
  }, [variantes, faces, noms, reglages]);

  // Un aperçu par couleur pour la face choisie, motif à sa taille maximale (celle des images Shopify).
  const apercus = useMemo(
    () => (reglages && face && dossier ? planifierApercus(variantes, [face], gabarits, noms, reglages, fiche, 'D-MAX') : []),
    [variantes, face, gabarits, noms, reglages, fiche, dossier],
  );

  // Monte les aperçus prêts, un par un ; gabarits et sources chargés une seule fois.
  useEffect(() => {
    if (!reglages) return;
    let actif = true;
    const charges = new Map<string, Promise<GabaritCharge>>();
    const sources = new Map<string, Promise<Source>>();
    (async () => {
      const faits: typeof images = {};
      for (const a of apercus) {
        if (a.manque || !a.gabaritId) continue;
        try {
          const g = gabarits.find((x) => x.id === a.gabaritId)!;
          if (!charges.has(g.id)) charges.set(g.id, chargerGabarit(g));
          const nomSource = a.fichier ?? dtfUrl ?? '';
          if (!nomSource) throw new Error('Logo DTF commun manquant (Réglages)');
          if (!sources.has(nomSource)) {
            sources.set(nomSource, a.fichier
              ? chargerSource(dossier!.fichiers.get(a.fichier)!)
              : fetch(nomSource).then((r) => r.blob()).then(chargerSource));
          }
          const hauteur = a.impression.pose === 'motif' ? fiche?.hauteurs['D-MAX'] ?? null : null;
          const canvas = composerMockup(await charges.get(g.id)!, await sources.get(nomSource)!, a.impression, reglages, hauteur);
          const blob = await versBlob(canvas, 'image/webp');
          faits[cle(a)] = { url: URL.createObjectURL(blob), blob };
        } catch (e) {
          faits[cle(a)] = { erreur: (e as Error).message };
        }
        if (!actif) break;
      }
      const nouvelles = Object.values(faits).flatMap((f) => ('url' in f ? [f.url] : []));
      if (!actif) return nouvelles.forEach((u) => URL.revokeObjectURL(u));
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = nouvelles;
      setImages(faits);
    })();
    return () => { actif = false; };
  }, [apercus, gabarits, reglages, dtfUrl, fiche, dossier]);

  const pretes = apercus.flatMap((a) => {
    const img = images[cle(a)];
    return img && 'blob' in img ? [{ a, blob: img.blob }] : [];
  });

  async function telechargerZip() {
    const entrees: Record<string, Uint8Array> = {};
    for (const { a, blob } of pretes) {
      entrees[`${dossier!.nom}_${a.modele}_${a.couleur}_${a.face}.webp`] = new Uint8Array(await blob.arrayBuffer());
    }
    const zip = zipSync(entrees, { level: 0 }); // le webp est déjà compressé
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = `${dossier!.nom} mockups.zip`;
    lien.click();
    URL.revokeObjectURL(url);
    notifications.show({ color: 'green', message: `${pretes.length} mockup(s) dans le zip` });
  }

  return (
    <div className={styles.generer}>
      <div>
        <section className={styles.panneau}>
          <h2 className={styles.panneauTitre}>1. Produit</h2>
          <Select
            size="xs" searchable placeholder="Choisir un produit" value={produitId} onChange={setProduitId}
            data={(produits.data?.products ?? []).map((p) => ({ value: p.id, label: p.title }))}
          />
          {produit.data && (
            <div className={styles.aide}>
              {[...new Set(variantes.map((v) => v.sku).filter(Boolean))].join(', ') || 'Sans SKU'}
              {' · '}{new Set(variantes.map((v) => v.couleur)).size} couleurs
            </div>
          )}
        </section>

        <section className={styles.panneau}>
          <h2 className={styles.panneauTitre}>2. Motif</h2>
          <ChoixDossier dossier={dossier} onChange={setDossier} />
          {dossier && (
            <>
              <Group gap={6} mt="sm">
                {attendus.map(({ mot, trouve, dtf }) => (
                  <Badge key={mot} size="sm" variant="light" color={trouve ? 'green' : dtf && dtfUrl ? 'gray' : 'red'}>
                    {trouve ? `${mot} ✓` : dtf && dtfUrl ? 'DTF · logo commun' : `${mot} manquant`}
                  </Badge>
                ))}
              </Group>
              <div className={styles.aide}>
                {fiche
                  ? `Fiche de tailles : ${Object.entries(fiche.hauteurs).map(([t, cm]) => `${t[0]} ${String(cm).replace('.', ',')}`).join(' · ')} cm`
                  : <span className={styles.aRegler}>Pas encore de fiche de tailles.</span>}
              </div>
              <Anchor size="xs" component="button" onClick={onReglerTailles}>Régler les tailles →</Anchor>
            </>
          )}
        </section>

        {faces.length > 1 && (
          <section className={styles.panneau}>
            <h2 className={styles.panneauTitre}>3. Face</h2>
            <SegmentedControl
              size="xs" value={face ?? undefined} onChange={(v) => setFace(v as Face)}
              data={faces.map((f) => ({ value: f, label: f === 'recto' ? 'Recto' : 'Verso' }))}
            />
          </section>
        )}
      </div>

      <section className={styles.panneau}>
        <Group justify="space-between" mb="sm">
          <div>
            <h2 className={styles.panneauTitre}>Aperçus · {pretes.length} prêts sur {apercus.length}</h2>
            <div className={styles.aide}>Un mockup par couleur du produit. Clique une image pour l’ouvrir en grand.</div>
          </div>
          <Button size="xs" variant="default" disabled={pretes.length === 0} onClick={telechargerZip}>
            Télécharger le zip ({pretes.length})
          </Button>
        </Group>

        {!produitId ? <div className={styles.vide}>Choisis un produit.</div>
          : !dossier ? <div className={styles.vide}>Choisis le dossier de son motif.</div>
          : apercus.length === 0 ? <div className={styles.vide}>Aucune impression trouvée dans les métachamps de ce produit.</div>
          : (
            <div className={styles.cartes}>
              {apercus.map((a) => {
                const img = images[cle(a)];
                const souci = a.manque ? MANQUES[a.manque] : img && 'erreur' in img ? img.erreur : null;
                return (
                  <div key={cle(a)} className={styles.carte}>
                    {img && 'url' in img
                      // eslint-disable-next-line @next/next/no-img-element -- montage local (blob)
                      ? <a href={img.url} target="_blank" rel="noreferrer"><img className={styles.apercu} src={img.url} alt={`${a.modele} ${a.couleur}`} /></a>
                      : <div className={styles.carteVide}>{souci ?? 'Montage…'}</div>}
                    <strong>{a.modele}</strong>
                    <div className={styles.aide}>{a.couleur} · {a.face === 'recto' ? 'Recto' : 'Verso'} · {a.impression.teinte}</div>
                    {souci && <Badge size="sm" variant="light" color="orange">{souci}</Badge>}
                  </div>
                );
              })}
            </div>
          )}
      </section>
    </div>
  );
}
