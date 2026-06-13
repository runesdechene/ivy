-- 049 — Caisses : séparation des motifs par compartiment (rendu Tetris)
-- Quand activé (défaut), le rendu d'une caisse regroupe les variantes par produit
-- (motif) et place un motif par compartiment au lieu d'équilibrer purement par
-- quantité. Purement visuel : n'affecte aucune donnée de stock.

ALTER TABLE container_types
  ADD COLUMN IF NOT EXISTS separate_motifs BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN container_types.separate_motifs IS
  'Si true (défaut), le rendu de la caisse regroupe les variantes par produit (motif) : 1 motif par compartiment, sans couper un motif entre deux colonnes (regroupe les motifs entiers si plus de motifs que de colonnes ; étale un motif si moins). Si false, distribution équilibrée par quantité (comportement historique).';
