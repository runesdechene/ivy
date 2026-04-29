'use client';

import { useMemo, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Loader } from '@mantine/core';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { useContainers } from '@/hooks/useContainers';
import { useContainerTypes } from '@/hooks/useContainerTypes';
import { ContainerCard } from '@/components/Logistique/ContainerCard';
import { AddContainerModal } from '@/components/Logistique/AddContainerModal';
import { AssignProductsModal } from '@/components/Logistique/AssignProductsModal';
import styles from './logistique.module.scss';

export default function LogistiquePage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const locationId = currentLocation?.id;

  const { data: instances = [], isLoading } = useContainers(currentShop?.id, locationId);
  const { data: types = [] } = useContainerTypes(currentShop?.id);

  const [adding, setAdding] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const counters = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of instances) {
      map.set(inst.type.name, (map.get(inst.type.name) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [instances]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrow}>
            Inventaire · {shopName}
            {currentLocation && ` · ${currentLocation.name}`}
          </div>
          <h1 className={styles.title}>
            <em>Logistique</em>
          </h1>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button
          className={styles.addBtn}
          onClick={() => setAdding(true)}
          disabled={!locationId}
        >
          <IconPlus size={14} />
          Ajouter un conteneur
        </button>
        {counters.length > 0 && (
          <div className={styles.counters}>
            {counters.map((c) => (
              <span key={c.name} className={styles.counter}>
                {c.count} × {c.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {!locationId ? (
        <div className={styles.empty}>Sélectionne un emplacement pour gérer ses conteneurs.</div>
      ) : isLoading ? (
        <div className={styles.empty}>
          <Loader size="sm" />
        </div>
      ) : instances.length === 0 ? (
        <div className={styles.empty}>
          Aucun conteneur dans <strong>{currentLocation?.name}</strong>. Ajoute-en un pour commencer.
        </div>
      ) : (
        <div className={styles.grid}>
          {instances.map((inst) => (
            <ContainerCard
              key={inst.id}
              instance={inst}
              onAssign={() => setAssigningId(inst.id)}
            />
          ))}
        </div>
      )}

      {adding && currentShop && locationId && (
        <AddContainerModal
          opened={adding}
          onClose={() => setAdding(false)}
          shopId={currentShop.id}
          locationId={locationId}
          existingTypes={types}
        />
      )}

      {assigningId && currentShop && (() => {
        const target = instances.find((i) => i.id === assigningId);
        if (!target) return null;
        return (
          <AssignProductsModal
            opened={!!assigningId}
            onClose={() => setAssigningId(null)}
            instance={target}
            shopId={currentShop.id}
          />
        );
      })()}
    </div>
  );
}
