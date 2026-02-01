'use client';

import { useRouter } from 'next/navigation';
import { ActionIcon, Tooltip } from '@mantine/core';
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
