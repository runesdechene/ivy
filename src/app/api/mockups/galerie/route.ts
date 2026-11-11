import { NextRequest, NextResponse } from 'next/server';
import { autoriser, erreur, toutesLesLignes, urlPublique, dossierMotif, fichiersDuMotif } from '@/lib/mockups/serveur';
import { lireGabarits, lireReglages } from '@/lib/mockups/donnees';
import {
  METACHAMPS, lireTaille, motifDuTitre, planifierApercus,
  type Apercu, type Face, type FicheMotif, type VarianteImpression,
} from '@/lib/mockups/regles';

export type EtatEnvoi = 'a_jour' | 'pas_a_jour' | 'jamais';
export interface CarteGalerie {
  couleur: string; face: Face; image_url: string | null; etat: EtatEnvoi | null; manque: Apercu['manque'];
}
export interface ProduitGalerie { id: string; title: string; cartes: CarteGalerie[] }
export interface MotifGalerie { nom: string; libelle: string; produits: ProduitGalerie[] }

interface LigneVariante {
  id: string; shopify_id: string; sku: string | null; option1: string | null; option2: string | null;
  products: { id: string; title: string }; variant_metafields: { key: string; value: string }[];
}
type ProduitBrut = { id: string; title: string; variantes: VarianteImpression[] };

/** Tous les mockups de la boutique, par motif puis par produit, avec leur état d'envoi sur Shopify. */
export async function GET(request: NextRequest) {
  const acces = await autoriser(request, request.nextUrl.searchParams.get('shopId'));
  if (!acces.ok) return acces.reponse;
  const { svc } = acces.auth;
  const shopId = acces.shopId;

  try {
    const [variantes, mockups, fiches, { reglages }, { gabarits }] = await Promise.all([
      toutesLesLignes<LigneVariante>((de, a) => svc.from('product_variants')
        .select('id, shopify_id, sku, option1, option2, products!inner(id, title, shop_id, status), variant_metafields(key, value)')
        .eq('products.shop_id', shopId).eq('products.status', 'active').eq('shopify_active', true)
        .like('products.title', '% | %')
        .in('variant_metafields.key', Object.values(METACHAMPS))
        .range(de, a).returns<LigneVariante[]>()),
      toutesLesLignes<{ product_id: string; couleur: string; face: Face; image_path: string; updated_at: string; envoye_le: string | null }>((de, a) =>
        svc.from('mockups').select('product_id, couleur, face, image_path, updated_at, envoye_le').eq('shop_id', shopId).range(de, a)),
      svc.from('mockup_motifs').select('nom, hauteurs').eq('shop_id', shopId),
      lireReglages(svc, shopId),
      lireGabarits(svc, shopId),
    ]);
    if (fiches.error) throw new Error(fiches.error.message);

    // Variantes regroupées par produit, produits regroupés par motif.
    const parProduit = new Map<string, ProduitBrut>();
    for (const v of variantes) {
      const p = parProduit.get(v.products.id) ?? { id: v.products.id, title: v.products.title, variantes: [] };
      const mf = (cle: string) => v.variant_metafields.find((m) => m.key === cle)?.value ?? null;
      p.variantes.push({
        id: v.id, shopifyId: v.shopify_id, couleur: v.option1 ?? '', tailleVetement: v.option2, sku: v.sku,
        recto: mf(METACHAMPS.recto), verso: mf(METACHAMPS.verso), taille: lireTaille(mf(METACHAMPS.taille)),
      });
      parProduit.set(p.id, p);
    }
    const parMotif = new Map<string, { nom: string; libelle: string; produitsBruts: ProduitBrut[] }>();
    for (const p of parProduit.values()) {
      const nom = motifDuTitre(p.title)!;
      const m = parMotif.get(nom) ?? { nom, libelle: p.title.slice(0, p.title.indexOf(' | ')), produitsBruts: [] };
      m.produitsBruts.push(p);
      parMotif.set(nom, m);
    }

    const motifs: MotifGalerie[] = await Promise.all([...parMotif.values()].map(async (m) => {
      const fiche = (fiches.data as FicheMotif[]).find((f) => f.nom === m.nom) ?? null;
      const fichiers = await fichiersDuMotif(svc, dossierMotif(shopId, m.nom));
      const noms = Object.entries(fichiers).map(([role, f]) => `${role}.${f.ext}`);
      const produits = m.produitsBruts.sort((a, b) => a.title.localeCompare(b.title, 'fr')).map((p) => ({
        id: p.id, title: p.title,
        cartes: planifierApercus(p.variantes, ['recto', 'verso'], gabarits, noms, reglages, fiche, 'D-MAX').map((a) => {
          const mk = mockups.find((x) => x.product_id === p.id && x.couleur === a.couleur && x.face === a.face);
          const etat: EtatEnvoi | null = !mk ? null : !mk.envoye_le ? 'jamais' : mk.envoye_le >= mk.updated_at ? 'a_jour' : 'pas_a_jour';
          return { couleur: a.couleur, face: a.face, image_url: mk ? urlPublique(svc, mk.image_path) : null, etat, manque: a.manque };
        }),
      }));
      return { nom: m.nom, libelle: m.libelle, produits };
    }));
    motifs.sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
    return NextResponse.json({ motifs });
  } catch (e) {
    return erreur((e as Error).message, 500);
  }
}
