'use client';

import { useState, useEffect } from 'react';
import {
  Title,
  Text,
  Card,
  Button,
  Group,
  Stack,
  TextInput,
  Modal,
  ActionIcon,
  Badge,
  Loader,
  Center,
  Alert,
  Avatar,
  Switch,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconPencil, IconTrash, IconUser } from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Seller {
  id: string;
  shop_id: string;
  name: string;
  initials: string | null;
  color: string | null;
  is_active: boolean;
  created_at: string;
}

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF69B4', '#32CD32', '#FF8C00',
];

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function VendeursPage() {
  const { currentShop } = useShop();
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSeller, setEditingSeller] = useState<Seller | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formInitials, setFormInitials] = useState('');
  const [formColor, setFormColor] = useState(COLORS[0]);
  const [formIsActive, setFormIsActive] = useState(true);

  // Load sellers
  useEffect(() => {
    if (!currentShop?.id) return;

    const loadSellers = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('pos_sellers')
        .select('*')
        .eq('shop_id', currentShop.id)
        .order('name');

      if (error) {
        console.error('Error loading sellers:', error);
        notifications.show({
          title: 'Erreur',
          message: 'Impossible de charger les vendeurs',
          color: 'red',
        });
      } else {
        setSellers(data || []);
      }
      setLoading(false);
    };

    loadSellers();
  }, [currentShop?.id]);

  const openCreateModal = () => {
    setEditingSeller(null);
    setFormName('');
    setFormInitials('');
    setFormColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
    setFormIsActive(true);
    setModalOpen(true);
  };

  const openEditModal = (seller: Seller) => {
    setEditingSeller(seller);
    setFormName(seller.name);
    setFormInitials(seller.initials || getInitials(seller.name));
    setFormColor(seller.color || COLORS[0]);
    setFormIsActive(seller.is_active);
    setModalOpen(true);
  };

  const handleNameChange = (name: string) => {
    setFormName(name);
    if (!editingSeller) {
      setFormInitials(getInitials(name));
    }
  };

  const handleSave = async () => {
    if (!currentShop?.id || !formName.trim()) {
      notifications.show({
        title: 'Erreur',
        message: 'Le nom est requis',
        color: 'red',
      });
      return;
    }

    setSaving(true);
    try {
      const initials = formInitials.trim() || getInitials(formName);

      if (editingSeller) {
        // Update
        const { error } = await supabase
          .from('pos_sellers')
          .update({
            name: formName.trim(),
            initials,
            color: formColor,
            is_active: formIsActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingSeller.id);

        if (error) throw error;

        setSellers(prev => prev.map(s => 
          s.id === editingSeller.id 
            ? { ...s, name: formName.trim(), initials, color: formColor, is_active: formIsActive }
            : s
        ));

        notifications.show({
          title: 'Succès',
          message: 'Vendeur mis à jour',
          color: 'green',
        });
      } else {
        // Create
        const { data, error } = await supabase
          .from('pos_sellers')
          .insert({
            shop_id: currentShop.id,
            name: formName.trim(),
            initials,
            color: formColor,
            is_active: formIsActive,
          })
          .select()
          .single();

        if (error) throw error;

        setSellers(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));

        notifications.show({
          title: 'Succès',
          message: 'Vendeur créé',
          color: 'green',
        });
      }

      setModalOpen(false);
    } catch (error) {
      console.error('Error saving seller:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder le vendeur',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (seller: Seller) => {
    if (!confirm(`Supprimer le vendeur "${seller.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from('pos_sellers')
        .delete()
        .eq('id', seller.id);

      if (error) throw error;

      setSellers(prev => prev.filter(s => s.id !== seller.id));

      notifications.show({
        title: 'Succès',
        message: 'Vendeur supprimé',
        color: 'green',
      });
    } catch (error) {
      console.error('Error deleting seller:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer le vendeur',
        color: 'red',
      });
    }
  };

  const toggleActive = async (seller: Seller) => {
    try {
      const { error } = await supabase
        .from('pos_sellers')
        .update({ is_active: !seller.is_active })
        .eq('id', seller.id);

      if (error) throw error;

      setSellers(prev => prev.map(s => 
        s.id === seller.id ? { ...s, is_active: !s.is_active } : s
      ));
    } catch (error) {
      console.error('Error toggling seller:', error);
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
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <div>
          <Title order={2}>Vendeurs</Title>
          <Text c="dimmed" size="sm">
            Gérez les vendeurs pour attribuer les ventes en caisse
          </Text>
        </div>
        <Button 
          leftSection={<IconPlus size={16} />}
          onClick={openCreateModal}
        >
          Nouveau vendeur
        </Button>
      </Group>

      {sellers.length === 0 ? (
        <Alert color="blue" title="Aucun vendeur">
          Créez votre premier vendeur pour pouvoir attribuer les ventes en caisse.
        </Alert>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', 
          gap: '1rem' 
        }}>
          {sellers.map(seller => (
            <Card key={seller.id} withBorder padding="md">
              <Group justify="space-between" align="flex-start">
                <Group gap="md">
                  <Avatar 
                    size="lg" 
                    radius="xl"
                    color={seller.color || 'blue'}
                    style={{ backgroundColor: seller.color || undefined }}
                  >
                    {seller.initials || getInitials(seller.name)}
                  </Avatar>
                  <div>
                    <Group gap="xs">
                      <Text fw={600}>{seller.name}</Text>
                      <Badge 
                        color={seller.is_active ? 'green' : 'gray'} 
                        size="xs"
                        variant="light"
                      >
                        {seller.is_active ? 'Actif' : 'Inactif'}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Initiales : {seller.initials || getInitials(seller.name)}
                    </Text>
                  </div>
                </Group>
                <Group gap="xs">
                  <Switch
                    checked={seller.is_active}
                    onChange={() => toggleActive(seller)}
                    size="sm"
                  />
                  <ActionIcon 
                    variant="subtle" 
                    color="blue"
                    onClick={() => openEditModal(seller)}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon 
                    variant="subtle" 
                    color="red"
                    onClick={() => handleDelete(seller)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingSeller ? 'Modifier le vendeur' : 'Nouveau vendeur'}
        size="md"
      >
        <Stack gap="md">
          <TextInput
            label="Nom"
            placeholder="Ex: Jean Dupont"
            value={formName}
            onChange={(e) => handleNameChange(e.target.value)}
            required
          />

          <TextInput
            label="Initiales"
            placeholder="Ex: JD"
            value={formInitials}
            onChange={(e) => setFormInitials(e.target.value.toUpperCase().slice(0, 2))}
            maxLength={2}
          />

          <div>
            <Text size="sm" fw={500} mb="xs">Couleur</Text>
            <Group gap="xs">
              {COLORS.map(color => (
                <ActionIcon
                  key={color}
                  size="lg"
                  radius="xl"
                  style={{ 
                    backgroundColor: color,
                    border: formColor === color ? '3px solid var(--mantine-color-dark-9)' : 'none',
                  }}
                  onClick={() => setFormColor(color)}
                />
              ))}
            </Group>
          </div>

          <Switch
            label="Vendeur actif"
            checked={formIsActive}
            onChange={(e) => setFormIsActive(e.currentTarget.checked)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingSeller ? 'Mettre à jour' : 'Créer'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
