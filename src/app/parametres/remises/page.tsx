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
  Textarea,
  NumberInput,
  Switch,
  Modal,
  ActionIcon,
  Badge,
  Loader,
  Center,
  Alert,
  Code,
  Accordion,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconPencil, IconTrash, IconInfoCircle } from '@tabler/icons-react';
import { createClient } from '@supabase/supabase-js';
import { useShop } from '@/context/ShopContext';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface DiscountRule {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  expression: string;
  priority: number;
  is_active: boolean;
  is_combinable: boolean;
  created_at: string;
}

const SYNTAX_HELP = `
## Syntaxe des règles de remise

Chaque ligne suit le format : \`CONDITION -> ACTION\`

### Variables disponibles
- \`items_count\` : nombre total d'articles dans le panier

### Opérateurs de condition
- \`>=\` : supérieur ou égal
- \`>\` : supérieur
- \`==\` : égal
- \`<=\` : inférieur ou égal
- \`<\` : inférieur

### Actions
- \`discount("all", X)\` : X% sur tous les articles
- \`discount("cheapest", X)\` : X% sur l'article le moins cher
- \`discount("item[N]", X)\` : X% sur le N-ième article le moins cher (0 = le moins cher)

### Exemples

**Mode 1 : Remise progressive sur les articles les moins chers**
\`\`\`
items_count >= 2 -> discount("item[0]", 10)
items_count >= 3 -> discount("item[1]", 20)
items_count >= 4 -> discount("item[2]", 30)
\`\`\`
Résultat : 2 articles = -10% sur le moins cher, 3 articles = -10% et -20% sur les 2 moins chers, etc.

**Mode 2 : Remise croissante sur le moins cher uniquement**
\`\`\`
items_count == 2 -> discount("cheapest", 10)
items_count == 3 -> discount("cheapest", 30)
items_count >= 4 -> discount("cheapest", 50)
\`\`\`
Résultat : 2 articles = -10% sur le moins cher, 3 articles = -30% sur le moins cher, 4+ = -50%

**Mode 3 : Remise globale**
\`\`\`
items_count >= 3 -> discount("all", 10)
\`\`\`
Résultat : -10% sur tous les articles dès 3 articles
`;

export default function RemisesPage() {
  const { currentShop } = useShop();
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formExpression, setFormExpression] = useState('');
  const [formPriority, setFormPriority] = useState<number>(0);
  const [formIsActive, setFormIsActive] = useState(true);
  const [formIsCombinable, setFormIsCombinable] = useState(false);

  // Load rules
  useEffect(() => {
    if (!currentShop?.id) return;

    const loadRules = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('pos_discount_rules')
        .select('*')
        .eq('shop_id', currentShop.id)
        .order('priority', { ascending: false });

      if (error) {
        console.error('Error loading rules:', error);
        notifications.show({
          title: 'Erreur',
          message: 'Impossible de charger les règles de remise',
          color: 'red',
        });
      } else {
        setRules(data || []);
      }
      setLoading(false);
    };

    loadRules();
  }, [currentShop?.id]);

  const openCreateModal = () => {
    setEditingRule(null);
    setFormName('');
    setFormDescription('');
    setFormExpression('');
    setFormPriority(rules.length);
    setFormIsActive(true);
    setFormIsCombinable(false);
    setModalOpen(true);
  };

  const openEditModal = (rule: DiscountRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    setFormDescription(rule.description || '');
    setFormExpression(rule.expression);
    setFormPriority(rule.priority);
    setFormIsActive(rule.is_active);
    setFormIsCombinable(rule.is_combinable);
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!currentShop?.id || !formName.trim() || !formExpression.trim()) {
      notifications.show({
        title: 'Erreur',
        message: 'Le nom et l\'expression sont requis',
        color: 'red',
      });
      return;
    }

    setSaving(true);
    try {
      if (editingRule) {
        // Update
        const { error } = await supabase
          .from('pos_discount_rules')
          .update({
            name: formName.trim(),
            description: formDescription.trim() || null,
            expression: formExpression.trim(),
            priority: formPriority,
            is_active: formIsActive,
            is_combinable: formIsCombinable,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRule.id);

        if (error) throw error;

        setRules(prev => prev.map(r => 
          r.id === editingRule.id 
            ? { ...r, name: formName.trim(), description: formDescription.trim() || null, expression: formExpression.trim(), priority: formPriority, is_active: formIsActive, is_combinable: formIsCombinable }
            : r
        ));

        notifications.show({
          title: 'Succès',
          message: 'Règle mise à jour',
          color: 'green',
        });
      } else {
        // Create
        const { data, error } = await supabase
          .from('pos_discount_rules')
          .insert({
            shop_id: currentShop.id,
            name: formName.trim(),
            description: formDescription.trim() || null,
            expression: formExpression.trim(),
            priority: formPriority,
            is_active: formIsActive,
            is_combinable: formIsCombinable,
          })
          .select()
          .single();

        if (error) throw error;

        setRules(prev => [data, ...prev]);

        notifications.show({
          title: 'Succès',
          message: 'Règle créée',
          color: 'green',
        });
      }

      setModalOpen(false);
    } catch (error) {
      console.error('Error saving rule:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de sauvegarder la règle',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rule: DiscountRule) => {
    if (!confirm(`Supprimer la règle "${rule.name}" ?`)) return;

    try {
      const { error } = await supabase
        .from('pos_discount_rules')
        .delete()
        .eq('id', rule.id);

      if (error) throw error;

      setRules(prev => prev.filter(r => r.id !== rule.id));

      notifications.show({
        title: 'Succès',
        message: 'Règle supprimée',
        color: 'green',
      });
    } catch (error) {
      console.error('Error deleting rule:', error);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de supprimer la règle',
        color: 'red',
      });
    }
  };

  const toggleActive = async (rule: DiscountRule) => {
    try {
      const { error } = await supabase
        .from('pos_discount_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);

      if (error) throw error;

      setRules(prev => prev.map(r => 
        r.id === rule.id ? { ...r, is_active: !r.is_active } : r
      ));
    } catch (error) {
      console.error('Error toggling rule:', error);
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
          <Title order={2}>Remises de caisse</Title>
          <Text c="dimmed" size="sm">
            Configurez les règles de remise automatiques pour le point de vente
          </Text>
        </div>
        <Group>
          <Button 
            variant="subtle" 
            leftSection={<IconInfoCircle size={16} />}
            onClick={() => setHelpOpen(true)}
          >
            Aide syntaxe
          </Button>
          <Button 
            leftSection={<IconPlus size={16} />}
            onClick={openCreateModal}
          >
            Nouvelle règle
          </Button>
        </Group>
      </Group>

      {rules.length === 0 ? (
        <Alert color="blue" title="Aucune règle de remise">
          Créez votre première règle de remise pour l'appliquer automatiquement en caisse.
        </Alert>
      ) : (
        <Stack gap="md">
          {rules.map(rule => (
            <Card key={rule.id} withBorder padding="md">
              <Group justify="space-between" align="flex-start">
                <div style={{ flex: 1 }}>
                  <Group gap="sm" mb="xs">
                    <Text fw={600}>{rule.name}</Text>
                    <Badge color={rule.is_active ? 'green' : 'gray'} size="sm">
                      {rule.is_active ? 'Actif' : 'Inactif'}
                    </Badge>
                    {rule.is_combinable && (
                      <Badge color="blue" size="sm" variant="light">
                        Combinable
                      </Badge>
                    )}
                    <Badge color="gray" size="sm" variant="light">
                      Priorité: {rule.priority}
                    </Badge>
                  </Group>
                  {rule.description && (
                    <Text size="sm" c="dimmed" mb="xs">
                      {rule.description}
                    </Text>
                  )}
                  <Code block style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                    {rule.expression}
                  </Code>
                </div>
                <Group gap="xs">
                  <Switch
                    checked={rule.is_active}
                    onChange={() => toggleActive(rule)}
                    size="sm"
                  />
                  <ActionIcon 
                    variant="subtle" 
                    color="blue"
                    onClick={() => openEditModal(rule)}
                  >
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon 
                    variant="subtle" 
                    color="red"
                    onClick={() => handleDelete(rule)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {/* Create/Edit Modal */}
      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Modifier la règle' : 'Nouvelle règle de remise'}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Nom"
            placeholder="Ex: Promo 2+1"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            required
          />

          <TextInput
            label="Description"
            placeholder="Ex: 10% sur le 2e article, 20% sur le 3e"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
          />

          <Textarea
            label="Expression (règles de logique)"
            placeholder={`items_count >= 2 -> discount("item[0]", 10)\nitems_count >= 3 -> discount("item[1]", 20)`}
            value={formExpression}
            onChange={(e) => setFormExpression(e.target.value)}
            minRows={5}
            required
            styles={{ input: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
          />

          <Group grow>
            <NumberInput
              label="Priorité"
              description="Plus haute = appliquée en premier"
              value={formPriority}
              onChange={(val) => setFormPriority(typeof val === 'number' ? val : 0)}
              min={0}
            />
          </Group>

          <Group>
            <Switch
              label="Règle active"
              checked={formIsActive}
              onChange={(e) => setFormIsActive(e.currentTarget.checked)}
            />
            <Switch
              label="Combinable avec d'autres règles"
              checked={formIsCombinable}
              onChange={(e) => setFormIsCombinable(e.currentTarget.checked)}
            />
          </Group>

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingRule ? 'Mettre à jour' : 'Créer'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Help Modal */}
      <Modal
        opened={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Aide - Syntaxe des règles"
        size="xl"
      >
        <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'system-ui' }}>
          <Accordion defaultValue="syntax">
            <Accordion.Item value="syntax">
              <Accordion.Control>Syntaxe de base</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="md">
                  Chaque ligne suit le format : <Code>CONDITION -&gt; ACTION</Code>
                </Text>
                <Text size="sm" fw={500} mb="xs">Variables :</Text>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li><Code>items_count</Code> : nombre total d'articles</li>
                </ul>
                <Text size="sm" fw={500} mt="md" mb="xs">Opérateurs :</Text>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li><Code>&gt;=</Code>, <Code>&gt;</Code>, <Code>==</Code>, <Code>&lt;=</Code>, <Code>&lt;</Code></li>
                </ul>
                <Text size="sm" fw={500} mt="md" mb="xs">Actions :</Text>
                <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                  <li><Code>discount("all", X)</Code> : X% sur tous</li>
                  <li><Code>discount("cheapest", X)</Code> : X% sur le moins cher</li>
                  <li><Code>discount("item[N]", X)</Code> : X% sur le N-ième moins cher</li>
                </ul>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="example1">
              <Accordion.Control>Exemple 1 : Remise progressive</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="sm">
                  10% sur le 2e article, 20% sur le 3e, 30% sur le 4e (toujours sur les moins chers)
                </Text>
                <Code block>
{`items_count >= 2 -> discount("item[0]", 10)
items_count >= 3 -> discount("item[1]", 20)
items_count >= 4 -> discount("item[2]", 30)`}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="example2">
              <Accordion.Control>Exemple 2 : Remise croissante sur le moins cher</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="sm">
                  10% pour 2 articles, 30% pour 3, 50% pour 4+ (toujours sur le moins cher uniquement)
                </Text>
                <Code block>
{`items_count == 2 -> discount("cheapest", 10)
items_count == 3 -> discount("cheapest", 30)
items_count >= 4 -> discount("cheapest", 50)`}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>

            <Accordion.Item value="example3">
              <Accordion.Control>Exemple 3 : Remise globale</Accordion.Control>
              <Accordion.Panel>
                <Text size="sm" mb="sm">
                  10% sur tout le panier dès 3 articles
                </Text>
                <Code block>
{`items_count >= 3 -> discount("all", 10)`}
                </Code>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </div>
      </Modal>
    </Stack>
  );
}
