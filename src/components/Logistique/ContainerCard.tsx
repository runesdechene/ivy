'use client';

import { useMemo } from 'react';
import clsx from 'clsx';
import { ActionIcon, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconPencil, IconPackage, IconRefresh, IconTrash } from '@tabler/icons-react';
import type { ContainerInstance } from '@/hooks/useContainers';
import { useDeleteContainer, useRenameContainer } from '@/hooks/useContainers';
import { compareSizes } from '@/utils/size-helpers';
import styles from './ContainerCard.module.scss';

const UNIT = 260;

function colorToCss(hex: string | null | undefined): string {
  if (hex && /^#[0-9a-f]{3,8}$/i.test(hex)) return hex;
  return '#cdcdcd';
}

const eurFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const formatEur = (n: number): string => eurFormatter.format(n);

function weatherEmoji(pct: number): { emoji: string; label: string } {
  if (pct > 100) return { emoji: '⚠️', label: 'Saturée' };
  if (pct >= 70) return { emoji: '☀️', label: 'Bien rempli' };
  if (pct >= 40) return { emoji: '☁️', label: 'À surveiller' };
  return { emoji: '⛈️', label: 'À recommander' };
}

interface Props {
  instance: ContainerInstance;
  onAssign: () => void;
  onRefill: () => void;
  sortMode?: 'color' | 'size';
}

type Variant = ContainerInstance['variants'][number];

/**
 * Distribue les variantes en N colonnes en respectant l'ordre primaire :
 * - mode 'size' : XS → 5XL, top-gauche → bottom-droite
 * - mode 'color' : ordre alphabétique
 * On avance à la colonne suivante dès qu'on a atteint ~ totalQty / cols pour
 * équilibrer approximativement les hauteurs sans casser l'ordre.
 */
type Section = { key: string; items: Variant[]; total: number };
type Column = { sections: Section[]; total: number; sortKey: string };

/**
 * Distribution "flat" pour les caisses en mode filtre : pas de regroupement
 * par couleur/taille, chaque variante est sa propre cellule. Tri stable par
 * produit alpha → taille (si pas de filtre size) → couleur. Variants répartis
 * séquentiellement sur toutes les colonnes selon totalQty/cols.
 */
function distributeFlat(
  variants: Variant[],
  cols: number,
  hasSizeFilter: boolean,
): Column[] {
  const buckets: Column[] = Array.from({ length: cols }, () => ({
    sections: [],
    total: 0,
    sortKey: '',
  }));
  if (variants.length === 0) return buckets;

  const sorted = [...variants].sort((a, b) => {
    // Regrouper visuellement les variantes du même product_type quand on
    // mélange plusieurs types dans une caisse filtre (ex: Le Zippé +
    // Le Robuste) — sinon le tri alphabétique par titre les interleave.
    const typeCmp = (a.product_type || '').localeCompare(b.product_type || '');
    if (typeCmp !== 0) return typeCmp;
    const productCmp = (a.product_title || '').localeCompare(b.product_title || '');
    if (productCmp !== 0) return productCmp;
    if (!hasSizeFilter) {
      const sizeCmp = compareSizes(a.size, b.size);
      if (sizeCmp !== 0) return sizeCmp;
    }
    return (a.color || '').localeCompare(b.color || '');
  });

  const totalQty = sorted.reduce((s, v) => s + v.qty, 0);
  const targetPerCol = totalQty > 0 ? totalQty / cols : 0;

  // Distribution avec split possible : si une variante est trop grosse pour
  // tenir dans la col courante, on la coupe et on continue dans la suivante.
  // Garantit que toutes les cols se remplissent (tant qu'il y a assez de qty)
  // — nécessaire pour des caisses avec moins de variants que de colonnes.
  // La même variante apparaît alors dans plusieurs cellules, même couleur,
  // même label, hauteurs proportionnelles à leur portion respective.
  let colIdx = 0;
  let colTotal = 0;

  for (const v of sorted) {
    let remaining = v.qty;
    while (remaining > 0) {
      const isLastCol = colIdx === cols - 1;
      const colCapacity = Math.max(0, targetPerCol - colTotal);

      // Si la col courante n'a presque plus de place et qu'il reste des cols
      // non-dernières disponibles, on avance (évite de coller un mini-bout).
      if (!isLastCol && colCapacity < 0.5) {
        colIdx += 1;
        colTotal = 0;
        continue;
      }

      // La dernière col absorbe tout le reliquat ; les autres prennent au plus
      // round(capacity) unités, sans descendre sous 1 pour éviter les blocages.
      const take = isLastCol
        ? remaining
        : Math.min(remaining, Math.max(1, Math.round(colCapacity)));

      buckets[colIdx].sections.push({
        key: `${v.id}-c${colIdx}`,
        items: [{ ...v, qty: take }],
        total: take,
      });
      buckets[colIdx].total += take;
      colTotal += take;
      remaining -= take;

      if (!isLastCol && colTotal >= targetPerCol) {
        colIdx += 1;
        colTotal = 0;
      }
    }
  }

  return buckets;
}

function distributeOrdered(
  variants: Variant[],
  cols: number,
  mode: 'color' | 'size',
): Column[] {
  const buckets: Column[] = Array.from({ length: cols }, () => ({
    sections: [],
    total: 0,
    sortKey: '',
  }));
  if (variants.length === 0) return buckets;

  const groupKey = (v: Variant) => (mode === 'color' ? v.color || '_' : v.size || '_');
  const compareKeys = (a: string, b: string) =>
    mode === 'size' ? compareSizes(a, b) : a.localeCompare(b);

  const groups = new Map<string, Variant[]>();
  for (const v of variants) {
    const k = groupKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }

  // Tri secondaire dans chaque groupe (couleur dans une section taille, ou inverse)
  for (const items of groups.values()) {
    if (mode === 'color') items.sort((a, b) => compareSizes(a.size, b.size));
    else items.sort((a, b) => (a.color || '').localeCompare(b.color || ''));
  }

  // Sections triées par clé primaire — XS → 5XL ou alpha
  const sortedGroupEntries = Array.from(groups.entries()).sort((a, b) =>
    compareKeys(a[0], b[0]),
  );

  const totalQty = sortedGroupEntries.reduce(
    (s, [, items]) => s + items.reduce((ss, v) => ss + v.qty, 0),
    0,
  );
  const targetPerCol = totalQty > 0 ? totalQty / cols : 0;

  let colIdx = 0;
  let colTotal = 0;
  for (const [key, items] of sortedGroupEntries) {
    const sectionTotal = items.reduce((s, v) => s + v.qty, 0);
    if (colIdx < cols - 1 && colTotal > 0 && colTotal >= targetPerCol) {
      colIdx += 1;
      colTotal = 0;
    }
    buckets[colIdx].sections.push({ key, items, total: sectionTotal });
    buckets[colIdx].total += sectionTotal;
    colTotal += sectionTotal;
  }

  buckets.forEach((b) => {
    b.sortKey = b.sections[0]?.key ?? '';
  });

  return buckets;
}

export function ContainerCard({ instance, onAssign, onRefill, sortMode = 'color' }: Props) {
  const { type, fill, variants, products } = instance;
  const filterTypes = instance.filter_product_type ?? [];
  const filterSizes = instance.filter_size ?? [];
  const isFilterMode = filterTypes.length > 0 || filterSizes.length > 0;
  // On masque la dimension "taille" dans les labels uniquement quand on filtre
  // sur UNE seule taille — sinon les variantes M/L/XL doivent rester
  // distinguables visuellement.
  const hideSizeInLabel = filterSizes.length === 1;
  const deleteMut = useDeleteContainer();
  const renameMut = useRenameContainer();

  const cols = Math.max(1, type.columns ?? 1);
  const colCapacity = type.max_capacity / cols;

  const columnsData = useMemo(
    () =>
      isFilterMode
        ? distributeFlat(variants, cols, hideSizeInLabel)
        : distributeOrdered(variants, cols, sortMode),
    [variants, cols, sortMode, isFilterMode, hideSizeInLabel],
  );

  const w = UNIT * type.ratio_w;
  const h = UNIT * type.ratio_h;
  const realPct =
    type.max_capacity > 0
      ? Math.round((fill.units / type.max_capacity) * 100)
      : 0;
  const overflow = Math.max(0, fill.units - type.max_capacity);
  const weather = weatherEmoji(realPct);

  const displayName = instance.name?.trim() || type.name;

  const handleDelete = async () => {
    if (!confirm(`Retirer cette caisse "${displayName}" ?`)) return;
    await deleteMut.mutateAsync(instance.id);
  };

  const handleRename = async () => {
    const next = window.prompt('Nom de la caisse (vide = nom du type) :', instance.name ?? '');
    if (next === null) return;
    await renameMut.mutateAsync({ id: instance.id, name: next.trim() || null });
  };

  return (
    <div className={styles.card} style={{ width: w + 24 }}>
      <div className={styles.menu}>
        <Menu position="bottom-end" withArrow>
          <Menu.Target>
            <ActionIcon variant="subtle" size="md" color="gray" aria-label="Options">
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconRefresh size={14} />} onClick={onRefill}>
              Refournir
            </Menu.Item>
            <Menu.Item leftSection={<IconPackage size={14} />} onClick={onAssign}>
              Affecter des produits
            </Menu.Item>
            <Menu.Item leftSection={<IconPencil size={14} />} onClick={handleRename}>
              Renommer
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconTrash size={14} />}
              color="red"
              onClick={handleDelete}
            >
              Retirer la caisse
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      <div className={styles.thumbs}>
        {products.length === 0 ? (
          <span className={styles.thumbPlaceholder}>—</span>
        ) : (
          products.map((p) => {
            // On utilise uniquement l'illustration (méta-objet
            // custom.illustration_produit, motif en noir) — même source que la
            // page feuillet d'impression. Le mockup p.image_url est ignoré.
            const src = p.illustration_url;
            return (
              <Tooltip key={p.id} label={p.title} withArrow>
                {src ? (
                  <span
                    className={styles.thumb}
                    style={{ backgroundImage: `url("${src}")` }}
                    aria-label={p.title}
                  />
                ) : (
                  <span className={styles.thumbPlaceholder} aria-label={p.title}>
                    {p.title.slice(0, 1)}
                  </span>
                )}
              </Tooltip>
            );
          })
        )}
      </div>

      <div className={styles.stats} style={{ width: w }}>
        <Tooltip label={weather.label} withArrow>
          <span className={styles.weatherBadge}>{weather.emoji}</span>
        </Tooltip>
        <span className={styles.statBadge}>
          {realPct}% · {fill.units}/{type.max_capacity}
          {fill.weight_g != null && ` · ${(fill.weight_g / 1000).toFixed(1)} kg`}
        </span>
        {overflow > 0 && (
          <Tooltip label={`${overflow} unité(s) au-delà de la capacité`} withArrow>
            <span className={styles.overflowBadge}>+{overflow} hors cap.</span>
          </Tooltip>
        )}
        {instance.draft_qty > 0 && (
          <Tooltip label={`${instance.draft_qty} unité(s) déjà en commande brouillon`} withArrow>
            <span className={styles.draftBadge}>+{instance.draft_qty} brouillon</span>
          </Tooltip>
        )}
      </div>

      <div
        className={styles.box}
        style={{ width: w, height: h, gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >

        {columnsData.map((bucket, idx) => {
          const colPct = colCapacity > 0 ? Math.min(100, (bucket.total / colCapacity) * 100) : 0;
          return (
            <div key={idx} className={styles.column}>
              <div className={styles.columnFill} style={{ height: `${colPct}%` }}>
                {bucket.sections.map((sec) => (
                  <div
                    key={sec.key}
                    className={styles.section}
                    style={{ flexGrow: sec.total }}
                  >
                    {!isFilterMode && sec.key !== '_' && (
                      <span className={styles.sectionLabel}>
                        <span className={styles.sectionCount}>{sec.total}</span>{' '}
                        {sec.key}
                      </span>
                    )}
                    <div className={styles.sectionStripes}>
                      {sec.items.flatMap((v, vIdx) => {
                        const tip = `${v.color || ''} ${v.size || ''} — ${v.qty}`.trim();
                        const bg = colorToCss(v.color_hex);
                        const isLastVariantInSection = vIdx === sec.items.length - 1;

                        if (isFilterMode) {
                          // En mode filtre, 1 cellule par variante :
                          // - hauteur proportionnelle à qty (flexGrow)
                          // - sub-divisions par unité (stripes internes) pour
                          //   conserver l'effet "pile" comme en mode produit
                          // - label "Produit · Taille · Couleur" centré en
                          //   absolute par-dessus, en sautant la dimension
                          //   filtrée pour ne pas répéter
                          // - bordure noire entre variantes consécutives
                          // Empilement vertical pour rester lisible quand on a
                          // beaucoup d'info (type + produit + taille + couleur).
                          // Le type n'apparaît que si la caisse mélange plusieurs
                          // types — sinon il est en footer de caisse.
                          const showType = filterTypes.length > 1 && !!v.product_type;
                          const variantLine = [
                            !hideSizeInLabel ? v.size : null,
                            v.color,
                          ].filter(Boolean).join(' · ');
                          const hasAnyLabel = showType || !!v.product_title || !!variantLine;
                          return (
                            <Tooltip key={v.id} label={tip} withArrow>
                              <div
                                className={clsx(
                                  styles.variantBlock,
                                  !isLastVariantInSection && styles.variantBoundary,
                                )}
                                style={{ flexGrow: v.qty, background: bg }}
                              >
                                {Array.from({ length: v.qty }).map((_, i) => (
                                  <div key={i} className={styles.variantStripe} />
                                ))}
                                {hasAnyLabel && (
                                  <span className={styles.variantLabel}>
                                    {showType && (
                                      <span className={styles.variantLabelType}>{v.product_type}</span>
                                    )}
                                    {v.product_title && (
                                      <span className={styles.variantLabelProduct}>{v.product_title}</span>
                                    )}
                                    {variantLine && (
                                      <span className={styles.variantLabelOpts}>{variantLine}</span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </Tooltip>
                          );
                        }

                        // Mode classique : 1 stripe par unité de qty (effet de
                        // pile). Les boutiques par produit gardent ce rendu
                        // tel quel — pas de boundary marqué.
                        return Array.from({ length: v.qty }).map((_, i) => (
                          <Tooltip key={`${v.id}-${i}`} label={tip} withArrow>
                            <div
                              className={styles.block}
                              style={{ flexGrow: 1, background: bg }}
                            />
                          </Tooltip>
                        ));
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

      </div>

      <div className={styles.footer}>
        <span className={styles.title}>{displayName}</span>
        {instance.name && (
          <span className={styles.subtitle}>{type.name}</span>
        )}
        {(instance.value_cost > 0 || instance.value_sale > 0) && (
          <span className={styles.values}>
            Coût {formatEur(instance.value_cost)} · Vente {formatEur(instance.value_sale)}
          </span>
        )}
        {isFilterMode ? (
          <span className={clsx(styles.products, styles.filter)}>
            Filtre · {[...filterTypes, ...filterSizes].join(' · ')}
          </span>
        ) : products.length > 0 ? (
          <span className={styles.products}>
            {products.map((p) => p.title).join(' · ')}
          </span>
        ) : (
          <span className={clsx(styles.products, styles.empty)}>
            Aucun produit affecté
          </span>
        )}
      </div>
    </div>
  );
}
