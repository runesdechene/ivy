'use client';

import { useState, useEffect } from 'react';
import { Modal, Button, Text, Group, Stack, Avatar, Loader, Center, TextInput, UnstyledButton } from '@mantine/core';
import { IconCheck, IconX, IconMail } from '@tabler/icons-react';
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
  onConfirm: (sellerId: string | null, customerEmail: string | null, customerPhone: string | null) => void;
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
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

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
    onConfirm(
      selectedSellerId, 
      customerEmail.trim() || null, 
      customerPhone.trim() || null
    );
  };

  // Reset form when modal closes
  useEffect(() => {
    if (!opened) {
      setCustomerEmail('');
      setCustomerPhone('');
      setSelectedSellerId(null);
    }
  }, [opened]);

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
            <Group gap="sm">
              {sellers.map(seller => {
                const isSelected = selectedSellerId === seller.id;
                return (
                  <UnstyledButton
                    key={seller.id}
                    onClick={() => setSelectedSellerId(isSelected ? null : seller.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 4,
                      padding: '0.5rem',
                      borderRadius: 8,
                      border: `2px solid ${isSelected ? (seller.color || 'var(--mantine-color-blue-5)') : 'transparent'}`,
                      background: isSelected ? 'var(--mantine-color-gray-0)' : 'transparent',
                      transition: 'all 0.15s ease',
                      opacity: selectedSellerId && !isSelected ? 0.5 : 1,
                    }}
                  >
                    <Avatar
                      size="md"
                      radius="xl"
                      style={{ backgroundColor: seller.color || 'var(--mantine-color-gray-5)' }}
                    >
                      {seller.initials || seller.name.charAt(0).toUpperCase()}
                    </Avatar>
                    <Text size="xs" fw={isSelected ? 600 : 400} ta="center">
                      {seller.name}
                    </Text>
                  </UnstyledButton>
                );
              })}
            </Group>
          )}
        </div>

        {/* Customer Info (optional) */}
        <div>
          <Text size="sm" fw={500} mb="xs">Client (optionnel)</Text>
          <TextInput
            placeholder="Email"
            leftSection={<IconMail size={16} />}
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            type="email"
          />
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
