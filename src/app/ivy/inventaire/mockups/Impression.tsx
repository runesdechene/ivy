'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete, Badge, Button, Checkbox, Group, SegmentedControl, Select, Table, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { authJson } from '@/lib/auth-fetch';
import { MIXTE, lireImpression, profilSuivi, type Profil } from '@/lib/mockups/regles';
import type { Ecriture, LigneImpression } from '@/app/api/mockups/metachamps/route';
import { ProfilsTailles } from './ProfilsTailles';
import styles from './mockups.module.scss';

type Champ = 'recto' | 'verso' | 'profil';
export interface EtatLigne { ligne: LigneImpression; profil: Profil | null; probleme: string | null }

const LOT = 200; // écritures par requête, la limite de la route
const AUCUNE_LIGNE: LigneImpression[] = [];
const AUCUN_PROFIL: Profil[] = [];
const cleLigne = (l: LigneImpression) => `${l.productId}|${l.couleur}`;

/** Ce qui cloche sur une ligne : un DTF au verso, pas de SKU (donc pas de modèle), ou des tailles hors profil. */
function probleme(l: LigneImpression, profil: Profil | null): string | null {
  if (l.verso?.startsWith('DTF-')) return 'DTF au verso';
  if (!l.modele) return 'SKU manquant';
  if (Object.keys(l.tailles).length > 0 && !profil) return 'hors profil';
  return null;
}

function Valeur({ v }: { v: string | null }) {
  if (v === MIXTE) return <Badge color="orange" variant="light" size="sm">mixte</Badge>;
  return v ? <>{v}</> : <span className={styles.aide}>—</span>;
}

/** Métachamps d'impression de chaque produit × couleur, corrigés par lot, et profils de tailles par modèle. */
export function Impression({ shopId, visible }: { shopId: string; visible: boolean }) {
  const metachamps = useQuery({
    queryKey: ['mockups-metachamps', shopId],
    queryFn: () => authJson<{ lignes: LigneImpression[]; valeurs: { recto: string[]; verso: string[] } }>(`/api/mockups/metachamps?shopId=${shopId}`),
  });
  const profilsQ = useQuery({
    queryKey: ['mockups-profils', shopId],
    queryFn: () => authJson<{ profils: Profil[] }>(`/api/mockups/profils?shopId=${shopId}`),
  });
  // L'onglet reste monté : on relit à chaque affichage, Shopify a pu changer entre-temps.
  const { refetch } = metachamps;
  useEffect(() => { if (visible) refetch(); }, [visible, refetch]);

  const [recherche, setRecherche] = useState('');
  const [modele, setModele] = useState<string | null>(null);
  const [aCorriger, setACorriger] = useState(false);
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [champ, setChamp] = useState<Champ>('recto');
  const [valeur, setValeur] = useState('');
  const [profilId, setProfilId] = useState<string | null>(null);
  const [avancement, setAvancement] = useState<string | null>(null);

  const lignes = metachamps.data?.lignes ?? AUCUNE_LIGNE;
  const profils = profilsQ.data?.profils ?? AUCUN_PROFIL;
  const etats = useMemo(() => lignes.map((ligne): EtatLigne => {
    const profil = profilSuivi(ligne.modele ?? '', ligne.tailles, profils);
    return { ligne, profil, probleme: probleme(ligne, profil) };
  }), [lignes, profils]);

  const modeles = [...new Set(lignes.map((l) => l.modele).filter((m): m is string => !!m))].sort();
  const q = recherche.trim().toLowerCase();
  const visibles = etats.filter((e) => (!modele || e.ligne.modele === modele) && (!aCorriger || e.probleme)
    && (!q || `${e.ligne.titre} ${e.ligne.couleur}`.toLowerCase().includes(q)));
  const nbACorriger = etats.filter((e) => e.probleme).length;
  const toutesCochees = visibles.length > 0 && visibles.every((e) => coches.has(cleLigne(e.ligne)));

  const cochees = lignes.filter((l) => coches.has(cleLigne(l)));
  const nbVariantes = cochees.reduce((s, l) => s + l.variantes.length, 0);
  const modelesCoches = [...new Set(cochees.map((l) => l.modele))];
  // Un profil ne s'applique qu'à son modèle : il faut des lignes d'un seul modèle.
  const profilsPossibles = modelesCoches.length === 1 ? profils.filter((p) => p.modele === modelesCoches[0]) : [];
  const profil = profilsPossibles.find((p) => p.id === profilId) ?? null;
  const pret = champ === 'profil' ? !!profil : !!lireImpression(valeur, champ);

  function cocher(cles: string[], oui: boolean) {
    setCoches((s) => { const t = new Set(s); cles.forEach((c) => (oui ? t.add(c) : t.delete(c))); return t; });
  }

  /** Les écritures du lot ; avec un profil, une taille de vêtement absente de la grille n'est pas touchée. */
  function ecritures(): { liste: Ecriture[]; ignorees: number } {
    if (champ !== 'profil') {
      return { liste: cochees.flatMap((l) => l.variantes.map((v) => ({ variantId: v.id, cle: champ, valeur }))), ignorees: 0 };
    }
    let ignorees = 0;
    const liste = cochees.flatMap((l) => l.variantes.flatMap((v) => {
      const t = v.taille ? profil!.grille[v.taille] : undefined;
      if (!t) { ignorees++; return []; }
      return [{ variantId: v.id, cle: 'taille' as const, valeur: t }];
    }));
    return { liste, ignorees };
  }

  function appliquer() {
    const { liste, ignorees } = ecritures();
    modals.openConfirmModal({
      title: `Appliquer à ${cochees.length} ligne${cochees.length > 1 ? 's' : ''} ?`,
      children: (
        <div>
          Écrit dans Shopify sur <strong>{liste.length} variantes</strong>.
          {ignorees > 0 && <div className={styles.aide}>{ignorees} variantes ont une taille absente de la grille : elles ne sont pas touchées.</div>}
        </div>
      ),
      labels: { confirm: 'Écrire dans Shopify', cancel: 'Annuler' },
      onConfirm: async () => {
        let modifiees = 0;
        const erreurs: string[] = [];
        try {
          for (let i = 0; i < liste.length; i += LOT) {
            setAvancement(`${i} / ${liste.length}`);
            const r = await authJson<{ modifiees: number; erreurs: string[] }>('/api/mockups/metachamps', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ shopId, ecritures: liste.slice(i, i + LOT) }),
            });
            modifiees += r.modifiees;
            erreurs.push(...r.erreurs);
          }
        } catch (e) {
          erreurs.push((e as Error).message);
        }
        setAvancement(null);
        notifications.show({
          color: erreurs.length ? 'orange' : 'green',
          title: `${modifiees} variante${modifiees > 1 ? 's' : ''} modifiée${modifiees > 1 ? 's' : ''}`,
          message: erreurs.length ? [...new Set(erreurs)].join(' · ') : 'Shopify et IVY sont à jour.',
          autoClose: erreurs.length ? false : 4000,
        });
        setCoches(new Set());
        await refetch();
      },
    });
  }

  if (metachamps.isLoading) return <div className={styles.vide}>Lecture des métachamps…</div>;
  if (metachamps.error) return <div className={styles.vide}>{(metachamps.error as Error).message}</div>;

  return (
    <div className={styles.impression}>
      <div>
        <Group gap="sm" mb="sm">
          <TextInput placeholder="Rechercher un produit, une couleur…" value={recherche} onChange={(e) => setRecherche(e.currentTarget.value)} w={300} />
          <Select placeholder="Tous les modèles" data={modeles} value={modele} onChange={setModele} clearable w={200} />
          <Checkbox
            label={<>À corriger seulement <Badge color="orange" size="sm" circle={nbACorriger < 10}>{nbACorriger}</Badge></>}
            checked={aCorriger} onChange={(e) => setACorriger(e.currentTarget.checked)}
          />
        </Group>

        <Table highlightOnHover withTableBorder verticalSpacing={8} fz={13}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox size="xs" aria-label="Tout cocher" checked={toutesCochees}
                  onChange={(e) => cocher(visibles.map((v) => cleLigne(v.ligne)), e.currentTarget.checked)} />
              </Table.Th>
              <Table.Th>Produit</Table.Th><Table.Th>Modèle</Table.Th><Table.Th>Couleur</Table.Th>
              <Table.Th>Recto</Table.Th><Table.Th>Verso</Table.Th><Table.Th>Profil</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibles.map(({ ligne: l, profil: p, probleme: pb }) => {
              const cle = cleLigne(l);
              return (
                <Table.Tr key={cle} bg={coches.has(cle) ? 'var(--mantine-color-blue-light)' : undefined}>
                  <Table.Td><Checkbox size="xs" aria-label={`${l.titre} ${l.couleur}`} checked={coches.has(cle)} onChange={(e) => cocher([cle], e.currentTarget.checked)} /></Table.Td>
                  <Table.Td fw={600}>{l.titre}</Table.Td>
                  <Table.Td className={styles.aide}>{l.modele ?? '—'}</Table.Td>
                  <Table.Td>{l.couleur}</Table.Td>
                  <Table.Td><Valeur v={l.recto} /></Table.Td>
                  <Table.Td><Valeur v={l.verso} /></Table.Td>
                  <Table.Td>{pb ? <Badge color="orange" variant="light" size="sm">{pb}</Badge> : p?.nom ?? <span className={styles.aide}>—</span>}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <div className={styles.aide} style={{ marginTop: 8 }}>
          {visibles.length} lignes · {visibles.reduce((s, e) => s + e.ligne.variantes.length, 0)} variantes — « Tout cocher » ne coche que les lignes affichées.
        </div>

        {cochees.length > 0 && (
          <div className={styles.barreAction}>
            <div>
              <div className={styles.barreTitre}>{cochees.length} ligne{cochees.length > 1 ? 's' : ''} cochée{cochees.length > 1 ? 's' : ''}</div>
              <div className={styles.barreSous}>{nbVariantes} variantes sur Shopify</div>
            </div>
            <SegmentedControl size="xs" value={champ} onChange={(v) => setChamp(v as Champ)}
              data={[{ value: 'recto', label: 'Recto' }, { value: 'verso', label: 'Verso' }, { value: 'profil', label: 'Profil de tailles' }]} />
            {champ === 'profil' ? (
              <Select w={200} value={profilId} onChange={setProfilId} data={profilsPossibles.map((p) => ({ value: p.id, label: p.nom }))}
                placeholder={modelesCoches.length > 1 ? 'Lignes d’un seul modèle' : profilsPossibles.length ? 'Choisir un profil' : 'Aucun profil pour ce modèle'}
                disabled={profilsPossibles.length === 0} />
            ) : (
              <Autocomplete w={200} value={valeur} onChange={(v) => setValeur(v.toUpperCase())}
                data={metachamps.data?.valeurs[champ] ?? []} placeholder="DTG-CUI, MARQUE-OPA…"
                error={valeur && !pret ? 'Valeur illisible' : undefined} />
            )}
            <Button onClick={appliquer} disabled={!pret || !!avancement} loading={!!avancement}>
              {avancement ?? `Appliquer à ${cochees.length} ligne${cochees.length > 1 ? 's' : ''}`}
            </Button>
          </div>
        )}
      </div>

      <ProfilsTailles shopId={shopId} etats={etats} profils={profils} recharger={() => profilsQ.refetch()} />
    </div>
  );
}
