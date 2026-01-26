'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShop } from '@/context/ShopContext';
import { useAuth } from '@/context/AuthContext';
import { TextInput, Button, Paper, Title, Stack, Alert, Text, Stepper, Group, PasswordInput, Loader, Center } from '@mantine/core';
import { IconAlertCircle, IconCheck, IconBuilding, IconBrandShopee, IconKey } from '@tabler/icons-react';
import styles from '../login/login.module.scss';

function OnboardingContent() {
  const searchParams = useSearchParams();
  const isAddingShop = searchParams.get('add') === 'true';
  const [active, setActive] = useState(0);
  const [shopName, setShopName] = useState('');
  const [shopifyUrl, setShopifyUrl] = useState('');
  const [shopifyToken, setShopifyToken] = useState('');
  const [shopifyLocationId, setShopifyLocationId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { createShop, hasShops, loading: shopLoading } = useShop();
  const { user } = useAuth();
  const router = useRouter();

  // Rediriger vers la page principale si l'utilisateur a déjà des boutiques
  // SAUF si on est en mode "ajout de boutique"
  useEffect(() => {
    if (!shopLoading && hasShops && !isAddingShop) {
      router.push('/');
    }
  }, [shopLoading, hasShops, isAddingShop, router]);

  const nextStep = () => setActive((current) => (current < 2 ? current + 1 : current));
  const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

  const handleSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      const { shop, error } = await createShop({
        name: shopName,
        shopify_url: shopifyUrl,
        shopify_token: shopifyToken,
        shopify_location_id: shopifyLocationId || undefined,
      });

      if (error) {
        setError('Erreur lors de la création de la boutique');
      } else {
        // Rediriger vers la page principale
        router.push('/');
      }
    } catch (error) {
      setError('Erreur lors de la création de la boutique');
    } finally {
      setLoading(false);
    }
  };

  // Afficher un loader pendant le chargement ou si redirection en cours
  if (!user || shopLoading || (hasShops && !isAddingShop)) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <div className={styles.container}>
      <Paper className={styles.formContainer} shadow="md" p="xl" style={{ maxWidth: 600, width: '100%' }}>
        <Title order={2} mb="lg">{isAddingShop ? 'Ajouter une boutique' : 'Bienvenue sur Ivy !'}</Title>
        <Text c="dimmed" mb="xl">
          {isAddingShop ? 'Configurons votre nouvelle boutique Shopify.' : 'Configurons votre première boutique Shopify.'}
        </Text>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
            {error}
          </Alert>
        )}

        <Stepper active={active} onStepClick={setActive} mb="xl">
          <Stepper.Step 
            label="Nom de la boutique" 
            description="Identifiez votre boutique"
            icon={<IconBuilding size={18} />}
          >
            <Stack mt="md">
              <TextInput
                label="Nom de la boutique"
                placeholder="Ma Boutique"
                description="Un nom pour identifier cette boutique dans Ivy"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Step 
            label="URL Shopify" 
            description="Connectez votre boutique"
            icon={<IconBrandShopee size={18} />}
          >
            <Stack mt="md">
              <TextInput
                label="URL de la boutique Shopify"
                placeholder="ma-boutique.myshopify.com"
                description="L'URL de votre boutique Shopify (sans https://)"
                value={shopifyUrl}
                onChange={(e) => setShopifyUrl(e.target.value)}
                required
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Step 
            label="Clé API" 
            description="Autorisez l'accès"
            icon={<IconKey size={18} />}
          >
            <Stack mt="md">
              <PasswordInput
                label="Token d'accès Shopify"
                placeholder="shpat_xxxxx"
                description="Créez un token dans Shopify Admin > Settings > Apps > Develop apps"
                value={shopifyToken}
                onChange={(e) => setShopifyToken(e.target.value)}
                required
              />
              <TextInput
                label="Location ID (optionnel)"
                placeholder="12345678"
                description="L'ID de l'emplacement pour le fulfillment (optionnel)"
                value={shopifyLocationId}
                onChange={(e) => setShopifyLocationId(e.target.value)}
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Completed>
            <Stack mt="md" align="center">
              <IconCheck size={48} color="green" />
              <Title order={3}>Tout est prêt !</Title>
              <Text c="dimmed" ta="center">
                Cliquez sur "Créer la boutique" pour commencer à utiliser Ivy.
              </Text>
            </Stack>
          </Stepper.Completed>
        </Stepper>

        <Group justify="space-between" mt="xl">
          {active > 0 && active < 3 && (
            <Button variant="default" onClick={prevStep}>
              Retour
            </Button>
          )}
          {active === 0 && <div />}
          
          {active < 2 && (
            <Button 
              onClick={nextStep}
              disabled={
                (active === 0 && !shopName) ||
                (active === 1 && !shopifyUrl)
              }
            >
              Suivant
            </Button>
          )}
          
          {active === 2 && (
            <Button 
              onClick={() => {
                if (shopifyToken) {
                  setActive(3);
                }
              }}
              disabled={!shopifyToken}
            >
              Vérifier
            </Button>
          )}

          {active === 3 && (
            <Button 
              onClick={handleSubmit}
              loading={loading}
              color="green"
            >
              Créer la boutique
            </Button>
          )}
        </Group>
      </Paper>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    }>
      <OnboardingContent />
    </Suspense>
  );
}
