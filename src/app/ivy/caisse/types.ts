export interface CartItem {
  id: string; // Unique ID for cart item
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
  price: number;
  cost: number;
  quantity: number;
  stock: number;
  discountPercentage: number;
  discountAmount: number;
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
  price?: number;
  cost?: number;
}

export interface Seller {
  id: string;
  name: string;
  avatarUrl: string | null;
  isActive: boolean;
}

export interface DiscountRule {
  id: string;
  shopId: string;
  name: string;
  description: string | null;
  expression: string;
  priority: number;
  isActive: boolean;
  isCombinable: boolean;
}

export interface DiscountResult {
  itemDiscounts: Map<string, { percentage: number; amount: number }>;
  totalDiscount: number;
  appliedRules: DiscountRule[];
}

export interface Sale {
  id: string;
  shopId: string;
  locationId: string | null;
  sellerId: string | null;
  discountRuleId: string | null;
  subtotal: number;
  discountAmount: number;
  totalAmount: number;
  itemsCount: number;
  isRefund: boolean;
  notes: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface SaleItem {
  id: string;
  saleId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  totalPrice: number;
}
