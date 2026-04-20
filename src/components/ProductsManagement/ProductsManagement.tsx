'use client';

import { useState } from 'react';
import { Card, Group, Text, TextInput, Table, Badge, ActionIcon, NumberInput, Stack } from '@mantine/core';
import { IconSearch, IconEdit, IconCheck } from '@tabler/icons-react';
import { useProducts } from '@/hooks/useProducts';
import { notifications } from '@mantine/notifications';

export function ProductsManagement() {
  const { products, isLoading, error, searchQuery, setSearchQuery, updateInventory } = useProducts();
  const [editingInventory, setEditingInventory] = useState<{
    productId: string;
    variantId: string;
    quantity: number;
  } | null>(null);

  const handleInventoryUpdate = async (productId: string, variantId: string, quantity: number) => {
    try {
      await updateInventory(productId, variantId, quantity);
      setEditingInventory(null);
      notifications.show({
        title: 'Succès',
        message: 'Stock mis à jour avec succès',
        color: 'green',
      });
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de mettre à jour le stock',
        color: 'red',
      });
    }
  };

  if (error) {
    return <Text c="red">Erreur : {error.message}</Text>;
  }

  return (
    <Stack>
      <Card withBorder>
        <Group justify="space-between">
          <TextInput
            placeholder="Rechercher des produits..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftSection={<IconSearch size={16} />}
            style={{ flexGrow: 1 }}
          />
        </Group>
      </Card>

      <Card withBorder>
        {isLoading ? (
          <Text>Chargement des produits...</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Produit</Table.Th>
                <Table.Th>Variante</Table.Th>
                <Table.Th>SKU</Table.Th>
                <Table.Th>Prix</Table.Th>
                <Table.Th>Stock</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {products.map(product => (
                product.variants.map((variant:any) => (
                  <Table.Tr key={`${product.id}-${variant.id}`}>
                    <Table.Td>
                      <Group>
                        {product.title}
                        <Badge>{product.status}</Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{variant.title}</Table.Td>
                    <Table.Td>{variant.sku || '-'}</Table.Td>
                    <Table.Td>{variant.price}</Table.Td>
                    <Table.Td>
                      {editingInventory?.productId === product.id && 
                       editingInventory?.variantId === variant.id ? (
                        <Group>
                          <NumberInput
                            value={editingInventory?.quantity ?? 0}
                            onChange={(value) => setEditingInventory(prev => prev ? {
                              ...prev,
                              quantity: typeof value === 'string' ? parseInt(value, 10) : (value ?? 0)
                            } : null)}
                            min={0}
                            style={{ width: 100 }}
                          />
                          <ActionIcon
                            variant="filled"
                            color="moss"
                            onClick={() => {
                              if (editingInventory) {
                                handleInventoryUpdate(
                                  product.id,
                                  variant.id,
                                  editingInventory.quantity
                                );
                              }
                            }}
                          >
                            <IconCheck size={16} />
                          </ActionIcon>
                        </Group>
                      ) : (
                        <Group>
                          <Text>{variant.inventory_quantity}</Text>
                          <ActionIcon
                            variant="subtle"
                            onClick={() => setEditingInventory({
                              productId: product.id,
                              variantId: variant.id,
                              quantity: variant.inventory_quantity
                            })}
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge 
                        color={variant.inventory_quantity === 0 ? 'red' : 
                               variant.inventory_quantity < 5 ? 'yellow' : 'green'}
                      >
                        {variant.inventory_quantity === 0 ? 'Rupture' :
                         variant.inventory_quantity < 5 ? 'Stock bas' : 'En stock'}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                ))
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
