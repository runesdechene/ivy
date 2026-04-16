'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader, Modal } from '@mantine/core';
import { IconArchive, IconArrowBack, IconTrash, IconPhoto } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import { StatusBadge } from '@/components/StatusBadge';
import { ProductThumbnail } from '@/components/ProductThumbnail';
import styles from './archives.module.scss';

interface ArchivedProduct {
  id: string;
  shopify_id: string;
  title: string;
  handle: string;
  image_url: string | null;
  product_type: string | null;
  synced_at: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    shopify_active: boolean;
  }>;
}

export default function ArchivesPage() {
  const { currentShop } = useShop();
  const [products, setProducts] = useState<ArchivedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedProduct | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchArchived = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`);
      if (response.ok) {
        const data = await response.json();
        setProducts(data.products || []);
      }
    } catch (err) {
      console.error('Error fetching archived products:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  const handleRestore = async (product: ArchivedProduct) => {
    if (!currentShop) return;
    setRestoring(product.id);
    try {
      const params = new URLSearchParams({ productId: product.id, shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`, { method: 'PATCH' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur');
      }
      setProducts(prev => prev.filter(p => p.id !== product.id));
      notifications.show({
        title: 'Produit restauré',
        message: `${product.title} est maintenant visible dans l'inventaire`,
        color: 'moss',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur';
      notifications.show({ title: 'Erreur', message, color: 'rust' });
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !currentShop) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ productId: deleteTarget.id, shopId: currentShop.id });
      const response = await fetch(`/api/inventory/archive?${params}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur');
      }
      setProducts(prev => prev.filter(p => p.id !== deleteTarget.id));
      notifications.show({
        title: 'Produit supprimé',
        message: `${deleteTarget.title} a été supprimé définitivement`,
        color: 'moss',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur';
      notifications.show({ title: 'Erreur', message, color: 'rust' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingWrap}>
          <Loader />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <div className={styles.eyebrow}>Inventaire · {shopName}</div>
        <h1 className={styles.title}>
          Archives <em>produits</em>
        </h1>
        <div className={styles.sub}>
          {products.length} produit{products.length > 1 ? 's' : ''} archivé{products.length > 1 ? 's' : ''}
        </div>
      </div>

      {products.length === 0 ? (
        <div className={styles.empty}>
          <IconArchive size={48} className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>Aucun produit archivé</div>
          <div className={styles.emptyHint}>
            Les produits supprimés ou désactivés sur Shopify apparaîtront ici après une synchronisation.
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {products.map(product => (
            <div key={product.id} className={styles.card}>
              <div className={styles.cardLeft}>
                <div className={styles.thumbWrap}>
                  {product.image_url ? (
                    <ProductThumbnail
                      imageUrl={product.image_url}
                      alt={product.title}
                      size={60}
                    />
                  ) : (
                    <div className={styles.thumbFallback} aria-hidden="true">
                      <IconPhoto size={24} />
                    </div>
                  )}
                </div>
                <div className={styles.info}>
                  <div className={styles.titleRow}>
                    <span className={styles.productTitle}>{product.title}</span>
                    <StatusBadge variant="slate">Archivé</StatusBadge>
                  </div>
                  <div className={styles.metaRow}>
                    {product.product_type && (
                      <span className={styles.typeChip}>{product.product_type}</span>
                    )}
                    <span className={styles.variantCount}>
                      {product.variants.length} variante{product.variants.length > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btnRestore}
                  onClick={() => handleRestore(product)}
                  disabled={restoring === product.id}
                >
                  <IconArrowBack size={14} />
                  {restoring === product.id ? 'Restauration…' : 'Restaurer'}
                </button>
                <button
                  type="button"
                  className={styles.btnDelete}
                  onClick={() => setDeleteTarget(product)}
                  aria-label="Supprimer définitivement"
                  title="Supprimer définitivement"
                >
                  <IconTrash size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de confirmation suppression */}
      <Modal
        opened={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={
          <span className={styles.modalTitle}>
            <IconTrash size={18} />
            Supprimer <em>définitivement</em>
          </span>
        }
        centered
        radius="lg"
        withCloseButton
      >
        <div className={styles.modalBody}>
          <div className={styles.modalText}>
            Supprimer définitivement <strong>{deleteTarget?.title}</strong> et ses{' '}
            {deleteTarget?.variants.length} variante
            {(deleteTarget?.variants.length || 0) > 1 ? 's' : ''} ?
          </div>
          <div className={styles.modalWarn}>
            Tout le stock associé sera perdu. Cette action est irréversible.
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnCancel}
              onClick={() => setDeleteTarget(null)}
            >
              Annuler
            </button>
            <button
              type="button"
              className={styles.btnConfirmDelete}
              onClick={handleDelete}
              disabled={deleting}
            >
              <IconTrash size={14} />
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
