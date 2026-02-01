import { CartItem, DiscountRule, DiscountResult } from '../types';

interface ExpandedUnit {
  originalItem: CartItem;
  unitIndex: number;
  price: number;
  discountPercentage: number;
}

interface DiscountAction {
  target: 'all' | 'cheapest' | number;
  percentage: number;
}

/**
 * Parse une expression de règle de remise
 */
function parseRule(expression: string): { 
  condition: (itemsCount: number) => boolean; 
  action: DiscountAction 
} | null {
  try {
    const cleaned = expression.trim();
    const arrowIndex = cleaned.indexOf('->');
    if (arrowIndex === -1) return null;
    
    const conditionStr = cleaned.substring(0, arrowIndex).trim();
    const actionStr = cleaned.substring(arrowIndex + 2).trim();
    
    const conditionMatch = conditionStr.match(/items_count\s*(>=|>|==|<=|<)\s*(\d+)/);
    if (!conditionMatch) return null;
    
    const operator = conditionMatch[1];
    const value = parseInt(conditionMatch[2], 10);
    
    const condition = (itemsCount: number): boolean => {
      switch (operator) {
        case '>=': return itemsCount >= value;
        case '>': return itemsCount > value;
        case '==': return itemsCount === value;
        case '<=': return itemsCount <= value;
        case '<': return itemsCount < value;
        default: return false;
      }
    };
    
    const actionMatch = actionStr.match(/discount\s*\(\s*["']([^"']+)["']\s*,\s*(\d+(?:\.\d+)?)\s*\)/);
    if (!actionMatch) return null;
    
    const targetStr = actionMatch[1];
    const percentage = parseFloat(actionMatch[2]);
    
    let target: 'all' | 'cheapest' | number;
    if (targetStr === 'all') {
      target = 'all';
    } else if (targetStr === 'cheapest') {
      target = 'cheapest';
    } else {
      const itemMatch = targetStr.match(/item\[(\d+)\]/);
      if (itemMatch) {
        target = parseInt(itemMatch[1], 10);
      } else {
        return null;
      }
    }
    
    return { condition, action: { target, percentage } };
  } catch {
    return null;
  }
}

/**
 * Évalue les règles de remise et retourne les items avec remises appliquées
 * Les items avec des remises différentes sont séparés en lignes distinctes
 */
export function evaluateDiscounts(
  items: CartItem[],
  rules: DiscountRule[],
  enabled: boolean = true
): DiscountResult {
  const result: DiscountResult = {
    itemDiscounts: new Map(),
    totalDiscount: 0,
    appliedRules: [],
  };
  
  if (!enabled || items.length === 0 || rules.length === 0) {
    return result;
  }
  
  // Expand chaque item en unités individuelles
  const expandedUnits: ExpandedUnit[] = [];
  items.forEach(item => {
    for (let i = 0; i < Math.abs(item.quantity); i++) {
      expandedUnits.push({
        originalItem: item,
        unitIndex: i,
        price: item.price,
        discountPercentage: 0,
      });
    }
  });
  
  // Trier par prix (du moins cher au plus cher)
  const sortedUnits = [...expandedUnits].sort((a, b) => a.price - b.price);
  const itemsCount = expandedUnits.length;
  
  // Trier les règles par priorité
  const sortedRules = [...rules]
    .filter(r => r.isActive)
    .sort((a, b) => b.priority - a.priority);
  
  for (const rule of sortedRules) {
    const lines = rule.expression.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
    
    for (const line of lines) {
      const parsed = parseRule(line);
      if (!parsed) continue;
      
      if (!parsed.condition(itemsCount)) continue;
      
      const { target, percentage } = parsed.action;
      
      if (target === 'all') {
        // Remise sur toutes les unités
        sortedUnits.forEach(unit => {
          if (unit.discountPercentage === 0 || rule.isCombinable) {
            unit.discountPercentage = rule.isCombinable 
              ? Math.min(unit.discountPercentage + percentage, 100)
              : percentage;
          }
        });
        if (!result.appliedRules.includes(rule)) {
          result.appliedRules.push(rule);
        }
      } else if (target === 'cheapest') {
        // Remise sur l'unité la moins chère
        if (sortedUnits.length > 0) {
          const unit = sortedUnits[0];
          if (unit.discountPercentage === 0 || rule.isCombinable) {
            unit.discountPercentage = rule.isCombinable 
              ? Math.min(unit.discountPercentage + percentage, 100)
              : percentage;
          }
          if (!result.appliedRules.includes(rule)) {
            result.appliedRules.push(rule);
          }
        }
      } else if (typeof target === 'number') {
        // Remise sur l'unité à l'index N
        if (target < sortedUnits.length) {
          const unit = sortedUnits[target];
          if (unit.discountPercentage === 0 || rule.isCombinable) {
            unit.discountPercentage = rule.isCombinable 
              ? Math.min(unit.discountPercentage + percentage, 100)
              : percentage;
          }
          if (!result.appliedRules.includes(rule)) {
            result.appliedRules.push(rule);
          }
        }
      }
    }
    
    if (!rule.isCombinable && result.appliedRules.includes(rule)) {
      break;
    }
  }
  
  // Calculer le total des remises
  let totalDiscount = 0;
  sortedUnits.forEach(unit => {
    if (unit.discountPercentage > 0) {
      totalDiscount += (unit.price * unit.discountPercentage) / 100;
    }
  });
  
  result.totalDiscount = totalDiscount;
  
  // Stocker les unités expandées pour applyDiscountsToCart
  (result as any)._expandedUnits = expandedUnits;
  
  return result;
}

/**
 * Applique les remises et sépare les items avec des remises différentes
 */
export function applyDiscountsToCart(
  items: CartItem[],
  discountResult: DiscountResult
): CartItem[] {
  const expandedUnits: ExpandedUnit[] = (discountResult as any)._expandedUnits;
  
  if (!expandedUnits || expandedUnits.length === 0) {
    return items.map(item => ({
      ...item,
      discountPercentage: 0,
      discountAmount: 0,
    }));
  }
  
  // Regrouper les unités par variantId ET discountPercentage
  const groupedItems = new Map<string, { 
    item: CartItem; 
    quantity: number; 
    discountPercentage: number;
    discountAmount: number;
  }>();
  
  expandedUnits.forEach(unit => {
    const key = `${unit.originalItem.variantId}-${unit.discountPercentage}`;
    const existing = groupedItems.get(key);
    
    if (existing) {
      existing.quantity += 1;
      existing.discountAmount += (unit.price * unit.discountPercentage) / 100;
    } else {
      groupedItems.set(key, {
        item: unit.originalItem,
        quantity: 1,
        discountPercentage: unit.discountPercentage,
        discountAmount: (unit.price * unit.discountPercentage) / 100,
      });
    }
  });
  
  // Convertir en CartItem[]
  const result: CartItem[] = [];
  groupedItems.forEach((group, key) => {
    result.push({
      ...group.item,
      id: `${group.item.variantId}-${group.discountPercentage}-${Date.now()}`,
      quantity: group.quantity,
      discountPercentage: group.discountPercentage,
      discountAmount: group.discountAmount,
    });
  });
  
  return result;
}
