'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Title, Text, Paper, Stack, Table, TextInput, Button, Group, 
  ActionIcon, Badge, Loader, Center, Modal, NumberInput, Select,
  Accordion, Switch, Tooltip
} from '@mantine/core';
import { IconPlus, IconTrash, IconEdit, IconPlayerPlay, IconCheck, IconDownload } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { useShop } from '@/context/ShopContext';
import { useTerminalStream } from '@/hooks/useTerminalStream';

interface Modifier {
  id?: string;
  namespace: string;
  key: string;
  value: string;
  amount: number;
  // Champs retournés par l'API (noms DB)
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
  // Champs retournés par l'API (noms DB)
  option_name?: string;
  option_value?: string;
  modifier_amount?: number;
}

interface PriceRule {
  id?: string;
  sku: string;
  base_price: number;
  description: string | null;
  product_type: string | null;
  is_active: boolean;
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
  const { streamFromUrl, endSync } = useTerminalStream();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [applyingLocal, setApplyingLocal] = useState<string | null>(null);
  const [applyingAllShopify, setApplyingAllShopify] = useState(false);
  const [applyingAllLocal, setApplyingAllLocal] = useState(false);
  
  const [rules, setRules] = useState<PriceRule[]>([]);
  const [metafields, setMetafields] = useState<MetafieldConfig[]>([]);
  const [editingRule, setEditingRule] = useState<PriceRule | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  // État pour le formulaire
  const [formBasePrice, setFormBasePrice] = useState<number>(0);
  const [formDescription, setFormDescription] = useState('');
  const [formProductType, setFormProductType] = useState('');
  const [formModifiers, setFormModifiers] = useState<Modifier[]>([]);
  const [formOptionModifiers, setFormOptionModifiers] = useState<OptionModifier[]>([]);

  // État pour ajouter un nouveau modificateur métachamp
  const [newModifierNamespace, setNewModifierNamespace] = useState('');
  const [newModifierKey, setNewModifierKey] = useState('');
  const [newModifierValue, setNewModifierValue] = useState('');
  const [newModifierAmount, setNewModifierAmount] = useState<number>(0);

  // État pour ajouter un nouveau modificateur d'option
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
    setFormBasePrice(0);
    setFormDescription('');
    setFormProductType('');
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
    setFormBasePrice(rule.base_price);
    setFormDescription(rule.description || '');
    setFormProductType(rule.product_type || '');
    setFormModifiers(rule.modifiers.map(m => ({
      namespace: m.metafield_namespace || m.namespace,
      key: m.metafield_key || m.key,
      value: m.metafield_value || m.value,
      amount: m.modifier_amount || m.amount,
    })));
    setFormOptionModifiers((rule.option_modifiers || []).map(m => ({
      optionName: m.option_name || m.optionName,
      optionValue: m.option_value || m.optionValue,
      amount: m.modifier_amount || m.amount,
    })));
    openModal();
  };

  const addModifier = () => {
    if (!newModifierNamespace || !newModifierKey || !newModifierValue) {
      notifications.show({
        title: 'Erreur',
        message: 'Veuillez remplir tous les champs du modificateur',
        color: 'red',
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

  const addOptionModifier = () => {
    if (!newOptionName || !newOptionValue) {
      notifications.show({
        title: 'Erreur',
        message: 'Veuillez remplir le nom et la valeur de l\'option',
        color: 'red',
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
    if (!currentShop || !formProductType.trim()) {
      notifications.show({
        title: 'Erreur',
        message: 'Le type de produit est obligatoire',
        color: 'red',
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
            sku: formProductType, // On utilise le type comme identifiant
            basePrice: formBasePrice,
            description: formDescription || null,
            productType: formProductType,
            modifiers: formModifiers,
            optionModifiers: formOptionModifiers,
          }
        : {
            shopId: currentShop.id,
            sku: formProductType, // On utilise le type comme identifiant
            basePrice: formBasePrice,
            description: formDescription || null,
            productType: formProductType,
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
          title: 'Succès',
          message: editingRule ? 'Règle mise à jour' : 'Règle créée',
          color: 'green',
        });
        closeModal();
        fetchData();
      } else {
        const error = await response.json();
        notifications.show({
          title: 'Erreur',
          message: error.error || 'Impossible de sauvegarder',
          color: 'red',
        });
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

  const deleteRule = async (id: string) => {
    if (!confirm('Supprimer cette règle ?')) return;

    try {
      const response = await fetch(`/api/settings/price-rules?id=${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        notifications.show({
          title: 'Succès',
          message: 'Règle supprimée',
          color: 'green',
        });
        fetchData();
      }
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer la règle',
        color: 'red',
      });
    }
  };

  const applyRule = async (rule: PriceRule) => {
    if (!currentShop || !rule.id) return;

    setApplying(rule.id);
    
    await streamFromUrl(
      `/api/settings/price-rules/apply-stream?shopId=${currentShop.id}&ruleId=${rule.id}`,
      {
        title: `Appliquer sur Shopify: ${rule.sku}`,
        onComplete: () => {
          fetchData();
          setApplying(null);
        },
        actions: rule.product_type ? [
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
        ],
      }
    );
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

  // Appliquer toutes les règles actives sur Shopify
  const applyAllShopify = async () => {
    if (!currentShop) return;
    
    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'orange',
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

  // Appliquer toutes les règles actives aux commandes
  const applyAllLocal = async () => {
    if (!currentShop) return;
    
    const activeRules = rules.filter(r => r.is_active);
    if (activeRules.length === 0) {
      notifications.show({
        title: 'Attention',
        message: 'Aucune règle active à appliquer',
        color: 'orange',
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

  const calculateTotalPrice = (rule: PriceRule) => {
    const modifiersTotal = rule.modifiers.reduce((sum, m) => {
      const amount = m.modifier_amount || m.amount || 0;
      return sum + amount;
    }, 0);
    const optionModifiersTotal = (rule.option_modifiers || []).reduce((sum, m) => {
      const amount = m.modifier_amount || m.amount || 0;
      return sum + amount;
    }, 0);
    return rule.base_price + modifiersTotal + optionModifiersTotal;
  };

  // Options pour le select des métachamps
  const metafieldOptions = metafields.map(m => ({
    value: `${m.namespace}|${m.key}`,
    label: m.display_name || `${m.namespace}.${m.key}`,
  }));

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <div>
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={2}>Règles de prix</Title>
          <Text size="sm" c="dimmed">
            Définissez des règles de calcul de coût basées sur le SKU et les métachamps
          </Text>
        </div>
        <Group gap="xs">
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateModal}>
            Nouvelle règle
          </Button>
        </Group>
      </Group>

      {/* Boutons d'application globale */}
      {rules.filter(r => r.is_active).length > 0 && (
        <Paper withBorder p="md" radius="md" mb="lg" bg="gray.0">
          <Group justify="space-between">
            <div>
              <Text fw={600}>Appliquer toutes les règles actives</Text>
              <Text size="sm" c="dimmed">
                {rules.filter(r => r.is_active).length} règle(s) active(s)
              </Text>
            </div>
            <Group gap="xs">
              <Button
                leftSection={applyingAllLocal ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
                color="blue"
                variant="light"
                onClick={applyAllLocal}
                loading={applyingAllLocal}
                disabled={applyingAllShopify}
              >
                Appliquer aux commandes
              </Button>
              <Button
                leftSection={applyingAllShopify ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
                color="green"
                onClick={applyAllShopify}
                loading={applyingAllShopify}
                disabled={applyingAllLocal}
              >
                Appliquer toutes sur Shopify
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {rules.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Text c="dimmed">Aucune règle de prix configurée</Text>
          </Center>
        </Paper>
      ) : (
        <Accordion variant="separated">
          {rules.map((rule) => (
            <Accordion.Item key={rule.id} value={rule.id || rule.sku}>
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" style={{ flex: 1 }}>
                  <Group gap="md">
                    <Switch
                      checked={rule.is_active}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleRuleActive(rule);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div>
                      <Text fw={600}>{rule.sku}</Text>
                      {rule.description && (
                        <Text size="xs" c="dimmed">{rule.description}</Text>
                      )}
                      {rule.product_type && (
                        <Text size="xs" c="blue">Type: {rule.product_type}</Text>
                      )}
                    </div>
                  </Group>
                  <Group gap="xs">
                    <Badge color="blue" variant="light">
                      Base: {rule.base_price.toFixed(2)} €
                    </Badge>
                    {rule.modifiers.length > 0 && (
                      <Badge color="violet" variant="light">
                        +{rule.modifiers.length} métachamp(s)
                      </Badge>
                    )}
                    {(rule.option_modifiers || []).length > 0 && (
                      <Badge color="orange" variant="light">
                        +{rule.option_modifiers.length} option(s)
                      </Badge>
                    )}
                  </Group>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="md">
                  {rule.modifiers.length > 0 && (
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Métachamp</Table.Th>
                          <Table.Th>Valeur</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Majoration</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {rule.modifiers.map((mod, index) => (
                          <Table.Tr key={index}>
                            <Table.Td>
                              {getMetafieldLabel(
                                mod.metafield_namespace || mod.namespace,
                                mod.metafield_key || mod.key
                              )}
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="outline">
                                {mod.metafield_value || mod.value}
                              </Badge>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              <Text fw={500} c={(mod.modifier_amount || mod.amount) >= 0 ? 'green' : 'red'}>
                                {(mod.modifier_amount || mod.amount) >= 0 ? '+' : ''}
                                {(mod.modifier_amount || mod.amount).toFixed(2)} €
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}

                  {/* Tableau des modificateurs d'options */}
                  {(rule.option_modifiers || []).length > 0 && (
                    <Table>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Option</Table.Th>
                          <Table.Th>Valeur</Table.Th>
                          <Table.Th style={{ textAlign: 'right' }}>Majoration</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {rule.option_modifiers.map((mod, index) => (
                          <Table.Tr key={index}>
                            <Table.Td>
                              {mod.option_name || mod.optionName}
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="outline" color="orange">
                                {mod.option_value || mod.optionValue}
                              </Badge>
                            </Table.Td>
                            <Table.Td style={{ textAlign: 'right' }}>
                              <Text fw={500} c={(mod.modifier_amount || mod.amount) >= 0 ? 'green' : 'red'}>
                                {(mod.modifier_amount || mod.amount) >= 0 ? '+' : ''}
                                {(mod.modifier_amount || mod.amount).toFixed(2)} €
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}

                  <Group justify="space-between">
                    <Group gap="xs">
                      <ActionIcon
                        variant="light"
                        color="blue"
                        onClick={() => openEditModal(rule)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="light"
                        color="red"
                        onClick={() => rule.id && deleteRule(rule.id)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                    <Group gap="xs">
                      <Tooltip label="Met à jour les coûts dans les commandes Supabase">
                        <Button
                          leftSection={applyingLocal === rule.id ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
                          color="blue"
                          variant="light"
                          onClick={() => applyRuleLocal(rule)}
                          loading={applyingLocal === rule.id}
                          disabled={!rule.is_active}
                        >
                          Appliquer aux commandes
                        </Button>
                      </Tooltip>
                      <Tooltip label="Appliquer sur Shopify (met à jour le coût des variantes)">
                        <Button
                          leftSection={applying === rule.id ? <Loader size={14} /> : <IconPlayerPlay size={16} />}
                          color="green"
                          onClick={() => applyRule(rule)}
                          loading={applying === rule.id}
                          disabled={!rule.is_active}
                        >
                          Appliquer sur Shopify
                        </Button>
                      </Tooltip>
                    </Group>
                  </Group>

                  {rule.last_applied_at && (
                    <Text size="xs" c="dimmed" ta="right">
                      Dernière application : {new Date(rule.last_applied_at).toLocaleString('fr-FR')}
                    </Text>
                  )}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}

      {/* Modal de création/édition */}
      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={editingRule ? 'Modifier la règle' : 'Nouvelle règle de prix'}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Type de produit"
            placeholder="Ex: T-shirt, Sweat, Hoodie..."
            value={formProductType}
            onChange={(e) => setFormProductType(e.target.value)}
            description="Doit correspondre exactement au type de produit dans Shopify"
            required
          />

          <NumberInput
            label="Prix de base (€)"
            placeholder="0.00"
            value={formBasePrice}
            onChange={(val) => setFormBasePrice(typeof val === 'number' ? val : 0)}
            decimalScale={2}
            fixedDecimalScale
            min={0}
            step={0.5}
          />

          <TextInput
            label="Description (optionnel)"
            placeholder="Ex: T-shirt basique"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
          />

          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="md">Modificateurs par métachamp</Text>

            {formModifiers.length > 0 && (
              <Table mb="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Métachamp</Table.Th>
                    <Table.Th>Valeur</Table.Th>
                    <Table.Th>Majoration</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {formModifiers.map((mod, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{getMetafieldLabel(mod.namespace, mod.key)}</Table.Td>
                      <Table.Td>{mod.value}</Table.Td>
                      <Table.Td>{mod.amount >= 0 ? '+' : ''}{mod.amount.toFixed(2)} €</Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="light"
                          color="red"
                          size="sm"
                          onClick={() => removeModifier(index)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
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
                  />
                  <TextInput
                    label="Valeur"
                    placeholder="Ex: DTG-OPA"
                    value={newModifierValue}
                    onChange={(e) => setNewModifierValue(e.target.value)}
                  />
                  <NumberInput
                    label="Majoration (€)"
                    placeholder="0.00"
                    value={newModifierAmount}
                    onChange={(val) => setNewModifierAmount(typeof val === 'number' ? val : 0)}
                    decimalScale={2}
                    fixedDecimalScale
                    step={0.5}
                  />
                </Group>
                <Button
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={addModifier}
                  disabled={!newModifierNamespace || !newModifierKey || !newModifierValue}
                >
                  Ajouter ce modificateur
                </Button>
              </Stack>
            ) : (
              <Text c="dimmed" size="sm">
                Configurez d'abord des métachamps dans les options globales pour ajouter des modificateurs.
              </Text>
            )}
          </Paper>

          {/* Modificateurs par option (couleur, taille) */}
          <Paper withBorder p="md" radius="md">
            <Text fw={600} mb="md">Modificateurs par option (Couleur, Taille...)</Text>

            {formOptionModifiers.length > 0 && (
              <Table mb="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Option</Table.Th>
                    <Table.Th>Valeur</Table.Th>
                    <Table.Th>Majoration</Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {formOptionModifiers.map((mod, index) => (
                    <Table.Tr key={index}>
                      <Table.Td>{mod.optionName}</Table.Td>
                      <Table.Td>{mod.optionValue}</Table.Td>
                      <Table.Td>{mod.amount >= 0 ? '+' : ''}{mod.amount.toFixed(2)} €</Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="light"
                          color="red"
                          size="sm"
                          onClick={() => removeOptionModifier(index)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}

            <Stack gap="xs">
              <Group grow>
                <TextInput
                  label="Nom de l'option"
                  placeholder="Ex: Color, Size, Couleur, Taille..."
                  value={newOptionName}
                  onChange={(e) => setNewOptionName(e.target.value)}
                  description="Le nom exact de l'option dans Shopify"
                />
                <TextInput
                  label="Valeur"
                  placeholder="Ex: XXL, French Navy..."
                  value={newOptionValue}
                  onChange={(e) => setNewOptionValue(e.target.value)}
                />
                <NumberInput
                  label="Majoration (€)"
                  placeholder="0.00"
                  value={newOptionAmount}
                  onChange={(val) => setNewOptionAmount(typeof val === 'number' ? val : 0)}
                  decimalScale={2}
                  fixedDecimalScale
                  step={0.5}
                />
              </Group>
              <Button
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={addOptionModifier}
                disabled={!newOptionName || !newOptionValue}
              >
                Ajouter ce modificateur d'option
              </Button>
            </Stack>
          </Paper>

          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={closeModal}>
              Annuler
            </Button>
            <Button onClick={saveRule} loading={saving}>
              {editingRule ? 'Mettre à jour' : 'Créer'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  );
}
