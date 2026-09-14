'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader, Paper, Table, Button, Group, Modal, NumberInput, TextInput,
  Stack, Text, Alert,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconPlus, IconFileCertificate, IconAlertTriangle, IconArrowRight, IconMapPin,
} from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { StatusBadge } from '@/components/StatusBadge';
import styles from './douane.module.scss';

interface PassageListItem {
  id: string;
  location_id: string;
  location_name: string;
  status: 'open' | 'closed';
  reference: string | null;
  departed_on: string;
  returned_on: string | null;
  eur_to_chf: number;
  vat_pct: number;
  gross_weight_kg: number | null;
  created_at: string;
  total_pieces: number;
}

interface ConflictInfo {
  openPassageId: string;
  departedOn: string;
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function DouanePage() {
  const router = useRouter();
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();

  const [loading, setLoading] = useState(true);
  const [passages, setPassages] = useState<PassageListItem[]>([]);

  const [modalOpened, modal] = useDisclosure(false);
  const [creating, setCreating] = useState(false);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const [eurToChf, setEurToChf] = useState<number | ''>('');
  const [vatPct, setVatPct] = useState<number | ''>(8.1);
  const [reference, setReference] = useState('');

  const fetchPassages = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/customs/passages?shopId=${currentShop.id}`);
      if (res.ok) {
        const data = await res.json();
        setPassages(data.passages || []);
      } else {
        notifications.show({ title: 'Erreur', message: 'Impossible de charger les passages', color: 'red' });
      }
    } catch (err) {
      console.error('Error fetching passages:', err);
      notifications.show({ title: 'Erreur', message: 'Impossible de charger les passages', color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchPassages();
  }, [fetchPassages]);

  const openModal = useCallback(() => {
    setConflict(null);
    setEurToChf('');
    setVatPct(8.1);
    setReference('');
    modal.open();
  }, [modal]);

  /** Le passage dont le nouveau reprendra l'identité, les libellés et les caisses. */
  const previous = passages[0] ?? null;

  const handleCreate = useCallback(async () => {
    if (!currentShop || !currentLocation) return;
    if (!eurToChf || Number(eurToChf) <= 0) {
      notifications.show({
        title: 'Taux manquant',
        message: 'Le taux EUR vers CHF est obligatoire : il figure sur le document.',
        color: 'red',
      });
      return;
    }

    setCreating(true);
    setConflict(null);
    try {
      const res = await fetch('/api/customs/passages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          locationId: currentLocation.id,
          locationName: currentLocation.name,
          eurToChf: Number(eurToChf),
          vatPct: vatPct === '' ? 8.1 : Number(vatPct),
          reference: reference.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setConflict({ openPassageId: data.openPassageId, departedOn: data.departedOn });
        return;
      }
      if (!res.ok) {
        notifications.show({ title: 'Erreur', message: data.error || 'Création impossible', color: 'red' });
        return;
      }

      notifications.show({
        title: 'Passage ouvert',
        message: `${data.pieces} pièce(s) figée(s) dans l'instantané de départ.`,
        color: 'green',
      });
      modal.close();
      router.push(`/ivy/inventaire/douane/${data.id}`);
    } catch (err) {
      console.error('Error creating passage:', err);
      notifications.show({ title: 'Erreur', message: 'Création impossible', color: 'red' });
    } finally {
      setCreating(false);
    }
  }, [currentShop, currentLocation, eurToChf, vatPct, reference, modal, router]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <Loader color="moss" />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Inventaire · {shopName}</div>
          <h1 className={styles.title}>
            Passages <em>en douane</em>
          </h1>
          <div className={styles.sub}>
            <span>{passages.length} passage{passages.length > 1 ? 's' : ''}</span>
            {currentLocation && (
              <>
                <span className={styles.subSep}>·</span>
                <span className={styles.locationChip}>
                  <IconMapPin size={11} />
                  {currentLocation.name}
                </span>
              </>
            )}
          </div>
        </div>

        <Button
          leftSection={<IconPlus size={16} />}
          color="moss"
          radius="md"
          onClick={openModal}
          disabled={!currentLocation}
        >
          Nouveau passage
        </Button>
      </div>

      {passages.length === 0 ? (
        <Paper withBorder p="xl" radius="md" className={styles.emptyState}>
          <Text c="dimmed" ta="center">
            Aucun passage en douane pour l&apos;instant. Ouvre le premier avec le bouton ci-dessus.
          </Text>
        </Paper>
      ) : (
        <Paper withBorder radius="md" className={styles.tableWrap}>
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Emplacement</Table.Th>
                <Table.Th>Départ</Table.Th>
                <Table.Th>Statut</Table.Th>
                <Table.Th>N° 11.74</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Pièces</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>Taux</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {passages.map((p) => (
                <Table.Tr
                  key={p.id}
                  className={styles.row}
                  onClick={() => router.push(`/ivy/inventaire/douane/${p.id}`)}
                >
                  <Table.Td>{p.location_name}</Table.Td>
                  <Table.Td>{formatDate(p.departed_on)}</Table.Td>
                  <Table.Td>
                    <StatusBadge variant={p.status === 'open' ? 'clay' : 'moss'}>
                      {p.status === 'open' ? 'Ouvert' : 'Clôturé'}
                    </StatusBadge>
                  </Table.Td>
                  <Table.Td>{p.reference || '—'}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{p.total_pieces}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>1 € = {Number(p.eur_to_chf).toFixed(4)} CHF</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal
        opened={modalOpened}
        onClose={modal.close}
        title="Nouveau passage en douane"
        radius="md"
        size="md"
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        <Stack gap="sm">
          {conflict && (
            <Alert color="rust" icon={<IconAlertTriangle size={16} />} title="Un passage est déjà ouvert">
              <Stack gap={6}>
                <Text size="sm">
                  L&apos;emplacement <b>{currentLocation?.name}</b> a déjà un passage ouvert depuis le{' '}
                  {formatDate(conflict.departedOn)}. Clôture-le avant d&apos;en ouvrir un nouveau.
                </Text>
                <Button
                  variant="light"
                  color="rust"
                  size="xs"
                  rightSection={<IconArrowRight size={14} />}
                  onClick={() => {
                    modal.close();
                    router.push(`/ivy/inventaire/douane/${conflict.openPassageId}`);
                  }}
                >
                  Voir le passage ouvert
                </Button>
              </Stack>
            </Alert>
          )}

          <Text size="sm" c="dimmed">
            Fige l&apos;instantané de départ du stock à l&apos;emplacement <b>{currentLocation?.name}</b>,
            tel qu&apos;il est <b>à cet instant</b> : ouvre le passage une fois le stock chargé et à jour.
          </Text>
          {previous && (
            <Text size="xs" c="dimmed">
              Identité, libellés douaniers, codes SH, caisses et cases fixes du 11.74 sont repris du
              passage du {formatDate(previous.departed_on)}. Les dates et le titre du festival repartent vides.
            </Text>
          )}

          <NumberInput
            label="Taux du jour (1 EUR = ? CHF)"
            description="Obligatoire — le taux officiel des douanes."
            value={eurToChf}
            onChange={(v) => setEurToChf(typeof v === 'number' ? v : '')}
            decimalScale={4}
            step={0.01}
            min={0}
            required
          />
          <NumberInput
            label="TVA suisse (%)"
            value={vatPct}
            onChange={(v) => setVatPct(typeof v === 'number' ? v : '')}
            suffix=" %"
            decimalScale={2}
            step={0.1}
            min={0}
          />
          <TextInput
            label="N° du 11.74"
            description="Facultatif — attribué par la douane au guichet, à saisir ensuite sur le passage."
            value={reference}
            onChange={(e) => setReference(e.currentTarget.value)}
          />

          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={modal.close}>Annuler</Button>
            <Button
              color="moss"
              leftSection={<IconFileCertificate size={16} />}
              onClick={handleCreate}
              loading={creating}
            >
              Ouvrir le passage
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
