'use client';

import { useEffect, useState } from 'react';
import { Loader } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { authJson } from '@/lib/auth-fetch';
import type { DemandeImpression, LigneAImprimer } from '@/lib/mockups/regles';
import styles from './FichiersImpression.module.scss';

/**
 * Les fichiers d'impression d'une commande de stock, à glisser dans Brother GTX Graphics Lab.
 * IVY les garde déjà fabriqués : la commande ne demande que leurs adresses signées, une par fichier
 * même s'il sert à plusieurs lignes. Un fichier manquant est fabriqué au passage.
 */

/** L'adresse signée d'un fichier (fabriqué par le serveur s'il ne l'a pas déjà). */
export async function obtenirAdresse(shopId: string, d: DemandeImpression): Promise<string> {
  const p = new URLSearchParams({ shopId, motif: d.motif, nom: d.nom });
  for (const [cle, valeur] of [['recto', d.recto], ['verso', d.verso], ['taille', d.taille]] as const) if (valeur) p.set(cle, valeur);
  return (await authJson<{ url: string }>(`/api/mockups/impression?${p}`)).url;
}

/** IVY Atelier : un fichier posé une fois sur le disque par l'application, partagé entre toutes les lignes. */
const surDisque = new Map<string, Promise<boolean>>();
const poser = (url: string, nom: string) => {
  if (!surDisque.has(url)) surDisque.set(url, window.ivyAtelier!.preparer(url, nom));
  return surDisque.get(url)!;
};

interface Ligne { id: string; fichiers: DemandeImpression[]; manque: string | null }

/** `lignes` : chaque ligne de la commande, avec l'impression qu'elle porte (figée sur une commande de stock). */
export function useFichiersImpression(shopId: string | undefined, lignesCommande: LigneAImprimer[]) {
  const [lignes, setLignes] = useState<Record<string, Ligne>>({});
  const [adresses, setAdresses] = useState<Record<string, string>>({});
  const [enCours, setEnCours] = useState(true); // la liste des fichiers n'est pas encore arrivée
  const [rates, setRates] = useState<Record<string, true>>({}); // fichiers que le serveur n'a pas pu fabriquer
  const [poses, setPoses] = useState<Record<string, boolean>>({}); // IVY Atelier : nom → posé sur le disque, ou échec
  const demandes = [...new Map(lignesCommande.map((l) => [l.id, l])).values()];
  const cle = JSON.stringify(demandes);

  useEffect(() => {
    if (!shopId) return;
    if (demandes.length === 0) return setEnCours(false); // rien à imprimer : pas de chargement à montrer
    let actif = true;
    setEnCours(true);
    (async () => {
      const r = await authJson<{ lignes: Ligne[]; adresses: Record<string, string> }>('/api/mockups/impression', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, lignes: demandes }),
      });
      if (!actif) return;
      setEnCours(false);
      setLignes(Object.fromEntries(r.lignes.map((l) => [l.id, l])));
      setAdresses(r.adresses); // les fichiers déjà gardés sont prêts tout de suite
      const aFabriquer = new Map(r.lignes.flatMap((l) => l.fichiers).filter((d) => !r.adresses[d.nom]).map((d) => [d.nom, d]));
      for (const d of aFabriquer.values()) {
        // Un fichier qui échoue ne bloque pas les suivants : le sien reste « préparation… ».
        const url = await obtenirAdresse(shopId, d).catch(() => null);
        if (!actif) return;
        if (url) setAdresses((a) => ({ ...a, [d.nom]: url }));
        else setRates((r) => ({ ...r, [d.nom]: true }));
      }
    })().catch(() => {
      // liste illisible : aucune étiquette, l'erreur est dans les journaux de la route
      if (actif) setEnCours(false);
    });
    return () => { actif = false; };
  }, [shopId, cle]); // eslint-disable-line react-hooks/exhaustive-deps

  // IVY Atelier : chaque fichier est posé sur le disque dès que son adresse arrive.
  useEffect(() => {
    if (!window.ivyAtelier) return;
    let actif = true;
    for (const [nom, url] of Object.entries(adresses)) {
      void poser(url, nom).then((ok) => { if (actif) setPoses((p) => ({ ...p, [nom]: ok })); });
    }
    return () => { actif = false; };
  }, [adresses]);

  // Un fichier est réglé quand il est prêt, ou qu'il a échoué : seuls les autres font tourner l'indicateur.
  const noms = [...new Set(Object.values(lignes).flatMap((l) => l.fichiers.map((f) => f.nom)))];
  const atelier = typeof window !== 'undefined' && !!window.ivyAtelier;
  const regles = noms.filter((n) => rates[n] || (atelier ? poses[n] !== undefined : !!adresses[n])).length;

  return { lignes, adresses, poses, enCours, total: noms.length, regles };
}

type Impression = ReturnType<typeof useFichiersImpression>;

/** En bas à droite, tant que les fichiers d'impression de la page ne sont pas tous prêts. */
export function ChargementImpression({ impression }: { impression: Impression }) {
  const { enCours, total, regles } = impression;
  if (!enCours && regles === total) return null;
  return (
    <div className={styles.flottant} role="status">
      <Loader size={14} color="currentColor" />
      {enCours ? "Fichiers d'impression…" : `Fichiers d'impression ${regles} / ${total}`}
    </div>
  );
}

/**
 * Copies en mémoire (`blob:`) des fichiers, par adresse : le clic et le glisser partent d'elles, pas du stockage.
 * Windows bloque le glisser d'une adresse d'un autre domaine (« Bloqué par votre organisation »).
 * shortcut: copies gardées tant que la page vit (~11 Mo chacune), à libérer si une commande en montre des dizaines.
 */
const copies = new Map<string, Promise<string>>();
const copie = (url: string) => {
  if (!copies.has(url)) copies.set(url, fetch(url).then((r) => r.blob()).then((b) => URL.createObjectURL(b)));
  return copies.get(url)!;
};
const prete = new Map<string, string>(); // copies déjà arrivées : le glisser doit les lire sans attendre
const preparer = (url: string) => void copie(url).then((local) => prete.set(url, local));

/** Télécharge un fichier sous son vrai nom (`download` est ignoré d'un autre domaine, d'où la copie). */
async function telecharger(url: string, nom: string) {
  const lien = document.createElement('a');
  lien.href = await copie(url);
  lien.download = nom;
  lien.click();
}

/**
 * Les fichiers d'une ligne de commande : un clic les télécharge, ou on les glisse.
 * Dans IVY Atelier, l'application pose chaque fichier sur le disque et le glisse comme un vrai fichier :
 * l'étiquette ne devient glissable qu'une fois le fichier posé, jamais un glisser vide.
 * shortcut: adresse signée valable 1 h, recharger la page au-delà.
 */
export function FichiersDeLaLigne({ ligne, impression }: { ligne: Ligne | undefined; impression: Impression }) {
  const { adresses, poses } = impression;
  if (!ligne) return null;
  const atelier = typeof window !== 'undefined' && !!window.ivyAtelier;
  return (
    <div className={styles.rangee}>
      {ligne.manque && <span className={styles.manque}>{ligne.manque}</span>}
      {ligne.fichiers.map(({ nom }) => {
        const url = adresses[nom];
        const etat = poses[nom]; // atelier : undefined = en cours, true = posé, false = échec
        const echec = atelier && etat === false;
        const pret = !!url && (!atelier || etat === true);
        return (
          <button
            type="button"
            key={nom}
            className={styles.fichier}
            title={echec ? `${nom} — adresse expirée, recharger la page` : `${nom} — clic pour télécharger`}
            disabled={!pret && !echec}
            onClick={(e) => {
              e.stopPropagation();
              if (echec) location.reload();
              else if (url) void telecharger(url, nom);
            }}
            onPointerEnter={() => url && !atelier && preparer(url)} // navigateur : la copie arrive pendant qu'on vise
            draggable={pret}
            onDragStart={(e) => {
              if (!url) return;
              // IVY Atelier : l'application lâche le vrai fichier, que le logiciel d'impression accepte.
              if (atelier) { e.preventDefault(); window.ivyAtelier!.glisser(url, nom); return; }
              // Navigateur : glisser-déposer de fichier de Chrome, depuis la copie si elle est là.
              e.dataTransfer.setData('DownloadURL', `image/png:${nom}:${prete.get(url) ?? url}`);
            }}
          >
            {pret ? <IconPrinter size={12} /> : echec ? null : <Loader size={10} />}
            {echec ? 'recharger la page' : nom.replace(/\.png$/, '').split(' ').slice(1).join(' ')}
          </button>
        );
      })}
    </div>
  );
}
