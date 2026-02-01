'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Select, Text, Group, Stack, Avatar, Loader, Center } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { CartItem } from '../types';

interface Seller {
  id: string;
  name: string;
  initials: string | null;
  color: string | null;
  isActive: boolean;
}
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface PaymentModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: (sellerId: string | null) => void;
  items: CartItem[];
  subtotal: number;
  totalDiscount: number;
  total: number;
  itemsCount: number;
  isRefund: boolean;
  shopId: string | undefined;
  loading: boolean;
}

export function PaymentModal({
  opened,
  onClose,
  onConfirm,
  items,
  subtotal,
  totalDiscount,
  total,
  itemsCount,
  isRefund,
  shopId,
  loading,
}: PaymentModalProps) {
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [loadingSellers, setLoadingSellers] = useState(true);

  // Load sellers
  useEffect(() => {
    if (!shopId || !opened) return;

    const loadSellers = async () => {
      setLoadingSellers(true);
      try {
        const { data } = await supabase
          .from('pos_sellers')
          .select('*')
          .eq('shop_id', shopId)
          .eq('is_active', true)
          .order('name');

        if (data) {
          setSellers(data.map(s => ({
            id: s.id,
            name: s.name,
            initials: s.initials,
            color: s.color,
            isActive: s.is_active,
          })));
        }
      } catch (error) {
        console.error('Error loading sellers:', error);
      } finally {
        setLoadingSellers(false);
      }
    };

    loadSellers();
  }, [shopId, opened]);

  const formatPrice = (price: number) => {
    return price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleConfirm = () => {
    onConfirm(selectedSellerId);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isRefund ? "Confirmer le remboursement" : "Confirmer la vente"}
      centered
      size="md"
    >
      <Stack gap="lg">
        {/* Seller Selection */}
        <div>
          <Text size="sm" fw={500} mb="xs">Vendeur</Text>
          {loadingSellers ? (
            <Center py="md">
              <Loader size="sm" />
            </Center>
          ) : sellers.length === 0 ? (
            <Text size="sm" c="dimmed">Aucun vendeur configuré</Text>
          ) : (
            <Select
              placeholder="Sélectionner un vendeur"
              data={sellers.map(s => ({
                value: s.id,
                label: s.name,
              }))}
              value={selectedSellerId}
              onChange={setSelectedSellerId}
              clearable
              renderOption={({ option }) => {
                const seller = sellers.find(s => s.id === option.value);
                return (
                  <Group gap="sm">
                    <Avatar 
                      size="sm" 
                      radius="xl"
                      style={{ backgroundColor: seller?.color || undefined }}
                    >
                      {seller?.initials || seller?.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <span>{option.label}</span>
                  </Group>
                );
              }}
            />
          )}
        </div>

        {/* Summary */}
        <div style={{ 
          background: 'var(--mantine-color-gray-0)', 
          padding: '1rem', 
          borderRadius: '8px' 
        }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Articles</Text>
              <Text size="sm" fw={500}>{itemsCount}</Text>
            </Group>
            
            {totalDiscount > 0 && (
              <>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Sous-total</Text>
                  <Text size="sm">{formatPrice(subtotal)} €</Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="green">Remise</Text>
                  <Text size="sm" c="green">−{formatPrice(totalDiscount)} €</Text>
                </Group>
              </>
            )}
            
            <div style={{ 
              borderTop: '1px solid var(--mantine-color-gray-3)', 
              paddingTop: '0.5rem',
              marginTop: '0.25rem'
            }}>
              <Group justify="space-between">
                <Text fw={700} size="lg">
                  {isRefund ? 'À rembourser' : 'Total à encaisser'}
                </Text>
                <Text 
                  fw={700} 
                  size="xl" 
                  c={isRefund ? 'red' : 'green'}
                >
                  {isRefund ? '−' : ''}{formatPrice(Math.abs(total))} €
                </Text>
              </Group>
            </div>
          </Stack>
        </div>

        {/* Actions */}
        <Group justify="flex-end" gap="sm">
          <Button 
            variant="subtle" 
            color="gray" 
            onClick={onClose}
            leftSection={<IconX size={16} />}
          >
            Annuler
          </Button>
          <Button 
            color={isRefund ? 'red' : 'green'}
            onClick={handleConfirm}
            loading={loading}
            leftSection={<IconCheck size={16} />}
          >
            {isRefund ? 'Confirmer le remboursement' : 'Marquer comme payé'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
