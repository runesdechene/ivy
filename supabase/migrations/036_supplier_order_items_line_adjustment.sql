-- Add per-line price adjustment to supplier order items
ALTER TABLE supplier_order_items ADD COLUMN IF NOT EXISTS line_adjustment DECIMAL(10,2) DEFAULT 0;
