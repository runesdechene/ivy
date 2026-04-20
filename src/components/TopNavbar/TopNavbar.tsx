'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Tooltip } from '@mantine/core';
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

  const navItems = [
    { label: 'Atelier', icon: IconBuildingStore, active: isCommandesSection, href: '/ivy/commandes' },
    { label: 'Festivals', icon: IconTent, active: isStandSection, href: '/ivy/stand' },
    { label: 'Inventaire', icon: null, active: isInventaireSection, href: '/ivy/inventaire' },
    { label: 'HUB de stand', icon: IconPackage, active: isHubSection, href: '/ivy/hub' },
  ];

  return (
    <div className={styles.topNavbar}>
      <div className={styles.left}>
        <IvyMark size="md" withParent />
        <div className={styles.separator} />
        <nav className={styles.nav}>
          {navItems.map(({ label, icon: Icon, active, href }) => (
            <button
              key={href}
              type="button"
              className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
              onClick={() => router.push(href)}
            >
              {Icon && <Icon size={16} />}
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className={styles.right}>
        <ShopSelector />
        <span className={styles.version}>v{APP_VERSION}</span>
        <Tooltip label="Profil">
          <button type="button" className={styles.iconBtn} onClick={() => router.push('/ivy/profil')}>
            <IconUser size={18} />
          </button>
        </Tooltip>
        <Tooltip label="Options globales">
          <button type="button" className={styles.iconBtn} onClick={() => router.push('/parametres')}>
            <IconSettings size={18} />
          </button>
        </Tooltip>
        <Tooltip label="Déconnexion">
          <button type="button" className={styles.iconBtn} onClick={handleLogout}>
            <IconLogout size={18} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
