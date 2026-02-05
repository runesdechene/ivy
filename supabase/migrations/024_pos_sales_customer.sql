-- Ajouter les champs client optionnels aux ventes POS
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
ALTER TABLE pos_sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);

-- Index pour recherche par client
CREATE INDEX IF NOT EXISTS idx_pos_sales_customer_email ON pos_sales(customer_email) WHERE customer_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_sales_customer_phone ON pos_sales(customer_phone) WHERE customer_phone IS NOT NULL;
