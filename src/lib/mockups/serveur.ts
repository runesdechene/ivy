import { NextRequest, NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { authorizeRequest, ownsShop, type AuthResult } from '@/lib/hub-ledger/server-auth';
import { ROLES, type FichierDepose, type Role } from './regles';

/** Côté serveur uniquement : accès, stockage et petites aides communes aux routes /api/mockups. */

export const BUCKET = 'mockups';
const TAILLE_MAX = 10 * 1024 * 1024;
const EXTENSIONS = ['png', 'webp', 'jpg', 'jpeg'];

/** Authentifie la requête et vérifie que la boutique demandée appartient à l'utilisateur. */
export async function autoriser(
  request: NextRequest, shopId: string | null | undefined,
): Promise<{ ok: true; auth: AuthResult; shopId: string } | { ok: false; reponse: NextResponse }> {
  const res = await authorizeRequest(request);
  if (!res.ok) return { ok: false, reponse: NextResponse.json({ error: res.error }, { status: res.status }) };
  if (!shopId || !ownsShop(res.auth, shopId)) return { ok: false, reponse: NextResponse.json({ error: 'Interdit' }, { status: 403 }) };
  return { ok: true, auth: res.auth, shopId };
}

export function erreur(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

export function urlPublique(svc: SupabaseClient, path: string | null): string | null {
  return path ? svc.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null;
}

/** Dépose une image dans `${shopId}/${dossier}/` sous un nom unique (pas de cache périmé) ; renvoie le chemin. */
export async function deposerImage(svc: SupabaseClient, shopId: string, dossier: string, fichier: File): Promise<string> {
  const ext = (fichier.name.split('.').pop() || '').toLowerCase();
  if (!EXTENSIONS.includes(ext)) throw new Error('Format refusé (png, webp ou jpg)');
  if (fichier.size > TAILLE_MAX) throw new Error('Fichier trop volumineux (10 Mo max)');
  const path = `${shopId}/${dossier}/${crypto.randomUUID()}.${ext}`;
  const { error } = await svc.storage.from(BUCKET).upload(path, new Uint8Array(await fichier.arrayBuffer()), {
    contentType: fichier.type || `image/${ext}`,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Copie un fichier du bucket sous un nom unique (duplication d'un gabarit) ; renvoie le nouveau chemin. */
export async function copierImage(svc: SupabaseClient, shopId: string, dossier: string, depuis: string): Promise<string> {
  const path = `${shopId}/${dossier}/${crypto.randomUUID()}.${depuis.split('.').pop()}`;
  const { error } = await svc.storage.from(BUCKET).copy(depuis, path);
  if (error) throw new Error(error.message);
  return path;
}

/** Supprime des fichiers du bucket ; les chemins vides sont ignorés. */
export async function retirer(svc: SupabaseClient, paths: (string | null | undefined)[]): Promise<void> {
  const aRetirer = paths.filter((p): p is string => !!p);
  if (aRetirer.length) await svc.storage.from(BUCKET).remove(aRetirer);
}

/** Lit toutes les lignes d'une requête paginée (PostgREST plafonne à 1 000 lignes). */
export async function toutesLesLignes<T>(page: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const lignes: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await page(de, de + 999);
    if (error) throw new Error(error.message);
    lignes.push(...(data ?? []));
    if (!data || data.length < 1000) return lignes;
  }
}

// --- Fichiers sources des motifs : `${shopId}/motifs/${dossier}/${ROLE}.${png|svg}` -----------------

const TAILLE_MAX_SOURCE = 20 * 1024 * 1024;

/** Dossier d'un motif dans le bucket ; les clés Storage n'acceptent pas tous les caractères (’ …). */
export function dossierMotif(shopId: string, cle: string): string {
  return `${shopId}/motifs/${cle.replace(/[^A-Z0-9]+/g, '-')}`;
}

/** Fichiers déposés d'un motif, par rôle. `?v=` suit la date : un fichier remplacé n'est pas resservi par le cache. */
export async function fichiersDuMotif(svc: SupabaseClient, dossier: string): Promise<Partial<Record<Role, FichierDepose>>> {
  const { data, error } = await svc.storage.from(BUCKET).list(dossier);
  if (error) throw new Error(error.message);
  const fichiers: Partial<Record<Role, FichierDepose>> = {};
  for (const f of data ?? []) {
    const [role, ext] = f.name.split('.') as [Role, 'png' | 'svg'];
    if (!ROLES.includes(role)) continue;
    const url = svc.storage.from(BUCKET).getPublicUrl(`${dossier}/${f.name}`).data.publicUrl;
    fichiers[role] = { url: `${url}?v=${Date.parse(f.updated_at)}`, taille: f.metadata?.size ?? 0, depose_le: f.updated_at, ext };
  }
  return fichiers;
}

/** Dépose un fichier source à la place de celui du même rôle (l'autre extension est retirée). */
export async function deposerSource(svc: SupabaseClient, dossier: string, role: Role, fichier: File): Promise<void> {
  const ext = fichier.name.split('.').pop()?.toLowerCase();
  if (ext !== 'png' && ext !== 'svg') throw new Error(`${fichier.name} : PNG ou SVG seulement`);
  if (fichier.size > TAILLE_MAX_SOURCE) throw new Error(`${fichier.name} : 20 Mo maximum`);
  await retirer(svc, [`${dossier}/${role}.png`, `${dossier}/${role}.svg`]);
  const { error } = await svc.storage.from(BUCKET).upload(`${dossier}/${role}.${ext}`, new Uint8Array(await fichier.arrayBuffer()), {
    contentType: ext === 'svg' ? 'image/svg+xml' : 'image/png',
    upsert: true,
  });
  if (error) throw new Error(`${fichier.name} : ${error.message}`);
}
