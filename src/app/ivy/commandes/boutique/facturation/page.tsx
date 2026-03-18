'use client';

import { useEffect, useState, useCallback } from 'react';
import { Title, Paper, Stack, Table, Text, Group, Box, Select, Loader, Center, Badge, Button, NumberInput, Divider } from '@mantine/core';
import { IconFileInvoice, IconCheck, IconX } from '@tabler/icons-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { VariantCheckboxGroup } from '@/components/VariantCheckboxGroup';
import { useShop } from '@/context/ShopContext';
import { supabase } from '@/supabase/client';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { getColorFromVariant, getSizeFromVariant } from '@/utils/variant-helpers';
import { transformColor, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { useMonthlyBalance } from '@/hooks/useMonthlyBalance';
import styles from './facturation.module.scss';

interface LineItem {
  id: string;
  title: string;
  quantity: number;
  sku: string;
  variantTitle?: string;
  unitCost?: number | null;
  totalCost?: number | null;
  isCancelled?: boolean;
  variant?: {
    selectedOptions?: Array<{ name: string; value: string }>;
  };
}

interface Order {
  id: string;
  shopify_id: string;
  name: string;
  order_number: string;
  created_at: string;
  display_financial_status: string;
  tags: string[];
  line_items: LineItem[];
}

interface OrderSettings {
  handling_fee: number;
}

interface MonthlyBillingStatus {
  is_invoiced: boolean;
  is_paid: boolean;
}

export default function FacturationBoutiquePage() {
  const { currentShop } = useShop();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [handlingFee, setHandlingFee] = useState(0);
  // Map: "encodedOrderId::productIndex" -> checkedCount
  const [checkedCounts, setCheckedCounts] = useState<Record<string, number>>({});
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [billingStatus, setBillingStatus] = useState<MonthlyBillingStatus>({ is_invoiced: false, is_paid: false });
  const { balance: monthlyBalance, updateBalance: updateMonthlyBalance } = useMonthlyBalance(selectedMonth);

  const fetchData = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      // Charger les mappings de couleurs
      await loadColorMappingsFromSupabase(currentShop.id);

      // Charger les paramètres (coût de manutention)
      const settingsRes = await fetch(`/api/settings/orders?shopId=${currentShop.id}`);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setHandlingFee(data.settings?.handling_fee || 0);
      }

      // Charger les commandes
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*')
        .eq('shop_id', currentShop.id)
        .neq('display_financial_status', 'REFUNDED')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filtrer les commandes batch
      const filteredOrders = (ordersData || []).filter(
        (order: any) => !order.tags?.some((tag: string) => tag.toLowerCase().includes('batch'))
      );

      setOrders(filteredOrders);

      // Charger les checked counts depuis line_item_checks
      const { data: checks } = await supabase
        .from('line_item_checks')
        .select('order_id, product_index')
        .eq('shop_id', currentShop.id)
        .eq('checked', true);

      if (checks) {
        const counts: Record<string, number> = {};
        for (const check of checks) {
          const key = `${check.order_id}::${check.product_index}`;
          counts[key] = (counts[key] || 0) + 1;
        }
        setCheckedCounts(counts);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  const fetchBillingStatus = useCallback(async () => {
    if (!currentShop || !selectedMonth) return;
    
    try {
      const res = await fetch(`/api/billing/monthly-status?shopId=${currentShop.id}&monthKey=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data.status || { is_invoiced: false, is_paid: false });
      }
    } catch (err) {
      console.error('Error fetching billing status:', err);
    }
  }, [currentShop, selectedMonth]);

  const updateBillingStatus = async (field: 'isInvoiced' | 'isPaid', value: boolean) => {
    if (!currentShop) return;
    
    try {
      const res = await fetch('/api/billing/monthly-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          monthKey: selectedMonth,
          [field]: value,
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data.status);
      }
    } catch (err) {
      console.error('Error updating billing status:', err);
    }
  };

  // Recharger les checked counts depuis Supabase
  const reloadCheckedCounts = useCallback(async () => {
    if (!currentShop) return;
    const { data: checks } = await supabase
      .from('line_item_checks')
      .select('order_id, product_index')
      .eq('shop_id', currentShop.id)
      .eq('checked', true);

    if (checks) {
      const counts: Record<string, number> = {};
      for (const check of checks) {
        const key = `${check.order_id}::${check.product_index}`;
        counts[key] = (counts[key] || 0) + 1;
      }
      setCheckedCounts(counts);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchBillingStatus();
  }, [fetchBillingStatus]);

  // Écouter les changements de checks en temps réel
  useEffect(() => {
    if (!currentShop) return;

    const channel = supabase
      .channel('facturation-checks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'line_item_checks', filter: `shop_id=eq.${currentShop.id}` },
        () => reloadCheckedCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentShop, reloadCheckedCounts]);

  // Grouper les commandes par mois
  const ordersByMonth = orders.reduce<Record<string, Order[]>>((acc, order) => {
    const date = new Date(order.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!acc[monthKey]) acc[monthKey] = [];
    acc[monthKey].push(order);
    return acc;
  }, {});

  // Extraire la liste des mois disponibles
  const availableMonths = [...new Set(orders.map(order => {
    const date = new Date(order.created_at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }))].sort().reverse();

  const monthOptions = availableMonths.map(monthKey => {
    const [year, month] = monthKey.split('-');
    const monthTitle = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric'
    });
    return { value: monthKey, label: monthTitle };
  });

  const formatVariant = (variantTitle?: string) => {
    if (!variantTitle) return '';
    return variantTitle.split(' / ').map(part => transformColor(part)).join(' - ');
  };

  const getItemBilledCost = (order: Order, item: LineItem, index: number): number => {
    const encodedOrderId = encodeFirestoreId(order.shopify_id);
    const key = `${encodedOrderId}::${index}`;
    const checked = checkedCounts[key] || 0;
    return checked * (item.unitCost || 0);
  };

  const calculateOrderCost = (order: Order): number => {
    let idx = 0;
    const itemsCost = order.line_items
      .filter(item => !item.isCancelled)
      .reduce((sum, item) => {
        const cost = getItemBilledCost(order, item, idx);
        idx++;
        return sum + cost;
      }, 0);
    return itemsCost + (itemsCost > 0 ? handlingFee : 0);
  };

  const calculateMonthlySubtotal = (monthOrders: Order[]): number => {
    return monthOrders.reduce((sum, order) => sum + calculateOrderCost(order), 0);
  };

  const calculateMonthlyTotal = (monthOrders: Order[]): number => {
    return calculateMonthlySubtotal(monthOrders) + monthlyBalance;
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  const currentMonthOrders = ordersByMonth[selectedMonth] || [];

  return (
    <div className={styles.container}>
      <Group justify="space-between" align="flex-end" mb="lg">
        <Title order={2}>Facturation</Title>
        <Select
          label="Mois"
          placeholder="Sélectionnez un mois"
          data={monthOptions}
          value={selectedMonth}
          onChange={(value) => setSelectedMonth(value || '')}
          w={250}
        />
      </Group>

      {currentMonthOrders.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Text c="dimmed">Aucune commande pour ce mois.</Text>
          </Center>
        </Paper>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: 'hidden' }}>
          <Group justify="space-between" p="md" style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
            <Box>
              <Title order={3}>
                {new Date(parseInt(selectedMonth.split('-')[0]), parseInt(selectedMonth.split('-')[1]) - 1).toLocaleDateString('fr-FR', {
                  month: 'long',
                  year: 'numeric'
                })}
              </Title>
              <Text size="sm" c="dimmed">{currentMonthOrders.length} commande(s)</Text>
            </Box>
            <Group gap="md">
              <Button
                variant={billingStatus.is_invoiced ? 'filled' : 'light'}
                color={billingStatus.is_invoiced ? 'blue' : 'gray'}
                leftSection={billingStatus.is_invoiced ? <IconCheck size={16} /> : <IconFileInvoice size={16} />}
                onClick={() => updateBillingStatus('isInvoiced', !billingStatus.is_invoiced)}
              >
                {billingStatus.is_invoiced ? 'Mois facturé' : 'Non facturé'}
              </Button>
              <Button
                variant={billingStatus.is_paid ? 'filled' : 'light'}
                color={billingStatus.is_paid ? 'green' : 'gray'}
                leftSection={billingStatus.is_paid ? <IconCheck size={16} /> : <IconX size={16} />}
                onClick={() => updateBillingStatus('isPaid', !billingStatus.is_paid)}
                disabled={!billingStatus.is_invoiced}
              >
                {billingStatus.is_paid ? 'Facture payée' : 'Non payée'}
              </Button>
              <Badge size="xl" variant="light" color="green">
                Total: {calculateMonthlyTotal(currentMonthOrders).toFixed(2)} € HT
              </Badge>
            </Group>
          </Group>

          <div className={styles.tableWrapper}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: 100 }}>Date</Table.Th>
                  <Table.Th style={{ width: 100 }}>Commande</Table.Th>
                  <Table.Th>Contenu</Table.Th>
                  <Table.Th style={{ width: 120, textAlign: 'right' }}>Coût articles</Table.Th>
                  <Table.Th style={{ width: 100, textAlign: 'right' }}>Manutention</Table.Th>
                  <Table.Th style={{ width: 100, textAlign: 'right' }}>Total</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {currentMonthOrders.map((order) => {
                  let itemIdx = 0;
                  const itemsCost = order.line_items
                    .filter(item => !item.isCancelled)
                    .reduce((sum, item) => {
                      const cost = getItemBilledCost(order, item, itemIdx);
                      itemIdx++;
                      return sum + cost;
                    }, 0);
                  const totalCost = itemsCost + (itemsCost > 0 ? handlingFee : 0);

                  return (
                    <Table.Tr key={order.id}>
                      <Table.Td>
                        {format(new Date(order.created_at), 'dd/MM/yyyy', { locale: fr })}
                      </Table.Td>
                      <Table.Td>
                        <Text fw={500}>#{order.order_number || order.name}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          {order.line_items
                            .filter(item => !item.isCancelled)
                            .map((item, index) => {
                              const color = getColorFromVariant(item);
                              const size = getSizeFromVariant(item);
                              const encodedOrderId = encodeFirestoreId(order.shopify_id);

                              return (
                                <Group key={index} gap="xs" wrap="nowrap">
                                  <VariantCheckboxGroup
                                    orderId={encodedOrderId}
                                    sku={item.sku || ''}
                                    color={color}
                                    size={size}
                                    quantity={item.quantity}
                                    productIndex={index}
                                    variantTitle={item.variantTitle}
                                    lineItems={order.line_items.map(li => ({
                                      sku: li.sku || '',
                                      variantTitle: li.variantTitle,
                                      quantity: li.quantity
                                    }))}
                                  />
                                  <Text size="xs" style={{ flex: 1 }}>
                                    {item.quantity}× {item.sku} - {formatVariant(item.variantTitle)}
                                    {item.unitCost !== null && item.unitCost !== undefined && item.unitCost > 0 && (
                                      <Text span c="dimmed" ml="xs">
                                        ({item.unitCost.toFixed(2)} €/u)
                                      </Text>
                                    )}
                                  </Text>
                                  <Text size="xs" fw={500} style={{ minWidth: 60, textAlign: 'right' }}>
                                    {(() => {
                                      const billedCost = getItemBilledCost(order, item, index);
                                      return billedCost > 0 ? `${billedCost.toFixed(2)} \u20ac` : '-';
                                    })()}
                                  </Text>
                                </Group>
                              );
                            })}
                        </Stack>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text fw={500}>{itemsCost.toFixed(2)} €</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text c="dimmed">{handlingFee.toFixed(2)} €</Text>
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        <Text fw={600} c="blue">{totalCost.toFixed(2)} €</Text>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr style={{ backgroundColor: 'var(--mantine-color-gray-1)' }}>
                  <Table.Td colSpan={3}>
                    <Text fw={600}>Sous-total du mois</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text fw={600}>
                      {currentMonthOrders.reduce((sum, o) => {
                        let idx = 0;
                        return sum + o.line_items.filter(i => !i.isCancelled).reduce((s, i) => {
                          const cost = getItemBilledCost(o, i, idx);
                          idx++;
                          return s + cost;
                        }, 0);
                      }, 0).toFixed(2)} €
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text fw={600}>
                      {currentMonthOrders.reduce((sum, o) => {
                        let idx = 0;
                        const hasChecked = o.line_items.filter(i => !i.isCancelled).some(i => {
                          const cost = getItemBilledCost(o, i, idx);
                          idx++;
                          return cost > 0;
                        });
                        return sum + (hasChecked ? handlingFee : 0);
                      }, 0).toFixed(2)} €
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text fw={600}>
                      {calculateMonthlySubtotal(currentMonthOrders).toFixed(2)} €
                    </Text>
                  </Table.Td>
                </Table.Tr>
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text fw={600}>Balance (ajustement)</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <NumberInput
                      value={monthlyBalance}
                      onChange={(value) => updateMonthlyBalance(Number(value) || 0)}
                      decimalScale={2}
                      prefix={monthlyBalance >= 0 ? '+' : ''}
                      suffix=" €"
                      size="xs"
                      style={{ width: 140, marginLeft: 'auto' }}
                    />
                  </Table.Td>
                </Table.Tr>
                <Table.Tr style={{ backgroundColor: 'var(--mantine-color-blue-0)' }}>
                  <Table.Td colSpan={5}>
                    <Text fw={700} size="lg">Total du mois</Text>
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    <Text fw={700} c="blue" size="lg">
                      {calculateMonthlyTotal(currentMonthOrders).toFixed(2)} € HT
                    </Text>
                  </Table.Td>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </div>
        </Paper>
      )}
    </div>
  );
}
