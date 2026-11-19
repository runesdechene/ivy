-- Versions d'IVY Atelier : l'installateur et son `latest.yml`, lus par electron-updater au démarrage.
-- Bucket PUBLIC : l'application installée lit sans compte, et l'installateur ne contient aucun secret
-- (il n'affiche que l'IVY en ligne, qui demande sa propre connexion). Seul le script `publier` y écrit,
-- avec la clé de service : aucune règle d'écriture n'est ouverte.
INSERT INTO storage.buckets (id, name, public)
VALUES ('atelier-versions', 'atelier-versions', true)
ON CONFLICT (id) DO NOTHING;
