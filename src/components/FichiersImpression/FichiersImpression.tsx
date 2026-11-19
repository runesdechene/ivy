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

interface Ligne { id: string; fichiers: DemandeImpression[]; manque: string | null }

/** `lignes` : chaque ligne de la commande, avec l'impression qu'elle porte (figée sur une commande de stock). */
export function useFichiersImpression(shopId: string | undefined, lignesCommande: LigneAImprimer[]) {
  const [lignes, setLignes] = useState<Record<string, Ligne>>({});
  const [adresses, setAdresses] = useState<Record<string, string>>({});
  const demandes = [...new Map(lignesCommande.map((l) => [l.id, l])).values()];
  const cle = JSON.stringify(demandes);

  useEffect(() => {
    if (!shopId || demandes.length === 0) return;
    let actif = true;
    (async () => {
      const r = await authJson<{ lignes: Ligne[]; adresses: Record<string, string> }>('/api/mockups/impression', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, lignes: demandes }),
      });
      if (!actif) return;
      setLignes(Object.fromEntries(r.lignes.map((l) => [l.id, l])));
      setAdresses(r.adresses); // les fichiers déjà gardés sont prêts tout de suite
      const aFabriquer = new Map(r.lignes.flatMap((l) => l.fichiers).filter((d) => !r.adresses[d.nom]).map((d) => [d.nom, d]));
      for (const d of aFabriquer.values()) {
        // Un fichier qui échoue ne bloque pas les suivants : le sien reste « préparation… ».
        const url = await obtenirAdresse(shopId, d).catch(() => null);
        if (!actif) return;
        if (url) setAdresses((a) => ({ ...a, [d.nom]: url }));
      }
    })().catch(() => { /* liste illisible : aucune étiquette, l'erreur est dans les journaux de la route */ });
    return () => { actif = false; };
  }, [shopId, cle]); // eslint-disable-line react-hooks/exhaustive-deps

  return { lignes, adresses };
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

/** Les fichiers d'une ligne de commande : un clic les télécharge, ou on les glisse. shortcut: adresse signée valable 1 h, recharger la page au-delà. */
export function FichiersDeLaLigne({ ligne, adresses }: { ligne: Ligne | undefined; adresses: Record<string, string> }) {
  if (!ligne) return null;
  return (
    <div className={styles.rangee}>
      {ligne.manque && <span className={styles.manque}>{ligne.manque}</span>}
      {ligne.fichiers.map(({ nom }) => {
        const url = adresses[nom];
        return (
          <button
            type="button"
            key={nom}
            className={styles.fichier}
            title={`${nom} — clic pour télécharger`}
            disabled={!url}
            onClick={(e) => { e.stopPropagation(); if (url) void telecharger(url, nom); }}
            onPointerEnter={() => url && preparer(url)} // la copie arrive pendant qu'on vise
            draggable={!!url}
            // Glisser-déposer de fichier de Chrome : Graphics Lab reçoit le PNG sous son nom, depuis la copie si elle est là.
            onDragStart={(e) => url && e.dataTransfer.setData('DownloadURL', `image/png:${nom}:${prete.get(url) ?? url}`)}
          >
            {url ? <IconPrinter size={12} /> : <Loader size={10} />}
            {nom.replace(/\.png$/, '').split(' ').slice(1).join(' ')}
          </button>
        );
      })}
    </div>
  );
}
