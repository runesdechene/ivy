'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActionIcon, Button, FileInput, Group, SegmentedControl, Select, Slider, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCopy } from '@tabler/icons-react';
import { authJson } from '@/lib/auth-fetch';
import { CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, hauteurMax, teinteReglee, type Cadre, type Face, type Gabarit, type Point, type Version } from '@/lib/mockups/regles';
import { chargerGabarit, chargerSource, composerMockup, versBlob, type GabaritCharge, type Source } from '@/lib/mockups/composer';
import { useReglages } from './Reglages';
import { CadreEditeur } from './CadreEditeur';
import styles from './mockups.module.scss';

interface ReponseGabarits { gabarits: Gabarit[]; modeles: Record<string, string[]> }

interface Brouillon {
  id: string | null; // null = nouveau gabarit
  copieDe: string | null; // duplication : gabarit dont on reprend réglages et fichiers
  modele: string | null; couleur: string | null; face: Face;
  cadre: Cadre; poitrine: Point | null;
  photo: File | null; ombresClair: File | null; ombresSombre: File | null; masque: File | null;
  retirer: Record<Version | 'MASQUE', boolean>; // fichier enregistré à supprimer
  intensites: Record<Version, number>;
}

const CADRE_DEPART: Cadre = { x: 100, y: 150, hauteur: 500 };
const nouveau = (): Brouillon => ({
  id: null, copieDe: null, modele: null, couleur: null, face: 'recto', cadre: CADRE_DEPART, poitrine: null, intensites: { CLAIR: 3, SOMBRE: 3 },
  photo: null, ombresClair: null, ombresSombre: null, masque: null, retirer: { CLAIR: false, SOMBRE: false, MASQUE: false },
});
const depuis = (g: Gabarit): Brouillon => ({
  id: g.id, copieDe: null, modele: g.modele, couleur: g.couleur, face: g.face, cadre: g.cadre, poitrine: g.poitrine, intensites: g.intensites,
  photo: null, ombresClair: null, ombresSombre: null, masque: null, retirer: { CLAIR: false, SOMBRE: false, MASQUE: false },
});
/** URL locale d'un fichier choisi, libérée quand il change. */
function useUrlLocale(fichier: File | null): string | null {
  const url = useMemo(() => (fichier ? URL.createObjectURL(fichier) : null), [fichier]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

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
  // Fichiers déjà en place : ceux du gabarit ouvert, ou du gabarit qu'on duplique.
  const enPlace = actuel ?? gabarits.find((g) => g.id === brouillon?.copieDe) ?? null;

  // Fichiers choisis mais pas encore enregistrés, sinon ceux du bucket.
  const photoUrl = useUrlLocale(brouillon?.photo ?? null) ?? enPlace?.photo_url ?? null;
  const ombreClair = useUrlLocale(brouillon?.ombresClair ?? null) ?? (brouillon?.retirer.CLAIR ? null : enPlace?.ombres.CLAIR ?? null);
  const ombreSombre = useUrlLocale(brouillon?.ombresSombre ?? null) ?? (brouillon?.retirer.SOMBRE ? null : enPlace?.ombres.SOMBRE ?? null);
  const masqueUrl = useUrlLocale(brouillon?.masque ?? null) ?? (brouillon?.retirer.MASQUE ? null : enPlace?.masque_url ?? null);

  // « Tester sur un motif » : montage avec le cadre en cours, enregistré ou non.
  const { reglages } = useReglages(shopId);
  const [motif, setMotif] = useState<File | null>(null);
  const [teinte, setTeinte] = useState<string | null>(null);
  const [charge, setCharge] = useState<GabaritCharge | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [apercuUrl, setApercuUrl] = useState<string | null>(null);
  const teintesReglees = reglages ? Object.keys(reglages.teintes).filter((t) => teinteReglee(reglages, t)).sort() : [];

  useEffect(() => {
    setCharge(null);
    if (!photoUrl) return;
    let actif = true;
    chargerGabarit({ photo_url: photoUrl, ombres: { CLAIR: ombreClair, SOMBRE: ombreSombre }, masque_url: masqueUrl, intensites: { CLAIR: 0, SOMBRE: 0 }, cadre: CADRE_DEPART, poitrine: null })
      .then((c) => { if (actif) setCharge(c); })
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    return () => { actif = false; };
  }, [photoUrl, ombreClair, ombreSombre, masqueUrl]);

  useEffect(() => {
    setSource(null);
    if (!motif) return;
    chargerSource(motif).then(setSource).catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
  }, [motif]);

  useEffect(() => {
    // L'ancien montage n'est libéré qu'une fois le nouveau affiché : pas d'image cassée pendant qu'on glisse le cadre.
    const remplacer = (url: string | null) => setApercuUrl((avant) => { if (avant) URL.revokeObjectURL(avant); return url; });
    if (!charge || !source || !teinte || !reglages || !brouillon) return remplacer(null);
    let actif = true;
    const montage = composerMockup({ ...charge, intensites: brouillon.intensites, cadre: brouillon.cadre, poitrine: brouillon.poitrine }, source, { pose: 'motif', teinte }, reglages,
      hauteurMax(source.dessin.w, source.dessin.h)); // test : toujours la plus grande taille qui tient dans le cadre
    versBlob(montage, 'image/webp').then((b) => { if (actif) remplacer(URL.createObjectURL(b)); });
    return () => { actif = false; };
  }, [charge, source, teinte, reglages, brouillon]);

  const parModele = useMemo(() => {
    const groupes: Record<string, Gabarit[]> = {};
    for (const g of gabarits) (groupes[g.modele] ??= []).push(g);
    return groupes;
  }, [gabarits]);

  const ouvrir = (b: Brouillon) => {
    setConfirmerSuppression(false);
    setBrouillon(b);
  };

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
    if (brouillon.copieDe) form.set('copie_de', brouillon.copieDe);
    if (brouillon.photo) form.set('photo', brouillon.photo);
    if (brouillon.ombresClair) form.set('ombres_clair', brouillon.ombresClair);
    if (brouillon.ombresSombre) form.set('ombres_sombre', brouillon.ombresSombre);
    if (brouillon.retirer.CLAIR) form.set('retirer_ombres_clair', '1');
    form.set('intensite_clair', String(brouillon.intensites.CLAIR));
    form.set('intensite_sombre', String(brouillon.intensites.SOMBRE));
    if (brouillon.retirer.SOMBRE) form.set('retirer_ombres_sombre', '1');
    if (brouillon.masque) form.set('masque', brouillon.masque);
    if (brouillon.retirer.MASQUE) form.set('retirer_masque', '1');

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
          <Button size="compact-xs" variant="subtle" onClick={() => ouvrir(nouveau())}>+ Ajouter</Button>
        </Group>
        {gabarits.length === 0 && <div className={styles.vide}>Aucun gabarit.</div>}
        {Object.entries(parModele).map(([modele, liste]) => (
          <div key={modele}>
            <div className={styles.groupe}>{modele}</div>
            {liste.map((g) => (
              <div key={g.id} className={`${styles.ligne} ${g.id === brouillon?.id ? styles.ligneActive : ''}`}>
                <button className={styles.ligneNom} onClick={() => ouvrir(depuis(g))}>
                  {libelle(g)}
                  {g.face === 'recto' && !g.poitrine && <span className={styles.aRegler}> · poitrine à poser</span>}
                </button>
                {/* Copie à l'identique : on change ensuite la face ou la couleur. */}
                <ActionIcon
                  className={styles.ligneAction} size="sm" variant="subtle" color="gray" title="Dupliquer" aria-label={`Dupliquer ${libelle(g)}`}
                  onClick={() => ouvrir({ ...depuis(g), id: null, copieDe: g.id })}
                >
                  <IconCopy size={14} />
                </ActionIcon>
              </div>
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
              <h2 className={styles.panneauTitre}>{brouillon.modele && brouillon.couleur ? libelle({ ...brouillon, modele: brouillon.modele, couleur: brouillon.couleur }) : (enPlace ? `Copie de ${libelle(enPlace)}` : 'Nouveau gabarit')}</h2>
              <span className={styles.sousTitre}>Glisse le cadre, agrandis-le par son coin</span>
            </Group>
            {photoUrl
              ? <CadreEditeur photoUrl={photoUrl} apercuUrl={apercuUrl} cadre={brouillon.cadre} poitrine={brouillon.poitrine} onChange={(cadre, poitrine) => changer({ cadre, poitrine })} />
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
            <FileInput size="xs" label="Photo" accept="image/png,image/webp,image/jpeg" placeholder={enPlace ? 'Remplacer la photo' : 'Déposer la photo'} value={brouillon.photo} onChange={(photo) => changer({ photo })} clearable />
            {(['CLAIR', 'SOMBRE'] as const).map((v) => {
              const cle = v === 'CLAIR' ? 'ombresClair' : 'ombresSombre';
              const enregistree = !!enPlace?.ombres[v] && !brouillon.retirer[v];
              return (
                <Stack key={v} gap={4}>
                  <Group gap="xs" align="flex-end" wrap="nowrap">
                    <FileInput
                      size="xs" style={{ flex: 1 }} label={`Ombres · vêtement ${v === 'CLAIR' ? 'clair' : 'sombre'}`} accept="image/png" clearable
                      placeholder={enregistree ? 'Remplacer' : brouillon.retirer[v] ? 'Retirée à l’enregistrement' : 'Tirées de la photo'}
                      value={brouillon[cle]} onChange={(f) => changer({ [cle]: f, retirer: { ...brouillon.retirer, [v]: false } })}
                    />
                    {enregistree && !brouillon[cle] && (
                      <Button size="xs" variant="subtle" color="red" onClick={() => changer({ retirer: { ...brouillon.retirer, [v]: true } })}>Retirer</Button>
                    )}
                  </Group>
                  {!enregistree && !brouillon[cle] && (
                    <Slider
                      size="xs" min={0} max={6} step={0.5} label={(x) => (x === 0 ? 'sans ombres' : `×${x}`)}
                      value={brouillon.intensites[v]} onChange={(x) => changer({ intensites: { ...brouillon.intensites, [v]: x } })}
                    />
                  )}
                </Stack>
              );
            })}
            <Group gap="xs" align="flex-end" wrap="nowrap">
              <FileInput
                size="xs" style={{ flex: 1 }} label="Masque de l’encre (cordons…)" accept="image/png" clearable
                placeholder={enPlace?.masque_url && !brouillon.retirer.MASQUE ? 'Remplacer' : brouillon.retirer.MASQUE ? 'Retiré à l’enregistrement' : 'Aucun'}
                value={brouillon.masque} onChange={(masque) => changer({ masque, retirer: { ...brouillon.retirer, MASQUE: false } })}
              />
              {enPlace?.masque_url && !brouillon.retirer.MASQUE && !brouillon.masque && (
                <Button size="xs" variant="subtle" color="red" onClick={() => changer({ retirer: { ...brouillon.retirer, MASQUE: true } })}>Retirer</Button>
              )}
            </Group>
            <div className={styles.aide}>Masque : le masque de fusion du PSD, blanc où l’encre passe, noir sur les cordons, PNG à la taille de la photo.</div>
            <div className={styles.aide}>Sans fichier, IVY tire les ombres de la photo (curseur = intensité). Un fichier déposé l’emporte : calque d’ombres seul, PNG à la taille de la photo.</div>
            {brouillon.face === 'recto' && !brouillon.poitrine && (
              <Button size="xs" variant="default" onClick={() => changer({ poitrine: { x: brouillon.cadre.x + (brouillon.cadre.hauteur * CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM) / 2, y: brouillon.cadre.y } })}>
                Poser le point poitrine
              </Button>
            )}
            <div className={styles.test}>
              <div className={styles.groupe}>Tester sur un motif</div>
              <FileInput size="xs" accept="image/png,image/svg+xml" placeholder="Motif (PNG ou SVG)" value={motif} onChange={setMotif} clearable />
              <Select size="xs" placeholder="Teinte" data={teintesReglees} value={teinte} onChange={setTeinte} />
            </div>
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
