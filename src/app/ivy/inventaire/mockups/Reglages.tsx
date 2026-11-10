'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, ColorInput, FileInput, Group, SegmentedControl, Table } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { authFetch, authJson } from '@/lib/auth-fetch';
import type { Reglages as ReglagesTeintes, Version } from '@/lib/mockups/regles';
import styles from './mockups.module.scss';

interface ReponseReglages { reglages: ReglagesTeintes; dtf_url: string | null }

/** Réglages de la boutique (teintes + logo DTF commun), partagés par tous les onglets. */
export function useReglages(shopId: string | undefined) {
  const query = useQuery({
    queryKey: ['mockups-reglages', shopId],
    queryFn: () => authJson<ReponseReglages>(`/api/mockups/reglages?shopId=${shopId}`),
    enabled: !!shopId,
  });
  return { reglages: query.data?.reglages ?? null, dtfUrl: query.data?.dtf_url ?? null, recharger: query.refetch };
}

export function Reglages({ shopId }: { shopId: string }) {
  const { reglages, dtfUrl, recharger } = useReglages(shopId);
  const [teintes, setTeintes] = useState<ReglagesTeintes['teintes']>({});
  const [enregistrement, setEnregistrement] = useState(false);

  useEffect(() => { if (reglages) setTeintes(reglages.teintes); }, [reglages]);

  const modifier = (code: string, champ: 'couleur' | 'version', valeur: string) =>
    setTeintes((t) => ({ ...t, [code]: { ...t[code], [champ]: valeur || null } }));

  async function enregistrer() {
    setEnregistrement(true);
    try {
      await authJson('/api/mockups/reglages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, reglages: { teintes } }),
      });
      notifications.show({ color: 'green', message: 'Réglages enregistrés' });
      await recharger();
    } catch (e) {
      notifications.show({ color: 'red', message: (e as Error).message });
    } finally {
      setEnregistrement(false);
    }
  }

  async function deposerDtf(fichier: File | null) {
    if (!fichier) return;
    const form = new FormData();
    form.set('shopId', shopId);
    form.set('file', fichier);
    const r = await authFetch('/api/mockups/reglages/dtf', { method: 'POST', body: form });
    if (!r.ok) {
      notifications.show({ color: 'red', message: (await r.json().catch(() => ({}))).error ?? 'Échec de l’envoi' });
      return;
    }
    notifications.show({ color: 'green', message: 'Logo DTF remplacé' });
    await recharger();
  }

  if (!reglages) return <div className={styles.vide}>Chargement…</div>;
  const codes = Object.keys(teintes).sort();

  return (
    <>
      <section className={styles.panneau}>
        <h2 className={styles.panneauTitre}>Teintes</h2>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr><Table.Th>Teinte</Table.Th><Table.Th>Couleur</Table.Th><Table.Th>Pour vêtement</Table.Th><Table.Th /></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {codes.map((code) => {
              const t = teintes[code];
              return (
                <Table.Tr key={code}>
                  <Table.Td><strong>{code}</strong></Table.Td>
                  <Table.Td>
                    <ColorInput size="xs" w={140} format="hex" value={t.couleur ?? ''} onChange={(v) => modifier(code, 'couleur', v)} />
                  </Table.Td>
                  <Table.Td>
                    <SegmentedControl
                      size="xs"
                      value={t.version ?? ''}
                      onChange={(v) => modifier(code, 'version', v as Version)}
                      data={[{ label: 'Clair', value: 'CLAIR' }, { label: 'Sombre', value: 'SOMBRE' }]}
                    />
                  </Table.Td>
                  <Table.Td>
                    {t.couleur && t.version
                      ? <div className={styles.pastille} style={{ background: t.couleur }} />
                      : <span className={styles.aRegler}>à régler</span>}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Group justify="flex-end" mt="md">
          <Button size="xs" loading={enregistrement} onClick={enregistrer}>Enregistrer</Button>
        </Group>
      </section>

      <section className={styles.panneau}>
        <h2 className={styles.panneauTitre}>Logo DTF commun (vestes zippées)</h2>
        <Group align="center">
          {dtfUrl
            ? <img src={dtfUrl} alt="Logo DTF commun" className={styles.logoDtf} />
            : <span className={styles.aRegler}>aucun logo déposé</span>}
          <FileInput size="xs" w={240} accept="image/png" placeholder="Déposer un PNG" onChange={deposerDtf} />
        </Group>
      </section>
    </>
  );
}
