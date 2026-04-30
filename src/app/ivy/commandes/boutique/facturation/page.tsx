'use client';

import { useEffect, useState, useCallback } from 'react';
import { Loader } from '@mantine/core';
import { IconFileInvoice, IconCheck, IconX } from '@tabler/icons-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { VariantCheckboxGroup } from '@/components/VariantCheckboxGroup';
import { FilterChip } from '@/components/FilterChip';
import { StatusBadge } from '@/components/StatusBadge';
import { useShop } from '@/context/ShopContext';
import { supabase } from '@/supabase/client';
import { encodeFirestoreId } from '@/utils/firebase-helpers';
import { getColorFromVariant, getSizeFromVariant } from '@/utils/variant-helpers';
import { transformColor, loadColorMappingsFromSupabase } from '@/utils/color-transformer';
import { useMonthlyBalance } from '@/hooks/useMonthlyBalance';
import styles from './facturation.module.scss';

interface LineItem {
  id: string;
  title: string;
  quantity: number;
  sku: string;
  variantTitle?: string;
  unitCost?: number | null;
  totalCost?: number | null;
  isCancelled?: boolean;
  variant?: {
    selectedOptions?: Array<{ name: string; value: string }>;
  };
}

interface Order {
  id: string;
  shopify_id: string;
  name: string;
  order_number: string;
  created_at: string;
  display_financial_status: string;
  tags: string[];
  line_items: LineItem[];
}

interface MonthlyBillingStatus {
  is_invoiced: boolean;
  is_paid: boolean;
}

function formatEuro(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

export default function FacturationBoutiquePage() {
  const { currentShop } = useShop();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [handlingFee, setHandlingFee] = useState(0);
  // Map: "encodedOrderId::productIndex" -> checkedCount
  const [checkedCounts, setCheckedCounts] = useState<Record<string, number>>({});
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [billingStatus, setBillingStatus] = useState<MonthlyBillingStatus>({ is_invoiced: false, is_paid: false });
  const { balance: monthlyBalance, updateBalance: updateMonthlyBalance } = useMonthlyBalance(selectedMonth);

  const fetchData = useCallback(async () => {
    if (!currentShop) return;

    setLoading(true);
    try {
      // Charger les mappings de couleurs
      await loadColorMappingsFromSupabase(currentShop.id);

      // Charger les paramètres (coût de manutention)
      const settingsRes = await fetch(`/api/settings/orders?shopId=${currentShop.id}`);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setHandlingFee(data.settings?.handling_fee || 0);
      }

      // Charger les commandes
      const { data: ordersData, error } = await supabase
        .from('orders')
        .select('*')
        .eq('shop_id', currentShop.id)
        .is('cancelled_at', null)
        .neq('display_financial_status', 'REFUNDED')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filtrer les commandes batch
      const filteredOrders = (ordersData || []).filter(
        (order: any) => !order.tags?.some((tag: string) => tag.toLowerCase().includes('batch'))
      );

      setOrders(filteredOrders);

      // Charger les checked counts depuis line_item_checks
      const { data: checks } = await supabase
        .from('line_item_checks')
        .select('order_id, product_index')
        .eq('shop_id', currentShop.id)
        .eq('checked', true);

      if (checks) {
        const counts: Record<string, number> = {};
        for (const check of checks) {
          const key = `${check.order_id}::${check.product_index}`;
          counts[key] = (counts[key] || 0) + 1;
        }
        setCheckedCounts(counts);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  const fetchBillingStatus = useCallback(async () => {
    if (!currentShop || !selectedMonth) return;

    try {
      const res = await fetch(`/api/billing/monthly-status?shopId=${currentShop.id}&monthKey=${selectedMonth}`);
      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data.status || { is_invoiced: false, is_paid: false });
      }
    } catch (err) {
      console.error('Error fetching billing status:', err);
    }
  }, [currentShop, selectedMonth]);

  const updateBillingStatus = async (field: 'isInvoiced' | 'isPaid', value: boolean) => {
    if (!currentShop) return;

    try {
      const res = await fetch('/api/billing/monthly-status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId: currentShop.id,
          monthKey: selectedMonth,
          [field]: value,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data.status);
      }
    } catch (err) {
      console.error('Error updating billing status:', err);
    }
  };

  // Recharger les checked counts depuis Supabase
  const reloadCheckedCounts = useCallback(async () => {
    if (!currentShop) return;
    const { data: checks } = await supabase
      .from('line_item_checks')
      .select('order_id, product_index')
      .eq('shop_id', currentShop.id)
      .eq('checked', true);

    if (checks) {
      const counts: Record<string, number> = {};
      for (const check of checks) {
        const key = `${check.order_id}::${check.product_index}`;
        counts[key] = (counts[key] || 0) + 1;
      }
      setCheckedCounts(counts);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchBillingStatus();
  }, [fetchBillingStatus]);

  // Écouter les changements de checks en temps réel
  useEffect(() => {
    if (!currentShop) return;

    const channel = supabase
      .channel('facturation-checks')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'line_item_checks', filter: `shop_id=eq.${currentShop.id}` },
        () => reloadCheckedCounts()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentShop, reloadCheckedCounts]);

  // Grouper les commandes par mois
  const ordersByMonth = orders.reduce<Record<string, Order[]>>((acc, order) => {
    const date = new Date(order.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!acc[monthKey]) acc[monthKey] = [];
    acc[monthKey].push(order);
    return acc;
  }, {});

  // Extraire la liste des mois disponibles
  const availableMonths = [...new Set(orders.map(order => {
    const date = new Date(order.created_at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }))].sort().reverse();

  const monthOptions = availableMonths.map(monthKey => {
    const [year, month] = monthKey.split('-');
    const monthTitle = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
    return { value: monthKey, label: monthTitle, count: ordersByMonth[monthKey]?.length || 0 };
  });

  const formatVariant = (variantTitle?: string) => {
    if (!variantTitle) return '';
    return variantTitle.split(' / ').map(part => transformColor(part)).join(' - ');
  };

  const getItemBilledCost = (order: Order, item: LineItem, index: number): number => {
    const encodedOrderId = encodeFirestoreId(order.shopify_id);
    const key = `${encodedOrderId}::${index}`;
    const checked = checkedCounts[key] || 0;
    return checked * (item.unitCost || 0);
  };

  const calculateOrderCost = (order: Order): number => {
    const itemsCost = order.line_items.reduce((sum, item, idx) => {
      if (item.isCancelled) return sum;
      return sum + getItemBilledCost(order, item, idx);
    }, 0);
    return itemsCost + (itemsCost > 0 ? handlingFee : 0);
  };

  const calculateMonthlySubtotal = (monthOrders: Order[]): number => {
    return monthOrders.reduce((sum, order) => sum + calculateOrderCost(order), 0);
  };

  const calculateMonthlyTotal = (monthOrders: Order[]): number => {
    return calculateMonthlySubtotal(monthOrders) + monthlyBalance;
  };

  const currentMonthOrders = ordersByMonth[selectedMonth] || [];
  const currentMonthLabel = (() => {
    const [year, month] = selectedMonth.split('-');
    if (!year || !month) return '';
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });
  })();

  const monthlyTotal = calculateMonthlyTotal(currentMonthOrders);

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Atelier · Runes de Chêne</div>
          <h1 className={styles.title}>
            Facturation <em>mensuelle</em>
          </h1>
          <div className={styles.sub}>
            {loading ? (
              <span>Chargement…</span>
            ) : (
              <>
                <span>{currentMonthOrders.length} commande{currentMonthOrders.length > 1 ? 's' : ''}</span>
                <span className={styles.subSep}>·</span>
                <span>{formatEuro(monthlyTotal)} HT ce mois</span>
              </>
            )}
          </div>
        </div>
      </header>

      {loading ? (
        <div className={styles.loaderWrap}>
          <Loader size="lg" color="var(--moss)" />
        </div>
      ) : (
        <>
          {monthOptions.length > 0 && (
            <div className={styles.filterBar}>
              <span className={styles.filterLabel}>Mois</span>
              {monthOptions.map((opt) => (
                <FilterChip
                  key={opt.value}
                  active={selectedMonth === opt.value}
                  count={opt.count}
                  onClick={() => setSelectedMonth(opt.value)}
                >
                  {opt.label}
                </FilterChip>
              ))}
            </div>
          )}

          {currentMonthOrders.length === 0 ? (
            <div className={styles.emptyState}>Aucune commande pour ce mois.</div>
          ) : (
            <div className={styles.monthPanel}>
              <div className={styles.monthHeader}>
                <div className={styles.monthHeaderLeft}>
                  <h2 className={styles.monthTitle}>{currentMonthLabel}</h2>
                  <div className={styles.monthSub}>
                    {currentMonthOrders.length} commande{currentMonthOrders.length > 1 ? 's' : ''}
                  </div>
                </div>
                <div className={styles.monthHeaderRight}>
                  {billingStatus.is_invoiced ? (
                    <StatusBadge variant="moss">Facturé</StatusBadge>
                  ) : (
                    <StatusBadge variant="sand">Non facturé</StatusBadge>
                  )}
                  {billingStatus.is_paid ? (
                    <StatusBadge variant="moss">Payée</StatusBadge>
                  ) : billingStatus.is_invoiced ? (
                    <StatusBadge variant="clay">Impayée</StatusBadge>
                  ) : null}

                  <button
                    type="button"
                    className={billingStatus.is_invoiced ? styles.btnGhost : styles.btnPrimary}
                    onClick={() => updateBillingStatus('isInvoiced', !billingStatus.is_invoiced)}
                  >
                    {billingStatus.is_invoiced ? (
                      <>
                        <IconCheck size={14} /> Mois facturé
                      </>
                    ) : (
                      <>
                        <IconFileInvoice size={14} /> Marquer facturé
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className={billingStatus.is_paid ? styles.btnGhost : styles.btnMoss}
                    onClick={() => updateBillingStatus('isPaid', !billingStatus.is_paid)}
                    disabled={!billingStatus.is_invoiced}
                  >
                    {billingStatus.is_paid ? (
                      <>
                        <IconCheck size={14} /> Facture payée
                      </>
                    ) : (
                      <>
                        <IconX size={14} /> Marquer payée
                      </>
                    )}
                  </button>

                  <span className={styles.totalPill}>
                    {formatEuro(monthlyTotal)}
                    <em>HT</em>
                  </span>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th} style={{ width: 110 }}>Date</th>
                      <th className={styles.th} style={{ width: 110 }}>Commande</th>
                      <th className={styles.th}>Contenu</th>
                      <th className={`${styles.th} ${styles.thRight}`} style={{ width: 130 }}>Coût articles</th>
                      <th className={`${styles.th} ${styles.thRight}`} style={{ width: 110 }}>Manutention</th>
                      <th className={`${styles.th} ${styles.thRight}`} style={{ width: 110 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentMonthOrders.map((order) => {
                      const itemsCost = order.line_items.reduce((sum, item, idx) => {
                        if (item.isCancelled) return sum;
                        return sum + getItemBilledCost(order, item, idx);
                      }, 0);
                      const totalCost = itemsCost + (itemsCost > 0 ? handlingFee : 0);

                      return (
                        <tr key={order.id} className={styles.row}>
                          <td className={`${styles.td} ${styles.tdDate}`}>
                            {format(new Date(order.created_at), 'dd/MM/yyyy', { locale: fr })}
                          </td>
                          <td className={`${styles.td} ${styles.tdOrderNum}`}>
                            #{order.order_number || order.name}
                          </td>
                          <td className={styles.td}>
                            <div>
                              {order.line_items
                                .map((item, index) => {
                                  if (item.isCancelled) return null;
                                  const color = getColorFromVariant(item);
                                  const size = getSizeFromVariant(item);
                                  const encodedOrderId = encodeFirestoreId(order.shopify_id);
                                  const billedCost = getItemBilledCost(order, item, index);
                                  const hasBilled = billedCost > 0;

                                  return (
                                    <div key={index} className={styles.itemRow}>
                                      <VariantCheckboxGroup
                                        orderId={encodedOrderId}
                                        sku={item.sku || ''}
                                        color={color}
                                        size={size}
                                        quantity={item.quantity}
                                        productIndex={index}
                                        variantTitle={item.variantTitle}
                                        lineItems={order.line_items.map(li => ({
                                          sku: li.sku || '',
                                          variantTitle: li.variantTitle,
                                          quantity: li.quantity,
                                        }))}
                                      />
                                      <div className={styles.itemLabel}>
                                        <span className={styles.itemQty}>{item.quantity}×</span>
                                        <span className={styles.itemSku}>{item.sku}</span>
                                        <span className={styles.itemVariant}>{formatVariant(item.variantTitle)}</span>
                                        {item.unitCost !== null && item.unitCost !== undefined && item.unitCost > 0 && (
                                          <span className={styles.itemUnit}>
                                            ({formatEuro(item.unitCost)}/u)
                                          </span>
                                        )}
                                      </div>
                                      <div
                                        className={`${styles.itemAmount} ${
                                          hasBilled ? styles.itemAmountActive : styles.itemAmountMuted
                                        }`}
                                      >
                                        {hasBilled ? formatEuro(billedCost) : '—'}
                                      </div>
                                    </div>
                                  );
                                })}
                            </div>
                          </td>
                          <td className={`${styles.td} ${styles.tdRight}`}>
                            <span className={itemsCost > 0 ? styles.amount : `${styles.amount} ${styles.amountMuted}`}>
                              {formatEuro(itemsCost)}
                            </span>
                          </td>
                          <td className={`${styles.td} ${styles.tdRight}`}>
                            <span className={`${styles.amount} ${styles.amountMuted}`}>
                              {formatEuro(itemsCost > 0 ? handlingFee : 0)}
                            </span>
                          </td>
                          <td className={`${styles.td} ${styles.tdRight}`}>
                            <span className={totalCost > 0 ? styles.amountTotal : `${styles.amount} ${styles.amountMuted}`}>
                              {formatEuro(totalCost)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className={styles.tfoot}>
                    <tr className={styles.footRow}>
                      <td className={styles.td} colSpan={3}>
                        <span className={styles.footLabel}>Sous-total du mois</span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <span className={styles.amount}>
                          {formatEuro(
                            currentMonthOrders.reduce((sum, o) => {
                              return sum + o.line_items.reduce((s, i, idx) => {
                                if (i.isCancelled) return s;
                                return s + getItemBilledCost(o, i, idx);
                              }, 0);
                            }, 0)
                          )}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <span className={styles.amount}>
                          {formatEuro(
                            currentMonthOrders.reduce((sum, o) => {
                              const hasChecked = o.line_items.some((i, idx) => {
                                if (i.isCancelled) return false;
                                return getItemBilledCost(o, i, idx) > 0;
                              });
                              return sum + (hasChecked ? handlingFee : 0);
                            }, 0)
                          )}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <span className={styles.amount}>{formatEuro(calculateMonthlySubtotal(currentMonthOrders))}</span>
                      </td>
                    </tr>
                    <tr className={`${styles.footRow} ${styles.balanceRow}`}>
                      <td className={styles.td} colSpan={5}>
                        <span className={styles.footLabel}>Balance (ajustement)</span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <div className={styles.balanceInputWrap}>
                          <input
                            type="number"
                            step="0.01"
                            value={monthlyBalance}
                            onChange={(e) => updateMonthlyBalance(Number(e.target.value) || 0)}
                            className={styles.balanceInput}
                          />
                        </div>
                      </td>
                    </tr>
                    <tr className={`${styles.footRow} ${styles.totalRow}`}>
                      <td className={styles.td} colSpan={5}>
                        <span className={styles.totalLabel}>
                          Total <em>du mois</em>
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.tdRight}`}>
                        <span className={styles.totalAmount}>
                          {formatEuro(monthlyTotal)}
                          <em>HT</em>
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
