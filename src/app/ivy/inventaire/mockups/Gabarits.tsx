'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Accordion, Button, FileButton, FileInput, Group, NumberInput, SegmentedControl, Select, Slider, Stack } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAdjustments, IconCopy, IconPhoto, IconPlus, IconRuler2, IconShadow } from '@tabler/icons-react';
import { authJson } from '@/lib/auth-fetch';
import { CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, hauteurMax, teinteReglee, type Cadre, type Face, type Gabarit, type Point, type Version } from '@/lib/mockups/regles';
import { useMotifs } from './Motifs';
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

export const libelle = (g: Pick<Gabarit, 'modele' | 'couleur' | 'face'>) => `${g.modele} · ${g.couleur} · ${g.face === 'recto' ? 'Recto' : 'Verso'}`;

/** Gabarits de la boutique et modèles Shopify (SKU → couleurs), partagés par les onglets. */
export function useGabarits(shopId: string) {
  return useQuery({
    queryKey: ['mockups-gabarits', shopId],
    queryFn: () => authJson<ReponseGabarits>(`/api/mockups/gabarits?shopId=${shopId}`),
  });
}

export function Gabarits({ shopId }: { shopId: string }) {
  const { data, refetch } = useGabarits(shopId);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);

  const gabarits = data?.gabarits ?? [];
  const modeles = data?.modeles ?? {};
  const actuel = gabarits.find((g) => g.id === brouillon?.id) ?? null;
  const autresCouleurs = actuel ? gabarits.filter((g) => g.modele === actuel.modele && g.face === actuel.face && g.id !== actuel.id).length : 0;
  // Le bouton « Appliquer » part de ce qui est enregistré : un réglage en cours le rendrait trompeur.
  const nonEnregistre = !!brouillon && (!!(brouillon.ombresClair || brouillon.ombresSombre || brouillon.masque)
    || Object.values(brouillon.retirer).some(Boolean)
    || brouillon.intensites.CLAIR !== actuel?.intensites.CLAIR || brouillon.intensites.SOMBRE !== actuel?.intensites.SOMBRE);
  const [zoneDe, setZoneDe] = useState<string | null>(null); // modèle dont on copie la zone d'impression
  // Fichiers déjà en place : ceux du gabarit ouvert, ou du gabarit qu'on duplique.
  const enPlace = actuel ?? gabarits.find((g) => g.id === brouillon?.copieDe) ?? null;

  // Fichiers choisis mais pas encore enregistrés, sinon ceux du bucket.
  const photoUrl = useUrlLocale(brouillon?.photo ?? null) ?? enPlace?.photo_url ?? null;
  const ombreClair = useUrlLocale(brouillon?.ombresClair ?? null) ?? (brouillon?.retirer.CLAIR ? null : enPlace?.ombres.CLAIR ?? null);
  const ombreSombre = useUrlLocale(brouillon?.ombresSombre ?? null) ?? (brouillon?.retirer.SOMBRE ? null : enPlace?.ombres.SOMBRE ?? null);
  const masqueUrl = useUrlLocale(brouillon?.masque ?? null) ?? (brouillon?.retirer.MASQUE ? null : enPlace?.masque_url ?? null);

  // « Tester sur un motif » : montage avec le cadre en cours, enregistré ou non.
  const { reglages } = useReglages(shopId);
  const motifs = useMotifs(shopId);
  const [motifNom, setMotifNom] = useState<string | null>(null);
  const [teinte, setTeinte] = useState<string | null>(null);
  const [charge, setCharge] = useState<GabaritCharge | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [hauteurChoisie, setHauteurChoisie] = useState<number | null>(null); // null = la plus grande qui tient dans le cadre
  const hauteurPlafond = source ? hauteurMax(source.dessin.w, source.dessin.h) : CADRE_HAUTEUR_CM;
  const hauteurCm = Math.min(hauteurChoisie ?? hauteurPlafond, hauteurPlafond);
  const [apercuUrl, setApercuUrl] = useState<string | null>(null);
  const teintesReglees = reglages ? Object.keys(reglages.teintes).filter((t) => teinteReglee(reglages, t)).sort() : [];
  // Le fichier du motif déposé dans IVY qui correspond à la version de la teinte (CLAIR ou SOMBRE).
  const version = reglages && teinte ? teinteReglee(reglages, teinte)?.version : null;
  const urlMotif = version ? motifs.data?.motifs.find((m) => m.nom === motifNom)?.fichiers[version]?.url ?? null : null;

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
    setHauteurChoisie(null); // chaque nouveau motif repart de sa taille maximale
    if (!urlMotif) return;
    fetch(urlMotif).then((r) => r.blob()).then(chargerSource).then(setSource).catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
  }, [urlMotif]);

  useEffect(() => {
    // L'ancien montage n'est libéré qu'une fois le nouveau affiché : pas d'image cassée pendant qu'on glisse le cadre.
    const remplacer = (url: string | null) => setApercuUrl((avant) => { if (avant) URL.revokeObjectURL(avant); return url; });
    if (!charge || !source || !teinte || !reglages || !brouillon) return remplacer(null);
    let actif = true;
    const montage = composerMockup({ ...charge, intensites: brouillon.intensites, cadre: brouillon.cadre, poitrine: brouillon.poitrine }, source, { pose: 'motif', teinte }, reglages, hauteurCm);
    versBlob(montage, 'image/webp').then((b) => { if (actif) remplacer(URL.createObjectURL(b)); });
    return () => { actif = false; };
  }, [charge, source, teinte, hauteurCm, reglages, brouillon]);

  const ouvrir = (b: Brouillon) => {
    setConfirmerSuppression(false);
    setBrouillon(b);
  };

  const changer = (champs: Partial<Brouillon>) => {
    setConfirmerSuppression(false);
    setBrouillon((b) => (b ? { ...b, ...champs } : b));
  };

  // Navigation : un modèle, une couleur, une face. La face reste en place quand on change de couleur.
  const modelesRegles = [...new Set(gabarits.map((g) => g.modele))];
  const couleursDe = (m: string) => [...new Set(gabarits.filter((g) => g.modele === m).map((g) => g.couleur))];
  const modeleVu = brouillon?.modele ?? modelesRegles[0] ?? '';
  const couleursVues = couleursDe(modeleVu);
  const faceVue = brouillon?.face ?? 'recto';
  const trouver = (modele: string, couleur: string, face: Face) => gabarits.find((g) => g.modele === modele && g.couleur === couleur && g.face === face);

  /** Ouvre le gabarit demandé ; s'il n'existe pas, en prépare un avec la zone du modèle. */
  function aller(modele: string, couleur: string, face: Face) {
    const g = trouver(modele, couleur, face);
    if (g) return ouvrir(depuis(g));
    const cadre = gabarits.find((x) => x.modele === modele && x.face === face)?.cadre ?? CADRE_DEPART;
    ouvrir({ ...nouveau(), modele, couleur, face, cadre });
  }

  // Les flèches ne doivent pas faire perdre un réglage en cours.
  const reglage = (g: Pick<Brouillon, 'cadre' | 'poitrine' | 'intensites'>) => JSON.stringify([g.cadre, g.poitrine, g.intensites.CLAIR, g.intensites.SOMBRE]);
  const modifie = !!brouillon && (!!(brouillon.photo || brouillon.ombresClair || brouillon.ombresSombre || brouillon.masque || brouillon.copieDe)
    || Object.values(brouillon.retirer).some(Boolean) || (!!actuel && reglage(brouillon) !== reglage(actuel)));

  const racine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function auClavier(e: KeyboardEvent) {
      // Les onglets restent montés : rien tant que celui-ci est caché, ni quand un champ ou un curseur a le focus.
      if (!racine.current?.offsetParent || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest('input, textarea, [role="slider"], [role="listbox"]')) return;
      const touche = e.key.toLowerCase();
      const sens = touche === 'arrowright' ? 1 : touche === 'arrowleft' ? -1 : 0;
      const face: Face | null = touche === 'r' ? 'recto' : touche === 'v' ? 'verso' : null;
      if ((!sens && !face) || !couleursVues.length) return;
      e.preventDefault();
      if (modifie) return notifications.show({ id: 'non-enregistre', color: 'yellow', message: 'Réglage non enregistré : enregistre-le, ou clique une couleur pour l’abandonner.' });
      const i = couleursVues.indexOf(brouillon?.couleur ?? '');
      const suivante = i < 0 ? 0 : (i + sens + couleursVues.length) % couleursVues.length;
      aller(modeleVu, couleursVues[suivante], face ?? faceVue);
    }
    window.addEventListener('keydown', auClavier);
    return () => window.removeEventListener('keydown', auClavier);
  });

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

  async function appliquerATous() {
    if (!actuel) return;
    setEnvoi(true);
    try {
      const { couleurs } = await authJson<{ couleurs: number }>('/api/mockups/gabarits', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, id: actuel.id }),
      });
      notifications.show({ color: 'green', message: `Ombres et masque appliqués à ${couleurs} autre(s) couleur(s)` });
      await refetch();
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

  const titre = !brouillon ? 'Choisis une couleur'
    : brouillon.modele && brouillon.couleur ? libelle({ ...brouillon, modele: brouillon.modele, couleur: brouillon.couleur })
    : enPlace ? `Copie de ${libelle(enPlace)}` : 'Nouveau gabarit';

  return (
    <div className={styles.gabarits} ref={racine}>
      <div className={styles.modeles}>
        {modelesRegles.map((m) => (
          <Button
            key={m} size="compact-sm" color="dark" variant={m === modeleVu ? 'filled' : 'subtle'} aria-pressed={m === modeleVu}
            onClick={() => aller(m, couleursDe(m).includes(brouillon?.couleur ?? '') ? brouillon!.couleur! : couleursDe(m)[0], faceVue)}
          >
            {m} · {couleursDe(m).length}
          </Button>
        ))}
        <Button size="compact-sm" variant="default" ml="auto" leftSection={<IconPlus size={14} />} onClick={() => ouvrir(nouveau())}>Ajouter un gabarit</Button>
      </div>

      <div className={styles.bande}>
        <SegmentedControl
          size="xs" value={faceVue} data={[{ label: 'Recto', value: 'recto' }, { label: 'Verso', value: 'verso' }]}
          onChange={(v) => modeleVu && aller(modeleVu, brouillon?.couleur ?? couleursVues[0], v as Face)}
        />
        <div className={styles.couleurs}>
          {couleursVues.map((couleur) => {
            const g = trouver(modeleVu, couleur, faceVue);
            const choisie = brouillon?.couleur === couleur;
            return (
              <button key={couleur} className={`${styles.couleur} ${choisie ? styles.couleurActive : ''}`} aria-pressed={choisie} onClick={() => aller(modeleVu, couleur, faceVue)}>
                {/* shortcut: la photo entière sert de vignette (une transformation Supabase serait facturée) ; en fabriquer à l'envoi si la bande rame. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- photo du bucket */}
                {g ? <img src={g.photo_url} alt="" loading="lazy" /> : <span className={styles.trou}><IconPlus size={16} /></span>}
                <span>{couleur}</span>
                {g && g.face === 'recto' && !g.poitrine && <span className={styles.point} title="Point poitrine à poser" />}
              </button>
            );
          })}
          {gabarits.length === 0 && <div className={styles.vide}>Aucun gabarit.</div>}
        </div>
      </div>

      <div className={styles.travail}>
        <section className={styles.colonne}>
          <div className={styles.tete}>
            <h2>{titre}</h2>
            <span className={styles.aide}>← → couleur, R recto, V verso</span>
          </div>
          <div className={styles.scene}>
            {!brouillon ? <div className={styles.vide}>Clique une couleur ci-dessus.</div>
              : photoUrl ? <CadreEditeur photoUrl={photoUrl} apercuUrl={apercuUrl} cadre={brouillon.cadre} poitrine={brouillon.poitrine} onChange={(cadre, poitrine) => changer({ cadre, poitrine })} />
              : (
                <Stack align="center" gap="xs">
                  <div className={styles.aide}>Pas encore de photo pour ce {brouillon.face}.</div>
                  <FileButton accept="image/png,image/webp,image/jpeg" onChange={(photo) => changer({ photo })}>
                    {(props) => <Button size="xs" variant="default" {...props}>Déposer la photo du {brouillon.face}</Button>}
                  </FileButton>
                </Stack>
              )}
          </div>
        </section>

        <aside className={styles.colonne}>
          {brouillon && (
            <>
              <div className={styles.volets}>
                {!brouillon.id && (
                  <Stack gap="xs" p="sm">
                    <Select
                      size="xs" label="Modèle" searchable
                      data={Object.keys(modeles).sort()} value={brouillon.modele}
                      onChange={(modele) => changer({ modele, couleur: null })}
                    />
                    <Select
                      size="xs" label="Couleur du tissu" searchable disabled={!brouillon.modele}
                      data={brouillon.modele ? modeles[brouillon.modele] ?? [] : []} value={brouillon.couleur}
                      onChange={(couleur) => changer({ couleur })}
                    />
                    <SegmentedControl
                      size="xs" value={brouillon.face}
                      onChange={(v) => changer({ face: v as Face, poitrine: v === 'verso' ? null : brouillon.poitrine })}
                      data={[{ label: 'Recto', value: 'recto' }, { label: 'Verso', value: 'verso' }]}
                    />
                  </Stack>
                )}
                <Accordion defaultValue="zone">
                  <Accordion.Item value="zone">
                    <Accordion.Control icon={<IconRuler2 size={16} />}>Zone d’impression</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        <div className={styles.aide}>Glisse le cadre, agrandis-le par son coin. Il suit toutes les couleurs du modèle.</div>
                        <Group gap="xs" align="flex-end" wrap="nowrap">
                          <Select
                            size="xs" style={{ flex: 1 }} label="Copier la zone d’impression de…" placeholder="Modèle" searchable
                            data={[...new Set(gabarits.filter((g) => g.face === brouillon.face && g.modele !== brouillon.modele).map((g) => g.modele))].sort()}
                            value={zoneDe} onChange={setZoneDe}
                          />
                          <Button
                            size="xs" variant="default" disabled={!zoneDe}
                            onClick={() => {
                              // Toutes les couleurs d'un modèle partagent la même zone : la première suffit.
                              const source = gabarits.find((g) => g.modele === zoneDe && g.face === brouillon.face);
                              if (source) changer({ cadre: source.cadre });
                            }}
                          >
                            Copier
                          </Button>
                        </Group>
                        {brouillon.face === 'recto' && !brouillon.poitrine && (
                          <Button size="xs" variant="default" onClick={() => changer({ poitrine: { x: brouillon.cadre.x + (brouillon.cadre.hauteur * CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM) / 2, y: brouillon.cadre.y } })}>
                            Poser le point poitrine
                          </Button>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value="ombres">
                    <Accordion.Control icon={<IconShadow size={16} />}>Ombres et masque</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
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
                            size="xs" style={{ flex: 1 }} label="Masque de l’encre (cordons, capuche…)" accept="image/png" clearable
                            placeholder={enPlace?.masque_url && !brouillon.retirer.MASQUE ? 'Remplacer' : brouillon.retirer.MASQUE ? 'Retiré à l’enregistrement' : 'Aucun'}
                            value={brouillon.masque} onChange={(masque) => changer({ masque, retirer: { ...brouillon.retirer, MASQUE: false } })}
                          />
                          {enPlace?.masque_url && !brouillon.retirer.MASQUE && !brouillon.masque && (
                            <Button size="xs" variant="subtle" color="red" onClick={() => changer({ retirer: { ...brouillon.retirer, MASQUE: true } })}>Retirer</Button>
                          )}
                        </Group>
                        <div className={styles.aide}>Masque : noir là où l’encre s’efface (cordons, capuche), blanc ou transparent ailleurs, PNG à la taille de la photo.</div>
                        <div className={styles.aide}>Sans fichier, IVY tire les ombres de la photo (curseur = intensité). Un fichier déposé l’emporte : calque d’ombres seul, PNG à la taille de la photo.</div>
                        {actuel && autresCouleurs > 0 && (
                          <Button size="xs" variant="default" loading={envoi} onClick={appliquerATous} disabled={nonEnregistre}
                            title={nonEnregistre ? 'Enregistre d’abord : ce sont les ombres et le masque enregistrés qui partent' : undefined}>
                            Appliquer les ombres et le masque de {actuel.couleur} · {actuel.face} aux {autresCouleurs} autres couleurs
                          </Button>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value="test">
                    <Accordion.Control icon={<IconAdjustments size={16} />}>Tester sur un motif</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        <Select
                          size="xs" searchable clearable placeholder="Motif déposé dans IVY" value={motifNom} onChange={setMotifNom}
                          data={(motifs.data?.motifs ?? []).filter((m) => m.fichiers.CLAIR || m.fichiers.SOMBRE).map((m) => ({ value: m.nom, label: m.libelle }))}
                        />
                        <Group grow gap="xs">
                          <Select size="xs" placeholder="Teinte" data={teintesReglees} value={teinte} onChange={setTeinte} />
                          <NumberInput
                            size="xs" suffix=" cm" min={1} max={Math.floor(hauteurPlafond * 10) / 10} step={0.1} decimalScale={1}
                            value={Math.round(hauteurCm * 10) / 10} onChange={(v) => setHauteurChoisie(Number(v) || null)}
                          />
                        </Group>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                  <Accordion.Item value="photo">
                    <Accordion.Control icon={<IconPhoto size={16} />}>Photo et gabarit</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        <FileInput size="xs" label="Photo" accept="image/png,image/webp,image/jpeg" placeholder={enPlace ? 'Remplacer la photo' : 'Déposer la photo'} value={brouillon.photo} onChange={(photo) => changer({ photo })} clearable />
                        {actuel && (
                          // Copie à l'identique : on change ensuite la face ou la couleur.
                          <Button size="xs" variant="default" leftSection={<IconCopy size={14} />} onClick={() => ouvrir({ ...depuis(actuel), id: null, copieDe: actuel.id })}>
                            Dupliquer vers une autre couleur
                          </Button>
                        )}
                        {actuel && (
                          <Button size="xs" color="red" variant={confirmerSuppression ? 'filled' : 'subtle'} onClick={supprimer}>{confirmerSuppression ? 'Confirmer la suppression' : 'Supprimer ce gabarit'}</Button>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              </div>
              <div className={styles.pied}>
                <Button fullWidth size="sm" loading={envoi} disabled={!brouillon.modele || !brouillon.couleur || !photoUrl} onClick={enregistrer}>Enregistrer</Button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
