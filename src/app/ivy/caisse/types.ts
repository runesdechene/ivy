export interface StockMovement {
  variantId: string;
  productId: string;
  productTitle: string;
  productType: string;
  variantTitle: string;
  options: {
    color?: string;
    size?: string;
    option3?: string;
  };
  quantity: number; // negative = sortie, positive = retour
  stock: number; // stock actuel
}

export interface ProductSelection {
  type: string | null;
  product: SelectedProduct | null;
  color: string | null;
  size: string | null;
  option3: string | null;
}

export interface SelectedProduct {
  id: string;
  shopifyId: string;
  title: string;
  productType: string;
  option1Name: string | null;
  option2Name: string | null;
  option3Name: string | null;
}

export interface VariantOption {
  value: string;
  stock: number;
  variantId?: string;
}
