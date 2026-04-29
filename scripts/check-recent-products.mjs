import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: shop } = await supabase
  .from('shops').select('id').ilike('name', '%Runes de Chêne%').single();

const { data: recent } = await supabase
  .from('products')
  .select('title, created_at, synced_at, status')
  .eq('shop_id', shop.id)
  .eq('status', 'active')
  .order('created_at', { ascending: false })
  .limit(15);

console.log('15 produits actifs avec created_at le plus récent :\n');
for (const p of recent || []) {
  console.log(`  ${p.created_at?.slice(0, 10)}  ${p.title}`);
}

console.log('\nRecherche spécifique :');
for (const name of ['Loutre', 'Hoplite', 'Hécate']) {
  const { data: matches } = await supabase
    .from('products')
    .select('title, created_at, status')
    .eq('shop_id', shop.id)
    .ilike('title', `%${name}%`);
  if (matches && matches.length > 0) {
    for (const m of matches) {
      console.log(`  [${name}] ${m.created_at?.slice(0, 10)}  ${m.title}  (${m.status})`);
    }
  } else {
    console.log(`  [${name}] aucun match`);
  }
}
