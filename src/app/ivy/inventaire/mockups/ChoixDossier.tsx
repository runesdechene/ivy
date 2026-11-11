'use client';

import type { ReactNode } from 'react';
import { ActionIcon, Button, Group } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { dossierPossible, ouvrirDossier, type DossierMotif } from '@/lib/mockups/dossier';

/** « Choisir le dossier » du motif, son nom, ce qu'il contient (`children`) et la croix pour le délier. */
export function ChoixDossier({ dossier, onChange, children }: {
  dossier: DossierMotif | null; onChange: (d: DossierMotif | null) => void; children?: ReactNode;
}) {
  async function choisir() {
    if (!dossierPossible()) {
      notifications.show({ color: 'red', message: 'Ce navigateur bloque l\'accès aux dossiers. Sur Brave : brave://flags/#file-system-access-api → Enabled, puis relancer. Sinon : Chrome ou Edge.' });
      return;
    }
    try {
      const d = await ouvrirDossier();
      if (d) onChange(d);
    } catch (e) {
      console.error('[mockups] dossier', e);
      notifications.show({ color: 'red', message: `Dossier illisible : ${e instanceof Error ? `${e.name} — ${e.message}` : String(e)}` });
    }
  }

  return (
    <Group gap="sm">
      <Button size="xs" variant="default" onClick={choisir}>Choisir le dossier</Button>
      {dossier && (
        <>
          <div><strong>{dossier.nom}</strong>{children}</div>
          <ActionIcon variant="subtle" color="gray" title="Délier le dossier" onClick={() => onChange(null)}>
            <IconX size={16} />
          </ActionIcon>
        </>
      )}
    </Group>
  );
}
