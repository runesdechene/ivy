'use client';

import { useState, useEffect, useCallback } from 'react';
import { Title, Text, Paper, Tabs, Table, Button, Group, Badge, ActionIcon, Modal, Textarea, Loader, Center } from '@mantine/core';
import { IconPlus, IconEye, IconTrash, IconPackage, IconCheck, IconClock, IconEdit, IconTruck } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useRouter } from 'next/navigation';
import { useShop } from '@/context/ShopContext';
import styles from './stock.module.scss';

interface SupplierOrder {
  id: string;
  order_number: string;
  status: 'draft' | 'requested' | 'produced' | 'completed';
  note: string | null;
  subtotal: number;
  balance_adjustment: number;
  total_ht: number;
  total_ttc: number;
  created_at: string;
  closed_at: string | null;
  items_count?: number;
  validated_count?: number;
}

export default function CommandesStockPage() {
  const router = useRouter();
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SupplierOrder[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>('active');
  const [createModalOpened, { open: openCreateModal, close: closeCreateModal }] = useDisclosure(false);
  const [newOrderNote, setNewOrderNote] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!currentShop) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/suppliers/orders?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de charger les commandes',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const createOrder = async () => {
    if (!currentShop) return;
    
    setCreating(true);
    try {
      const response = await fetch('/api/suppliers/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          note: newOrderNote,
        }),
      });
      
      if (response.ok) {
        const data = await response.json();
        notifications.show({
          title: 'Succès',
          message: `Commande ${data.order.order_number} créée`,
          color: 'green',
        });
        closeCreateModal();
        setNewOrderNote('');
        fetchOrders();
        router.push(`/ivy/commandes/stock/${data.order.id}`);
      }
    } catch (err) {
      console.error('Error creating order:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de créer la commande',
        color: 'red',
      });
    } finally {
      setCreating(false);
    }
  };

  const deleteOrder = async (orderId: string) => {
    if (!currentShop) return;
    if (!confirm('Supprimer cette commande ?')) return;
    
    try {
      const response = await fetch(`/api/suppliers/orders?id=${orderId}&shopId=${currentShop.id}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        notifications.show({
          title: 'Succès',
          message: 'Commande supprimée',
          color: 'green',
        });
        fetchOrders();
      }
    } catch (err) {
      console.error('Error deleting order:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge color="gray" leftSection={<IconEdit size={12} />}>Brouillon</Badge>;
      case 'requested':
        return <Badge color="slate" leftSection={<IconClock size={12} />}>Demandée</Badge>;
      case 'produced':
        return <Badge color="moss" leftSection={<IconCheck size={12} />}>Produite</Badge>;
      case 'completed':
        return <Badge color="moss" leftSection={<IconCheck size={12} />}>Terminée</Badge>;
      default:
        return <Badge color="gray">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatPrice = (price: number) => {
    return price.toFixed(2) + ' €';
  };

  const filteredOrders = orders.filter(order => {
    if (activeTab === 'active') return order.status !== 'completed';
    if (activeTab === 'completed') return order.status === 'completed';
    return true;
  });

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <div className={styles.container}>
      <Group justify="space-between" mb="lg">
        <Group>
          <IconTruck size={28} />
          <Title order={2}>Commandes Stock</Title>
        </Group>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={openCreateModal}
        >
          Nouvelle commande
        </Button>
      </Group>

      <Text c="dimmed" mb="lg">
        Gérez vos commandes de réapprovisionnement de stock auprès de vos fournisseurs.
      </Text>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List mb="lg">
          <Tabs.Tab 
            value="active" 
            leftSection={<IconClock size={16} />}
          >
            En cours ({orders.filter(o => o.status !== 'completed').length})
          </Tabs.Tab>
          <Tabs.Tab 
            value="completed" 
            leftSection={<IconCheck size={16} />}
          >
            Terminées ({orders.filter(o => o.status === 'completed').length})
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="active">
          {renderOrdersTable(filteredOrders)}
        </Tabs.Panel>

        <Tabs.Panel value="completed">
          {renderOrdersTable(filteredOrders)}
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={createModalOpened}
        onClose={closeCreateModal}
        title="Nouvelle commande stock"
      >
        <Textarea
          label="Note (optionnel)"
          placeholder="Description de la commande..."
          value={newOrderNote}
          onChange={(e) => setNewOrderNote(e.target.value)}
          rows={3}
          mb="md"
        />
        <Group justify="flex-end">
          <Button variant="subtle" onClick={closeCreateModal}>Annuler</Button>
          <Button onClick={createOrder} loading={creating}>Créer</Button>
        </Group>
      </Modal>
    </div>
  );

  function renderOrdersTable(ordersList: SupplierOrder[]) {
    if (ordersList.length === 0) {
      return (
        <Paper withBorder p="xl" radius="md">
          <Text c="dimmed" ta="center">
            Aucune commande dans cette catégorie.
          </Text>
        </Paper>
      );
    }

    return (
      <Paper withBorder radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>N° Commande</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Statut</Table.Th>
              <Table.Th>Articles</Table.Th>
              <Table.Th>Progression</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Total HT</Table.Th>
              <Table.Th style={{ width: 120 }}>Actions</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {ordersList.map((order) => (
              <Table.Tr key={order.id}>
                <Table.Td>
                  <Group gap="xs">
                    <IconPackage size={16} />
                    <Text fw={600}>{order.order_number}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>{formatDate(order.created_at)}</Table.Td>
                <Table.Td>{getStatusBadge(order.status)}</Table.Td>
                <Table.Td>
                  <Badge variant="light">{order.items_count || 0} article(s)</Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c={order.validated_count === order.items_count ? 'green' : 'orange'}>
                    {order.validated_count || 0}/{order.items_count || 0} validé(s)
                  </Text>
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Text fw={600}>{formatPrice(order.total_ht || 0)}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs">
                    <Button
                      variant="light"
                      size="xs"
                      leftSection={<IconEye size={14} />}
                      onClick={() => router.push(`/ivy/commandes/stock/${order.id}`)}
                    >
                      Voir
                    </Button>
                    {order.status === 'draft' && (
                      <ActionIcon
                        variant="subtle"
                        color="rust"
                        onClick={() => deleteOrder(order.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    );
  }
}
