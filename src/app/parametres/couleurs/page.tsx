'use client';

import { useState, useEffect, useCallback } from 'react';
import { Title, Text, Paper, Stack, Table, TextInput, Button, Group, ActionIcon, Badge, ColorSwatch, Modal, Loader, Center, ColorPicker, Popover } from '@mantine/core';
import { IconPlus, IconTrash, IconEdit } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';

interface ColorRule {
  id?: string;
  reception_name: string;
  display_name: string | null;
  hex_value: string;
}

export default function CouleursPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [colorRules, setColorRules] = useState<ColorRule[]>([]);
  const [editingColor, setEditingColor] = useState<ColorRule | null>(null);
  const [colorModalOpened, { open: openColorModal, close: closeColorModal }] = useDisclosure(false);
  const [colorSearch, setColorSearch] = useState('');

  const fetchRules = useCallback(async () => {
    if (!currentShop) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/settings?shopId=${currentShop.id}`);
      if (response.ok) {
        const data = await response.json();
        setColorRules(data.colorRules || []);
      }
    } catch (err) {
      console.error('Error fetching color rules:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const saveColorRule = async (rule: ColorRule) => {
    if (!currentShop) return;
    
    setSaving(true);
    try {
      const response = await fetch('/api/settings/colors', {
        method: rule.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rule,
          shopId: currentShop.id,
        }),
      });

      if (response.ok) {
        notifications.show({
          title: 'Succès',
          message: 'Règle de couleur sauvegardée',
          color: 'green',
        });
        closeColorModal();
        fetchRules();
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder la règle',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteColorRule = async (id: string) => {
    if (!currentShop) return;
    
    try {
      const response = await fetch(`/api/settings/colors?id=${id}&shopId=${currentShop.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        notifications.show({
          title: 'Succès',
          message: 'Règle supprimée',
          color: 'green',
        });
        fetchRules();
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer la règle',
        color: 'red',
      });
    }
  };

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <div>
      <Title order={2} mb="lg">Couleurs</Title>
      
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="md">
          <div>
            <Text fw={600}>Mapping des couleurs</Text>
            <Text size="sm" c="dimmed">
              Définissez comment les noms de couleurs reçus de Shopify sont affichés dans l'application.
              La recherche est insensible à la casse.
            </Text>
          </div>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => {
              setEditingColor({ reception_name: '', display_name: null, hex_value: '#808080' });
              openColorModal();
            }}
          >
            Ajouter une couleur
          </Button>
        </Group>

        {colorRules.length > 0 && (
          <TextInput
            placeholder="Rechercher une couleur..."
            value={colorSearch}
            onChange={(e) => setColorSearch(e.target.value)}
            mb="md"
          />
        )}

        {colorRules.length > 0 ? (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Couleur</Table.Th>
                <Table.Th>Nom de réception</Table.Th>
                <Table.Th>Nom sur Ivy</Table.Th>
                <Table.Th style={{ width: 100 }}>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {colorRules
                .filter(rule => 
                  colorSearch === '' || 
                  rule.reception_name.toLowerCase().includes(colorSearch.toLowerCase()) ||
                  (rule.display_name && rule.display_name.toLowerCase().includes(colorSearch.toLowerCase()))
                )
                .map((rule) => (
                <Table.Tr key={rule.id || rule.reception_name}>
                  <Table.Td>
                    <ColorSwatch color={rule.hex_value} size={24} />
                  </Table.Td>
                  <Table.Td>{rule.reception_name}</Table.Td>
                  <Table.Td>
                    {rule.display_name ? (
                      <Badge variant="light" color="blue">{rule.display_name}</Badge>
                    ) : (
                      <Text size="sm" c="dimmed">—</Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <ActionIcon
                        variant="subtle"
                        color="blue"
                        onClick={() => {
                          setEditingColor(rule);
                          openColorModal();
                        }}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        onClick={() => rule.id && deleteColorRule(rule.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed" ta="center" py="xl">
            Aucune règle de couleur définie.
          </Text>
        )}
      </Paper>

      <Modal
        opened={colorModalOpened}
        onClose={closeColorModal}
        title={editingColor?.id ? 'Modifier la couleur' : 'Ajouter une couleur'}
      >
        {editingColor && (
          <Stack>
            <TextInput
              label="Nom de réception"
              description="Le nom de la couleur tel qu'il arrive de Shopify (ex: Bleu Marine)"
              placeholder="ex: Bleu Marine, Rouge Bordeaux"
              value={editingColor.reception_name}
              onChange={(e) => setEditingColor({ ...editingColor, reception_name: e.target.value })}
              required
            />
            <TextInput
              label="Nom sur Ivy"
              description="Le nom à afficher dans l'application (laisser vide pour garder le nom de réception)"
              placeholder="ex: French Navy, Burgundy"
              value={editingColor.display_name || ''}
              onChange={(e) => setEditingColor({ ...editingColor, display_name: e.target.value || null })}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>Couleur associée</Text>
              <Text size="xs" c="dimmed" mb="xs">Code hexadécimal pour l'affichage visuel</Text>
              <Group align="flex-start">
                <TextInput
                  placeholder="#FF0000"
                  value={editingColor.hex_value}
                  onChange={(e) => setEditingColor({ ...editingColor, hex_value: e.target.value })}
                  style={{ flex: 1 }}
                />
                <Popover position="bottom" withArrow shadow="md">
                  <Popover.Target>
                    <ActionIcon 
                      variant="light" 
                      size={36}
                      style={{ backgroundColor: editingColor.hex_value, border: '2px solid #ddd' }}
                    >
                      <span />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <ColorPicker
                      format="hex"
                      value={editingColor.hex_value}
                      onChange={(color) => setEditingColor({ ...editingColor, hex_value: color })}
                      swatches={[
                        '#ffffff', '#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da', '#adb5bd', '#868e96', '#495057', '#343a40', '#212529',
                        '#000000', '#c92a2a', '#a61e4d', '#862e9c', '#5f3dc4', '#364fc7', '#1864ab', '#0b7285', '#087f5b', '#2b8a3e',
                        '#5c940d', '#e67700', '#d9480f', '#f03e3e', '#d6336c', '#ae3ec9', '#7048e8', '#4263eb', '#1c7ed6', '#15aabf',
                        '#12b886', '#40c057', '#82c91e', '#fab005', '#fd7e14', '#ff6b6b', '#f06595', '#cc5de8', '#845ef7', '#5c7cfa',
                        '#339af0', '#22b8cf', '#20c997', '#51cf66', '#94d82d', '#fcc419', '#ff922b',
                      ]}
                    />
                  </Popover.Dropdown>
                </Popover>
              </Group>
            </div>
            <Group justify="flex-end" mt="md">
              <Button variant="subtle" onClick={closeColorModal}>Annuler</Button>
              <Button 
                onClick={() => saveColorRule(editingColor)}
                loading={saving}
                disabled={!editingColor.reception_name.trim()}
              >
                Sauvegarder
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}
