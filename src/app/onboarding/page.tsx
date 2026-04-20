'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useShop } from '@/context/ShopContext';
import { useAuth } from '@/context/AuthContext';
import { TextInput, Button, Stack, PasswordInput, Loader, Center, Stepper, Group } from '@mantine/core';
import { IconBuilding, IconBrandShopee, IconKey, IconCheck } from '@tabler/icons-react';
import { IvyMark } from '@/components/IvyMark';
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
      const { error } = await createShop({
        name: shopName,
        shopify_url: shopifyUrl,
        shopify_token: shopifyToken,
        shopify_location_id: shopifyLocationId || undefined,
      });

      if (error) {
        setError('Erreur lors de la création de la boutique');
      } else {
        router.push('/');
      }
    } catch (error) {
      setError('Erreur lors de la création de la boutique');
    } finally {
      setLoading(false);
    }
  };

  if (!user || shopLoading || (hasShops && !isAddingShop)) {
    return (
      <Center h="100vh" bg="var(--cream)">
        <Loader size="lg" color="var(--moss)" />
      </Center>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.card} style={{ maxWidth: 560 }}>
        <div className={styles.markWrapper}>
          <IvyMark size="xl" withParent />
        </div>
        <p className={styles.subtitle}>
          {isAddingShop ? 'Ajouter une boutique' : 'Configurons votre espace de production'}
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <Stepper
          active={active}
          onStepClick={setActive}
          mb="xl"
          color="var(--moss)"
          styles={{
            stepIcon: { borderColor: 'var(--divider-strong)' },
            stepLabel: { fontFamily: 'var(--font-inter)', fontSize: 13, color: 'var(--slate)' },
            stepDescription: { fontFamily: 'var(--font-inter)', fontSize: 12, color: 'var(--slate-muted)' },
          }}
        >
          <Stepper.Step
            label="Boutique"
            description="Identifiez votre boutique"
            icon={<IconBuilding size={18} />}
          >
            <Stack mt="md" gap="sm">
              <TextInput
                label="Nom de la boutique"
                placeholder="Ma Boutique"
                description="Un nom pour identifier cette boutique dans Ivy"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                required
                classNames={{ root: styles.input }}
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Step
            label="URL Shopify"
            description="Connectez votre boutique"
            icon={<IconBrandShopee size={18} />}
          >
            <Stack mt="md" gap="sm">
              <TextInput
                label="URL de la boutique Shopify"
                placeholder="ma-boutique.myshopify.com"
                description="L'URL de votre boutique Shopify (sans https://)"
                value={shopifyUrl}
                onChange={(e) => setShopifyUrl(e.target.value)}
                required
                classNames={{ root: styles.input }}
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Step
            label="Clé API"
            description="Autorisez l'accès"
            icon={<IconKey size={18} />}
          >
            <Stack mt="md" gap="sm">
              <PasswordInput
                label="Token d'accès Shopify"
                placeholder="shpat_xxxxx"
                description="Créez un token dans Shopify Admin > Settings > Apps > Develop apps"
                value={shopifyToken}
                onChange={(e) => setShopifyToken(e.target.value)}
                required
                classNames={{ root: styles.input }}
              />
              <TextInput
                label="Location ID (optionnel)"
                placeholder="12345678"
                description="L'ID de l'emplacement pour le fulfillment (optionnel)"
                value={shopifyLocationId}
                onChange={(e) => setShopifyLocationId(e.target.value)}
                classNames={{ root: styles.input }}
              />
            </Stack>
          </Stepper.Step>

          <Stepper.Completed>
            <Stack mt="md" align="center" gap="sm">
              <IconCheck size={48} color="var(--moss)" />
              <p style={{
                fontFamily: 'var(--font-fraunces)',
                fontStyle: 'normal',
                fontSize: 22,
                color: 'var(--slate)',
                fontWeight: 600,
              }}>
                Tout est prêt !
              </p>
              <p style={{
                fontFamily: 'var(--font-inter)',
                fontSize: 13,
                color: 'var(--slate-muted)',
                textAlign: 'center',
              }}>
                Cliquez sur &laquo; Créer la boutique &raquo; pour commencer.
              </p>
            </Stack>
          </Stepper.Completed>
        </Stepper>

        <Group justify="space-between" mt="xl">
          {active > 0 && active < 3 && (
            <Button
              variant="default"
              onClick={prevStep}
              styles={{
                root: {
                  backgroundColor: 'var(--cream)',
                  borderColor: 'var(--divider-strong)',
                  color: 'var(--slate)',
                  fontFamily: 'var(--font-inter)',
                  fontSize: 14,
                },
              }}
            >
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
              className={styles.submitBtn}
              style={{ width: 'auto', paddingInline: 24 }}
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
              className={styles.submitBtn}
              style={{ width: 'auto', paddingInline: 24 }}
            >
              Vérifier
            </Button>
          )}

          {active === 3 && (
            <Button
              onClick={handleSubmit}
              loading={loading}
              styles={{
                root: {
                  backgroundColor: 'var(--moss)',
                  color: 'var(--cream-soft)',
                  fontFamily: 'var(--font-inter)',
                  fontSize: 14,
                  fontWeight: 500,
                  borderRadius: 6,
                  height: 42,
                  paddingInline: 24,
                  border: 'none',
                },
              }}
            >
              Créer la boutique
            </Button>
          )}
        </Group>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <Center h="100vh" bg="var(--cream)">
        <Loader size="lg" color="var(--moss)" />
      </Center>
    }>
      <OnboardingContent />
    </Suspense>
  );
}
