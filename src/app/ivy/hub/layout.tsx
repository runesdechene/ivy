'use client';

import { useRouter } from 'next/navigation';
import { ActionIcon, Tooltip, Text } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { LocationProvider } from '@/context/LocationContext';
import { LocationSelector } from '@/components/LocationSelector/LocationSelector';
import styles from './caisse.module.scss';

function CaisseLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className={styles.caisseLayout}>
      <div className={styles.caisseHeader}>
        <Tooltip label="Retour à Ivy">
          <ActionIcon 
            variant="light" 
            color="gray" 
            size="lg"
            onClick={() => router.push('/ivy/commandes')}
          >
            <IconArrowLeft size={20} />
          </ActionIcon>
        </Tooltip>
        <div className={styles.locationFloating}>
          <LocationSelector />
        </div>
      </div>
      <main className={styles.caisseMain}>
        {children}
      </main>
      <Text size="xs" c="dimmed" ta="center" py={4} style={{ opacity: 0.5 }}>
        Outil interne de gestion de stock — Ne constitue pas un système d'enregistrement des ventes
      </Text>
    </div>
  );
}

export default function CaisseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <LocationProvider>
      <CaisseLayoutContent>{children}</CaisseLayoutContent>
    </LocationProvider>
  );
}
