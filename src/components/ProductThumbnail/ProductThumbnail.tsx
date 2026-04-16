import clsx from 'clsx';
import { getColorHex } from '@/utils/color-transformer';
import styles from './ProductThumbnail.module.scss';

export interface ProductThumbnailProps {
  /** Shopify/Supabase image URL. If provided, takes precedence over color fallback. */
  imageUrl?: string | null;
  /** Variant color name (French or English). Used for gradient fallback. */
  variantColor?: string | null;
  /** Alt text for the image (ignored when fallback is used). */
  alt?: string;
  /** Size in pixels. Default 48. */
  size?: number;
  className?: string;
}

function darken(hex: string, amount = 0.3): string {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.floor(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.floor(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.floor((n & 0xff) * (1 - amount)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function ProductThumbnail({
  imageUrl,
  variantColor,
  alt = '',
  size = 48,
  className,
}: ProductThumbnailProps) {
  const styleVars = { width: `${size}px`, height: `${size}px` } as React.CSSProperties;

  if (imageUrl) {
    return (
      <div className={clsx(styles.thumb, className)} style={styleVars}>
        <img src={imageUrl} alt={alt} className={styles.img} />
      </div>
    );
  }

  const base = variantColor ? getColorHex(variantColor) : '#808080';
  const darker = darken(base, 0.3);
  const gradient = `linear-gradient(135deg, ${base} 0%, ${darker} 100%)`;

  return (
    <div
      className={clsx(styles.thumb, styles.thumbFallback, className)}
      style={{ ...styleVars, background: gradient }}
      aria-hidden="true"
    />
  );
}
