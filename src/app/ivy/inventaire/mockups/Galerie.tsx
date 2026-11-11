'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Anchor, Badge, Button, Group, SegmentedControl, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { authJson } from '@/lib/auth-fetch';
import type { CarteGalerie, MotifGalerie, ProduitGalerie } from '@/app/api/mockups/galerie/route';
import { envoyerSurShopify } from './envoiShopify';
import styles from './mockups.module.scss';

type Filtre = 'tout' | 'pas_a_jour' | 'jamais';
const BADGES = { a_jour: ['à jour', 'green'], pas_a_jour: ['pas à jour', 'orange'], jamais: ['jamais envoyé', 'gray'] } as const;
const MANQUES: Record<string, string> = {
  teinte: 'teinte à régler', hauteur: 'hauteur à régler', gabarit: 'gabarit manquant', poitrine: 'point poitrine à poser', fichier: 'fichier manquant',
};
const cle = (p: ProduitGalerie, c: CarteGalerie) => `${p.id}|${c.couleur}|${c.face}`;
const aEnvoyer = (p: ProduitGalerie) => p.cartes.some((c) => c.etat === 'pas_a_jour' || c.etat === 'jamais');

/** Tous les mockups, par motif puis par produit : repérer celui qui cloche, le régénérer, envoyer ce qui n'est pas à jour. */
export function Galerie({ shopId, visible, ouvrirProduit, ouvrirMotif }: {
  shopId: string; visible: boolean; ouvrirProduit: (id: string) => void; ouvrirMotif: (nom: string) => void;
}) {
  const galerie = useQuery({
    queryKey: ['mockups-galerie', shopId],
    queryFn: () => authJson<{ motifs: MotifGalerie[] }>(`/api/mockups/galerie?shopId=${shopId}`),
  });
  // L'onglet reste monté : on relit à chaque affichage, pour voir ce qui a été généré ou envoyé ailleurs.
  const { refetch } = galerie;
  useEffect(() => { if (visible) refetch(); }, [visible, refetch]);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tout');
  const [enCours, setEnCours] = useState<Set<string>>(new Set()); // cartes en régénération, produits en envoi
  const [lot, setLot] = useState<string | null>(null); // avancement de l'envoi groupé

  const tous = galerie.data?.motifs ?? [];
  const cartes = tous.flatMap((m) => m.produits.flatMap((p) => p.cartes));
  const compte = (e: Filtre) => cartes.filter((c) => c.etat === e).length;
  const garder = (c: CarteGalerie) => filtre === 'tout' || c.etat === filtre;
  const motifs = tous
    .filter((m) => m.libelle.toLowerCase().includes(recherche.toLowerCase()))
    .map((m) => ({ ...m, produits: m.produits.filter((p) => p.cartes.some(garder)) }))
    .filter((m) => m.produits.length > 0);
  const enRetard = tous.flatMap((m) => m.produits).filter(aEnvoyer);

  const occupe = (id: string, oui: boolean) => setEnCours((s) => { const t = new Set(s); if (oui) t.add(id); else t.delete(id); return t; });

  async function regenerer(p: ProduitGalerie, c: CarteGalerie) {
    occupe(cle(p, c), true);
    try {
      const r = await authJson<{ manque?: string }>('/api/mockups/generer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, productId: p.id, couleur: c.couleur, face: c.face }),
      });
      if (r.manque) notifications.show({ color: 'orange', message: `${c.couleur} : ${MANQUES[r.manque] ?? r.manque}` });
      await galerie.refetch();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      occupe(cle(p, c), false);
    }
  }

  /** Envoie des produits l'un après l'autre (photos remplacées, couleurs rattachées), après une seule confirmation. */
  function envoyer(produits: ProduitGalerie[]) {
    modals.openConfirmModal({
      title: produits.length > 1 ? `Envoyer ${produits.length} produits sur Shopify ?` : `Envoyer « ${produits[0].title} » ?`,
      children: <div>Les photos actuelles de {produits.length > 1 ? 'ces produits' : 'ce produit'} seront <strong>remplacées</strong> par les mockups, une fois les nouvelles prêtes. C’est définitif.</div>,
      labels: { confirm: 'Envoyer et remplacer', cancel: 'Annuler' },
      onConfirm: async () => {
        let ok = 0;
        for (const [i, p] of produits.entries()) {
          occupe(p.id, true);
          try {
            await envoyerSurShopify(shopId, p.id, { remplacer: true, rattacher: true },
              (etape) => setLot(produits.length > 1 ? `${i + 1} / ${produits.length} · ${etape}` : etape));
            ok++;
          } catch (e) {
            notifications.show({ color: 'red', message: `${p.title} : ${(e as Error).message}` });
          }
          occupe(p.id, false);
        }
        setLot(null);
        await galerie.refetch();
        if (ok) notifications.show({ color: 'green', message: `${ok} produit(s) à jour sur Shopify` });
      },
    });
  }

  return (
    <>
      <section className={`${styles.panneau} ${styles.barreMotif}`}>
        <TextInput size="xs" w={220} placeholder="Rechercher un motif" value={recherche} onChange={(e) => setRecherche(e.currentTarget.value)} />
        <SegmentedControl
          size="xs" value={filtre} onChange={(v) => setFiltre(v as Filtre)}
          data={[
            { value: 'tout', label: 'Tout' },
            { value: 'pas_a_jour', label: `Pas à jour · ${compte('pas_a_jour')}` },
            { value: 'jamais', label: `Jamais envoyés · ${compte('jamais')}` },
          ]}
        />
        <span className={styles.espace} />
        <Button size="xs" disabled={enRetard.length === 0} loading={lot !== null} onClick={() => envoyer(enRetard)}>
          {lot ?? `Envoyer les ${enRetard.length} produit(s) pas à jour`}
        </Button>
      </section>

      {galerie.isLoading ? <div className={styles.vide}>Chargement…</div>
        : motifs.length === 0 ? <div className={styles.vide}>Rien à montrer avec ce filtre.</div>
        : motifs.map((m) => {
          const retard = m.produits.flatMap((p) => p.cartes).filter((c) => c.etat === 'pas_a_jour').length;
          return (
            <section key={m.nom} className={styles.panneau}>
              <Group justify="space-between" mb="sm">
                <Group gap="xs">
                  <h2 className={styles.panneauTitre}>{m.libelle}</h2>
                  {retard > 0 && <Badge size="xs" variant="light" color="orange">{retard} pas à jour</Badge>}
                </Group>
                <Anchor size="xs" component="button" onClick={() => ouvrirMotif(m.nom)}>Fichiers et tailles →</Anchor>
              </Group>
              {m.produits.map((p) => (
                <div key={p.id} className={styles.produitGalerie}>
                  <Group justify="space-between" mb={6}>
                    <strong>{p.title}</strong>
                    <Group gap="xs">
                      <Anchor size="xs" component="button" onClick={() => ouvrirProduit(p.id)}>Ouvrir dans Générer →</Anchor>
                      <Button size="compact-xs" variant="default" disabled={!p.cartes.some((c) => c.image_url)} loading={enCours.has(p.id)} onClick={() => envoyer([p])}>
                        Envoyer
                      </Button>
                    </Group>
                  </Group>
                  <div className={styles.cartesGalerie}>
                    {p.cartes.filter(garder).map((c) => {
                      const badge = c.etat ? BADGES[c.etat] : null;
                      return (
                        <div key={cle(p, c)} className={`${styles.carte} ${c.etat === 'pas_a_jour' ? styles.carteRetard : ''}`}>
                          {c.image_url
                            // eslint-disable-next-line @next/next/no-img-element -- image du bucket
                            ? <a href={c.image_url} target="_blank" rel="noreferrer"><img className={styles.apercu} src={c.image_url} alt={`${p.title} ${c.couleur}`} loading="lazy" /></a>
                            : <div className={styles.carteVide}>{c.manque ? MANQUES[c.manque] : 'Pas encore généré'}</div>}
                          <Group justify="space-between" wrap="nowrap">
                            <span>{c.couleur}{c.face === 'verso' ? ' · verso' : ''}</span>
                            {!c.manque && (
                              <ActionIcon size="sm" variant="subtle" color="gray" title="Régénérer" loading={enCours.has(cle(p, c))} onClick={() => regenerer(p, c)}>
                                <IconRefresh size={14} />
                              </ActionIcon>
                            )}
                          </Group>
                          {badge && <Badge size="xs" variant="light" color={badge[1]}>{badge[0]}</Badge>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
    </>
  );
}
