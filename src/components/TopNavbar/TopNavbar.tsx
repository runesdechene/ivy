'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Button, Group, Text, ActionIcon, Tooltip } from '@mantine/core';
import { IconLogout, IconSettings, IconPackage, IconBuildingStore, IconTent, IconUser } from '@tabler/icons-react';
import { APP_VERSION } from '@/config/version';
import { ShopSelector } from '@/components/ShopSelector';
import { useAuth } from '@/context/AuthContext';
import { IvyMark } from '@/components/IvyMark';
import styles from './TopNavbar.module.scss';

export function TopNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();

  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isStandSection = pathname.startsWith('/ivy/stand');
  const isHubSection = pathname.startsWith('/ivy/hub');

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
      <Group gap="xl">
        <IvyMark size="md" withParent />

        <div className={styles.separator} />

        <Group gap={4}>
          <Button
            variant={isCommandesSection ? 'filled' : 'subtle'}
            color={isCommandesSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/commandes')}
            size="md"
            leftSection={<IconBuildingStore size={18} />}
            className={styles.navButton}
          >
            Atelier
          </Button>
          <Button
            variant={isStandSection ? 'filled' : 'subtle'}
            color={isStandSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/stand')}
            size="md"
            leftSection={<IconTent size={18} />}
            className={styles.navButton}
          >
            Festivals
          </Button>
          <Button
            variant={isInventaireSection ? 'filled' : 'subtle'}
            color={isInventaireSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/inventaire')}
            size="md"
            className={styles.navButton}
          >
            Inventaire
          </Button>
          <Button
            variant={isHubSection ? 'filled' : 'subtle'}
            color={isHubSection ? 'slate' : 'gray'}
            onClick={() => router.push('/ivy/hub')}
            size="md"
            leftSection={<IconPackage size={18} />}
            className={styles.navButton}
          >
            HUB de stand
          </Button>
        </Group>
      </Group>

      <Group gap="md">
        <ShopSelector />
        <Text className={styles.version}>v{APP_VERSION}</Text>
        <Tooltip label="Profil">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => router.push('/ivy/profil')}>
            <IconUser size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Options globales">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => router.push('/parametres')}>
            <IconSettings size={20} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Déconnexion">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={handleLogout}>
            <IconLogout size={20} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  );
}
