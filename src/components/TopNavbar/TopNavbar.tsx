'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button, Group, Text, ActionIcon, Tooltip } from '@mantine/core';
import { IconLogout, IconSettings, IconCash } from '@tabler/icons-react';
import Image from 'next/image';
import { APP_VERSION } from '@/config/version';
import { ShopSelector } from '@/components/ShopSelector';
import { useAuth } from '@/context/AuthContext';
import styles from './TopNavbar.module.scss';

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  
  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isCaisseSection = pathname.startsWith('/ivy/caisse');

  const handleLogout = async () => {
    try {
      await signOut();
      router.push('/login');
    } catch (error) {
      console.error('Erreur lors de la déconnexion:', error);
    }
  };

  return (
    <div className={styles.topNavbar}>
      <Group gap="md">
        <Image
          src="/runesdechene.png"
          alt="Runes de Chêne"
          width={160}
          height={66}
          priority
          style={{ objectFit: 'contain' }}
        />
        <Group gap="xs">
          <Button
            variant={isCommandesSection ? 'filled' : 'subtle'}
            color="orange"
            onClick={() => router.push('/ivy/commandes')}
            size="md"
            className={isCommandesSection ? styles.activeButton : styles.inactiveButton}
          >
            Commandes
          </Button>
          <Button
            variant={isInventaireSection ? 'filled' : 'subtle'}
            color="orange"
            onClick={() => router.push('/ivy/inventaire')}
            size="md"
            className={isInventaireSection ? styles.activeButton : styles.inactiveButton}
          >
            Inventaire
          </Button>
          <Button
            variant={isCaisseSection ? 'filled' : 'subtle'}
            color="orange"
            onClick={() => router.push('/ivy/caisse')}
            size="md"
            leftSection={<IconCash size={18} />}
            className={isCaisseSection ? styles.activeButton : styles.inactiveButton}
          >
            Caisse
          </Button>
        </Group>
      </Group>
      
      <Group gap="md">
        <ShopSelector />
        <Text size="sm" c="dimmed">v{APP_VERSION}</Text>
        <Tooltip label="Options globales">
          <ActionIcon 
            variant="subtle" 
            color="gray" 
            size="lg"
            onClick={() => router.push('/parametres')}
          >
            <IconSettings size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Déconnexion">
          <ActionIcon 
            variant="subtle" 
            color="gray" 
            size="lg"
            onClick={handleLogout}
          >
            <IconLogout size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  );
}
