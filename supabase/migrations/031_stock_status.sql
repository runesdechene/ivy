-- Ajouter le suivi du statut stock par item sur les commandes fournisseur
-- Permet de savoir quel item a été ajouté au stock, lequel a échoué, et de réessayer

ALTER TABLE supplier_order_items
  ADD COLUMN IF NOT EXISTS stock_status TEXT,
  ADD COLUMN IF NOT EXISTS stock_error TEXT,
  ADD COLUMN IF NOT EXISTS stock_added_at TIMESTAMPTZ;
