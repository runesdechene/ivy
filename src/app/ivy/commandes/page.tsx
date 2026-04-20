'use client';

import { IconPrinter, IconTruck } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import styles from './commandes.module.scss';

export default function CommandesPage() {
  const router = useRouter();

  return (
    <div className={styles.container}>
      <div className={styles.eyebrow}>Atelier · Runes de Chêne</div>
      <h1 className={styles.title}>Commandes</h1>
      <p className={styles.sub}>Gérez vos commandes fournisseurs et suivez la production en atelier.</p>

      <div className={styles.grid}>
        <button
          type="button"
          className={styles.card}
          onClick={() => router.push('/ivy/commandes/batch')}
        >
          <div className={styles.cardIcon} style={{ background: 'var(--plum-bg)', color: 'var(--plum)' }}>
            <IconPrinter size={28} />
          </div>
          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>Atelier <em>(Impression)</em></h3>
            <p className={styles.cardText}>
              Vue simplifiée pour l'imprimeur. Visualisez les articles à produire et cochez-les au fur et à mesure.
            </p>
          </div>
        </button>

        <button
          type="button"
          className={styles.card}
          onClick={() => router.push('/ivy/commandes/fournisseurs')}
        >
          <div className={styles.cardIcon} style={{ background: 'var(--clay-bg)', color: 'var(--clay)' }}>
            <IconTruck size={28} />
          </div>
          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>Commandes <em>fournisseurs</em></h3>
            <p className={styles.cardText}>
              Créez et gérez vos commandes batch auprès de vos fournisseurs. Suivez les statuts et les coûts.
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
