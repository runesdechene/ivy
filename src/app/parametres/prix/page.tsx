'use client';

import { useState, useEffect, useCallback, ReactNode } from 'react';
import {
  Stack, TextInput, Group,
  Loader, Modal, NumberInput, Select,
  Accordion, Switch, Tooltip
} from '@mantine/core';
import { IconPlus, IconTrash, IconEdit, IconPlayerPlay, IconDownload, IconCopy, IconGripVertical } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import styles from '../parametres.module.scss';

function SortableItem({ id, children }: { id: string; children: (dragHandleProps: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

interface Modifier {
  id?: string;
  namespace: string;
  key: string;
  value: string;
  amount: number;
  metafield_namespace?: string;
  metafield_key?: string;
  metafield_value?: string;
  modifier_amount?: number;
}

interface OptionModifier {
  id?: string;
  optionName: string;
  optionValue: string;
  amount: number;
  option_name?: string;
  option_value?: string;
  modifier_amount?: number;
}

interface PriceRule {
  id?: string;
  title: string | null;
  sku: string;
  base_price: number;
  description: string | null;
  product_type: string | null;
  is_active: boolean;
  local_only: boolean;
  last_applied_at: string | null;
  modifiers: Modifier[];
  option_modifiers: OptionModifier[];
}

interface MetafieldConfig {
  id: string;
  namespace: string;
  key: string;
  display_name: string;
}

export default function PriceRulesPage() {
  const { currentShop } = useShop();
  const { streamFromUrl, endSync, log: terminalLog } = useTerminalStream();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyingLocal, setApplyingLocal] = useState<string | null>(null);
  const [applyingIvy, setApplyingIvy] = useState<string | null>(null);
  const [applyingAllShopify, setApplyingAllShopify] = useState(false);
  const [applyingAllLocal, setApplyingAllLocal] = useState(false);
  const [applyingAllIvy, setApplyingAllIvy] = useState(false);
  const [applyingStock, setApplyingStock] = useState<string | null>(null);
  const [applyingAllStock, setApplyingAllStock] = useState(false);

  const [rules, setRules] = useState<PriceRule[]>([]);
  const [metafields, setMetafields] = useState<MetafieldConfig[]>([]);
  const [editingRule, setEditingRule] = useState<PriceRule | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formBasePrice, setFormBasePrice] = useState<number>(0);
  const [formDescription, setFormDescription] = useState('');
  const [formProductType, setFormProductType] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formLocalOnly, setFormLocalOnly] = useState(false);
  const [formModifiers, setFormModifiers] = useState<Modifier[]>([]);
  const [formOptionModifiers, setFormOptionModifiers] = useState<OptionModifier[]>([]);

  // New modifier form state
  const [newModifierNamespace, setNewModifierNamespace] = useState('');
  const [newModifierKey, setNewModifierKey] = useState('');
  const [newModifierValue, setNewModifierValue] = useState('');
  const [newModifierAmount, setNewModifierAmount] = useState<number>(0);

  // New option modifier form state
  const [newOptionName, setNewOptionName] = useState('');
  const [newOptionValue, setNewOptionValue] = useState('');
  const [newOptionAmount, setNewOptionAmount] = useState<number>(0);

  const fetchData = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      const [rulesRes, metafieldsRes] = await Promise.all([
        fetch(`/api/settings/price-rules?shopId=${currentShop.id}`),
        fetch(`/api/settings/metafields?shopId=${currentShop.id}`),
      ]);

      if (rulesRes.ok) {
        const data = await rulesRes.json();
        setRules(data.rules || []);
      }

      if (metafieldsRes.ok) {
        const data = await metafieldsRes.json();
        setMetafields(data.metafields || []);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const resetForm = () => {
    setFormTitle('');
    setFormBasePrice(0);
    setFormDescription('');
    setFormProductType('');
    setFormSku('');
    setFormLocalOnly(false);
    setFormModifiers([]);
    setFormOptionModifiers([]);
    setNewModifierNamespace('');
    setNewModifierKey('');
    setNewModifierValue('');
    setNewModifierAmount(0);
    setNewOptionName('');
    setNewOptionValue('');
    setNewOptionAmount(0);
  };

  const openCreateModal = () => {
    setEditingRule(null);
    resetForm();
    openModal();
  };

  const openEditModal = (rule: PriceRule) => {
    setEditingRule(rule);
    setFormTitle(rule.title || '');
    setFormBasePrice(rule.base_price);
    setFormDescription(rule.description || '');
    setFormProductType(rule.product_type || '');
    setFormSku(rule.sku || '');
    setFormLocalOnly(rule.local_only || false);
    setFormModifiers(rule.modifiers.map(m => ({
      namespace: m.metafield_namespace ?? m.namespace,
      key: m.metafield_key ?? m.key,
      value: m.metafield_value ?? m.value,
      amount: m.modifier_amount ?? m.amount ?? 0,
    })));
    setFormOptionModifiers((rule.option_modifiers || []).map(m => ({
      optionName: m.option_name ?? m.optionName,
      optionValue: m.option_value ?? m.optionValue,
      amount: m.modifier_amount ?? m.amount ?? 0,
    })));
    openModal();
  };

  const duplicateRule = (rule: PriceRule) => {
    setEditingRule(null);
    setFormTitle(rule.title ? `${rule.title} (copie)` : '');
    setFormBasePrice(rule.base_price);
    setFormDescription(rule.description || '');
    setFormProductType(rule.product_type || '');
    setFormSku('');
    setFormLocalOnly(rule.local_only || false);
    setFormModifiers(rule.modifiers.map(m => ({
      namespace: m.metafield_namespace ?? m.namespace,
      key: m.metafield_key ?? m.key,
      value: m.metafield_value ?? m.value,
      amount: m.modifier_amount ?? m.amount ?? 0,
    })));
    setFormOptionModifiers((rule.option_modifiers || []).map(m => ({
      optionName: m.option_name ?? m.optionName,
      optionValue: m.option_value ?? m.optionValue,
      amount: m.modifier_amount ?? m.amount ?? 0,
    })));
    openModal();
  };

  const addModifier = () => {
    if (!newModifierNamespace || !newModifierKey || !newModifierValue) {
      notifications.show({
        title: 'Erreur',
        message: 'Veuillez remplir tous les champs du modificateur',
        color: 'rust',
      });
      return;
    }

    setFormModifiers([...formModifiers, {
      namespace: newModifierNamespace,
      key: newModifierKey,
      value: newModifierValue,
      amount: newModifierAmount,
    }]);

    setNewModifierValue('');
    setNewModifierAmount(0);
  };

  const removeModifier = (index: number) => {
    setFormModifiers(formModifiers.filter((_, i) => i !== index));
  };

  // Drag-and-drop state for modifier reordering
  const [dragModIdx, setDragModIdx] = useState<number | null>(null);
  const [dragOverModIdx, setDragOverModIdx] = useState<number | null>(null);

  const handleModDrop = (targetIdx: number, list: 'meta' | 'option') => {
    if (dragModIdx === null || dragModIdx === targetIdx) {
      setDragModIdx(null);
      setDragOverModIdx(null);
      return;
    }
    if (list === 'meta') {
      const next = [...formModifiers];
      const [moved] = next.splice(dragModIdx, 1);
      next.splice(targetIdx, 0, moved);
      setFormModifiers(next);
    } else {
      const next = [...formOptionModifiers];
      const [moved] = next.splice(dragModIdx, 1);
      next.splice(targetIdx, 0, moved);
      setFormOptionModifiers(next);
    }
    setDragModIdx(null);
    setDragOverModIdx(null);
  };

  const addOptionModifier = () => {
    if (!newOptionName || !newOptionValue) {
      notifications.show({
        title: 'Erreur',
        message: 'Veuillez remplir le nom et la valeur de l\'option',
        color: 'rust',
      });
      return;
    }

    setFormOptionModifiers([...formOptionModifiers, {
      optionName: newOptionName,
      optionValue: newOptionValue,
      amount: newOptionAmount,
    }]);

    setNewOptionValue('');
    setNewOptionAmount(0);
  };

  const removeOptionModifier = (index: number) => {
    setFormOptionModifiers(formOptionModifiers.filter((_, i) => i !== index));
  };

  const saveRule = async () => {
    if (!currentShop || !formSku.trim()) {
      notifications.show({
        title: 'Erreur',
        message: 'Le SKU est obligatoire',
        color: 'rust',
      });
      return;
    }

    setSaving(true);
    try {
      const url = '/api/settings/price-rules';
      const method = editingRule ? 'PUT' : 'POST';
      const body = editingRule
        ? {
            id: editingRule.id,
            title: formTitle.trim() || null,
            sku: formSku.trim(),
            basePrice: formBasePrice,
            description: formDescription || null,
            productType: formProductType.trim() || null,
            localOnly: formLocalOnly,
            modifiers: formModifiers,
            optionModifiers: formOptionModifiers,
          }
        : {
            shopId: currentShop.id,
            title: formTitle.trim() || null,
            sku: formSku.trim(),
            basePrice: formBasePrice,
            description: formDescription || null,
            productType: formProductType.trim() || null,
            localOnly: formLocalOnly,
            modifiers: formModifiers,
            optionModifiers: formOptionModifiers,
          };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        notifications.show({
          title: 'Enregistré',
          message: editingRule ? 'Règle mise à jour' : 'Règle créée',
          color: 'moss',
        });
        closeModal();
        fetchData();
      } else {
        const error = await response.json();
        notifications.show({
          title: 'Erreur',
          message: error.error || 'Impossible de sauvegarder',
          color: 'rust',
        });
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder la règle',
        color: 'rust',
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Supprimer cette règle ?')) return;

    try {
      const response = await fetch(`/api/settings/price-rules?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        notifications.show({
          title: 'Supprimé',
          message: 'Règle supprimée',
          color: 'moss',
        });
        fetchData();
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer la règle',
        color: 'rust',
      });
    }
  };

  const applyRule = async (rule: PriceRule) => {
    if (!currentShop || !rule.id) return;

    setApplying(rule.id);

    const actions = rule.product_type ? [
      {
        label: `Importer dans l'inventaire les prix (${rule.product_type})`,
        color: 'green',
        icon: <IconDownload size={14} />,
        onClick: () => syncInventory(rule.product_type!),
      },
    ] : [
      {
        label: 'Importer dans l\'inventaire',
        color: 'green',
        icon: <IconDownload size={14} />,
        onClick: () => syncInventory(),
      },
    ];

    let cursor: string | null = null;
    let offset = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    let chunk = 0;

    do {
      const params = new URLSearchParams({
        shopId: currentShop.id,
        ruleId: rule.id,
      });
      if (cursor) params.set('cursor', cursor);
      if (offset > 0) params.set('offset', offset.toString());

      let nextCursor: string | null = null;

      await streamFromUrl(`/api/settings/price-rules/apply-stream?${params}`, {
        title: chunk === 0 ? `Appliquer sur Shopify: ${rule.sku}` : undefined,
        noStartSync: chunk > 0,
        noEndSync: true,
        onComplete: (data) => {
          nextCursor = (data?.nextCursor as string) || null;
          offset = (data?.offset as number) || offset;
          totalUpdated += (data?.updatedCount as number) || 0;
          totalErrors += (data?.errorCount as number) || 0;
        },
      });

      cursor = nextCursor;
      chunk++;
    } while (cursor);

    terminalLog('', 'info');
    terminalLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'info');
    terminalLog(`Total: ${totalUpdated} mise(s) à jour, ${totalErrors} erreur(s)`, 'success');
    endSync(actions);

    fetchData();
    setApplying(null);
  };

  const syncInventory = async (productType?: string) => {
    if (!currentShop) return;

    let url = `/api/inventory/sync-stream?shopId=${currentShop.id}`;
    let title = 'Import Inventaire';

    if (productType) {
      url += `&productType=${encodeURIComponent(productType)}`;
      title = `Import: ${productType}`;
    }

    await streamFromUrl(url, { title });
  };

  const applyRuleLocal = async (rule: PriceRule) => {
    if (!currentShop || !rule.id) return;

    setApplyingLocal(rule.id);

    await streamFromUrl(
      `/api/settings/price-rules/apply-local-stream?shopId=${currentShop.id}&ruleId=${rule.id}`,
      {
        title: `Appliquer aux commandes: ${rule.sku}`,
        onComplete: () => {
          fetchData();
          setApplyingLocal(null);
        },
      }
    );
  };

  const applyAllShopify = async () => {
    if (!currentShop) return;

    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'clay',
      });
      return;
    }

    setApplyingAllShopify(true);

    await streamFromUrl(
      `/api/settings/price-rules/apply-all-stream?shopId=${currentShop.id}&target=shopify`,
      {
        title: 'Appliquer toutes sur Shopify',
        onComplete: () => {
          fetchData();
          setApplyingAllShopify(false);
        },
        actions: [
          {
            label: 'Importer dans l\'inventaire',
            color: 'green',
            icon: <IconDownload size={14} />,
            onClick: () => syncInventory(),
          },
        ],
      }
    );
  };

  const applyAllLocal = async () => {
    if (!currentShop) return;

    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'clay',
      });
      return;
    }

    setApplyingAllLocal(true);

    await streamFromUrl(
      `/api/settings/price-rules/apply-all-stream?shopId=${currentShop.id}&target=local`,
      {
        title: 'Appliquer aux commandes',
        onComplete: () => {
          fetchData();
          setApplyingAllLocal(false);
        },
      }
    );
  };

  const applyRuleIvy = async (rule: PriceRule) => {
    if (!currentShop || !rule.id) return;

    setApplyingIvy(rule.id);

    await streamFromUrl(
      `/api/settings/price-rules/apply-ivy-stream?shopId=${currentShop.id}&ruleId=${rule.id}`,
      {
        title: `Stocks locaux: ${rule.product_type || rule.sku}`,
        onComplete: () => {
          fetchData();
          setApplyingIvy(null);
        },
      }
    );
  };

  const applyRuleStock = async (rule: PriceRule) => {
    if (!currentShop || !rule.id) return;

    setApplyingStock(rule.id);

    await streamFromUrl(
      `/api/settings/price-rules/apply-stock-stream?shopId=${currentShop.id}&ruleId=${rule.id}`,
      {
        title: `Commandes de stock: ${rule.sku}`,
        onComplete: () => {
          fetchData();
          setApplyingStock(null);
        },
      }
    );
  };

  const applyAllStock = async () => {
    if (!currentShop) return;

    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'clay',
      });
      return;
    }

    setApplyingAllStock(true);

    for (const rule of activeRules) {
      await streamFromUrl(
        `/api/settings/price-rules/apply-stock-stream?shopId=${currentShop.id}&ruleId=${rule.id}`,
        {
          title: `Stock: ${rule.sku}`,
        }
      );
    }

    fetchData();
    setApplyingAllStock(false);
  };

  const applyAllIvy = async () => {
    if (!currentShop) return;

    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'clay',
      });
      return;
    }

    setApplyingAllIvy(true);

    await streamFromUrl(
      `/api/settings/price-rules/apply-all-stream?shopId=${currentShop.id}&target=ivy`,
      {
        title: 'Appliquer aux stocks locaux',
        onComplete: () => {
          fetchData();
          setApplyingAllIvy(false);
        },
      }
    );
  };

  const toggleRuleActive = async (rule: PriceRule) => {
    try {
      const response = await fetch('/api/settings/price-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: rule.id,
          isActive: !rule.is_active,
        }),
      });

      if (response.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Error toggling rule:', err);
    }
  };

  const getMetafieldLabel = (namespace: string, key: string) => {
    const config = metafields.find(m => m.namespace === namespace && m.key === key);
    return config?.display_name || `${namespace}.${key}`;
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rules.findIndex(r => r.id === active.id);
    const newIndex = rules.findIndex(r => r.id === over.id);
    const reordered = arrayMove(rules, oldIndex, newIndex);

    setRules(reordered);

    try {
      await fetch('/api/settings/price-rules/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map(r => r.id) }),
      });
    } catch {
      fetchData();
    }
  };

  // Metafield select options
  const metafieldOptions = metafields.map(m => ({
    value: `${m.namespace}|${m.key}`,
    label: m.display_name || `${m.namespace}.${m.key}`,
  }));

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Paramètres · {shopName}</div>
          <h1 className={styles.title}>
            Règles de <em>prix</em>
          </h1>
          <div className={styles.sub}>
            Définissez des règles de calcul de coût basées sur le SKU et les métachamps
          </div>
        </div>
        <button className={styles.primaryButton} onClick={openCreateModal}>
          <IconPlus size={14} />
          Nouvelle règle
        </button>
      </div>

      {/* Global apply bar */}
      {rules.filter(r => r.is_active).length > 0 && (
        <div className={styles.applyBar}>
          <div className={styles.applyBarInfo}>
            <div className={styles.applyBarTitle}>Appliquer toutes les règles actives</div>
            <div className={styles.applyBarSub}>
              {rules.filter(r => r.is_active).length} règle(s) active(s)
            </div>
          </div>
          <div className={styles.applyBarButtons}>
            <button
              className={styles.ghostButton}
              onClick={applyAllLocal}
              disabled={applyingAllLocal || applyingAllShopify || applyingAllIvy || applyingAllStock}
            >
              {applyingAllLocal ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
              Commandes
            </button>
            <button
              className={styles.ghostButton}
              onClick={applyAllStock}
              disabled={applyingAllStock || applyingAllShopify || applyingAllIvy || applyingAllLocal}
            >
              {applyingAllStock ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
              Batch
            </button>
            <button
              className={styles.ghostButton}
              onClick={applyAllIvy}
              disabled={applyingAllIvy || applyingAllLocal || applyingAllShopify || applyingAllStock}
            >
              {applyingAllIvy ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
              Stock
            </button>
            <button
              className={styles.mossButton}
              onClick={applyAllShopify}
              disabled={applyingAllShopify || applyingAllLocal || applyingAllIvy}
            >
              {applyingAllShopify ? <Loader size={14} color="var(--cream)" /> : <IconPlayerPlay size={14} />}
              Shopify
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyStateText}>Aucune règle de prix configurée</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rules.map(r => r.id!)} strategy={verticalListSortingStrategy}>
            <Accordion variant="separated" styles={{
              item: {
                backgroundColor: 'var(--cream-soft)',
                border: '1px solid var(--divider)',
                borderRadius: 14,
                '&[data-active]': { backgroundColor: 'var(--cream-soft)' },
              },
              control: {
                '&:hover': { backgroundColor: 'var(--cream-warm)' },
              },
              content: {
                backgroundColor: 'var(--cream-soft)',
              },
            }}>
              {rules.map((rule) => (
                <SortableItem key={rule.id} id={rule.id!}>
                  {(dragHandleProps) => (
                    <Accordion.Item value={rule.id || rule.sku}>
                      <Accordion.Control>
                        <Group justify="space-between" wrap="nowrap" style={{ flex: 1 }}>
                          <Group gap="sm">
                            <div
                              {...dragHandleProps}
                              onClick={(e: React.MouseEvent) => e.stopPropagation()}
                              className={styles.dragHandle}
                            >
                              <IconGripVertical size={18} />
                            </div>
                            <Switch
                              checked={rule.is_active}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleRuleActive(rule);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              styles={{
                                track: rule.is_active ? { backgroundColor: 'var(--moss)', borderColor: 'var(--moss)' } : {},
                              }}
                            />
                            <div>
                              <span style={{ fontWeight: 600, color: 'var(--slate)', fontSize: 14 }}>
                                {rule.title || rule.product_type || rule.sku}
                              </span>
                              {rule.product_type && (
                                <div style={{ fontSize: 12, color: 'var(--slate-muted)' }}>Type : {rule.product_type}</div>
                              )}
                              {rule.description && (
                                <div style={{ fontSize: 12, color: 'var(--slate-muted)' }}>{rule.description}</div>
                              )}
                            </div>
                          </Group>
                          <Group gap="xs">
                            <span className={styles.badge + ' ' + styles.badge_slate}>
                              Base: {rule.base_price.toFixed(2)} EUR
                            </span>
                            {rule.modifiers.length > 0 && (
                              <span className={styles.badge + ' ' + styles.badge_plum}>
                                +{rule.modifiers.length} métachamp(s)
                              </span>
                            )}
                            {(rule.option_modifiers || []).length > 0 && (
                              <span className={styles.badge + ' ' + styles.badge_clay}>
                                +{rule.option_modifiers.length} option(s)
                              </span>
                            )}
                            {rule.local_only && (
                              <span className={styles.badge + ' ' + styles.badge_sand}>
                                Local
                              </span>
                            )}
                          </Group>
                        </Group>
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="md">
                          {rule.modifiers.length > 0 && (
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th className={styles.th}>Métachamp</th>
                                  <th className={styles.th}>Valeur</th>
                                  <th className={styles.th + ' ' + styles.thRight}>Majoration</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rule.modifiers.map((mod, index) => {
                                  const amount = mod.modifier_amount || mod.amount;
                                  return (
                                    <tr key={index} className={styles.tr}>
                                      <td className={styles.td}>
                                        {getMetafieldLabel(
                                          mod.metafield_namespace || mod.namespace,
                                          mod.metafield_key || mod.key
                                        )}
                                      </td>
                                      <td className={styles.td}>
                                        <span className={styles.badge + ' ' + styles.badge_slate}>
                                          {mod.metafield_value || mod.value}
                                        </span>
                                      </td>
                                      <td className={`${styles.td} ${styles.tdRight}`}>
                                        <span className={amount >= 0 ? styles.amountPositive : styles.amountNegative}>
                                          {amount >= 0 ? '+' : ''}{amount.toFixed(2)} EUR
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}

                          {(rule.option_modifiers || []).length > 0 && (
                            <table className={styles.table}>
                              <thead>
                                <tr>
                                  <th className={styles.th}>Option</th>
                                  <th className={styles.th}>Valeur</th>
                                  <th className={styles.th + ' ' + styles.thRight}>Majoration</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rule.option_modifiers.map((mod, index) => {
                                  const amount = mod.modifier_amount || mod.amount;
                                  return (
                                    <tr key={index} className={styles.tr}>
                                      <td className={styles.td}>
                                        {mod.option_name || mod.optionName}
                                      </td>
                                      <td className={styles.td}>
                                        <span className={styles.badge + ' ' + styles.badge_clay}>
                                          {mod.option_value || mod.optionValue}
                                        </span>
                                      </td>
                                      <td className={`${styles.td} ${styles.tdRight}`}>
                                        <span className={amount >= 0 ? styles.amountPositive : styles.amountNegative}>
                                          {amount >= 0 ? '+' : ''}{amount.toFixed(2)} EUR
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}

                          <Group justify="space-between">
                            <Group gap="xs">
                              <button className={styles.iconButton} onClick={() => openEditModal(rule)}>
                                <IconEdit size={16} />
                              </button>
                              <button className={styles.iconButton} onClick={() => duplicateRule(rule)}>
                                <IconCopy size={16} />
                              </button>
                              <button
                                className={`${styles.iconButton} ${styles.iconButton_danger}`}
                                onClick={() => rule.id && deleteRule(rule.id)}
                              >
                                <IconTrash size={16} />
                              </button>
                            </Group>
                            <Group gap="xs">
                              {!rule.local_only && (
                                <Tooltip label="Met à jour les coûts dans les commandes Supabase">
                                  <button
                                    className={styles.ghostButton}
                                    onClick={() => applyRuleLocal(rule)}
                                    disabled={applyingLocal === rule.id || !rule.is_active}
                                  >
                                    {applyingLocal === rule.id ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
                                    Commandes
                                  </button>
                                </Tooltip>
                              )}
                              <Tooltip label="Met à jour les coûts dans les commandes de stock fournisseur (batch)">
                                <button
                                  className={styles.ghostButton}
                                  onClick={() => applyRuleStock(rule)}
                                  disabled={applyingStock === rule.id || !rule.is_active}
                                >
                                  {applyingStock === rule.id ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
                                  Batch
                                </button>
                              </Tooltip>
                              <Tooltip label="Met à jour le coût des variantes dans l'inventaire Ivy (Supabase)">
                                <button
                                  className={styles.ghostButton}
                                  onClick={() => applyRuleIvy(rule)}
                                  disabled={applyingIvy === rule.id || !rule.is_active}
                                >
                                  {applyingIvy === rule.id ? <Loader size={14} /> : <IconPlayerPlay size={14} />}
                                  Stock
                                </button>
                              </Tooltip>
                              {!rule.local_only && (
                                <Tooltip label="Appliquer sur Shopify (met à jour le coût des variantes)">
                                  <button
                                    className={styles.mossButton}
                                    onClick={() => applyRule(rule)}
                                    disabled={applying === rule.id || !rule.is_active}
                                  >
                                    {applying === rule.id ? <Loader size={14} color="var(--cream)" /> : <IconPlayerPlay size={14} />}
                                    Shopify
                                  </button>
                                </Tooltip>
                              )}
                            </Group>
                          </Group>

                          {rule.last_applied_at && (
                            <p style={{ fontSize: 12, color: 'var(--slate-muted)', textAlign: 'right', fontFamily: 'var(--font-inter)', fontStyle: 'normal' }}>
                              Dernière application : {new Date(rule.last_applied_at).toLocaleString('fr-FR')}
                            </p>
                          )}
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  )}
                </SortableItem>
              ))}
            </Accordion>
          </SortableContext>
        </DndContext>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={<span className={styles.modalTitle}>{editingRule ? 'Modifier la règle' : 'Nouvelle règle de prix'}</span>}
        size="lg"
        styles={{
          content: { backgroundColor: 'var(--cream-soft)' },
          header: { backgroundColor: 'var(--cream-soft)' },
        }}
      >
        <Stack gap="md">
          <TextInput
            label="Titre de la règle"
            placeholder="Ex: Slammer DTG, Hoodie brodé..."
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            description="Nom affiché dans l'interface. Si vide, le type de produit sera utilisé."
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
            }}
          />

          <TextInput
            label="SKU (ciblage)"
            placeholder="Ex: SLAMMER, DRUMMER 2.0..."
            value={formSku}
            onChange={(e) => setFormSku(e.target.value)}
            description="Identifiant unique. Toutes les variantes dont le SKU commence par cette valeur seront ciblées."
            required
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)', fontFamily: 'var(--font-jetbrains)', letterSpacing: '0.04em' },
            }}
          />

          <NumberInput
            label="Prix de base (EUR)"
            placeholder="0.00"
            value={formBasePrice}
            onChange={(val) => setFormBasePrice(typeof val === 'number' ? val : 0)}
            decimalScale={2}
            fixedDecimalScale
            min={0}
            step={0.5}
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)', fontFamily: 'var(--font-fraunces)', fontStyle: 'normal' },
            }}
          />

          <TextInput
            label="Type de produit (optionnel)"
            placeholder="Ex: T-shirt, Sweat, Hoodie..."
            value={formProductType}
            onChange={(e) => setFormProductType(e.target.value)}
            description="Informatif uniquement. N'est plus utilisé pour le ciblage."
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
            }}
          />

          <TextInput
            label="Description (optionnel)"
            placeholder="Ex: T-shirt basique"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            styles={{
              input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
            }}
          />

          <Switch
            label="Appliquer seulement aux variantes locales"
            description="Si activé, cette règle ne ciblera que les variantes non-Shopify (locales)"
            checked={formLocalOnly}
            onChange={(e) => setFormLocalOnly(e.currentTarget.checked)}
            styles={{
              track: formLocalOnly ? { backgroundColor: 'var(--moss)', borderColor: 'var(--moss)' } : {},
            }}
          />

          {/* Metafield modifiers */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardHeadTitle}>Modificateurs par métachamp</h3>
            </div>
            <div className={styles.cardBody}>
              {formModifiers.length > 0 && (
                <table className={styles.table} style={{ marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th className={styles.th} style={{ width: 30 }}></th>
                      <th className={styles.th}>Métachamp</th>
                      <th className={styles.th}>Valeur</th>
                      <th className={styles.th}>Majoration</th>
                      <th className={styles.th} style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formModifiers.map((mod, index) => (
                      <tr
                        key={index}
                        className={styles.tr}
                        draggable
                        onDragStart={() => setDragModIdx(index)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverModIdx(index); }}
                        onDragLeave={() => setDragOverModIdx(null)}
                        onDrop={() => handleModDrop(index, 'meta')}
                        onDragEnd={() => { setDragModIdx(null); setDragOverModIdx(null); }}
                        style={{
                          opacity: dragModIdx === index ? 0.4 : 1,
                          outline: dragOverModIdx === index ? '2px dashed var(--clay)' : 'none',
                          cursor: 'grab',
                        }}
                      >
                        <td className={styles.td} style={{ width: 30 }}>
                          <IconGripVertical size={14} color="var(--slate-muted)" />
                        </td>
                        <td className={styles.td}>{getMetafieldLabel(mod.namespace, mod.key)}</td>
                        <td className={styles.td}>{mod.value}</td>
                        <td className={styles.td}>
                          <span className={mod.amount >= 0 ? styles.amountPositive : styles.amountNegative}>
                            {mod.amount >= 0 ? '+' : ''}{mod.amount.toFixed(2)} EUR
                          </span>
                        </td>
                        <td className={styles.td}>
                          <button
                            className={`${styles.iconButton} ${styles.iconButton_danger}`}
                            style={{ width: 24, height: 24 }}
                            onClick={() => removeModifier(index)}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {metafields.length > 0 ? (
                <Stack gap="xs">
                  <Group grow>
                    <Select
                      label="Métachamp"
                      placeholder="Sélectionner"
                      data={metafieldOptions}
                      value={newModifierNamespace && newModifierKey ? `${newModifierNamespace}|${newModifierKey}` : null}
                      onChange={(val) => {
                        if (val) {
                          const [ns, k] = val.split('|');
                          setNewModifierNamespace(ns);
                          setNewModifierKey(k);
                        }
                      }}
                      styles={{
                        input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                      }}
                    />
                    <TextInput
                      label="Valeur"
                      placeholder="Ex: DTG-OPA"
                      value={newModifierValue}
                      onChange={(e) => setNewModifierValue(e.target.value)}
                      styles={{
                        input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                      }}
                    />
                    <NumberInput
                      label="Majoration (EUR)"
                      placeholder="0.00"
                      value={newModifierAmount}
                      onChange={(val) => setNewModifierAmount(typeof val === 'number' ? val : 0)}
                      decimalScale={2}
                      fixedDecimalScale
                      step={0.5}
                      styles={{
                        input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)', fontFamily: 'var(--font-fraunces)', fontStyle: 'normal' },
                      }}
                    />
                  </Group>
                  <button
                    className={styles.ghostButton}
                    onClick={addModifier}
                    disabled={!newModifierNamespace || !newModifierKey || !newModifierValue}
                  >
                    <IconPlus size={14} />
                    Ajouter ce modificateur
                  </button>
                </Stack>
              ) : (
                <p style={{ fontSize: 13, color: 'var(--slate-muted)' }}>
                  Configurez d&apos;abord des métachamps dans les options globales pour ajouter des modificateurs.
                </p>
              )}
            </div>
          </div>

          {/* Option modifiers */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardHeadTitle}>Modificateurs par option (Couleur, Taille...)</h3>
            </div>
            <div className={styles.cardBody}>
              {formOptionModifiers.length > 0 && (
                <table className={styles.table} style={{ marginBottom: 16 }}>
                  <thead>
                    <tr>
                      <th className={styles.th} style={{ width: 30 }}></th>
                      <th className={styles.th}>Option</th>
                      <th className={styles.th}>Valeur</th>
                      <th className={styles.th}>Majoration</th>
                      <th className={styles.th} style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formOptionModifiers.map((mod, index) => (
                      <tr
                        key={index}
                        className={styles.tr}
                        draggable
                        onDragStart={() => setDragModIdx(index)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverModIdx(index); }}
                        onDragLeave={() => setDragOverModIdx(null)}
                        onDrop={() => handleModDrop(index, 'option')}
                        onDragEnd={() => { setDragModIdx(null); setDragOverModIdx(null); }}
                        style={{
                          opacity: dragModIdx === index ? 0.4 : 1,
                          outline: dragOverModIdx === index ? '2px dashed var(--clay)' : 'none',
                          cursor: 'grab',
                        }}
                      >
                        <td className={styles.td} style={{ width: 30 }}>
                          <IconGripVertical size={14} color="var(--slate-muted)" />
                        </td>
                        <td className={styles.td}>{mod.optionName}</td>
                        <td className={styles.td}>{mod.optionValue}</td>
                        <td className={styles.td}>
                          <span className={mod.amount >= 0 ? styles.amountPositive : styles.amountNegative}>
                            {mod.amount >= 0 ? '+' : ''}{mod.amount.toFixed(2)} EUR
                          </span>
                        </td>
                        <td className={styles.td}>
                          <button
                            className={`${styles.iconButton} ${styles.iconButton_danger}`}
                            style={{ width: 24, height: 24 }}
                            onClick={() => removeOptionModifier(index)}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <Stack gap="xs">
                <Group grow>
                  <TextInput
                    label="Nom de l'option"
                    placeholder="Ex: Color, Size, Couleur, Taille..."
                    value={newOptionName}
                    onChange={(e) => setNewOptionName(e.target.value)}
                    description="Le nom exact de l'option dans Shopify"
                    styles={{
                      input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                    }}
                  />
                  <TextInput
                    label="Valeur"
                    placeholder="Ex: XXL, French Navy..."
                    value={newOptionValue}
                    onChange={(e) => setNewOptionValue(e.target.value)}
                    styles={{
                      input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' },
                    }}
                  />
                  <NumberInput
                    label="Majoration (EUR)"
                    placeholder="0.00"
                    value={newOptionAmount}
                    onChange={(val) => setNewOptionAmount(typeof val === 'number' ? val : 0)}
                    decimalScale={2}
                    fixedDecimalScale
                    step={0.5}
                    styles={{
                      input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)', fontFamily: 'var(--font-fraunces)', fontStyle: 'normal' },
                    }}
                  />
                </Group>
                <button
                  className={styles.ghostButton}
                  onClick={addOptionModifier}
                  disabled={!newOptionName || !newOptionValue}
                >
                  <IconPlus size={14} />
                  Ajouter ce modificateur d&apos;option
                </button>
              </Stack>
            </div>
          </div>

          <div className={styles.modalActions}>
            <button className={styles.ghostButton} onClick={closeModal}>
              Annuler
            </button>
            <button className={styles.primaryButton} onClick={saveRule} disabled={saving}>
              {editingRule ? 'Mettre à jour' : 'Créer'}
            </button>
          </div>
        </Stack>
      </Modal>
    </div>
  );
}
