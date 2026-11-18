-- Fichiers d'impression : fabriqués une fois, gardés jusqu'à ce que le motif change.
-- Bucket PRIVÉ (les dessins en pleine résolution) : seules les routes IVY y écrivent, et elles
-- servent chaque fichier par une adresse signée de courte durée. Une fonction Netlify ne peut pas
-- renvoyer 11 Mo : le navigateur télécharge donc depuis le stockage, pas depuis la route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('impression', 'impression', false)
ON CONFLICT (id) DO NOTHING;
