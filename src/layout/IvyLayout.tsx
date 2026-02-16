'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './IvyLayout.module.scss';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { Badge, Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHome, IconPackage, IconTruck, IconChartBar, IconPrinter, IconShoppingCart, IconFileInvoice, IconArchive, IconRefresh, IconChecklist, IconHistory, IconCash, IconChartPie } from '@tabler/icons-react';
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
  const [orderCounts, setOrderCounts] = useState<{ atelier: number; stock: number }>({ atelier: 0, stock: 0 });

  const isCommandesSection = pathname.startsWith('/ivy/commandes');
  const isInventaireSection = pathname.startsWith('/ivy/inventaire');
  const isStandSection = pathname.startsWith('/ivy/stand');
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
        // Déclencher un refresh des pages et des compteurs
        window.dispatchEvent(new CustomEvent('orders-synced'));
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

  // Charger les compteurs de commandes actives
  const fetchOrderCounts = useCallback(async () => {
    if (!currentShop) return;
    try {
      const res = await fetch(`/api/orders/counts?shopId=${currentShop.id}`);
      if (res.ok) {
        const data = await res.json();
        setOrderCounts({ atelier: data.atelier || 0, stock: data.stock || 0 });
      }
    } catch {
      // Silencieux
    }
  }, [currentShop]);

  useEffect(() => {
    if (isCommandesSection) {
      fetchOrderCounts();
    }
  }, [isCommandesSection, fetchOrderCounts]);

  // Rafraîchir les compteurs après une sync
  useEffect(() => {
    const handler = () => fetchOrderCounts();
    window.addEventListener('orders-synced', handler);
    return () => window.removeEventListener('orders-synced', handler);
  }, [fetchOrderCounts]);

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
      title: 'Atelier',
      items: [
        {
          href: '/ivy/commandes/boutique',
          label: 'Commandes',
          icon: IconShoppingCart,
          exact: true,
          badge: orderCounts.atelier > 0 ? orderCounts.atelier : null,
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
          badge: orderCounts.stock > 0 ? orderCounts.stock : null,
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
        {
          href: '/ivy/inventaire/archives',
          label: 'Archives',
          icon: IconArchive,
        },
      ],
    },
  ];

  const standMenu = [
    {
      title: 'Commandes stand',
      items: [
        {
          href: '/ivy/stand',
          label: 'Tableau de bord',
          icon: IconHome,
          exact: true,
        },
        {
          href: '/ivy/stand/historique',
          label: 'Historique',
          icon: IconHistory,
        },
        {
          href: '/ivy/stand/zones',
          label: 'Zones d\'étude',
          icon: IconChartPie,
        },
      ],
    },
  ];

  const menuCategories = isCommandesSection
    ? commandesMenu
    : isStandSection
      ? standMenu
      : inventaireMenu;

  // Section Caisse : pas de sidebar, layout plein écran
  if (isCaisseSection) {
    return <div className={styles.fullscreen}>{children}</div>;
  }

  const showSyncButton = isCommandesSection;
  const showLocationSelector = isInventaireSection || isStandSection;

  return (
    <div className={styles.view}>
      <div className={styles.menu}>
        <div className={styles.menu_header}>
          {showSyncButton ? (
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
          ) : showLocationSelector ? (
            <LocationSelector />
          ) : null}
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
                        {item.badge && (
                          <Badge size="xs" variant="filled" color="orange" ml="auto">
                            {item.badge}
                          </Badge>
                        )}
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
