'use client';

import styles from './IvyLayout.module.scss';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { IconPalette, IconTag, IconShoppingCart, IconCurrencyEuro } from '@tabler/icons-react';

interface ParametresLayoutProps {
  children: React.ReactNode;
}

export function ParametresLayout({ children }: ParametresLayoutProps) {
  const pathname = usePathname();

  const menuCategories = [
    {
      title: 'Options globales',
      items: [
        {
          href: '/parametres',
          label: 'Commandes',
          icon: IconShoppingCart,
          exact: true,
        },
        {
          href: '/parametres/couleurs',
          label: 'Couleurs',
          icon: IconPalette,
        },
        {
          href: '/parametres/metachamps',
          label: 'Métachamps',
          icon: IconTag,
        },
        {
          href: '/parametres/prix',
          label: 'Règles de prix',
          icon: IconCurrencyEuro,
        },
      ],
    },
  ];

  return (
    <div className={styles.view}>
      <div className={styles.menu}>
        <ul className={styles.menu_links}>
          {menuCategories.map((category) => (
            <li key={category.title} className={styles.menu_category}>
              <div className={styles.menu_category_title}>{category.title}</div>
              <ul>
                {category.items.map((item) => {
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
