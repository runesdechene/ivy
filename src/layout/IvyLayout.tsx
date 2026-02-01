'use client';

import { useState } from 'react';
import styles from './IvyLayout.module.scss';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHome, IconPackage, IconTruck, IconChartBar, IconPrinter, IconShoppingCart, IconFileInvoice, IconArchive, IconRefresh, IconChecklist } from '@tabler/icons-react';
import { LocationProvider } from '@/context/LocationContext';
import { LocationSelector } from '@/components/LocationSelector';
import { useShop } from '@/context/ShopContext';

interface IvyLayoutProps {
  children: React.ReactNode;
}

function IvyLayoutContent({ children }: IvyLayoutProps) {
  const pathname = usePathname();
  const { currentShop } = useShop();
  const [syncing, setSyncing] = useState(false);
  
  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isCaisseSection = pathname.startsWith('/ivy/caisse');

  const handleSync = async () => {
    if (!currentShop || syncing) return;
    
    setSyncing(true);
    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id }),
      });
      
      if (response.ok) {
        const data = await response.json();
        const newCount = data.newOrdersCount || 0;
        
        notifications.show({
          title: 'Synchronisation terminée',
          message: newCount > 0 
            ? `${newCount} nouvelle(s) commande(s) importée(s)` 
            : 'Aucune nouvelle commande',
          color: 'green',
        });
        // Déclencher un refresh de la page si on est sur les commandes boutique
        if (pathname.startsWith('/ivy/commandes/boutique')) {
          window.dispatchEvent(new CustomEvent('orders-synced'));
        }
      } else {
        throw new Error('Sync failed');
      }
    } catch (err) {
      console.error('Error syncing:', err);
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de synchroniser les commandes',
        color: 'red',
      });
    } finally {
      setSyncing(false);
    }
  };

  // Menu contextuel selon la section
  const commandesMenu = [
    {
      title: '',
      items: [
        {
          href: '/ivy/commandes',
          label: 'Vue d\'ensemble',
          icon: IconHome,
        },
      ],
    },
    {
      title: 'Commandes boutique',
      items: [
        {
          href: '/ivy/commandes/boutique',
          label: 'Commandes',
          icon: IconShoppingCart,
          exact: true,
        },
        {
          href: '/ivy/commandes/boutique/suivi',
          label: 'Suivi interne',
          icon: IconChecklist,
          exact: true,
        },
        {
          href: '/ivy/commandes/boutique/facturation',
          label: 'Facturation',
          icon: IconFileInvoice,
          exact: true,
        },
        {
          href: '/ivy/commandes/boutique/archives',
          label: 'Archives',
          icon: IconArchive,
          exact: true,
        },
      ],
    },
    {
      title: 'Commandes stock',
      items: [
        {
          href: '/ivy/commandes/stock',
          label: 'Commandes',
          icon: IconTruck,
        },
      ],
    },
  ];

  const inventaireMenu = [
    {
      title: 'Inventaire',
      items: [
        {
          href: '/ivy/inventaire',
          label: 'Tableau de bord',
          icon: IconHome,
          exact: true,
        },
        {
          href: '/ivy/inventaire/produits',
          label: 'Produits',
          icon: IconPackage,
        },
        {
          href: '/ivy/inventaire/statistiques',
          label: 'Statistiques',
          icon: IconChartBar,
        },
      ],
    },
  ];

  const menuCategories = isCommandesSection ? commandesMenu : inventaireMenu;

  // Section Caisse : pas de sidebar, layout plein écran
  if (isCaisseSection) {
    return <div className={styles.fullscreen}>{children}</div>;
  }

  return (
    <div className={styles.view}>
      <div className={styles.menu}>
        <div className={styles.menu_header}>
          {isCommandesSection ? (
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              fullWidth
              onClick={handleSync}
              loading={syncing}
              disabled={!currentShop}
            >
              Synchroniser
            </Button>
          ) : (
            <LocationSelector />
          )}
        </div>
        <ul className={styles.menu_links}>
          {menuCategories.map((category) => (
            <li key={category.title || 'main'} className={styles.menu_category}>
              {category.title && (
                <div className={styles.menu_category_title}>{category.title}</div>
              )}
              <ul>
                {category.items.map((item: any) => {
                  const Icon = item.icon;
                  const isActive = item.exact 
                    ? pathname === item.href 
                    : pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={clsx({
                          [styles.active]: isActive,
                        })}
                      >
                        <Icon size={16} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

// Wrapper avec le LocationProvider
export const IvyLayout = ({ children }: IvyLayoutProps) => {
  return (
    <LocationProvider>
      <IvyLayoutContent>{children}</IvyLayoutContent>
    </LocationProvider>
  );
};
