'use client';

import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Group,
  Stack,
  Table,
  Badge,
  Loader,
  Center,
  ActionIcon,
  Modal,
  Pagination,
  Select,
  TextInput,
} from '@mantine/core';
import { DatePickerInput, DatesRangeValue } from '@mantine/dates';
import { IconEye, IconSearch, IconCalendar } from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';

import 'dayjs/locale/fr';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Sale {
  id: string;
  created_at: string;
  subtotal: number;
  discount_amount: number;
  total_amount: number;
  items_count: number;
  is_refund: boolean;
  customer_email: string | null;
  customer_phone: string | null;
  seller: { name: string; initials: string; color: string } | null;
  location: { name: string } | null;
  discount_rule: { name: string } | null;
  items: SaleItem[];
}

interface SaleItem {
  id: string;
  product_title: string;
  variant_title: string;
  quantity: number;
  unit_price: number;
  discount_percentage: number;
  discount_amount: number;
  total_price: number;
}

const PAGE_SIZE = 20;

export default function StandHistoriquePage() {
  const { currentShop } = useShop();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Filters
  const [dateRange, setDateRange] = useState<DatesRangeValue>([null, null]);
  const [filterType, setFilterType] = useState<string | null>(null);

  // Load sales
  useEffect(() => {
    if (!currentShop?.id) return;

    const loadSales = async () => {
      setLoading(true);

      // Count total
      let countQuery = supabase
        .from('pos_sales')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', currentShop.id);

      if (filterType === 'refund') {
        countQuery = countQuery.eq('is_refund', true);
      } else if (filterType === 'sale') {
        countQuery = countQuery.eq('is_refund', false);
      }

      if (dateRange[0]) {
        const startDate = typeof dateRange[0] === 'string' ? new Date(dateRange[0]) : dateRange[0];
        countQuery = countQuery.gte('created_at', startDate.toISOString());
      }
      if (dateRange[1]) {
        const endDate = typeof dateRange[1] === 'string' ? new Date(dateRange[1]) : new Date(dateRange[1]);
        endDate.setHours(23, 59, 59, 999);
        countQuery = countQuery.lte('created_at', endDate.toISOString());
      }

      const { count } = await countQuery;
      setTotalPages(Math.ceil((count || 0) / PAGE_SIZE));

      // Fetch sales
      let query = supabase
        .from('pos_sales')
        .select(`
          id,
          created_at,
          subtotal,
          discount_amount,
          total_amount,
          items_count,
          is_refund,
          customer_email,
          customer_phone,
          seller:pos_sellers(name, initials, color),
          location:locations(name),
          discount_rule:pos_discount_rules(name)
        `)
        .eq('shop_id', currentShop.id)
        .order('created_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (filterType === 'refund') {
        query = query.eq('is_refund', true);
      } else if (filterType === 'sale') {
        query = query.eq('is_refund', false);
      }

      if (dateRange[0]) {
        const startDate = typeof dateRange[0] === 'string' ? new Date(dateRange[0]) : dateRange[0];
        query = query.gte('created_at', startDate.toISOString());
      }
      if (dateRange[1]) {
        const endDate = typeof dateRange[1] === 'string' ? new Date(dateRange[1]) : new Date(dateRange[1]);
        endDate.setHours(23, 59, 59, 999);
        query = query.lte('created_at', endDate.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading sales:', error);
      } else {
        setSales((data || []).map((s: any) => ({
          ...s,
          seller: s.seller?.[0] || s.seller || null,
          location: s.location?.[0] || s.location || null,
          discount_rule: s.discount_rule?.[0] || s.discount_rule || null,
          items: [],
        })));
      }

      setLoading(false);
    };

    loadSales();
  }, [currentShop?.id, page, filterType, dateRange]);

  const openDetail = async (sale: Sale) => {
    const { data: items } = await supabase
      .from('pos_sale_items')
      .select('*')
      .eq('sale_id', sale.id)
      .order('created_at');

    setSelectedSale({ ...sale, items: items || [] });
    setDetailModalOpen(true);
  };

  const formatPrice = (price: number) => {
    return price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Historique des ventes</Title>
        <Text c="dimmed" size="sm">
          Consultez l'historique des ventes effectuées en caisse
        </Text>
      </div>

      {/* Filters */}
      <Group>
        <Select
          placeholder="Type"
          data={[
            { value: 'sale', label: 'Ventes' },
            { value: 'refund', label: 'Remboursements' },
          ]}
          value={filterType}
          onChange={setFilterType}
          clearable
          style={{ width: 150 }}
        />
        <DatePickerInput
          type="range"
          placeholder="Période"
          value={dateRange}
          onChange={setDateRange}
          locale="fr"
          clearable
          leftSection={<IconCalendar size={16} />}
          style={{ width: 280 }}
        />
      </Group>

      {/* Table */}
      {loading ? (
        <Center h={300}>
          <Loader size="lg" />
        </Center>
      ) : sales.length === 0 ? (
        <Card withBorder padding="xl">
          <Center>
            <Text c="dimmed">Aucune vente trouvée</Text>
          </Center>
        </Card>
      ) : (
        <>
          <Card withBorder padding={0}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th>Articles</Table.Th>
                  <Table.Th>Vendeur</Table.Th>
                  <Table.Th>Client</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Remise</Table.Th>
                  <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  <Table.Th></Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sales.map(sale => (
                  <Table.Tr key={sale.id}>
                    <Table.Td>{formatDate(sale.created_at)}</Table.Td>
                    <Table.Td>
                      <Badge color={sale.is_refund ? 'red' : 'green'} size="sm">
                        {sale.is_refund ? 'Remboursement' : 'Vente'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{sale.items_count}</Table.Td>
                    <Table.Td>
                      {sale.seller ? (
                        <Group gap="xs">
                          <div
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: '50%',
                              backgroundColor: sale.seller.color || '#ccc',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              color: 'white',
                              fontWeight: 600,
                            }}
                          >
                            {sale.seller.initials}
                          </div>
                          <span>{sale.seller.name}</span>
                        </Group>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {sale.customer_email || sale.customer_phone ? (
                        <Text size="sm">{sale.customer_email || sale.customer_phone}</Text>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      {sale.discount_amount > 0 ? (
                        <Text c="green" size="sm">−{formatPrice(sale.discount_amount)} €</Text>
                      ) : (
                        <Text c="dimmed" size="sm">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td style={{ textAlign: 'right' }}>
                      <Text fw={600} c={sale.is_refund ? 'red' : undefined}>
                        {sale.is_refund ? '−' : ''}{formatPrice(Math.abs(sale.total_amount))} €
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" onClick={() => openDetail(sale)}>
                        <IconEye size={16} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>

          {totalPages > 1 && (
            <Center>
              <Pagination
                value={page}
                onChange={setPage}
                total={totalPages}
              />
            </Center>
          )}
        </>
      )}

      {/* Detail Modal */}
      <Modal
        opened={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title="Détail de la vente"
        size="lg"
      >
        {selectedSale && (
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Text size="sm" c="dimmed">Date</Text>
                <Text fw={500}>{formatDate(selectedSale.created_at)}</Text>
              </div>
              <Badge color={selectedSale.is_refund ? 'red' : 'green'} size="lg">
                {selectedSale.is_refund ? 'Remboursement' : 'Vente'}
              </Badge>
            </Group>

            {selectedSale.seller && (
              <div>
                <Text size="sm" c="dimmed">Vendeur</Text>
                <Text fw={500}>{selectedSale.seller.name}</Text>
              </div>
            )}

            {(selectedSale.customer_email || selectedSale.customer_phone) && (
              <div>
                <Text size="sm" c="dimmed">Client</Text>
                {selectedSale.customer_email && (
                  <Text fw={500}>{selectedSale.customer_email}</Text>
                )}
                {selectedSale.customer_phone && (
                  <Text fw={500}>{selectedSale.customer_phone}</Text>
                )}
              </div>
            )}

            {selectedSale.discount_rule && (
              <div>
                <Text size="sm" c="dimmed">Règle de remise</Text>
                <Text fw={500}>{selectedSale.discount_rule.name}</Text>
              </div>
            )}

            <div>
              <Text size="sm" c="dimmed" mb="xs">Articles</Text>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Produit</Table.Th>
                    <Table.Th style={{ textAlign: 'center' }}>Qté</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Prix unit.</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Remise</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>Total</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {selectedSale.items.map(item => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Text size="sm">{item.product_title}</Text>
                        {item.variant_title && (
                          <Text size="xs" c="dimmed">{item.variant_title}</Text>
                        )}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'center' }}>{item.quantity}</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatPrice(item.unit_price)} €</Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>
                        {item.discount_percentage > 0 ? (
                          <Text c="green" size="sm">−{item.discount_percentage}%</Text>
                        ) : '—'}
                      </Table.Td>
                      <Table.Td style={{ textAlign: 'right' }}>{formatPrice(item.total_price)} €</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>

            <Card withBorder padding="md" bg="gray.0">
              <Stack gap="xs">
                <Group justify="space-between">
                  <Text>Sous-total</Text>
                  <Text>{formatPrice(selectedSale.subtotal)} €</Text>
                </Group>
                {selectedSale.discount_amount > 0 && (
                  <Group justify="space-between">
                    <Text c="green">Remise</Text>
                    <Text c="green">−{formatPrice(selectedSale.discount_amount)} €</Text>
                  </Group>
                )}
                <Group justify="space-between">
                  <Text fw={700} size="lg">Total</Text>
                  <Text fw={700} size="lg" c={selectedSale.is_refund ? 'red' : 'green'}>
                    {selectedSale.is_refund ? '−' : ''}{formatPrice(Math.abs(selectedSale.total_amount))} €
                  </Text>
                </Group>
              </Stack>
            </Card>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
