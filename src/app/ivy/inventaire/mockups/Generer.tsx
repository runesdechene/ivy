'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Anchor, Badge, Button, Checkbox, Group, SegmentedControl, Select } from '@mantine/core';
import { IconRefresh, IconTrash } from '@tabler/icons-react';
import { modals } from '@mantine/modals';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import { notifications } from '@mantine/notifications';
import { zipSync } from 'fflate';
import { authJson } from '@/lib/auth-fetch';
import { obtenirAdresse } from '@/components/FichiersImpression';
import { envoyerSurShopify } from './envoiShopify';
import {
  demandesImpression, fichiersImpression, lireImpression, motifDuTitre, planifierApercus, teinteReglee, trouverFichier,
  type Apercu, type Face, type Gabarit, type Impression, type VarianteImpression,
} from '@/lib/mockups/regles';
import { useReglages } from './Reglages';
import { useGabarits } from './Gabarits';
import { useMotifs } from './Motifs';
import styles from './mockups.module.scss';

interface ReponseProduit {
  produit: { id: string; title: string; shopify_id: string }; variantes: VarianteImpression[]; stockParCouleur: Record<string, number>;
}
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

export function Generer({ shopId, produitId, setProduitId, onReglerTailles }: {
  shopId: string; produitId: string | null; setProduitId: (id: string | null) => void; onReglerTailles: (motif: string) => void;
}) {
  const { reglages, dtfUrl } = useReglages(shopId);
  const { data: donneesGabarits } = useGabarits(shopId);
  const motifs = useMotifs(shopId);
  const produits = useQuery({
    queryKey: ['mockups-produits', shopId],
    queryFn: () => authJson<{ products: { id: string; title: string }[] }>(`/api/inventory/products-list?shopId=${shopId}`),
  });

  const [faceChoisie, setFace] = useState<Face | null>(null);
  const [synchro, setSynchro] = useState(false);
  const { streamFromUrl } = useTerminalStream();

  const produit = useQuery({
    queryKey: ['mockups-produit', shopId, produitId],
    queryFn: () => authJson<ReponseProduit>(`/api/mockups/produit?shopId=${shopId}&productId=${produitId}`),
    enabled: !!produitId,
  });
  // Références stables : le montage se relance seulement quand une entrée change vraiment.
  const variantes = produit.data?.variantes ?? AUCUNE_VARIANTE;
  const gabarits = donneesGabarits?.gabarits ?? AUCUN_GABARIT;
  // Le motif vient du titre (« Loki | T-shirt unisexe » → LOKI) ; ses fichiers sont ceux déposés dans l'onglet Motifs.
  const cleDuMotif = produit.data ? motifDuTitre(produit.data.produit.title) : null;
  const motif = motifs.data?.motifs.find((m) => m.nom === cleDuMotif) ?? null;
  const noms = useMemo(() => (motif ? Object.entries(motif.fichiers).map(([role, f]) => `${role}.${f.ext}`) : []), [motif]);
  const fiche = motif;

  const faces = useMemo(() => (['recto', 'verso'] as Face[]).filter((f) => variantes.some((v) => lireImpression(v[f], f))), [variantes]);
  const face = faceChoisie && faces.includes(faceChoisie) ? faceChoisie : faces[0] ?? null;

  // Fichiers attendus du motif, d'après les impressions du produit.
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
    () => (reglages && face && motif ? planifierApercus(variantes, [face], gabarits, noms, reglages, fiche, 'D-MAX') : []),
    [variantes, face, gabarits, noms, reglages, fiche, motif],
  );

  // Mockups enregistrés dans IVY (montés côté serveur, comme ceux de `pnpm mockups`).
  const enregistres = useQuery({
    queryKey: ['mockups-enregistres', shopId, produitId],
    queryFn: () => authJson<{ mockups: { couleur: string; face: Face; image_url: string; updated_at: string; envoye_le: string | null }[] }>(`/api/mockups/generer?shopId=${shopId}&productId=${produitId}`),
    enabled: !!produitId,
  });
  const images = Object.fromEntries((enregistres.data?.mockups ?? []).map((m) => [cle(m), m.image_url]));
  // À jour sur Shopify = envoyé après sa dernière génération.
  const aJour = (enregistres.data?.mockups ?? []).filter((m) => m.envoye_le && m.envoye_le >= m.updated_at && apercus.some((a) => cle(a) === cle(m))).length;
  const [enCours, setEnCours] = useState<Set<string>>(new Set());
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const aGenerer = apercus.filter((a) => !a.manque);
  const pretes = apercus.filter((a) => images[cle(a)]);

  /** Monte et enregistre les mockups un par un (une image par appel serveur). */
  async function generer(liste: Apercu[]) {
    setEnCours(new Set(liste.map(cle)));
    for (const a of liste) {
      try {
        const r = await authJson<{ image_url?: string; manque?: string }>('/api/mockups/generer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopId, productId: produitId, couleur: a.couleur, face: a.face }),
        });
        setErreurs((e) => { const { [cle(a)]: _, ...reste } = e; return r.manque ? { ...reste, [cle(a)]: r.manque } : reste; });
      } catch (e) {
        setErreurs((x) => ({ ...x, [cle(a)]: (e as Error).message }));
      }
      setEnCours((s) => { const t = new Set(s); t.delete(cle(a)); return t; });
      await enregistres.refetch();
    }
  }

  const [remplacer, setRemplacer] = useState(true);
  const [rattacher, setRattacher] = useState(true);
  const [envoi, setEnvoi] = useState<string | null>(null); // étape en cours, affichée sur le bouton

  /** Envoie (après confirmation si les photos actuelles seront remplacées) ; `regenerer` refait d'abord les mockups. */
  function confirmerEnvoi(regenerer = false) {
    const action = async () => { if (regenerer) await generer(aGenerer); await envoyer(); };
    if (!remplacer) return action();
    modals.openConfirmModal({
      title: 'Remplacer les photos sur Shopify ?',
      children: <div>Les photos actuelles de « {produit.data?.produit.title} » seront <strong>supprimées</strong> une fois les nouvelles prêtes. C’est définitif.</div>,
      labels: { confirm: regenerer ? 'Générer, envoyer et remplacer' : 'Envoyer et remplacer', cancel: 'Annuler' },
      onConfirm: action,
    });
  }

  /** Crée et rattache les images, puis (si « Remplacer ») supprime les anciennes une fois les nouvelles traitées par Shopify. */
  async function envoyer() {
    if (!produitId) return;
    try {
      const b = await envoyerSurShopify(shopId, produitId, { remplacer, rattacher }, setEnvoi);
      await enregistres.refetch(); // repère « à jour sur Shopify »
      notifications.show({ color: 'green', message: `${b.envoyees} image(s) envoyée(s)${rattacher ? `, ${b.rattachees} variante(s) rattachée(s)` : ''}${b.retirees ? `, ${b.retirees} ancienne(s) retirée(s)` : ''}` });
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setEnvoi(null);
    }
  }
  /** Relit le produit sur Shopify (variantes supprimées là-bas, métachamps changés), avec la synchro existante d'IVY. */
  async function reprendreDeShopify() {
    if (!produit.data) return;
    setSynchro(true);
    const params = new URLSearchParams({ shopId, productId: produit.data.produit.shopify_id.replace('gid://shopify/Product/', '') });
    await streamFromUrl(`/api/inventory/sync-product?${params}`, { title: `Sync : ${produit.data.produit.title}` });
    await produit.refetch();
    setSynchro(false);
  }

  /** Supprime sur Shopify toutes les variantes d'une couleur, après confirmation (stock restant affiché). */
  function retirerCouleur(couleur: string) {
    if (!produit.data) return;
    const n = variantes.filter((v) => v.couleur === couleur).length;
    const stock = produit.data.stockParCouleur[couleur] ?? 0;
    modals.openConfirmModal({
      title: `Retirer ${couleur} de Shopify ?`,
      children: (
        <div>
          Les {n} variantes {couleur} de « {produit.data.produit.title} » seront <strong>supprimées sur Shopify</strong>. C’est définitif.
          {stock > 0 && <div className={styles.aRegler} style={{ marginTop: 8 }}>Il reste {stock} pièce(s) en stock dans cette couleur.</div>}
        </div>
      ),
      labels: { confirm: `Supprimer ${couleur}`, cancel: 'Annuler' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          const r = await authJson<{ retirees: number }>(
            `/api/mockups/produit?${new URLSearchParams({ shopId, productId: produit.data!.produit.id, couleur })}`, { method: 'DELETE' });
          notifications.show({ color: 'green', message: `${couleur} retirée : ${r.retirees} variante(s) supprimée(s) sur Shopify` });
          await produit.refetch();
        } catch (e) {
          notifications.show({ color: 'red', message: (e as Error).message });
        }
      },
    });
  }

  const aImprimer = useMemo(
    () => (motif && reglages ? fichiersImpression(motif.nom, variantes, reglages, motif) : []),
    [motif, variantes, reglages],
  );
  const [impressionEnCours, setImpressionEnCours] = useState<string | null>(null);

  /** Les fichiers d'impression, gardés (ou fabriqués) côté serveur en PNG 300 dpi, réunis dans un zip. */
  async function telechargerImpression() {
    if (!motif || !reglages) return;
    const demandes = demandesImpression(motif.nom, variantes, reglages, motif);
    const entrees: Record<string, Uint8Array> = {};
    try {
      for (const [i, f] of demandes.entries()) {
        setImpressionEnCours(`${i + 1} / ${demandes.length}`);
        // La route rend une adresse signée : le fichier (11 Mo) vient du stockage, pas de la fonction.
        entrees[f.nom] = new Uint8Array(await (await fetch(await obtenirAdresse(shopId, f))).arrayBuffer());
      }
      const url = URL.createObjectURL(new Blob([zipSync(entrees, { level: 0 }) as BlobPart], { type: 'application/zip' }));
      const lien = document.createElement('a');
      lien.href = url;
      lien.download = `${motif!.libelle} impression.zip`;
      lien.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setImpressionEnCours(null);
    }
  }

  async function telechargerZip() {
    const entrees: Record<string, Uint8Array> = {};
    for (const a of pretes) {
      const octets = await (await fetch(images[cle(a)])).arrayBuffer();
      entrees[`${motif!.libelle}_${a.modele}_${a.couleur}_${a.face}.webp`] = new Uint8Array(octets);
    }
    const zip = zipSync(entrees, { level: 0 }); // le webp est déjà compressé
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = `${motif!.libelle} mockups.zip`;
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
            <Group justify="space-between" mt={4}>
              <div className={styles.aide}>
                {[...new Set(variantes.map((v) => v.sku).filter(Boolean))].join(', ') || 'Sans SKU'}
                {' · '}{new Set(variantes.map((v) => v.couleur)).size} couleurs
              </div>
              <Button size="compact-xs" variant="subtle" loading={synchro} onClick={reprendreDeShopify}>Reprendre de Shopify</Button>
            </Group>
          )}
        </section>

        {produit.data && (
        <section className={styles.panneau}>
          <h2 className={styles.panneauTitre}>2. Motif · {motif?.libelle ?? cleDuMotif ?? '—'}</h2>
          {!motif ? (
            <div className={styles.aRegler}>
              {cleDuMotif ? `Motif ${cleDuMotif} inconnu.` : 'Le titre ne suit pas la règle « Motif | Produit ».'}
            </div>
          ) : (
            <>
              <Group gap={6}>
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
              <Anchor size="xs" component="button" onClick={() => onReglerTailles(motif.nom)}>Fichiers et tailles du motif →</Anchor>
            </>
          )}
        </section>
        )}

        {pretes.length > 0 && (
          <section className={styles.panneau}>
            <h2 className={styles.panneauTitre}>Shopify</h2>
            <Checkbox size="xs" label="Remplacer les photos actuelles" checked={remplacer} onChange={(e) => setRemplacer(e.currentTarget.checked)} />
            <Checkbox size="xs" mt={6} label="Rattacher chaque image à sa couleur" checked={rattacher} onChange={(e) => setRattacher(e.currentTarget.checked)} />
            <Button size="xs" mt="sm" fullWidth loading={envoi !== null} onClick={() => confirmerEnvoi()}>
              {envoi ?? `Envoyer ${pretes.length} image(s) sur Shopify`}
            </Button>
            <div className={styles.aide} style={{ marginTop: 6 }}>
              {aJour === pretes.length ? 'À jour sur Shopify.' : <span className={styles.aRegler}>{pretes.length - aJour} image(s) pas à jour sur Shopify.</span>}
            </div>
          </section>
        )}

        {aImprimer.length > 0 && (
          <section className={styles.panneau}>
            <h2 className={styles.panneauTitre}>Fichiers d’impression</h2>
            <div className={styles.aide}>
              {aImprimer.map((f) => (
                <div key={f.nom}>{f.nom}{f.hauteurCm ? ` · ${String(f.hauteurCm).replace('.', ',')} cm` : ''}</div>
              ))}
            </div>
            <Button size="xs" mt="sm" variant="default" fullWidth loading={impressionEnCours !== null} onClick={telechargerImpression}>
              {impressionEnCours ?? `Télécharger ${aImprimer.length} fichier(s) · 300 dpi`}
            </Button>
          </section>
        )}

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
            <h2 className={styles.panneauTitre}>Mockups · {pretes.length} enregistrés sur {apercus.length}</h2>
            <div className={styles.aide}>Un mockup par couleur, motif en D-Max. Clique une image pour l’ouvrir en grand.</div>
          </div>
          <Group gap="xs">
            <Button size="xs" variant="default" disabled={pretes.length === 0} onClick={telechargerZip}>
              Télécharger le zip ({pretes.length})
            </Button>
            <Button size="xs" disabled={aGenerer.length === 0} loading={enCours.size > 0} onClick={() => generer(aGenerer)}>
              {pretes.length ? 'Tout régénérer' : 'Générer'} ({aGenerer.length})
            </Button>
            <Button size="xs" color="teal" disabled={aGenerer.length === 0} loading={enCours.size > 0 || envoi !== null} onClick={() => confirmerEnvoi(true)}>
              Générer et envoyer
            </Button>
          </Group>
        </Group>

        {!produitId ? <div className={styles.vide}>Choisis un produit.</div>
          : !motif ? <div className={styles.vide}>Ce produit n’a pas de motif connu.</div>
          : apercus.length === 0 ? <div className={styles.vide}>Aucune impression trouvée dans les métachamps de ce produit.</div>
          : (
            <div className={styles.cartes}>
              {apercus.map((a) => {
                const img = images[cle(a)];
                const souci = a.manque ? MANQUES[a.manque] : erreurs[cle(a)] ?? null;
                return (
                  <div key={cle(a)} className={styles.carte}>
                    {img
                      // eslint-disable-next-line @next/next/no-img-element -- image du bucket
                      ? <a href={img} target="_blank" rel="noreferrer"><img className={styles.apercu} src={img} alt={`${a.modele} ${a.couleur}`} /></a>
                      : <div className={styles.carteVide}>{enCours.has(cle(a)) ? 'Montage…' : souci ?? 'Pas encore généré'}</div>}
                    <Group justify="space-between" wrap="nowrap">
                      <strong>{a.modele}</strong>
                      <Group gap={2} wrap="nowrap">
                        {!a.manque && (
                          <ActionIcon size="sm" variant="subtle" color="gray" title="Régénérer" loading={enCours.has(cle(a))} onClick={() => generer([a])}>
                            <IconRefresh size={14} />
                          </ActionIcon>
                        )}
                        <ActionIcon size="sm" variant="subtle" color="red" title={`Retirer ${a.couleur} de Shopify`} onClick={() => retirerCouleur(a.couleur)}>
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                    </Group>
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
