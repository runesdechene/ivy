-- Titre et sous-titre libres de la feuille imprimee. Le document sert de piece
-- jointe a un dossier douanier : l'utilisateur doit pouvoir le nommer lui-meme.
ALTER TABLE customs_declarations
  ADD COLUMN IF NOT EXISTS doc_titre TEXT,
  ADD COLUMN IF NOT EXISTS doc_sous_titre TEXT;
