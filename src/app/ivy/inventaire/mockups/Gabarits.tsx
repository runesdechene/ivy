'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, FileInput, Group, SegmentedControl, Select, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { authJson } from '@/lib/auth-fetch';
import { CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, type Cadre, type Face, type Gabarit, type Point } from '@/lib/mockups/regles';
import { CadreEditeur } from './CadreEditeur';
import styles from './mockups.module.scss';

interface ReponseGabarits { gabarits: Gabarit[]; modeles: Record<string, string[]> }

interface Brouillon {
  id: string | null; // null = nouveau gabarit
  modele: string | null; couleur: string | null; face: Face;
  cadre: Cadre; poitrine: Point | null;
  photo: File | null; ombresClair: File | null; ombresSombre: File | null;
}

const CADRE_DEPART: Cadre = { x: 100, y: 150, hauteur: 500 };
const nouveau = (): Brouillon => ({
  id: null, modele: null, couleur: null, face: 'recto', cadre: CADRE_DEPART, poitrine: null,
  photo: null, ombresClair: null, ombresSombre: null,
});
const depuis = (g: Gabarit): Brouillon => ({
  id: g.id, modele: g.modele, couleur: g.couleur, face: g.face, cadre: g.cadre, poitrine: g.poitrine,
  photo: null, ombresClair: null, ombresSombre: null,
});
const libelle = (g: Pick<Gabarit, 'modele' | 'couleur' | 'face'>) => `${g.modele} · ${g.couleur} · ${g.face === 'recto' ? 'Recto' : 'Verso'}`;

export function Gabarits({ shopId }: { shopId: string }) {
  const { data, refetch } = useQuery({
    queryKey: ['mockups-gabarits', shopId],
    queryFn: () => authJson<ReponseGabarits>(`/api/mockups/gabarits?shopId=${shopId}`),
  });
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);

  const gabarits = data?.gabarits ?? [];
  const modeles = data?.modeles ?? {};
  const actuel = gabarits.find((g) => g.id === brouillon?.id) ?? null;

  // Aperçu local de la photo choisie, sinon celle du bucket.
  const photoLocale = useMemo(() => (brouillon?.photo ? URL.createObjectURL(brouillon.photo) : null), [brouillon?.photo]);
  useEffect(() => () => { if (photoLocale) URL.revokeObjectURL(photoLocale); }, [photoLocale]);
  const photoUrl = photoLocale ?? actuel?.photo_url ?? null;

  const parModele = useMemo(() => {
    const groupes: Record<string, Gabarit[]> = {};
    for (const g of gabarits) (groupes[g.modele] ??= []).push(g);
    return groupes;
  }, [gabarits]);

  const changer = (champs: Partial<Brouillon>) => {
    setConfirmerSuppression(false);
    setBrouillon((b) => (b ? { ...b, ...champs } : b));
  };

  async function enregistrer() {
    if (!brouillon?.modele || !brouillon.couleur) return;
    const form = new FormData();
    form.set('shopId', shopId);
    form.set('modele', brouillon.modele);
    form.set('couleur', brouillon.couleur);
    form.set('face', brouillon.face);
    form.set('cadre_x', String(brouillon.cadre.x));
    form.set('cadre_y', String(brouillon.cadre.y));
    form.set('cadre_hauteur', String(brouillon.cadre.hauteur));
    if (brouillon.poitrine) {
      form.set('poitrine_x', String(brouillon.poitrine.x));
      form.set('poitrine_y', String(brouillon.poitrine.y));
    }
    if (brouillon.photo) form.set('photo', brouillon.photo);
    if (brouillon.ombresClair) form.set('ombres_clair', brouillon.ombresClair);
    if (brouillon.ombresSombre) form.set('ombres_sombre', brouillon.ombresSombre);

    setEnvoi(true);
    try {
      const { gabarit } = await authJson<{ gabarit: Gabarit }>('/api/mockups/gabarits', { method: 'POST', body: form });
      notifications.show({ color: 'green', message: `${libelle(gabarit)} enregistré` });
      await refetch();
      setBrouillon(depuis(gabarit));
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setEnvoi(false);
    }
  }

  async function supprimer() {
    if (!actuel) return;
    if (!confirmerSuppression) return setConfirmerSuppression(true);
    try {
      await authJson(`/api/mockups/gabarits?shopId=${shopId}&id=${actuel.id}`, { method: 'DELETE' });
      notifications.show({ color: 'green', message: `${libelle(actuel)} supprimé` });
      setBrouillon(null);
      await refetch();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  }

  if (!data) return <div className={styles.vide}>Chargement…</div>;

  return (
    <div className={styles.troisColonnes}>
      <section className={styles.panneau}>
        <Group justify="space-between" mb="xs">
          <h2 className={styles.panneauTitre}>Gabarits · {gabarits.length}</h2>
          <Button size="compact-xs" variant="subtle" onClick={() => { setConfirmerSuppression(false); setBrouillon(nouveau()); }}>+ Ajouter</Button>
        </Group>
        {gabarits.length === 0 && <div className={styles.vide}>Aucun gabarit.</div>}
        {Object.entries(parModele).map(([modele, liste]) => (
          <div key={modele}>
            <div className={styles.groupe}>{modele}</div>
            {liste.map((g) => (
              <button
                key={g.id}
                className={`${styles.ligne} ${g.id === brouillon?.id ? styles.ligneActive : ''}`}
                onClick={() => { setConfirmerSuppression(false); setBrouillon(depuis(g)); }}
              >
                {libelle(g)}
                {g.face === 'recto' && !g.poitrine && <span className={styles.aRegler}> · poitrine à poser</span>}
              </button>
            ))}
          </div>
        ))}
      </section>

      <section className={styles.panneau}>
        {!brouillon ? (
          <div className={styles.vide}>Choisis un gabarit, ou « + Ajouter ».</div>
        ) : (
          <>
            <Group justify="space-between" mb="xs">
              <h2 className={styles.panneauTitre}>{brouillon.modele && brouillon.couleur ? libelle({ ...brouillon, modele: brouillon.modele, couleur: brouillon.couleur }) : 'Nouveau gabarit'}</h2>
              <span className={styles.sousTitre}>Glisse le cadre, agrandis-le par son coin</span>
            </Group>
            {photoUrl
              ? <CadreEditeur photoUrl={photoUrl} cadre={brouillon.cadre} poitrine={brouillon.poitrine} onChange={(cadre, poitrine) => changer({ cadre, poitrine })} />
              : <div className={styles.vide}>Dépose une photo à droite.</div>}
          </>
        )}
      </section>

      <section className={styles.panneau}>
        {brouillon && (
          <Stack gap="sm">
            <h2 className={styles.panneauTitre}>Réglages</h2>
            <Select
              size="xs" label="Modèle" searchable disabled={!!brouillon.id}
              data={Object.keys(modeles).sort()} value={brouillon.modele}
              onChange={(modele) => changer({ modele, couleur: null })}
            />
            <Select
              size="xs" label="Couleur du tissu" searchable disabled={!!brouillon.id || !brouillon.modele}
              data={brouillon.modele ? modeles[brouillon.modele] ?? [] : []} value={brouillon.couleur}
              onChange={(couleur) => changer({ couleur })}
            />
            <SegmentedControl
              size="xs" disabled={!!brouillon.id} value={brouillon.face}
              onChange={(v) => changer({ face: v as Face, poitrine: v === 'verso' ? null : brouillon.poitrine })}
              data={[{ label: 'Recto', value: 'recto' }, { label: 'Verso', value: 'verso' }]}
            />
            <FileInput size="xs" label="Photo" accept="image/png,image/webp,image/jpeg" placeholder={actuel ? 'Remplacer la photo' : 'Déposer la photo'} value={brouillon.photo} onChange={(photo) => changer({ photo })} clearable />
            <FileInput size="xs" label="Ombres · dessin CLAIR" accept="image/png" placeholder={actuel?.ombres.CLAIR ? 'Remplacer' : 'Aucune'} value={brouillon.ombresClair} onChange={(ombresClair) => changer({ ombresClair })} clearable />
            <FileInput size="xs" label="Ombres · dessin SOMBRE" accept="image/png" placeholder={actuel?.ombres.SOMBRE ? 'Remplacer' : 'Aucune'} value={brouillon.ombresSombre} onChange={(ombresSombre) => changer({ ombresSombre })} clearable />
            <div className={styles.aide}>Calque d’ombres seul, exporté à son opacité, PNG à la taille de la photo.</div>
            {brouillon.face === 'recto' && !brouillon.poitrine && (
              <Button size="xs" variant="default" onClick={() => changer({ poitrine: { x: brouillon.cadre.x + (brouillon.cadre.hauteur * CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM) / 2, y: brouillon.cadre.y } })}>
                Poser le point poitrine
              </Button>
            )}
            <Group justify="space-between" mt="sm">
              {actuel
                ? <Button size="xs" color="red" variant={confirmerSuppression ? 'filled' : 'subtle'} onClick={supprimer}>{confirmerSuppression ? 'Confirmer la suppression' : 'Supprimer'}</Button>
                : <span />}
              <Button size="xs" loading={envoi} disabled={!brouillon.modele || !brouillon.couleur || !photoUrl} onClick={enregistrer}>Enregistrer</Button>
            </Group>
          </Stack>
        )}
      </section>
    </div>
  );
}
