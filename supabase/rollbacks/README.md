# Scripts d'annulation — À NE JAMAIS METTRE DANS `supabase/migrations/`

Ces fichiers annulent une migration. Ils s'exécutent **à la main**, jamais par
`supabase db push`.

`013_shop_orders_rollback.sql` vivait dans `supabase/migrations/` avec le même numéro
`013` que la migration qu'il annule. Conséquence : `supabase migration repair` ne pouvait
en marquer qu'un des deux, et le push suivant aurait exécuté le `DROP TABLE`.

Déplacé le 2026-08-23. Les tables visées n'existaient déjà plus, donc rien n'a été perdu —
mais le piège se serait armé de nouveau à la prochaine recréation de ces tables.
