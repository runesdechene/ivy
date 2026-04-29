'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { Loader, SegmentedControl } from '@mantine/core';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import {
  useContainers,
  useReorderContainers,
  type ContainerInstance,
} from '@/hooks/useContainers';
import { useContainerTypes } from '@/hooks/useContainerTypes';
import { ContainerCard } from '@/components/Logistique/ContainerCard';
import { AddContainerModal } from '@/components/Logistique/AddContainerModal';
import { AssignProductsModal } from '@/components/Logistique/AssignProductsModal';
import { RefillModal } from '@/components/Logistique/RefillModal';
import styles from './logistique.module.scss';

function SortableCardWrapper({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function LogistiquePage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const locationId = currentLocation?.id;

  const { data, isLoading } = useContainers(currentShop?.id, locationId);
  const { data: types = [] } = useContainerTypes(currentShop?.id);
  const reorder = useReorderContainers();

  const [adding, setAdding] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [refillingId, setRefillingId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'color' | 'size'>('color');
  const [orderedInstances, setOrderedInstances] = useState<ContainerInstance[]>([]);

  // Sync local order with server data. We depend on `data` (stable from TanStack)
  // rather than a destructured default `[]` which would create a new ref every
  // render and trigger an infinite loop while loading.
  useEffect(() => {
    if (data) setOrderedInstances(data);
  }, [data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    if (!currentShop?.id || !locationId) return;

    const oldIndex = orderedInstances.findIndex((i) => i.id === active.id);
    const newIndex = orderedInstances.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(orderedInstances, oldIndex, newIndex);
    setOrderedInstances(next);

    reorder.mutate({
      orderedIds: next.map((i) => i.id),
      shopId: currentShop.id,
      locationId,
    });
  };

  const counters = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of orderedInstances) {
      map.set(inst.type.name, (map.get(inst.type.name) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [orderedInstances]);

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
        <SegmentedControl
          value={sortMode}
          onChange={(v) => setSortMode(v as 'color' | 'size')}
          data={[
            { label: 'Par couleur', value: 'color' },
            { label: 'Par taille', value: 'size' },
          ]}
          size="xs"
        />
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
      ) : orderedInstances.length === 0 ? (
        <div className={styles.empty}>
          Aucun conteneur dans <strong>{currentLocation?.name}</strong>. Ajoute-en un pour commencer.
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedInstances.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className={styles.grid}>
              {orderedInstances.map((inst) => (
                <SortableCardWrapper key={inst.id} id={inst.id}>
                  <ContainerCard
                    instance={inst}
                    sortMode={sortMode}
                    onAssign={() => setAssigningId(inst.id)}
                    onRefill={() => setRefillingId(inst.id)}
                  />
                </SortableCardWrapper>
              ))}
            </div>
          </SortableContext>
        </DndContext>
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
        const target = orderedInstances.find((i) => i.id === assigningId);
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

      {refillingId && currentShop && (
        <RefillModal
          opened={!!refillingId}
          onClose={() => setRefillingId(null)}
          containerId={refillingId}
          shopId={currentShop.id}
        />
      )}
    </div>
  );
}
