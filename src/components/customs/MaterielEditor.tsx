'use client';

import { Table, TextInput, NumberInput, ActionIcon, Button, Text, Checkbox, Tooltip } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { depuisSaisie, separerFournitures, totauxMateriel, type LigneSaisie } from '@/lib/customs/materiel';

export const LIGNE_VIDE: LigneSaisie = { designation: '', quantite: '', poids_kg: '', valeur_eur: '', caisse: false };

const fmt = (n: number, d = 2) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * Liste des fournitures du stand, éditable ligne à ligne.
 *
 * Poids et valeur se saisissent pour UN objet ; le pied de tableau donne les
 * totaux. Une ligne cochée « Caisse » transporte la marchandise : son poids ira
 * dans le brut. Les lignes en cours de frappe restent du texte : la conversion et
 * la validation se font à l'enregistrement, côté appelant, via `depuisSaisie`.
 */
export function MaterielEditor({ lignes, onChange, tauxEurChf, disabled }: {
  lignes: LigneSaisie[];
  onChange: (lignes: LigneSaisie[]) => void;
  tauxEurChf?: number;
  disabled?: boolean;
}) {
  const maj = (i: number, patch: Partial<LigneSaisie>) =>
    onChange(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  // Totaux sur les seules lignes valides : une ligne à moitié tapée ne fausse pas le pied.
  const valide = depuisSaisie(lignes);
  const totaux = 'materiel' in valide ? totauxMateriel(valide.materiel) : null;
  const poidsCaisses = 'materiel' in valide ? totauxMateriel(separerFournitures(valide.materiel).caisses).poidsKg : 0;

  return (
    <>
      <Table withTableBorder striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Désignation</Table.Th>
            <Table.Th style={{ width: 110, textAlign: 'right' }}>Quantité</Table.Th>
            <Table.Th style={{ width: 140, textAlign: 'right' }}>Poids unitaire (kg)</Table.Th>
            <Table.Th style={{ width: 160, textAlign: 'right' }}>Valeur estimée unitaire (€)</Table.Th>
            <Table.Th style={{ width: 80, textAlign: 'center' }}>
              <Tooltip label="Transporte la marchandise : son poids va dans le poids brut, pas dans le matériel d'exposition" multiline w={260}>
                <span>Caisse</span>
              </Tooltip>
            </Table.Th>
            <Table.Th style={{ width: 50 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lignes.map((l, i) => (
            <Table.Tr key={i}>
              <Table.Td>
                <TextInput size="xs" value={l.designation} placeholder="ex. Table pliante" disabled={disabled}
                  onChange={(e) => maj(i, { designation: e.currentTarget.value })} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.quantite} min={1} allowDecimal={false} disabled={disabled}
                  onChange={(v) => maj(i, { quantite: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.poids_kg} min={0} decimalScale={2} disabled={disabled}
                  allowedDecimalSeparators={['.', ',']}
                  onChange={(v) => maj(i, { poids_kg: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td>
                <NumberInput size="xs" value={l.valeur_eur} min={0} decimalScale={2} disabled={disabled}
                  allowedDecimalSeparators={['.', ',']}
                  onChange={(v) => maj(i, { valeur_eur: v })} styles={{ input: { textAlign: 'right' } }} />
              </Table.Td>
              <Table.Td style={{ textAlign: 'center' }}>
                <Checkbox checked={l.caisse} color="moss" disabled={disabled} aria-label="Caisse"
                  style={{ display: 'inline-block' }}
                  onChange={(e) => maj(i, { caisse: e.currentTarget.checked })} />
              </Table.Td>
              <Table.Td>
                <ActionIcon variant="subtle" color="rust" disabled={disabled}
                  onClick={() => onChange(lignes.filter((_, j) => j !== i))} aria-label="Retirer">
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
          {lignes.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}><Text size="sm" c="dimmed" ta="center">Aucune fourniture.</Text></Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
        {totaux && totaux.objets > 0 && (
          <Table.Tfoot>
            <Table.Tr>
              <Table.Td><b>TOTAL</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}><b>{totaux.objets}</b></Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{fmt(totaux.poidsKg, 1)} kg</b>
                {poidsCaisses > 0 && <Text size="xs" c="dimmed">dont caisses {fmt(poidsCaisses, 1)} kg</Text>}
              </Table.Td>
              <Table.Td style={{ textAlign: 'right' }}>
                <b>{fmt(totaux.valeurEur)} €</b>
                {tauxEurChf ? <Text size="xs" c="dimmed">{fmt(totaux.valeurEur * tauxEurChf)} CHF</Text> : null}
              </Table.Td>
              <Table.Td />
              <Table.Td />
            </Table.Tr>
          </Table.Tfoot>
        )}
      </Table>
      {'erreur' in valide && <Text size="xs" c="rust" mt={4}>{valide.erreur}</Text>}
      <Button variant="subtle" color="moss" size="xs" mt="xs" leftSection={<IconPlus size={14} />}
        disabled={disabled} onClick={() => onChange([...lignes, { ...LIGNE_VIDE }])}>
        Ajouter un objet
      </Button>
    </>
  );
}
