'use client';

import { IconChartHistogram } from '@tabler/icons-react';
import styles from '../dashboard.module.scss';

export default function AnalyticsPage() {
  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Inventaire · Runes de Chêne</div>
          <h1 className={styles.title}>
            Statistiques <em>d&apos;inventaire</em>
          </h1>
          <div className={styles.sub}>
            <span>Analyses détaillées par période et produit</span>
          </div>
        </div>
      </div>

      <div className={styles.placeholderCard}>
        <IconChartHistogram size={42} color="var(--slate-muted)" />
        <div className={styles.placeholderTitle}>
          Bientôt <em style={{ fontStyle: 'italic', color: 'var(--moss)' }}>disponible</em>
        </div>
        <div className={styles.placeholderHint}>
          Cet espace accueillera des analyses approfondies : rotation du stock,
          évolution temporelle, prévisions d&apos;achat. En cours de construction.
        </div>
      </div>
    </div>
  );
}
