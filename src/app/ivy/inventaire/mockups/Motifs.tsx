'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Group, NumberInput, Select, Slider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { authJson } from '@/lib/auth-fetch';
import {
  CADRE_HAUTEUR_CM, CADRE_LARGEUR_CM, PX_PAR_CM_300DPI, TAILLES_IMPRESSION,
  hauteurMax, tailleDansNom, teinteReglee, trouverFichier,
  type FicheMotif, type TailleImpression,
} from '@/lib/mockups/regles';
import { chargerGabarit, chargerSource, composerMockup, versBlob, type GabaritCharge, type Source } from '@/lib/mockups/composer';
import { dossierPossible, ouvrirDossier, type DossierMotif } from '@/lib/mockups/dossier';
import { useReglages } from './Reglages';
import { libelle, useGabarits } from './Gabarits';
import styles from './mockups.module.scss';

type Hauteurs = FicheMotif['hauteurs'];
const arrondi = (cm: number) => Math.round(cm * 10) / 10;
const enCm = (cm: number) => `${arrondi(cm).toFixed(1).replace('.', ',')} cm`;

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

export function Motifs({ shopId }: { shopId: string }) {
  const { data: donneesGabarits } = useGabarits(shopId);
  const { reglages } = useReglages(shopId);
  const fiches = useQuery({
    queryKey: ['mockups-motifs', shopId],
    queryFn: () => authJson<{ fiches: FicheMotif[] }>(`/api/mockups/motifs?shopId=${shopId}`),
  });

  const [dossier, setDossier] = useState<DossierMotif | null>(null);
  const [hauteurs, setHauteurs] = useState<Hauteurs>({});
  const [gabaritId, setGabaritId] = useState<string | null>(null);
  const [teinte, setTeinte] = useState<string | null>(null);
  const [charge, setCharge] = useState<GabaritCharge | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [apercus, setApercus] = useState<Partial<Record<TailleImpression, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const urlsAffichees = useRef<string[]>([]);

  const gabarits = donneesGabarits?.gabarits ?? [];
  const gabarit = gabarits.find((g) => g.id === gabaritId) ?? gabarits[0] ?? null;
  const teintes = reglages ? Object.keys(reglages.teintes).filter((t) => teinteReglee(reglages, t)).sort() : [];
  const teinteVue = teinte ?? teintes[0] ?? null;
  const noms = dossier ? [...dossier.fichiers.keys()] : [];
  const nomSource = reglages && teinteVue ? trouverFichier(noms, { pose: 'motif', teinte: teinteVue }, reglages) : null;
  const versionVue = reglages && teinteVue ? teinteReglee(reglages, teinteVue)?.version : null;
  // Anciens fichiers d'impression du dossier (« LOKI DTG-CUI C-LARGE.png ») : ils donnent les tailles déjà utilisées.
  const anciens = noms.filter((n) => /\.png$/i.test(n) && /(?:^|\s)(DTG|DTF)-/i.test(n) && tailleDansNom(n));
  const plafond = source ? arrondi(hauteurMax(source.dessin.w, source.dessin.h) - 0.05) : CADRE_HAUTEUR_CM;

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
    const fichier = nomSource ? dossier?.fichiers.get(nomSource) : undefined;
    if (!fichier) return;
    let actif = true;
    chargerSource(fichier)
      .then((s) => { if (actif) setSource(s); })
      .catch((e: Error) => notifications.show({ color: 'red', message: e.message }));
    return () => { actif = false; };
  }, [dossier, nomSource]);

  // Recompose les quatre mockups, 150 ms après le dernier geste sur un curseur.
  useEffect(() => {
    if (!charge || !source || !teinteVue || !reglages) return;
    let actif = true;
    const minuteur = setTimeout(async () => {
      const urls: Partial<Record<TailleImpression, string>> = {};
      for (const t of TAILLES_IMPRESSION) {
        const cm = hauteurs[t];
        if (cm) urls[t] = URL.createObjectURL(await montage(charge, source, teinteVue, reglages, cm));
      }
      const nouvelles = Object.values(urls);
      if (!actif) return nouvelles.forEach((u) => URL.revokeObjectURL(u));
      urlsAffichees.current.forEach((u) => URL.revokeObjectURL(u));
      urlsAffichees.current = nouvelles;
      setApercus(urls);
    }, 150);
    return () => { actif = false; clearTimeout(minuteur); };
  }, [charge, source, teinteVue, reglages, hauteurs]);

  async function choisirDossier() {
    if (!dossierPossible()) {
      notifications.show({ color: 'red', message: 'Ouvre IVY dans Chrome ou Edge pour accéder au dossier du motif.' });
      return;
    }
    const d = await ouvrirDossier();
    if (!d) return;
    setDossier(d);
    setHauteurs(fiches.data?.fiches.find((f) => f.nom === d.nom)?.hauteurs ?? {});
  }

  async function reprendre() {
    if (!dossier) return;
    const lues: Hauteurs = {};
    for (const t of TAILLES_IMPRESSION) {
      const nom = anciens.find((n) => tailleDansNom(n) === t);
      if (!nom) continue;
      const s = await chargerSource(dossier.fichiers.get(nom)!);
      lues[t] = arrondi(s.dessin.h / PX_PAR_CM_300DPI); // fichiers d'impression à 300 dpi
    }
    setHauteurs((h) => ({ ...h, ...lues }));
    notifications.show({ message: `${Object.keys(lues).length} taille(s) reprise(s) des anciens fichiers` });
  }

  async function enregistrer() {
    if (!dossier) return;
    setEnvoi(true);
    try {
      await authJson('/api/mockups/motifs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, fiche: { nom: dossier.nom, hauteurs } }),
      });
      notifications.show({ color: 'green', message: `Fiche de ${dossier.nom} enregistrée` });
      await fiches.refetch();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setEnvoi(false);
    }
  }

  const regler = (t: TailleImpression, cm: number | null) =>
    setHauteurs((h) => ({ ...h, [t]: cm ? Math.min(arrondi(cm), plafond) : undefined }));

  return (
    <>
      <section className={`${styles.panneau} ${styles.barreMotif}`}>
        <div>
          <div className={styles.etiquette}>Dossier du motif</div>
          <Group gap="sm">
            <Button size="xs" variant="default" onClick={choisirDossier}>Choisir le dossier</Button>
            {dossier && (
              <div>
                <strong>{dossier.nom}</strong>
                <div className={styles.aide}>{noms.filter((n) => !anciens.includes(n) && !n.startsWith('.')).join(' · ') || 'dossier vide'}</div>
              </div>
            )}
          </Group>
        </div>
        <Select
          size="xs" w={220} label="Vu sur" value={gabarit?.id ?? null} onChange={setGabaritId}
          data={gabarits.map((g) => ({ value: g.id, label: libelle(g) }))}
        />
        <Select size="xs" w={100} label="Teinte" value={teinteVue} onChange={setTeinte} data={teintes} />
        <span className={styles.espace} />
        {anciens.length > 0 && <Button size="xs" variant="default" onClick={reprendre}>Reprendre des anciens fichiers</Button>}
        <Button size="xs" loading={envoi} disabled={!dossier} onClick={enregistrer}>Enregistrer</Button>
      </section>

      {!dossier ? (
        <div className={styles.vide}>Choisis le dossier d’un motif pour régler ses tailles.</div>
      ) : !gabarit ? (
        <div className={styles.vide}>Aucun gabarit : crée-en un dans l’onglet Gabarits.</div>
      ) : !nomSource ? (
        <div className={styles.vide}><span className={styles.aRegler}>Fichier {dossier.nom} {versionVue ?? ''} manquant</span> dans le dossier.</div>
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
                  {cm && source ? `${enCm(cm * source.dessin.w / source.dessin.h)} de large` : <span className={styles.aRegler}>hauteur à régler</span>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
