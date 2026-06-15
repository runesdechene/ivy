'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Stack, Group, Modal, TextInput, Switch,
  Select, Loader,
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
import styles from '../parametres.module.scss';

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
    // Next.js App Router + React 19 : sans ce flag, l'éditeur est rendu côté
    // serveur → mismatch d'hydratation → ProseMirror devient non éditable.
    immediatelyRender: false,
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
      notifications.show({ title: 'Erreur', message: 'Le nom est obligatoire', color: 'rust' });
      return;
    }

    if (formConditions.length === 0) {
      notifications.show({ title: 'Erreur', message: 'Ajoutez au moins une condition', color: 'rust' });
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
          title: 'Enregistré',
          message: editingDesc ? 'Description modifiée' : 'Description créée',
          color: 'moss',
        });
        setModalOpen(false);
        fetchData();
      } else {
        const err = await res.json();
        notifications.show({ title: 'Erreur', message: err.error || 'Erreur', color: 'rust' });
      }
    } catch {
      notifications.show({ title: 'Erreur', message: 'Erreur réseau', color: 'rust' });
    } finally {
      setSaving(false);
    }
  };

  const deleteDescription = async (id: string) => {
    if (!confirm('Supprimer cette description ?')) return;

    const res = await fetch(`/api/settings/product-descriptions?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      notifications.show({ title: 'Supprimé', message: 'Description supprimée', color: 'moss' });
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
    terminalLog(`Terminé: ${totalUpdated} mis à jour, ${totalSkipped} déjà identique(s), ${totalErrors} erreur(s)`, 'success');
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

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return <div className={styles.loadingWrap}><Loader size="lg" /></div>;
  }

  // Render the HTML preview safely - this is admin-created content from
  // the rich text editor, not user-submitted data.
  const renderDescPreview = (html: string) => {
    return { __html: html };
  };

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Paramètres · {shopName}</div>
          <h1 className={styles.title}>
            Descriptions <em>produits</em>
          </h1>
          <div className={styles.sub}>
            Créez des modèles de description et appliquez-les en masse sur Shopify
          </div>
        </div>
        <button className={styles.primaryButton} onClick={openCreateModal}>
          <IconPlus size={14} />
          Nouvelle description
        </button>
      </div>

      {descriptions.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyStateText}>Aucune description créée</p>
          <p className={styles.emptyStateHint}>
            Créez un modèle de description pour l&apos;appliquer à vos produits Shopify.
          </p>
        </div>
      ) : (
        <Stack gap="md">
          {descriptions.map(desc => (
            <div key={desc.id} className={styles.descCard}>
              <div className={styles.descCardHead}>
                <Group gap="sm">
                  <Switch
                    checked={desc.is_active}
                    onChange={() => toggleActive(desc)}
                    color="moss"
                    size="sm"
                    styles={{
                      track: desc.is_active ? { backgroundColor: 'var(--moss)', borderColor: 'var(--moss)' } : {},
                    }}
                  />
                  <span className={styles.descCardName}>{desc.name}</span>
                </Group>
                <Group gap="xs">
                  {desc.conditions.map((c, i) => (
                    <span key={i} className={styles.badge + ' ' + (c.field === 'title' ? styles.badge_plum : styles.badge_clay)}>
                      {c.field === 'title' ? 'Nom' : 'Type'} contient &ldquo;{c.value}&rdquo;
                    </span>
                  ))}
                </Group>
              </div>

              {desc.description_html && (
                <div
                  className={styles.descPreview}
                  dangerouslySetInnerHTML={renderDescPreview(desc.description_html)}
                />
              )}

              <Group justify="space-between">
                <Group gap="xs">
                  <button className={styles.iconButton} onClick={() => openEditModal(desc)}>
                    <IconEdit size={16} />
                  </button>
                  <button className={styles.iconButton} onClick={() => duplicateDescription(desc)}>
                    <IconCopy size={16} />
                  </button>
                  <button className={`${styles.iconButton} ${styles.iconButton_danger}`} onClick={() => deleteDescription(desc.id)}>
                    <IconTrash size={16} />
                  </button>
                </Group>
                <button
                  className={styles.mossButton}
                  onClick={() => applyDescription(desc)}
                  disabled={applying === desc.id || !desc.is_active}
                >
                  {applying === desc.id ? <Loader size={14} color="var(--cream)" /> : <IconPlayerPlay size={16} />}
                  Appliquer sur Shopify
                </button>
              </Group>
            </div>
          ))}
        </Stack>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={<span className={styles.modalTitle}>{editingDesc ? 'Modifier la description' : 'Nouvelle description'}</span>}
        size="xl"
        styles={{
          content: { backgroundColor: 'var(--cream-soft)' },
          header: { backgroundColor: 'var(--cream-soft)' },
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Nom de la règle"
            placeholder="Ex: Description T-shirts Morrigan"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
            }}
          />

          {/* Conditions */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardHeadTitle}>Conditions (toutes doivent correspondre)</h3>
            </div>
            <div className={styles.cardBody}>
              {formConditions.length > 0 && (
                <Stack gap="xs" mb="md">
                  {formConditions.map((cond, i) => (
                    <Group key={i} gap="xs">
                      <span className={styles.badge + ' ' + (cond.field === 'title' ? styles.badge_plum : styles.badge_clay)}>
                        {cond.field === 'title' ? 'Nom' : 'Type'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--slate-soft)' }}>contient</span>
                      <span className={styles.badge + ' ' + styles.badge_slate}>&ldquo;{cond.value}&rdquo;</span>
                      <button
                        className={`${styles.iconButton} ${styles.iconButton_danger}`}
                        style={{ width: 24, height: 24 }}
                        onClick={() => removeCondition(i)}
                      >
                        <IconTrash size={14} />
                      </button>
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
                  styles={{
                    input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                  }}
                />
                <TextInput
                  label="Contient"
                  placeholder="Ex: Morrigan, T-shirt..."
                  value={newCondValue}
                  onChange={(e) => setNewCondValue(e.target.value)}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCondition(); } }}
                  styles={{
                    input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                  }}
                />
                <button className={styles.ghostButton} onClick={addCondition} disabled={!newCondValue.trim()}>
                  Ajouter
                </button>
              </Group>
            </div>
          </div>

          {/* Rich Text Editor */}
          <div>
            <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--slate)', display: 'block', marginBottom: 8 }}>
              Description HTML
            </label>
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
            styles={{
              track: formIsActive ? { backgroundColor: 'var(--moss)', borderColor: 'var(--moss)' } : {},
            }}
          />

          <div className={styles.modalActions}>
            <button className={styles.ghostButton} onClick={() => setModalOpen(false)}>Annuler</button>
            <button className={styles.primaryButton} onClick={saveDescription} disabled={saving}>
              {editingDesc ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}
