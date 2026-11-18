'use client';

import { useEffect, useState } from 'react';
import { Loader } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { authJson } from '@/lib/auth-fetch';
import type { DemandeImpression } from '@/lib/mockups/regles';
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

/** Une ligne de commande vue par l'impression : sa variante et ses métachamps figés à la commande. */
export interface LigneCommande { variantId: string; metafields: Record<string, string> }
interface Ligne { variantId: string; fichiers: DemandeImpression[]; manque: string | null }

export function useFichiersImpression(shopId: string | undefined, lignesCommande: LigneCommande[]) {
  const [lignes, setLignes] = useState<Record<string, Ligne>>({});
  const [adresses, setAdresses] = useState<Record<string, string>>({});
  // L'impression vient de la commande (« Recto », « Verso », « Taille de print ») : elle fait foi, pas la fiche actuelle.
  const demandes = [...new Map(lignesCommande.map((l) => [l.variantId, {
    variantId: l.variantId, recto: l.metafields['Recto'] ?? null, verso: l.metafields['Verso'] ?? null, taille: l.metafields['Taille de print'] ?? null,
  }])).values()];
  const cle = JSON.stringify(demandes);

  useEffect(() => {
    if (!shopId || demandes.length === 0) return;
    let actif = true;
    (async () => {
      const r = await authJson<{ lignes: Ligne[] }>('/api/mockups/impression', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopId, lignes: demandes }),
      });
      if (!actif) return;
      setLignes(Object.fromEntries(r.lignes.map((l) => [l.variantId, l])));
      const uniques = new Map(r.lignes.flatMap((l) => l.fichiers).map((d) => [d.nom, d]));
      for (const d of uniques.values()) {
        const url = await obtenirAdresse(shopId, d);
        if (!actif) return;
        setAdresses((a) => ({ ...a, [d.nom]: url }));
      }
    })().catch(() => { /* la vignette reste « préparation… » ; l'erreur est dans les journaux de la route */ });
    return () => { actif = false; };
  }, [shopId, cle]); // eslint-disable-line react-hooks/exhaustive-deps

  return { lignes, adresses };
}

/** Les fichiers d'une ligne de commande. shortcut: adresse signée valable 1 h, recharger la page au-delà. */
export function FichiersDeLaLigne({ ligne, adresses }: { ligne: Ligne | undefined; adresses: Record<string, string> }) {
  if (!ligne) return null;
  if (ligne.manque) return <span className={styles.manque}>{ligne.manque}</span>;
  return (
    <div className={styles.rangee}>
      {ligne.fichiers.map(({ nom }) => {
        const url = adresses[nom];
        return (
          <span
            key={nom}
            className={styles.fichier}
            title={nom}
            draggable={!!url}
            // Glisser-déposer de fichier de Chrome : Graphics Lab reçoit le PNG sous son nom.
            onDragStart={(e) => url && e.dataTransfer.setData('DownloadURL', `image/png:${nom}:${url}`)}
          >
            {url ? <IconPrinter size={12} /> : <Loader size={10} />}
            {nom.replace(/\.png$/, '').split(' ').slice(1).join(' ')}
          </span>
        );
      })}
    </div>
  );
}
