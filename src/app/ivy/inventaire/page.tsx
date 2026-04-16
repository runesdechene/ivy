'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader, SimpleGrid, Button, Menu, Checkbox, NumberInput,
} from '@mantine/core';
import {
  IconPackage, IconCurrencyEuro, IconPalette, IconRuler2,
  IconChartBar, IconTrendingUp, IconMapPin, IconDownload,
  IconFileSpreadsheet, IconChevronDown, IconListDetails,
  IconPrinter,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import { useLocation } from '@/context/LocationContext';
import { generateInventoryCsv, generateSummaryCsv, downloadCsv, type SaleValueOptions } from '@/utils/csv-export';
import { printSummaryPdf, printDetailPdf } from '@/utils/pdf-export';
import { getColorHex, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import styles from './dashboard.module.scss';

interface Stats {
  totalStock: number;
  totalStockValue: number;
  totalSaleValue: number;
  potentialProfit: number;
  byProductType: Record<string, { count: number; stock: number; value: number; saleValue: number }>;
  byColor: Record<string, { count: number; stock: number }>;
  bySize: Record<string, { count: number; stock: number }>;
  topProducts: { title: string; stock: number; value: number; saleValue: number }[];
}

export default function InventaireDashboardPage() {
  const { currentShop } = useShop();
  const { currentLocation } = useLocation();
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [includeSaleValue, setIncludeSaleValue] = useState(false);
  const [saleValueModifier, setSaleValueModifier] = useState<number>(0);

  const fetchStats = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      await loadColorMappingsFromSupabase(currentShop.id);

      const params = new URLSearchParams({ shopId: currentShop.id });
      if (currentLocation?.id) {
        params.append('locationId', currentLocation.id);
      }

      const response = await fetch(`/api/inventory/stats?${params}`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop, currentLocation]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const saleValueOpts: SaleValueOptions = { include: includeSaleValue, modifier: saleValueModifier };

  const handleExportCsv = useCallback(async () => {
    if (!currentShop) return;

    setExporting(true);
    try {
      const params = new URLSearchParams({ shopId: currentShop.id });
      if (currentLocation?.id) {
        params.append('locationId', currentLocation.id);
      }

      const response = await fetch(`/api/products?${params}`);
      if (!response.ok) throw new Error('Erreur API');

      const { products } = await response.json();
      const csv = generateInventoryCsv(products, saleValueOpts);
      const date = new Date().toISOString().slice(0, 10);
      const locationLabel = currentLocation?.name || 'tous';
      downloadCsv(csv, `inventaire_${locationLabel}_${date}.csv`);
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: "Impossible d'exporter l'inventaire",
        color: 'rust',
      });
    } finally {
      setExporting(false);
    }
  }, [currentShop, currentLocation, saleValueOpts]);

  const handleExportSummary = useCallback(() => {
    if (!stats) return;

    const date = new Date().toISOString().slice(0, 10);
    const locationLabel = currentLocation?.name || 'tous';
    const csv = generateSummaryCsv(
      stats.byProductType,
      stats.totalStock,
      stats.totalStockValue,
      saleValueOpts,
    );
    downloadCsv(csv, `resume_inventaire_${locationLabel}_${date}.csv`);
  }, [stats, currentLocation, saleValueOpts]);

  const handlePrintSummary = useCallback(() => {
    if (!stats) return;
    printSummaryPdf(
      stats.byProductType,
      stats.totalStock,
      stats.totalStockValue,
      currentLocation?.name,
      saleValueOpts,
    );
  }, [stats, currentLocation, saleValueOpts]);

  const handlePrintDetail = useCallback(async () => {
    if (!currentShop) return;

    setExporting(true);
    try {
      const params = new URLSearchParams({ shopId: currentShop.id });
      if (currentLocation?.id) {
        params.append('locationId', currentLocation.id);
      }

      const response = await fetch(`/api/products?${params}`);
      if (!response.ok) throw new Error('Erreur API');

      const { products } = await response.json();
      printDetailPdf(products, currentLocation?.name, saleValueOpts);
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: 'Impossible de générer le PDF',
        color: 'rust',
      });
    } finally {
      setExporting(false);
    }
  }, [currentShop, currentLocation, saleValueOpts]);

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingWrap}>
          <Loader color="moss" />
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className={styles.container}>
        <div className={styles.errorWrap}>
          Impossible de charger les statistiques.
        </div>
      </div>
    );
  }

  const maxStock = Math.max(...Object.values(stats.byProductType).map(t => t.stock), 1);
  const maxColorStock = Math.max(...Object.values(stats.byColor).map(c => c.stock), 1);

  // Ordre des tailles pour le tri
  const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL'];
  const sortedSizes = Object.entries(stats.bySize).sort((a, b) => {
    const indexA = sizeOrder.indexOf(a[0]);
    const indexB = sizeOrder.indexOf(b[0]);
    if (indexA === -1 && indexB === -1) return a[0].localeCompare(b[0]);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
  const maxSizeStock = Math.max(...sortedSizes.map(([, s]) => s.stock), 1);

  const productTypeCount = Object.keys(stats.byProductType).length;

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Inventaire · {shopName}</div>
          <h1 className={styles.title}>
            Tableau <em>de bord</em>
          </h1>
          <div className={styles.sub}>
            <span>{stats.totalStock.toLocaleString('fr-FR')} unités en stock</span>
            <span className={styles.subSep}>·</span>
            <span>{productTypeCount} type{productTypeCount > 1 ? 's' : ''} de produit</span>
            {currentLocation && (
              <>
                <span className={styles.subSep}>·</span>
                <span className={styles.locationChip}>
                  <IconMapPin size={11} />
                  {currentLocation.name}
                </span>
              </>
            )}
          </div>
        </div>

        <Menu shadow="md" width={260} radius="md">
          <Menu.Target>
            <Button
              variant="light"
              color="moss"
              leftSection={<IconDownload size={16} />}
              rightSection={<IconChevronDown size={14} />}
              loading={exporting}
              size="sm"
              radius="md"
            >
              Exporter
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <div className={styles.exportConfig}>
              <Checkbox
                label="Inclure valeur de vente"
                checked={includeSaleValue}
                onChange={(e) => setIncludeSaleValue(e.currentTarget.checked)}
                size="xs"
                color="moss"
              />
              {includeSaleValue && (
                <NumberInput
                  label="Modulation"
                  value={saleValueModifier}
                  onChange={(v) => setSaleValueModifier(typeof v === 'number' ? v : 0)}
                  suffix=" %"
                  allowNegative
                  step={5}
                  size="xs"
                  mt={8}
                  styles={{ input: { width: 100 } }}
                />
              )}
            </div>
            <Menu.Divider />
            <Menu.Label>CSV (tableur)</Menu.Label>
            <Menu.Item
              leftSection={<IconFileSpreadsheet size={16} />}
              onClick={handleExportSummary}
            >
              Résumé par type
            </Menu.Item>
            <Menu.Item
              leftSection={<IconListDetails size={16} />}
              onClick={handleExportCsv}
            >
              Détail par variante
            </Menu.Item>
            <Menu.Divider />
            <Menu.Label>PDF (impression)</Menu.Label>
            <Menu.Item
              leftSection={<IconPrinter size={16} />}
              onClick={handlePrintSummary}
            >
              Résumé par type
            </Menu.Item>
            <Menu.Item
              leftSection={<IconPrinter size={16} />}
              onClick={handlePrintDetail}
            >
              Détail par variante
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      {/* Cartes principales */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Unités en stock</div>
            <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
              {stats.totalStock.toLocaleString('fr-FR')}
            </div>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_slate}`}>
            <IconPackage size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Coût du stock</div>
            <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
              {stats.totalStockValue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
              <span className={styles.metricUnit}>€</span>
            </div>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_clay}`}>
            <IconCurrencyEuro size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Valeur de vente</div>
            <div className={`${styles.metricValue} ${styles.metricValueNeutral}`}>
              {stats.totalSaleValue.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
              <span className={styles.metricUnit}>€</span>
            </div>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_plum}`}>
            <IconChartBar size={20} />
          </div>
        </div>

        <div className={styles.metricCard}>
          <div className={styles.metricBody}>
            <div className={styles.metricLabel}>Profit potentiel</div>
            <div className={`${styles.metricValue} ${stats.potentialProfit >= 0 ? styles.metricValuePositive : styles.metricValueNegative}`}>
              {stats.potentialProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}
              <span className={styles.metricUnit}>€</span>
            </div>
          </div>
          <div className={`${styles.metricIcon} ${styles.metricIcon_moss}`}>
            <IconTrendingUp size={20} />
          </div>
        </div>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md" className={styles.panelsGrid}>
        {/* Stock par type de produit */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <IconPackage size={18} />
            </span>
            <h3 className={styles.panelTitle}>
              Stock par <em>type</em>
            </h3>
          </div>
          <div>
            {Object.entries(stats.byProductType).slice(0, 8).map(([type, data]) => (
              <div key={type} className={styles.row}>
                <div className={styles.rowHead}>
                  <div className={styles.rowLabel}>
                    <span className={styles.rowLabelText}>{type}</span>
                  </div>
                  <div className={styles.rowMetrics}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: 12, color: 'var(--slate-soft)' }}>
                      {data.stock.toLocaleString('fr-FR')}
                    </span>
                    <span style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontSize: 12, color: 'var(--moss)' }}>
                      {data.value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                    </span>
                  </div>
                </div>
                <div className={styles.bar}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${(data.stock / maxStock) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top produits */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <IconTrendingUp size={18} />
            </span>
            <h3 className={styles.panelTitle}>
              Top 10 <em>produits</em>
            </h3>
          </div>
          <div>
            {stats.topProducts.slice(0, 10).map((product, index) => (
              <div key={product.title} className={styles.row}>
                <div className={styles.rowHead}>
                  <div className={styles.rowLabel}>
                    <span className={styles.rankBadge}>{index + 1}</span>
                    <span className={styles.rowLabelText}>{product.title}</span>
                  </div>
                  <div className={styles.rowMetrics}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: 12, color: 'var(--slate-soft)' }}>
                      {product.stock.toLocaleString('fr-FR')}
                    </span>
                    <span style={{ fontFamily: 'var(--font-fraunces)', fontStyle: 'italic', fontSize: 12, color: 'var(--moss)' }}>
                      {product.value.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        {/* Couleurs les plus présentes */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <IconPalette size={18} />
            </span>
            <h3 className={styles.panelTitle}>
              Couleurs <em>présentes</em>
            </h3>
          </div>
          <div>
            {Object.entries(stats.byColor).slice(0, 12).map(([color, data]) => {
              const hex = getColorHex(color);
              const showSwatch = hex && hex !== '#808080';
              return (
                <div key={color} className={styles.row}>
                  <div className={styles.rowHead}>
                    <div className={styles.rowLabel}>
                      {showSwatch && (
                        <span
                          className={styles.colorSwatch}
                          style={{ background: hex }}
                        />
                      )}
                      <span className={styles.rowLabelText}>{color}</span>
                    </div>
                    <div className={styles.rowMetrics}>
                      <span style={{ fontFamily: 'var(--font-inter)', fontSize: 12, color: 'var(--slate-soft)' }}>
                        {data.stock.toLocaleString('fr-FR')}
                      </span>
                    </div>
                  </div>
                  <div className={styles.bar}>
                    <div
                      className={styles.barFill}
                      style={{
                        width: `${(data.stock / maxColorStock) * 100}%`,
                        ...(showSwatch ? { background: hex } : {}),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tailles les plus présentes */}
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <span className={styles.panelIcon}>
              <IconRuler2 size={18} />
            </span>
            <h3 className={styles.panelTitle}>
              Répartition par <em>taille</em>
            </h3>
          </div>
          <div>
            {sortedSizes.map(([size, data]) => (
              <div key={size} className={styles.row}>
                <div className={styles.rowHead}>
                  <div className={styles.rowLabel}>
                    <span className={styles.sizePill}>{size}</span>
                  </div>
                  <div className={styles.rowMetrics}>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: 12, color: 'var(--slate-soft)' }}>
                      {data.stock.toLocaleString('fr-FR')}
                    </span>
                  </div>
                </div>
                <div className={styles.bar}>
                  <div
                    className={`${styles.barFill} ${styles.barFill_clay}`}
                    style={{ width: `${(data.stock / maxSizeStock) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SimpleGrid>
    </div>
  );
}
