'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, FileButton, Group, NumberInput, Select, Slider, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { authFetch, authJson } from '@/lib/auth-fetch';
import {
  CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, ROLES, TAILLES_IMPRESSION,
  axeSymetrique, hauteurMax, teinteReglee,
  type Motif, type Role, type TailleImpression,
} from '@/lib/mockups/regles';
import { centrer, chargerGabarit, chargerSource, composerMockup, peindre, versBlob, type GabaritCharge, type Source } from '@/lib/mockups/composer';
import { useReglages } from './Reglages';
import { libelle, useGabarits } from './Gabarits';
import styles from './mockups.module.scss';

type Hauteurs = Motif['hauteurs'];
const arrondi = (cm: number) => Math.round(cm * 10) / 10;
const enCm = (cm: number) => `${arrondi(cm).toFixed(1).replace('.', ',')} cm`;
const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR');

/** État d'un motif dans la liste : fichiers déposés, puis tailles réglées. */
function etat(m: Motif): { label: string; color: string } {
  if (!m.fichiers.CLAIR && !m.fichiers.SOMBRE) return { label: 'pas de fichier', color: 'gray' };
  if (TAILLES_IMPRESSION.some((t) => !m.hauteurs[t])) return { label: 'tailles à régler', color: 'orange' };
  return { label: 'prêt', color: 'green' };
}

/** Mockup d'une taille, avec le cadre maximal en pointillé pour juger la place prise. */
function montage(charge: GabaritCharge, source: Source, teinte: string, reglages: NonNullable<ReturnType<typeof useReglages>['reglages']>, cm: number) {
  const canvas = composerMockup(charge, source, { pose: 'motif', teinte }, reglages, cm);
  const ctx = canvas.getContext('2d')!;
  const { x, y, hauteur } = charge.cadre;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([12, 8]);
  ctx.lineWidth = Math.max(2, canvas.width / 300);
  ctx.strokeStyle = '#228be6';
  ctx.strokeRect(x, y, hauteur * CADRE_LARGEUR_CM / CADRE_HAUTEUR_CM, hauteur);
  return versBlob(canvas, 'image/webp');
}

const HAUTEUR_AXE = 640; // px de l'aperçu de l'axe

/** Le dessin centré sur son axe, et son reflet en miroir par transparence : l'axe est juste quand le cadre et son reflet se superposent. */
function AxeMotif({ source, axe, setAxe, hauteurDMax }: {
  source: Source; axe: number | null; setAxe: (a: number | null) => void; hauteurDMax: number | undefined;
}) {
  const toile = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const centree = centrer(source, axe ?? 0.5);
    const k = HAUTEUR_AXE / centree.dessin.h;
    const encre = peindre(centree, '#2b2b2b', centree.dessin.w * k, HAUTEUR_AXE);
    const reflet = peindre(centree, '#e8590c', centree.dessin.w * k, HAUTEUR_AXE);
    const canvas = toile.current!;
    canvas.width = encre.width;
    canvas.height = encre.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(encre, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(reflet, 0, 0);
    ctx.restore();
    ctx.fillStyle = '#228be6';
    ctx.fillRect(canvas.width / 2 - 0.5, 0, 1, canvas.height);
  }, [source, axe]);

  function proposer() {
    const l = 300, h = Math.round(l * source.dessin.h / source.dessin.w); // assez fin pour l'œil, assez petit pour être instantané
    const pixels = peindre(source, '#000', l, h).getContext('2d')!.getImageData(0, 0, l, h).data;
    const alpha = new Uint8ClampedArray(l * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    setAxe(axeSymetrique(alpha, l, h));
  }

  const ecartMm = hauteurDMax && axe !== null
    ? (axe - 0.5) * hauteurDMax * source.dessin.w / source.dessin.h * 10 : 0;
  return (
    <section className={styles.panneau}>
      <Group justify="space-between" mb="xs">
        <div>
          <h2 className={styles.panneauTitre}>Axe du motif</h2>
          <div className={styles.aide}>Fais glisser jusqu’à ce que le cadre et son reflet orange se superposent. Les flèches du clavier affinent.</div>
        </div>
        <Group gap={6}>
          <Button size="compact-xs" variant="default" onClick={proposer}>Proposer l’axe</Button>
          <Button size="compact-xs" variant="subtle" disabled={axe === null} onClick={() => setAxe(null)}>Au milieu du dessin</Button>
        </Group>
      </Group>
      <div className={styles.axe}>
        <canvas ref={toile} />
        <Slider size="sm" min={0.3} max={0.7} step={0.0005} label={null} value={axe ?? 0.5} onChange={setAxe} />
        <div className={styles.aide}>
          {axe === null ? 'Axe au milieu du dessin.' : `Axe décalé de ${Math.abs(ecartMm).toFixed(1).replace('.', ',')} mm vers la ${ecartMm < 0 ? 'gauche' : 'droite'} (en D-Max).`}
        </div>
      </div>
    </section>
  );
}

/** Les motifs, leurs fichiers déposés et leurs fiches de tailles ; partagés avec l'onglet Générer. */
export function useMotifs(shopId: string) {
  return useQuery({
    queryKey: ['mockups-motifs', shopId],
    queryFn: () => authJson<{ motifs: Motif[] }>(`/api/mockups/motifs?shopId=${shopId}`),
  });
}

export function Motifs({ shopId, choisi, setChoisi }: { shopId: string; choisi: string | null; setChoisi: (nom: string | null) => void }) {
  const { data: donneesGabarits } = useGabarits(shopId);
  const { reglages } = useReglages(shopId);
  const motifs = useMotifs(shopId);

  const [recherche, setRecherche] = useState('');
  const [nouveau, setNouveau] = useState<string | null>(null); // nom en cours de saisie
  const [hauteurs, setHauteurs] = useState<Hauteurs>({});
  const [axe, setAxe] = useState<number | null>(null);
  const [gabaritId, setGabaritId] = useState<string | null>(null);
  const [teinte, setTeinte] = useState<string | null>(null);
  const [charge, setCharge] = useState<GabaritCharge | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [apercus, setApercus] = useState<Partial<Record<TailleImpression, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const [depot, setDepot] = useState(false);
  const urlsAffichees = useRef<string[]>([]);

  const liste = motifs.data?.motifs ?? [];
  const motif = liste.find((m) => m.nom === choisi) ?? null;
  const visibles = liste.filter((m) => m.libelle.toLowerCase().includes(recherche.toLowerCase()));
  const gabarits = donneesGabarits?.gabarits ?? [];
  const gabarit = gabarits.find((g) => g.id === gabaritId) ?? gabarits[0] ?? null;
  const teintes = reglages ? Object.keys(reglages.teintes).filter((t) => teinteReglee(reglages, t)).sort() : [];
  const teinteVue = teinte ?? teintes[0] ?? null;
  const versionVue = reglages && teinteVue ? teinteReglee(reglages, teinteVue)?.version ?? null : null;
  const urlSource = versionVue ? motif?.fichiers[versionVue]?.url ?? null : null;
  const centree = useMemo(() => source && centrer(source, axe), [source, axe]); // ce qui sera imprimé
  const plafond = centree ? arrondi(hauteurMax(centree.dessin.w, centree.dessin.h) - 0.05) : CADRE_HAUTEUR_CM;

  // Changer de motif recharge sa fiche. Lié au seul choix, pour qu'un rechargement de la liste n'écrase pas un réglage en cours.
  useEffect(() => {
    setHauteurs(motif?.hauteurs ?? {});
    setAxe(motif?.axe ?? null);
  }, [choisi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCharge(null);
    if (!gabarit) return;
    let actif = true;
    chargerGabarit(gabarit)
      .then((c) => { if (actif) setCharge(c); })
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    return () => { actif = false; };
  }, [gabarit]);

  useEffect(() => {
    setSource(null);
    if (!urlSource) return;
    let actif = true;
    fetch(urlSource).then((r) => r.blob()).then(chargerSource)
      .then((s) => {
        if (!actif) return;
        setSource(s);
        // Motif neuf : on part des proportions de Valkyrie (A 42, B 44,2, C 45,7, D 50 cm), D au maximum du cadre.
        const max = arrondi(hauteurMax(s.dessin.w, s.dessin.h) - 0.05);
        setHauteurs((h) => Object.keys(h).length ? h : {
          'A-SMALL': arrondi(max * 42 / 50), 'B-MEDIUM': arrondi(max * 44.2 / 50), 'C-LARGE': arrondi(max * 45.7 / 50), 'D-MAX': max,
        });
      })
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    return () => { actif = false; };
  }, [urlSource]);

  // Recompose les quatre mockups, 150 ms après le dernier geste sur un curseur.
  useEffect(() => {
    if (!charge || !centree || !teinteVue || !reglages) return;
    let actif = true;
    const minuteur = setTimeout(async () => {
      const urls: Partial<Record<TailleImpression, string>> = {};
      for (const t of TAILLES_IMPRESSION) {
        const cm = hauteurs[t];
        if (cm) urls[t] = URL.createObjectURL(await montage(charge, centree, teinteVue, reglages, cm));
      }
      const nouvelles = Object.values(urls);
      if (!actif) return nouvelles.forEach((u) => URL.revokeObjectURL(u));
      urlsAffichees.current.forEach((u) => URL.revokeObjectURL(u));
      urlsAffichees.current = nouvelles;
      setApercus(urls);
    }, 150);
    return () => { actif = false; clearTimeout(minuteur); };
  }, [charge, centree, teinteVue, reglages, hauteurs]);

  async function enregistrerFiche(nom: string, h: Hauteurs, a: number | null = null) {
    await authJson('/api/mockups/motifs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, fiche: { nom, hauteurs: h, axe: a } }),
    });
  }

  async function enregistrer() {
    if (!motif) return;
    setEnvoi(true);
    try {
      await enregistrerFiche(motif.nom, hauteurs, axe);
      notifications.show({ color: 'green', message: `Axe et tailles de ${motif.libelle} enregistrés` });
      await motifs.refetch();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setEnvoi(false);
    }
  }

  async function creer() {
    const nom = nouveau?.trim();
    if (!nom) return setNouveau(null);
    try {
      await enregistrerFiche(nom, {});
      const { data } = await motifs.refetch();
      setChoisi(data?.motifs.find((m) => m.libelle.toLowerCase() === nom.toLowerCase() || m.nom === nom.toUpperCase())?.nom ?? null);
      setNouveau(null);
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    }
  }

  /** Dépose des fichiers ; `role` force leur rôle (bouton « Remplacer » d'une vignette), sinon il vient de leur nom. */
  async function deposer(fichiers: File[], role?: Role) {
    if (!motif || fichiers.length === 0) return;
    const form = new FormData();
    form.append('shopId', shopId);
    form.append('motif', motif.nom);
    for (const f of fichiers) form.append('files', role ? new File([f], `${role}.${f.name.split('.').pop()}`, { type: f.type }) : f);
    setDepot(true);
    try {
      const r = await authFetch('/api/mockups/motifs/fichiers', { method: 'POST', body: form });
      const corps = await r.json() as { error?: string };
      if (!r.ok) throw new Error(corps.error ?? 'Dépôt refusé');
      notifications.show({ color: 'green', message: `${fichiers.length} fichier(s) déposé(s) pour ${motif.libelle}` });
      await motifs.refetch();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setDepot(false);
    }
  }

  const regler = (t: TailleImpression, cm: number | null) =>
    setHauteurs((h) => ({ ...h, [t]: cm ? Math.min(arrondi(cm), plafond) : undefined }));

  return (
    <div className={styles.motifs}>
      <section className={styles.panneau}>
        <Group justify="space-between" mb="xs">
          <h2 className={styles.panneauTitre}>Motifs · {liste.length}</h2>
          <Button size="compact-xs" variant="subtle" onClick={() => setNouveau('')}>+ Nouveau</Button>
        </Group>
        {nouveau !== null && (
          <TextInput
            size="xs" mb="xs" autoFocus placeholder="Nom du motif, puis Entrée" value={nouveau}
            onChange={(e) => setNouveau(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') creer(); if (e.key === 'Escape') setNouveau(null); }}
          />
        )}
        <TextInput size="xs" mb="xs" placeholder="Rechercher" value={recherche} onChange={(e) => setRecherche(e.currentTarget.value)} />
        {visibles.map((m) => {
          const e = etat(m);
          return (
            <div key={m.nom} className={`${styles.ligne} ${m.nom === choisi ? styles.ligneActive : ''}`}>
              <button className={styles.ligneNom} onClick={() => setChoisi(m.nom)}>{m.libelle}</button>
              <Badge size="xs" variant="light" color={e.color}>{e.label}</Badge>
            </div>
          );
        })}
      </section>

      {!motif ? (
        <div className={styles.vide}>Choisis un motif dans la liste.</div>
      ) : (
        <div>
          <section
            className={`${styles.panneau} ${depot ? styles.depotEnCours : ''}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); deposer([...e.dataTransfer.files]); }}
          >
            <Group justify="space-between" mb="sm">
              <div>
                <h2 className={styles.panneauTitre}>{motif.libelle} · fichiers</h2>
                <div className={styles.aide}>Glisse un ou plusieurs fichiers ici : IVY les range d’après la fin de leur nom (CLAIR, SOMBRE, MARQUE, DTF).</div>
              </div>
              <FileButton multiple accept="image/png,image/svg+xml" onChange={(f) => deposer(f)}>
                {(props) => <Button {...props} size="xs" variant="default" loading={depot}>Déposer des fichiers</Button>}
              </FileButton>
            </Group>
            <div className={styles.tuiles}>
              {ROLES.map((role) => {
                const f = motif.fichiers[role];
                return (
                  <div key={role} className={`${styles.tuile} ${f ? '' : styles.tuileVide}`}>
                    {f
                      // eslint-disable-next-line @next/next/no-img-element -- fichier du bucket, SVG compris
                      ? <img className={styles.vignette} src={f.url} alt={`${motif.libelle} ${role}`} />
                      : <div className={`${styles.vignette} ${styles.carteVide}`}>Pas de fichier</div>}
                    <strong>{role}</strong>
                    <div className={styles.aide}>{f ? `${f.ext.toUpperCase()} · ${date(f.depose_le)}` : role === 'DTF' ? 'Facultatif (si aucun fichier, le logo de base des Réglages sera utilisé)' : 'Manquant'}</div>
                    <Group gap={6}>
                      <FileButton accept="image/png,image/svg+xml" onChange={(x) => x && deposer([x], role)}>
                        {(props) => <Button {...props} size="compact-xs" variant="default">{f ? 'Remplacer' : 'Déposer'}</Button>}
                      </FileButton>
                      {f && <Button component="a" href={f.url} target="_blank" size="compact-xs" variant="default">Télécharger</Button>}
                    </Group>
                  </div>
                );
              })}
            </div>
          </section>

          {source && <AxeMotif source={source} axe={axe} setAxe={setAxe} hauteurDMax={hauteurs['D-MAX']} />}

          <section className={`${styles.panneau} ${styles.barreMotif}`}>
            <h2 className={styles.panneauTitre}>Tailles d’impression</h2>
            <span className={styles.espace} />
            <Select
              size="xs" w={220} label="Vu sur" value={gabarit?.id ?? null} onChange={setGabaritId}
              data={gabarits.map((g) => ({ value: g.id, label: libelle(g) }))}
            />
            <Select size="xs" w={100} label="Teinte" value={teinteVue} onChange={setTeinte} data={teintes} />
            <Button size="xs" loading={envoi} onClick={enregistrer}>Enregistrer</Button>
          </section>

          {!gabarit ? (
            <div className={styles.vide}>Aucun gabarit : crée-en un dans l’onglet Gabarits.</div>
          ) : !urlSource ? (
            <div className={styles.vide}><span className={styles.aRegler}>Fichier {versionVue ?? ''} manquant</span> : dépose-le ci-dessus.</div>
          ) : (
            <div className={styles.tailles}>
              {TAILLES_IMPRESSION.map((t) => {
                const cm = hauteurs[t] ?? null;
                return (
                  <section key={t} className={styles.panneau}>
                    <Group justify="space-between" mb="xs">
                      <h2 className={styles.panneauTitre}>{t}</h2>
                      {t === 'D-MAX' && <span className={styles.aide}>max {enCm(plafond)}</span>}
                    </Group>
                    {/* eslint-disable-next-line @next/next/no-img-element -- montage local (blob) */}
                    <img className={styles.apercu} src={(cm && apercus[t]) || gabarit.photo_url} alt={`${t} sur ${libelle(gabarit)}`} />
                    <Group gap="sm" mt="sm" wrap="nowrap">
                      <Slider style={{ flex: 1 }} size="sm" min={1} max={plafond} step={0.1} label={null} value={cm ?? 0} onChange={(v) => regler(t, v)} />
                      <NumberInput size="xs" w={90} suffix=" cm" min={1} max={plafond} step={0.1} decimalScale={1} value={cm ?? ''} onChange={(v) => regler(t, Number(v) || null)} />
                    </Group>
                    <div className={styles.aide}>
                      {cm && centree ? `${enCm(cm * centree.dessin.w / centree.dessin.h)} de large` : <span className={styles.aRegler}>hauteur à régler</span>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
