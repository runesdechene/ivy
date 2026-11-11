-- Axe du motif : où tombe son centre voulu (le milieu de son cadre), en fraction de la largeur du dessin.
-- IVY élargit le dessin de transparent pour centrer cet axe. NULL = milieu du dessin.
ALTER TABLE mockup_motifs ADD COLUMN IF NOT EXISTS axe REAL CHECK (axe > 0 AND axe < 1);
