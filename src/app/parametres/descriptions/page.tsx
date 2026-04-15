'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Title, Text, Paper, Stack, Group, Button, Modal, TextInput, Switch,
  ActionIcon, Card, Badge, Select, Loader, Center,
} from '@mantine/core';
import { RichTextEditor, Link } from '@mantine/tiptap';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TipTapLink from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { IconPlus, IconTrash, IconEdit, IconPlayerPlay, IconCopy } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';

interface Condition {
  field: 'title' | 'product_type';
  operator: 'contains';
  value: string;
}

interface ProductDescription {
  id: string;
  name: string;
  description_html: string;
  conditions: Condition[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function DescriptionsPage() {
  const { currentShop } = useShop();
  const { streamFromUrl, log: terminalLog, endSync } = useTerminalStream();
  const [descriptions, setDescriptions] = useState<ProductDescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDesc, setEditingDesc] = useState<ProductDescription | null>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formConditions, setFormConditions] = useState<Condition[]>([]);
  const [formIsActive, setFormIsActive] = useState(true);

  // New condition form
  const [newCondField, setNewCondField] = useState<'title' | 'product_type'>('title');
  const [newCondValue, setNewCondValue] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TipTapLink.configure({ openOnClick: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '',
  });

  const fetchData = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/settings/product-descriptions?shopId=${currentShop.id}`);
      if (res.ok) {
        const data = await res.json();
        setDescriptions(data.descriptions || []);
      }
    } catch (err) {
      console.error('Error fetching descriptions:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreateModal = () => {
    setEditingDesc(null);
    setFormName('');
    setFormConditions([]);
    setFormIsActive(true);
    editor?.commands.setContent('');
    setModalOpen(true);
  };

  const openEditModal = (desc: ProductDescription) => {
    setEditingDesc(desc);
    setFormName(desc.name);
    setFormConditions([...desc.conditions]);
    setFormIsActive(desc.is_active);
    editor?.commands.setContent(desc.description_html || '');
    setModalOpen(true);
  };

  const addCondition = () => {
    if (!newCondValue.trim()) return;
    setFormConditions([...formConditions, {
      field: newCondField,
      operator: 'contains',
      value: newCondValue.trim(),
    }]);
    setNewCondValue('');
  };

  const removeCondition = (index: number) => {
    setFormConditions(formConditions.filter((_, i) => i !== index));
  };

  const saveDescription = async () => {
    if (!currentShop || !formName.trim()) {
      notifications.show({ title: 'Erreur', message: 'Le nom est obligatoire', color: 'red' });
      return;
    }

    if (formConditions.length === 0) {
      notifications.show({ title: 'Erreur', message: 'Ajoutez au moins une condition', color: 'red' });
      return;
    }

    setSaving(true);
    try {
      const url = '/api/settings/product-descriptions';
      const method = editingDesc ? 'PUT' : 'POST';
      const body = editingDesc
        ? {
            id: editingDesc.id,
            name: formName.trim(),
            descriptionHtml: editor?.getHTML() || '',
            conditions: formConditions,
            isActive: formIsActive,
          }
        : {
            shopId: currentShop.id,
            name: formName.trim(),
            descriptionHtml: editor?.getHTML() || '',
            conditions: formConditions,
            isActive: formIsActive,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        notifications.show({
          title: 'Succès',
          message: editingDesc ? 'Description modifiée' : 'Description créée',
          color: 'green',
        });
        setModalOpen(false);
        fetchData();
      } else {
        const err = await res.json();
        notifications.show({ title: 'Erreur', message: err.error || 'Erreur', color: 'red' });
      }
    } catch {
      notifications.show({ title: 'Erreur', message: 'Erreur réseau', color: 'red' });
    } finally {
      setSaving(false);
    }
  };

  const deleteDescription = async (id: string) => {
    if (!confirm('Supprimer cette description ?')) return;

    const res = await fetch(`/api/settings/product-descriptions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      notifications.show({ title: 'Supprimé', message: 'Description supprimée', color: 'green' });
      fetchData();
    }
  };

  const toggleActive = async (desc: ProductDescription) => {
    await fetch('/api/settings/product-descriptions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: desc.id, isActive: !desc.is_active }),
    });
    fetchData();
  };

  const applyDescription = async (desc: ProductDescription) => {
    if (!currentShop) return;
    setApplying(desc.id);

    let cursor: string | null = null;
    let offset = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let chunk = 0;

    do {
      const params = new URLSearchParams({
        shopId: currentShop.id,
        descriptionId: desc.id,
      });
      if (cursor) params.set('cursor', cursor);
      if (offset > 0) params.set('offset', offset.toString());

      let nextCursor: string | null = null;

      await streamFromUrl(`/api/settings/product-descriptions/apply-stream?${params}`, {
        title: chunk === 0 ? `Description: ${desc.name}` : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          nextCursor = (data?.nextCursor as string) || null;
          offset = (data?.offset as number) || offset;
          totalUpdated += (data?.updatedCount as number) || 0;
          totalSkipped += (data?.skippedCount as number) || 0;
          totalErrors += (data?.errorCount as number) || 0;
        },
      });

      cursor = nextCursor;
      chunk++;
    } while (cursor);

    terminalLog('', 'info');
    terminalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    terminalLog(`✅ Terminé: ${totalUpdated} mis à jour, ${totalSkipped} déjà identique(s), ${totalErrors} erreur(s)`, 'success');
    endSync();

    fetchData();
    setApplying(null);
  };

  const duplicateDescription = (desc: ProductDescription) => {
    setEditingDesc(null);
    setFormName(`${desc.name} (copie)`);
    setFormConditions([...desc.conditions]);
    setFormIsActive(desc.is_active);
    editor?.commands.setContent(desc.description_html || '');
    setModalOpen(true);
  };

  if (loading) {
    return <Center h={400}><Loader size="lg" /></Center>;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Descriptions produits</Title>
          <Text c="dimmed" size="sm">Créez des modèles de description et appliquez-les en masse sur Shopify</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
          Nouvelle description
        </Button>
      </Group>

      {descriptions.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="sm">
              <Text c="dimmed">Aucune description créée</Text>
              <Text c="dimmed" size="sm">Créez un modèle de description pour l'appliquer à vos produits Shopify.</Text>
            </Stack>
          </Center>
        </Paper>
      ) : (
        <Stack gap="md">
          {descriptions.map(desc => (
            <Card key={desc.id} withBorder padding="lg" radius="md">
              <Group justify="space-between" mb="sm">
                <Group gap="sm">
                  <Switch
                    checked={desc.is_active}
                    onChange={() => toggleActive(desc)}
                    color="green"
                    size="sm"
                  />
                  <Text fw={600} size="lg">{desc.name}</Text>
                </Group>
                <Group gap="xs">
                  {desc.conditions.map((c, i) => (
                    <Badge key={i} variant="light" color={c.field === 'title' ? 'blue' : 'orange'} size="sm">
                      {c.field === 'title' ? 'Nom' : 'Type'} contient "{c.value}"
                    </Badge>
                  ))}
                </Group>
              </Group>

              {desc.description_html && (
                <Paper withBorder p="sm" radius="sm" mb="sm" bg="gray.0">
                  <div
                    style={{ fontSize: '0.85rem', maxHeight: 100, overflow: 'hidden' }}
                    dangerouslySetInnerHTML={{ __html: desc.description_html }}
                  />
                </Paper>
              )}

              <Group justify="space-between">
                <Group gap="xs">
                  <ActionIcon variant="light" color="blue" onClick={() => openEditModal(desc)}>
                    <IconEdit size={16} />
                  </ActionIcon>
                  <ActionIcon variant="light" color="gray" onClick={() => duplicateDescription(desc)}>
                    <IconCopy size={16} />
                  </ActionIcon>
                  <ActionIcon variant="light" color="red" onClick={() => deleteDescription(desc.id)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
                <Button
                  leftSection={applying === desc.id ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
                  color="green"
                  onClick={() => applyDescription(desc)}
                  loading={applying === desc.id}
                  disabled={!desc.is_active}
                >
                  Appliquer sur Shopify
                </Button>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingDesc ? 'Modifier la description' : 'Nouvelle description'}
        size="xl"
      >
        <Stack gap="md">
          <TextInput
            label="Nom de la règle"
            placeholder="Ex: Description T-shirts Morrigan"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />

          {/* Conditions */}
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="sm">Conditions (toutes doivent correspondre)</Text>

            {formConditions.length > 0 && (
              <Stack gap="xs" mb="md">
                {formConditions.map((cond, i) => (
                  <Group key={i} gap="xs">
                    <Badge variant="light" color={cond.field === 'title' ? 'blue' : 'orange'}>
                      {cond.field === 'title' ? 'Nom' : 'Type'}
                    </Badge>
                    <Text size="sm">contient</Text>
                    <Badge variant="outline">"{cond.value}"</Badge>
                    <ActionIcon variant="subtle" color="red" size="sm" onClick={() => removeCondition(i)}>
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}

            <Group gap="xs" align="flex-end">
              <Select
                label="Champ"
                data={[
                  { value: 'title', label: 'Nom du produit' },
                  { value: 'product_type', label: 'Type de produit' },
                ]}
                value={newCondField}
                onChange={(v) => setNewCondField((v as 'title' | 'product_type') || 'title')}
                style={{ width: 180 }}
              />
              <TextInput
                label="Contient"
                placeholder="Ex: Morrigan, T-shirt..."
                value={newCondValue}
                onChange={(e) => setNewCondValue(e.target.value)}
                style={{ flex: 1 }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCondition(); } }}
              />
              <Button variant="light" onClick={addCondition} disabled={!newCondValue.trim()}>
                Ajouter
              </Button>
            </Group>
          </Paper>

          {/* Rich Text Editor */}
          <div>
            <Text fw={600} mb="xs">Description HTML</Text>
            <RichTextEditor editor={editor}>
              <RichTextEditor.Toolbar sticky stickyOffset={60}>
                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.Bold />
                  <RichTextEditor.Italic />
                  <RichTextEditor.Underline />
                  <RichTextEditor.Strikethrough />
                </RichTextEditor.ControlsGroup>

                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.H2 />
                  <RichTextEditor.H3 />
                  <RichTextEditor.H4 />
                </RichTextEditor.ControlsGroup>

                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.BulletList />
                  <RichTextEditor.OrderedList />
                </RichTextEditor.ControlsGroup>

                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.Link />
                  <RichTextEditor.Unlink />
                </RichTextEditor.ControlsGroup>

                <RichTextEditor.ControlsGroup>
                  <RichTextEditor.AlignLeft />
                  <RichTextEditor.AlignCenter />
                </RichTextEditor.ControlsGroup>
              </RichTextEditor.Toolbar>

              <RichTextEditor.Content />
            </RichTextEditor>
          </div>

          <Switch
            label="Règle active"
            checked={formIsActive}
            onChange={(e) => setFormIsActive(e.currentTarget.checked)}
          />

          <Group justify="flex-end" gap="sm">
            <Button variant="subtle" onClick={() => setModalOpen(false)}>Annuler</Button>
            <Button onClick={saveDescription} loading={saving}>
              {editingDesc ? 'Mettre à jour' : 'Créer'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
