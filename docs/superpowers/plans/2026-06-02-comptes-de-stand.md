# Comptes de stand (privé) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à IVY un module privé « Comptes de stand » (route `/ivy/hub/comptes`, hors nav) où l'apprenti tient ses dépenses remboursables et son fond de caisse, derrière un verrou PIN, sur des données protégées par RLS.

**Architecture:** 4 tables Supabase `hub_ledger_*` (réglages+PIN, dépenses, sessions caisse, sorties), accédées uniquement via routes serveur Next.js en `service_role` qui vérifient (1) le JWT Supabase + appartenance `user_shops`, (2) un jeton de déverrouillage PIN signé (HMAC, courte durée) pour servir des montants. UI Mantine 7 + TanStack Query, montants masqués par défaut, page atteinte via une icône cadenas discrète dans le Hub.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Mantine 7 (+ `@mantine/dates`) · TanStack Query v5 · Supabase (Postgres + Storage) · `crypto` natif Node (scrypt + HMAC, **aucune nouvelle dépendance**) · pnpm.

**Convention de test (adaptée à IVY) :** IVY n'a pas de framework de tests. Pour les **utilitaires crypto purs** (PIN, jeton), on utilise `node --test` (intégré à Node, rien à installer) — c'est sécurité-critique, ça mérite des tests de non-régression. Pour les **routes et l'UI**, vérification manuelle via `pnpm dev`, avec checklist explicite (Task 17).

**Conventions IVY à respecter :** pnpm uniquement · TS strict (pas de `any`) · alias `@/*` → `src/*` · branche feature `feat/comptes-de-stand` (déjà créée) · jamais enregistrer de prix de vente/encaissement (hors NF525).

**Référence spec :** `docs/superpowers/specs/2026-06-02-comptes-de-stand-design.md`

---

## File Structure

**Migration**
- Create `supabase/migrations/046_hub_ledger.sql` — 4 tables + RLS + bucket Storage privé.

**Lib serveur (logique pure + auth) — `src/lib/hub-ledger/`**
- Create `pin.ts` — `hashPin` / `verifyPin` (scrypt). Pur, testé.
- Create `pin.test.ts` — `node --test`.
- Create `unlock-token.ts` — `issueUnlockToken` / `verifyUnlockToken` (HMAC). Pur, testé.
- Create `unlock-token.test.ts` — `node --test`.
- Create `server-auth.ts` — `authorizeRequest` (JWT → user + shopIds) + `requireUnlock` (jeton PIN).

**Routes API — `src/app/api/hub/comptes/`**
- Create `pin/route.ts` — `GET` statut PIN, `POST` (setup OU unlock selon `action`).
- Create `expenses/route.ts` — `GET`/`POST`/`PATCH`/`DELETE`.
- Create `cash/sessions/route.ts` — `GET`/`POST`/`PATCH`.
- Create `cash/outflows/route.ts` — `GET`/`POST`/`DELETE`.
- Create `receipts/route.ts` — `POST` upload, `GET` URL signée.

**UI — `src/app/ivy/hub/comptes/`**
- Create `types.ts` — types partagés.
- Create `api-client.ts` — `hubFetch` (attache Bearer + jeton unlock).
- Create `hooks/usePinLock.ts` — état verrouillé/déverrouillé + jeton + auto-lock.
- Create `hooks/useLedger.ts` — hooks TanStack Query (dépenses, sessions, sorties, reçus).
- Create `components/PinSetup.tsx` — écran de 1ère config.
- Create `components/PinGate.tsx` — saisie PIN + déverrouillage.
- Create `components/MaskedAmount.tsx` — montant masqué `••••`.
- Create `components/ExpensesTable.tsx` + `components/ExpenseForm.tsx`.
- Create `components/CashTable.tsx` + `components/CashOutflowForm.tsx`.
- Create `page.tsx` — assemblage (gate → onglets Dépenses / Caisse).
- Create `comptes.module.scss` — styles page.

**Modif existant**
- Modify `src/app/ivy/hub/page.tsx` — icône cadenas discrète → `/ivy/hub/comptes`.

---

## Task 1: Migration — schéma `hub_ledger_*` + RLS + bucket

**Files:**
- Create: `supabase/migrations/046_hub_ledger.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 046_hub_ledger.sql
-- Module privé "Comptes de stand" : dépenses remboursables + suivi de fond de caisse.
-- Aucune vente/encaissement enregistré (hors périmètre NF525). Données sincères.

-- Réglages du module (1 ligne par shop), porte le hash du PIN
CREATE TABLE IF NOT EXISTS hub_ledger_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  pin_hash TEXT,                 -- NULL = PIN pas encore défini → écran 1ère config
  pin_set_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau A : dépenses engagées remboursables
CREATE TABLE IF NOT EXISTS hub_ledger_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  study_zone_id UUID REFERENCES pos_study_zones(id),
  spent_on DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(10,2) NOT NULL,
  receipt_path TEXT,
  status TEXT NOT NULL DEFAULT 'engage',  -- engage | soumis | rembourse
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau B (en-tête) : fond de caisse par festival
CREATE TABLE IF NOT EXISTS hub_ledger_cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),
  study_zone_id UUID REFERENCES pos_study_zones(id),
  opening_float DECIMAL(10,2) NOT NULL DEFAULT 0,
  opened_on DATE NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tableau B (lignes) : sorties piochées dans la caisse
CREATE TABLE IF NOT EXISTS hub_ledger_cash_outflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES hub_ledger_cash_sessions(id) ON DELETE CASCADE,
  spent_on DATE NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(10,2) NOT NULL,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hub_expenses_shop ON hub_ledger_expenses(shop_id);
CREATE INDEX IF NOT EXISTS idx_hub_expenses_zone ON hub_ledger_expenses(study_zone_id);
CREATE INDEX IF NOT EXISTS idx_hub_cash_sessions_shop ON hub_ledger_cash_sessions(shop_id);
CREATE INDEX IF NOT EXISTS idx_hub_cash_outflows_session ON hub_ledger_cash_outflows(session_id);

-- RLS : accès réservé aux membres du shop (pattern IVY user_shops).
-- Compte unique aujourd'hui → seul ce compte. Les routes serveur passent en service_role
-- (RLS bypassée) MAIS revérifient l'appartenance + exigent un jeton PIN.
ALTER TABLE hub_ledger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub_ledger_cash_outflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_settings_member" ON hub_ledger_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_settings.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_settings.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_expenses_member" ON hub_ledger_expenses FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_expenses.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_expenses.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_cash_sessions_member" ON hub_ledger_cash_sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_sessions.shop_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM user_shops us WHERE us.shop_id = hub_ledger_cash_sessions.shop_id AND us.user_id = auth.uid()));

CREATE POLICY "hub_cash_outflows_member" ON hub_ledger_cash_outflows FOR ALL
  USING (EXISTS (SELECT 1 FROM hub_ledger_cash_sessions s JOIN user_shops us ON us.shop_id = s.shop_id WHERE s.id = hub_ledger_cash_outflows.session_id AND us.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM hub_ledger_cash_sessions s JOIN user_shops us ON us.shop_id = s.shop_id WHERE s.id = hub_ledger_cash_outflows.session_id AND us.user_id = auth.uid()));

-- Bucket Storage privé pour les reçus (accès uniquement via routes serveur service_role)
INSERT INTO storage.buckets (id, name, public)
VALUES ('hub-receipts', 'hub-receipts', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE hub_ledger_expenses IS 'Dépenses engagées remboursables (note de frais apprenti). Pas une caisse.';
COMMENT ON TABLE hub_ledger_cash_sessions IS 'Fond de caisse cash par festival. Solde = opening_float - somme des outflows.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/046_hub_ledger.sql
git commit -m "feat(db): tables hub_ledger + RLS + bucket reçus pour Comptes de stand"
```

---

## Task 2: Appliquer la migration + vérifier le bucket

**Files:** (aucun fichier — opération sur la base Supabase liée)

- [ ] **Step 1: Appliquer la migration**

Appliquer `046_hub_ledger.sql` sur le projet Supabase lié, au choix :
- via le Supabase MCP : outil `apply_migration` (name `046_hub_ledger`, contenu = le SQL ci-dessus), **ou**
- via CLI : `supabase db push` (si la CLI est configurée), **ou**
- via le SQL Editor du dashboard Supabase (coller le contenu, exécuter).

- [ ] **Step 2: Vérifier**

Via le MCP `list_tables` (ou dashboard) : confirmer que `hub_ledger_settings`, `hub_ledger_expenses`, `hub_ledger_cash_sessions`, `hub_ledger_cash_outflows` existent, que RLS est activée, et que le bucket `hub-receipts` apparaît dans Storage avec `public = false`.

Expected: 4 tables présentes, RLS ON, bucket privé créé.

---

## Task 3: Utilitaire de hash du PIN (scrypt)

**Files:**
- Create: `src/lib/hub-ledger/pin.ts`
- Test: `src/lib/hub-ledger/pin.test.ts`

- [ ] **Step 1: Écrire le test (échoue)**

```ts
// src/lib/hub-ledger/pin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin } from './pin.ts';

test('hashPin produit un format scrypt$salt$hash et n\'est pas le PIN en clair', () => {
  const h = hashPin('1234');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(!h.includes('1234'));
});

test('verifyPin accepte le bon PIN', () => {
  const h = hashPin('4271');
  assert.equal(verifyPin('4271', h), true);
});

test('verifyPin rejette le mauvais PIN', () => {
  const h = hashPin('4271');
  assert.equal(verifyPin('0000', h), false);
});

test('deux hash du même PIN diffèrent (sel aléatoire)', () => {
  assert.notEqual(hashPin('1234'), hashPin('1234'));
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node --test --experimental-strip-types src/lib/hub-ledger/pin.test.ts`
Expected: FAIL (module `./pin.ts` introuvable).

- [ ] **Step 3: Implémenter**

```ts
// src/lib/hub-ledger/pin.ts
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

/** Hash salé d'un PIN. Format: scrypt$<saltHex>$<hashHex>. Jamais réversible. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Vérifie un PIN contre un hash stocké (comparaison à temps constant). */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(pin, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `node --test --experimental-strip-types src/lib/hub-ledger/pin.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub-ledger/pin.ts src/lib/hub-ledger/pin.test.ts
git commit -m "feat(hub-ledger): util de hash PIN (scrypt) + tests"
```

---

## Task 4: Utilitaire de jeton de déverrouillage (HMAC)

**Files:**
- Create: `src/lib/hub-ledger/unlock-token.ts`
- Test: `src/lib/hub-ledger/unlock-token.test.ts`

- [ ] **Step 1: Écrire le test (échoue)**

```ts
// src/lib/hub-ledger/unlock-token.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HUB_LEDGER_SECRET = 'test-secret-please-change';
const { issueUnlockToken, verifyUnlockToken, TTL_MS } = await import('./unlock-token.ts');

const NOW = 1_000_000;

test('un jeton fraîchement émis est valide pour le bon user', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-1', NOW + 1000), true);
});

test('rejette un autre user', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-2', NOW + 1000), false);
});

test('rejette un jeton expiré', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t, 'user-1', NOW + TTL_MS + 1), false);
});

test('rejette une signature altérée', () => {
  const t = issueUnlockToken('user-1', NOW);
  assert.equal(verifyUnlockToken(t.slice(0, -2) + 'xy', 'user-1', NOW + 1000), false);
});
```

- [ ] **Step 2: Lancer le test, vérifier l'échec**

Run: `node --test --experimental-strip-types src/lib/hub-ledger/unlock-token.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter**

```ts
// src/lib/hub-ledger/unlock-token.ts
import { createHmac, timingSafeEqual } from 'crypto';

export const TTL_MS = 15 * 60 * 1000; // 15 min

// Secret serveur dédié, fallback sur la service role key (jamais exposée au client).
function secret(): string {
  const s = process.env.HUB_LEDGER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Missing HUB_LEDGER_SECRET / SUPABASE_SERVICE_ROLE_KEY');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** Émet un jeton de déverrouillage signé, lié au user et expirant après TTL_MS. */
export function issueUnlockToken(userId: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** Vérifie signature + appartenance user + expiration. */
export function verifyUnlockToken(token: string, userId: string, now: number): boolean {
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return uid === userId && typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Lancer le test, vérifier le succès**

Run: `node --test --experimental-strip-types src/lib/hub-ledger/unlock-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub-ledger/unlock-token.ts src/lib/hub-ledger/unlock-token.test.ts
git commit -m "feat(hub-ledger): jeton de déverrouillage signé (HMAC) + tests"
```

---

## Task 5: Helper d'autorisation serveur

**Files:**
- Create: `src/lib/hub-ledger/server-auth.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/lib/hub-ledger/server-auth.ts
import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyUnlockToken } from './unlock-token';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface AuthResult {
  userId: string;
  shopIds: string[];
  svc: SupabaseClient; // client service_role
}

/** Valide le JWT Supabase (header Authorization: Bearer) et résout les shops du user. */
export async function authorizeRequest(
  request: NextRequest
): Promise<{ ok: true; auth: AuthResult } | { ok: false; status: number; error: string }> {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return { ok: false, status: 401, error: 'Non authentifié' };

  const anon = createClient(URL, ANON);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: 'Session invalide' };

  const svc = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: rows, error: msErr } = await svc
    .from('user_shops')
    .select('shop_id')
    .eq('user_id', data.user.id);
  if (msErr) return { ok: false, status: 500, error: msErr.message };

  const shopIds = (rows ?? []).map((r) => r.shop_id as string);
  return { ok: true, auth: { userId: data.user.id, shopIds, svc } };
}

/** Vérifie qu'un shopId demandé appartient bien au user. */
export function ownsShop(auth: AuthResult, shopId: string): boolean {
  return auth.shopIds.includes(shopId);
}

/** Vérifie le jeton de déverrouillage PIN (header x-unlock-token). Requis pour servir des montants. */
export function requireUnlock(request: NextRequest, userId: string): boolean {
  const token = request.headers.get('x-unlock-token');
  if (!token) return false;
  return verifyUnlockToken(token, userId, Date.now());
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `pnpm exec tsc --noEmit`
Expected: aucune erreur sur `src/lib/hub-ledger/server-auth.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hub-ledger/server-auth.ts
git commit -m "feat(hub-ledger): helper autorisation serveur (JWT + shop + jeton PIN)"
```

---

## Task 6: Route PIN — statut, 1ère config, déverrouillage

**Files:**
- Create: `src/app/api/hub/comptes/pin/route.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/api/hub/comptes/pin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop } from '@/lib/hub-ledger/server-auth';
import { hashPin, verifyPin } from '@/lib/hub-ledger/pin';
import { issueUnlockToken } from '@/lib/hub-ledger/unlock-token';

// GET ?shopId= : statut du PIN (défini ou non)
export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const shopId = new URL(request.url).searchParams.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data } = await res.auth.svc
    .from('hub_ledger_settings')
    .select('pin_hash')
    .eq('shop_id', shopId)
    .maybeSingle();

  return NextResponse.json({ pinSet: !!data?.pin_hash });
}

// POST { shopId, action: 'setup' | 'unlock', pin }
export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  const { shopId, action, pin } = body as { shopId?: string; action?: string; pin?: string };

  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (!pin || !/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: 'PIN invalide (4 à 6 chiffres)' }, { status: 400 });

  const { svc, userId } = res.auth;
  const { data: settings } = await svc
    .from('hub_ledger_settings')
    .select('pin_hash')
    .eq('shop_id', shopId)
    .maybeSingle();

  if (action === 'setup') {
    if (settings?.pin_hash) return NextResponse.json({ error: 'PIN déjà défini' }, { status: 409 });
    const pin_hash = hashPin(pin);
    const { error } = await svc
      .from('hub_ledger_settings')
      .upsert({ shop_id: shopId, pin_hash, pin_set_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ unlockToken: issueUnlockToken(userId, Date.now()) });
  }

  if (action === 'unlock') {
    if (!settings?.pin_hash || !verifyPin(pin, settings.pin_hash)) {
      // délai anti-bruteforce léger
      await new Promise((r) => setTimeout(r, 400));
      return NextResponse.json({ error: 'PIN incorrect' }, { status: 401 });
    }
    return NextResponse.json({ unlockToken: issueUnlockToken(userId, Date.now()) });
  }

  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hub/comptes/pin/route.ts
git commit -m "feat(hub-ledger): route PIN (statut / setup / unlock)"
```

---

## Task 7: Route Dépenses

**Files:**
- Create: `src/app/api/hub/comptes/expenses/route.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/api/hub/comptes/expenses/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

const STATUSES = ['engage', 'soumis', 'rembourse'];

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const shopId = sp.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  let q = res.auth.svc.from('hub_ledger_expenses').select('*').eq('shop_id', shopId);
  const studyZoneId = sp.get('studyZoneId');
  if (studyZoneId) q = q.eq('study_zone_id', studyZoneId);
  const { data, error } = await q.order('spent_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expenses: data });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.amount !== 'number' || b.amount < 0 || !b.spentOn) {
    return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });
  }

  const { data, error } = await res.auth.svc.from('hub_ledger_expenses').insert({
    shop_id: b.shopId,
    location_id: b.locationId ?? null,
    study_zone_id: b.studyZoneId ?? null,
    spent_on: b.spentOn,
    description: b.description ?? '',
    amount: b.amount,
    receipt_path: b.receiptPath ?? null,
    status: 'engage',
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function PATCH(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.id || !b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (b.status && !STATUSES.includes(b.status)) return NextResponse.json({ error: 'Statut invalide' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['description', 'amount', 'status', 'receipt_path', 'spent_on', 'location_id', 'study_zone_id'] as const) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (b[camel] !== undefined) patch[k] = b[camel];
  }

  const { data, error } = await res.auth.svc
    .from('hub_ledger_expenses')
    .update(patch)
    .eq('id', b.id)
    .eq('shop_id', b.shopId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ expense: data });
}

export async function DELETE(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const id = sp.get('id');
  const shopId = sp.get('shopId');
  if (!id || !shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { error } = await res.auth.svc.from('hub_ledger_expenses').delete().eq('id', id).eq('shop_id', shopId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hub/comptes/expenses/route.ts
git commit -m "feat(hub-ledger): route dépenses (CRUD)"
```

---

## Task 8: Route Sessions de caisse

**Files:**
- Create: `src/app/api/hub/comptes/cash/sessions/route.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/api/hub/comptes/cash/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const shopId = sp.get('shopId');
  if (!shopId || !ownsShop(res.auth, shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  // Sessions + somme des sorties pour calculer le solde côté serveur
  const { data: sessions, error } = await res.auth.svc
    .from('hub_ledger_cash_sessions')
    .select('*, hub_ledger_cash_outflows(amount)')
    .eq('shop_id', shopId)
    .order('opened_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withBalance = (sessions ?? []).map((s: any) => {
    const out = (s.hub_ledger_cash_outflows ?? []).reduce((acc: number, o: any) => acc + Number(o.amount), 0);
    const { hub_ledger_cash_outflows, ...rest } = s;
    return { ...rest, total_outflows: out, balance: Number(s.opening_float) - out };
  });
  return NextResponse.json({ sessions: withBalance });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.openingFloat !== 'number' || b.openingFloat < 0 || !b.openedOn) {
    return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });
  }

  const { data, error } = await res.auth.svc.from('hub_ledger_cash_sessions').insert({
    shop_id: b.shopId,
    location_id: b.locationId ?? null,
    study_zone_id: b.studyZoneId ?? null,
    opening_float: b.openingFloat,
    opened_on: b.openedOn,
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

export async function PATCH(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.id || !b?.shopId || !ownsShop(res.auth, b.shopId)) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (b.openingFloat !== undefined) patch.opening_float = b.openingFloat;
  if (b.openedOn !== undefined) patch.opened_on = b.openedOn;
  if (b.studyZoneId !== undefined) patch.study_zone_id = b.studyZoneId;
  if (b.locationId !== undefined) patch.location_id = b.locationId;

  const { data, error } = await res.auth.svc
    .from('hub_ledger_cash_sessions')
    .update(patch)
    .eq('id', b.id)
    .eq('shop_id', b.shopId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
```

- [ ] **Step 2: Compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hub/comptes/cash/sessions/route.ts
git commit -m "feat(hub-ledger): route sessions de caisse (+ solde calculé)"
```

---

## Task 9: Route Sorties de caisse

**Files:**
- Create: `src/app/api/hub/comptes/cash/outflows/route.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/api/hub/comptes/cash/outflows/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

// Vérifie que la session appartient bien à un shop du user
async function sessionShopOk(res: { auth: { svc: any; shopIds: string[] } }, sessionId: string): Promise<boolean> {
  const { data } = await res.auth.svc.from('hub_ledger_cash_sessions').select('shop_id').eq('id', sessionId).maybeSingle();
  return !!data && res.auth.shopIds.includes(data.shop_id);
}

export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId || !(await sessionShopOk(res, sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { data, error } = await res.auth.svc
    .from('hub_ledger_cash_outflows')
    .select('*')
    .eq('session_id', sessionId)
    .order('spent_on', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outflows: data });
}

export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const b = await request.json().catch(() => null);
  if (!b?.sessionId || !(await sessionShopOk(res, b.sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  if (typeof b.amount !== 'number' || b.amount < 0 || !b.spentOn) return NextResponse.json({ error: 'Champs invalides' }, { status: 400 });

  const { data, error } = await res.auth.svc.from('hub_ledger_cash_outflows').insert({
    session_id: b.sessionId,
    spent_on: b.spentOn,
    description: b.description ?? '',
    amount: b.amount,
    created_by_user_id: res.auth.userId,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ outflow: data });
}

export async function DELETE(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const id = sp.get('id');
  const sessionId = sp.get('sessionId');
  if (!id || !sessionId || !(await sessionShopOk(res, sessionId))) return NextResponse.json({ error: 'Interdit' }, { status: 403 });

  const { error } = await res.auth.svc.from('hub_ledger_cash_outflows').delete().eq('id', id).eq('session_id', sessionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hub/comptes/cash/outflows/route.ts
git commit -m "feat(hub-ledger): route sorties de caisse (CRUD)"
```

---

## Task 10: Route Reçus (upload + URL signée)

**Files:**
- Create: `src/app/api/hub/comptes/receipts/route.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/api/hub/comptes/receipts/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, ownsShop, requireUnlock } from '@/lib/hub-ledger/server-auth';

const BUCKET = 'hub-receipts';

// POST multipart: file + shopId → upload privé, renvoie le path stocké
export async function POST(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  const shopId = form?.get('shopId');
  if (!(file instanceof File) || typeof shopId !== 'string' || !ownsShop(res.auth, shopId)) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Fichier trop volumineux (max 10 Mo)' }, { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${shopId}/${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error } = await res.auth.svc.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ path });
}

// GET ?path=&shopId= → URL signée courte durée
export async function GET(request: NextRequest) {
  const res = await authorizeRequest(request);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  if (!requireUnlock(request, res.auth.userId)) return NextResponse.json({ error: 'Verrouillé' }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const path = sp.get('path');
  const shopId = sp.get('shopId');
  // garde-fou : un path doit appartenir au dossier du shop
  if (!path || !shopId || !ownsShop(res.auth, shopId) || !path.startsWith(`${shopId}/`)) {
    return NextResponse.json({ error: 'Interdit' }, { status: 403 });
  }

  const { data, error } = await res.auth.svc.storage.from(BUCKET).createSignedUrl(path, 60 * 5);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
```

- [ ] **Step 2: Compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/hub/comptes/receipts/route.ts
git commit -m "feat(hub-ledger): route reçus (upload privé + URL signée)"
```

---

## Task 11: Types partagés + client API

**Files:**
- Create: `src/app/ivy/hub/comptes/types.ts`
- Create: `src/app/ivy/hub/comptes/api-client.ts`

- [ ] **Step 1: Types**

```ts
// src/app/ivy/hub/comptes/types.ts
export type ExpenseStatus = 'engage' | 'soumis' | 'rembourse';

export interface Expense {
  id: string;
  shop_id: string;
  location_id: string | null;
  study_zone_id: string | null;
  spent_on: string;
  description: string;
  amount: number;
  receipt_path: string | null;
  status: ExpenseStatus;
  created_at: string;
}

export interface CashSession {
  id: string;
  shop_id: string;
  location_id: string | null;
  study_zone_id: string | null;
  opening_float: number;
  opened_on: string;
  total_outflows: number;
  balance: number;
}

export interface CashOutflow {
  id: string;
  session_id: string;
  spent_on: string;
  description: string;
  amount: number;
}
```

- [ ] **Step 2: Client API**

```ts
// src/app/ivy/hub/comptes/api-client.ts
import { supabase } from '@/supabase/client';

/** Récupère le jeton de déverrouillage PIN courant (déposé par usePinLock). */
function unlockToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('hub_comptes_unlock');
}

/** fetch authentifié : ajoute le Bearer JWT + le jeton de déverrouillage PIN. */
export async function hubFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) headers.set('Authorization', `Bearer ${data.session.access_token}`);
  const ut = unlockToken();
  if (ut) headers.set('x-unlock-token', ut);
  return fetch(input, { ...init, headers });
}

export async function hubJson<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await hubFetch(input, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Erreur ${r.status}`);
  return body as T;
}
```

- [ ] **Step 3: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/types.ts src/app/ivy/hub/comptes/api-client.ts
git commit -m "feat(hub-ledger): types partagés + client API (Bearer + jeton)"
```

---

## Task 12: Hook de verrou PIN

**Files:**
- Create: `src/app/ivy/hub/comptes/hooks/usePinLock.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/ivy/hub/comptes/hooks/usePinLock.ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { hubJson } from '../api-client';

const KEY = 'hub_comptes_unlock';
const AUTO_LOCK_MS = 2 * 60 * 1000; // re-verrouille après 2 min d'inactivité

export type PinState = 'loading' | 'needs-setup' | 'locked' | 'unlocked';

export function usePinLock(shopId: string | undefined) {
  const [state, setState] = useState<PinState>('loading');

  const lock = useCallback(() => {
    sessionStorage.removeItem(KEY);
    setState('locked');
  }, []);

  // Statut initial : PIN défini ou non ?
  useEffect(() => {
    if (!shopId) return;
    let alive = true;
    hubJson<{ pinSet: boolean }>(`/api/hub/comptes/pin?shopId=${shopId}`)
      .then((r) => {
        if (!alive) return;
        if (!r.pinSet) setState('needs-setup');
        else setState(sessionStorage.getItem(KEY) ? 'unlocked' : 'locked');
      })
      .catch(() => alive && setState('locked'));
    return () => { alive = false; };
  }, [shopId]);

  // Auto-lock sur inactivité + masquage au changement d'onglet
  useEffect(() => {
    if (state !== 'unlocked') return;
    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, AUTO_LOCK_MS); };
    const onHide = () => { if (document.visibilityState === 'hidden') lock(); };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [state, lock]);

  const setup = useCallback(async (pin: string) => {
    if (!shopId) return;
    const { unlockToken } = await hubJson<{ unlockToken: string }>('/api/hub/comptes/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, action: 'setup', pin }),
    });
    sessionStorage.setItem(KEY, unlockToken);
    setState('unlocked');
  }, [shopId]);

  const unlock = useCallback(async (pin: string) => {
    if (!shopId) return;
    const { unlockToken } = await hubJson<{ unlockToken: string }>('/api/hub/comptes/pin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shopId, action: 'unlock', pin }),
    });
    sessionStorage.setItem(KEY, unlockToken);
    setState('unlocked');
  }, [shopId]);

  return { state, setup, unlock, lock };
}
```

- [ ] **Step 2: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/hooks/usePinLock.ts
git commit -m "feat(hub-ledger): hook usePinLock (setup/unlock/auto-lock)"
```

---

## Task 13: Hooks de données (TanStack Query)

**Files:**
- Create: `src/app/ivy/hub/comptes/hooks/useLedger.ts`

- [ ] **Step 1: Implémenter**

```ts
// src/app/ivy/hub/comptes/hooks/useLedger.ts
'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hubJson, hubFetch } from '../api-client';
import type { Expense, CashSession, CashOutflow } from '../types';

// ----- Dépenses -----
export function useExpenses(shopId: string | undefined, studyZoneId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['hub-expenses', shopId, studyZoneId],
    enabled: !!shopId && enabled,
    queryFn: () => {
      const u = new URL('/api/hub/comptes/expenses', window.location.origin);
      u.searchParams.set('shopId', shopId!);
      if (studyZoneId) u.searchParams.set('studyZoneId', studyZoneId);
      return hubJson<{ expenses: Expense[] }>(u.pathname + u.search).then((r) => r.expenses);
    },
  });
}

export function useExpenseMutations(shopId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hub-expenses', shopId] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson('/api/hub/comptes/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson('/api/hub/comptes/expenses', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => hubJson(`/api/hub/comptes/expenses?id=${id}&shopId=${shopId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

// ----- Sessions de caisse -----
export function useCashSessions(shopId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['hub-cash-sessions', shopId],
    enabled: !!shopId && enabled,
    queryFn: () => hubJson<{ sessions: CashSession[] }>(`/api/hub/comptes/cash/sessions?shopId=${shopId}`).then((r) => r.sessions),
  });
}

export function useCashSessionMutations(shopId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hub-cash-sessions', shopId] });
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson('/api/hub/comptes/cash/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson('/api/hub/comptes/cash/sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, shopId }) }),
      onSuccess: invalidate,
    }),
  };
}

// ----- Sorties de caisse -----
export function useOutflows(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['hub-outflows', sessionId],
    enabled: !!sessionId,
    queryFn: () => hubJson<{ outflows: CashOutflow[] }>(`/api/hub/comptes/cash/outflows?sessionId=${sessionId}`).then((r) => r.outflows),
  });
}

export function useOutflowMutations(shopId: string | undefined, sessionId: string | undefined) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['hub-outflows', sessionId] });
    qc.invalidateQueries({ queryKey: ['hub-cash-sessions', shopId] }); // le solde change
  };
  return {
    create: useMutation({
      mutationFn: (body: Record<string, unknown>) =>
        hubJson('/api/hub/comptes/cash/outflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, sessionId }) }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => hubJson(`/api/hub/comptes/cash/outflows?id=${id}&sessionId=${sessionId}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

// ----- Reçus -----
export async function uploadReceipt(shopId: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.set('file', file);
  fd.set('shopId', shopId);
  const r = await hubFetch('/api/hub/comptes/receipts', { method: 'POST', body: fd });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || 'Upload échoué');
  return body.path as string;
}

export async function getReceiptUrl(shopId: string, path: string): Promise<string> {
  const r = await hubJson<{ url: string }>(`/api/hub/comptes/receipts?shopId=${shopId}&path=${encodeURIComponent(path)}`);
  return r.url;
}
```

- [ ] **Step 2: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/hooks/useLedger.ts
git commit -m "feat(hub-ledger): hooks données TanStack Query + reçus"
```

---

## Task 14: Composants PIN (Setup + Gate)

**Files:**
- Create: `src/app/ivy/hub/comptes/components/PinSetup.tsx`
- Create: `src/app/ivy/hub/comptes/components/PinGate.tsx`

- [ ] **Step 1: PinSetup**

```tsx
// src/app/ivy/hub/comptes/components/PinSetup.tsx
'use client';
import { useState } from 'react';
import { Button, PinInput, Stack, Text, Title } from '@mantine/core';

export function PinSetup({ onSubmit }: { onSubmit: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length < 4) return setErr('Le PIN doit faire au moins 4 chiffres.');
    if (pin !== confirm) return setErr('Les deux PIN ne correspondent pas.');
    setBusy(true); setErr('');
    try { await onSubmit(pin); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Stack align="center" gap="md" maw={360} mx="auto" mt="xl">
      <Title order={3}>Définir un code PIN</Title>
      <Text size="sm" c="dimmed" ta="center">Ce code protège l&apos;accès à tes comptes de stand. Il n&apos;est stocké que sous forme chiffrée (irrécupérable).</Text>
      <PinInput length={6} type="number" value={pin} onChange={setPin} aria-label="Nouveau PIN" />
      <PinInput length={6} type="number" value={confirm} onChange={setConfirm} aria-label="Confirmer le PIN" />
      {err && <Text c="red" size="sm">{err}</Text>}
      <Button onClick={submit} loading={busy} fullWidth>Enregistrer le PIN</Button>
    </Stack>
  );
}
```

- [ ] **Step 2: PinGate**

```tsx
// src/app/ivy/hub/comptes/components/PinGate.tsx
'use client';
import { useState } from 'react';
import { Button, PinInput, Stack, Text, Title } from '@mantine/core';

export function PinGate({ onUnlock }: { onUnlock: (pin: string) => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true); setErr('');
    try { await onUnlock(value); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  };

  return (
    <Stack align="center" gap="md" maw={320} mx="auto" mt="xl">
      <Title order={3}>Accès protégé</Title>
      <Text size="sm" c="dimmed">Saisis ton PIN pour afficher tes comptes.</Text>
      <PinInput length={6} type="number" value={pin} onChange={setPin} onComplete={submit} disabled={busy} aria-label="PIN" />
      {err && <Text c="red" size="sm">{err}</Text>}
      <Button onClick={() => submit(pin)} loading={busy} disabled={pin.length < 4} fullWidth>Déverrouiller</Button>
    </Stack>
  );
}
```

- [ ] **Step 3: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/components/PinSetup.tsx src/app/ivy/hub/comptes/components/PinGate.tsx
git commit -m "feat(hub-ledger): composants PinSetup + PinGate"
```

---

## Task 15: Composant MaskedAmount

**Files:**
- Create: `src/app/ivy/hub/comptes/components/MaskedAmount.tsx`

- [ ] **Step 1: Implémenter**

```tsx
// src/app/ivy/hub/comptes/components/MaskedAmount.tsx
'use client';
import { Text } from '@mantine/core';

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/**
 * Affiche un montant formaté quand `revealed`, sinon `••••• €`.
 * Le verrou réel est côté serveur (jeton PIN) ; ceci évite l'affichage à l'écran sur le stand.
 */
export function MaskedAmount({ value, revealed, c }: { value: number; revealed: boolean; c?: string }) {
  return <Text span fw={600} c={c}>{revealed ? EUR.format(value) : '••••• €'}</Text>;
}
```

- [ ] **Step 2: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/components/MaskedAmount.tsx
git commit -m "feat(hub-ledger): composant MaskedAmount"
```

---

## Task 16: Tableau Dépenses + formulaire

**Files:**
- Create: `src/app/ivy/hub/comptes/components/ExpenseForm.tsx`
- Create: `src/app/ivy/hub/comptes/components/ExpensesTable.tsx`

- [ ] **Step 1: ExpenseForm**

```tsx
// src/app/ivy/hub/comptes/components/ExpenseForm.tsx
'use client';
import { useState } from 'react';
import { Button, FileButton, Group, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';

interface Zone { id: string; name: string; }

export function ExpenseForm({ zones, onSubmit }: {
  zones: Zone[];
  onSubmit: (data: { amount: number; spentOn: string; description: string; studyZoneId: string | null; file: File | null }) => Promise<void>;
}) {
  const [amount, setAmount] = useState<number | string>('');
  const [spentOn, setSpentOn] = useState<Date | null>(new Date());
  const [description, setDescription] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (typeof amount !== 'number' || !spentOn) return;
    setBusy(true);
    try {
      await onSubmit({ amount, spentOn: spentOn.toISOString().slice(0, 10), description, studyZoneId: zoneId, file });
      setAmount(''); setDescription(''); setFile(null);
    } finally { setBusy(false); }
  };

  return (
    <Stack gap="sm">
      <Group grow>
        <NumberInput label="Montant (€)" value={amount} onChange={setAmount} min={0} decimalScale={2} thousandSeparator=" " />
        <DateInput label="Date" value={spentOn} onChange={setSpentOn} valueFormat="DD/MM/YYYY" />
      </Group>
      <TextInput label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      <Select label="Festival" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={zoneId} onChange={setZoneId} clearable searchable />
      <Group>
        <FileButton onChange={setFile} accept="image/*">
          {(props) => <Button variant="light" {...props}>{file ? file.name : 'Photo du reçu'}</Button>}
        </FileButton>
        <Button onClick={submit} loading={busy} disabled={typeof amount !== 'number'}>Ajouter</Button>
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 2: ExpensesTable**

```tsx
// src/app/ivy/hub/comptes/components/ExpensesTable.tsx
'use client';
import { Badge, Group, Select, Stack, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { ExpenseForm } from './ExpenseForm';
import { MaskedAmount } from './MaskedAmount';
import { useExpenses, useExpenseMutations, uploadReceipt } from '../hooks/useLedger';
import type { ExpenseStatus } from '../types';

const STATUS_LABEL: Record<ExpenseStatus, { label: string; color: string }> = {
  engage: { label: 'Engagé', color: 'gray' },
  soumis: { label: 'Soumis', color: 'blue' },
  rembourse: { label: 'Remboursé', color: 'green' },
};

interface Zone { id: string; name: string; }

export function ExpensesTable({ shopId, zones, revealed }: { shopId: string; zones: Zone[]; revealed: boolean }) {
  const { data: expenses = [], isLoading } = useExpenses(shopId);
  const { create, update } = useExpenseMutations(shopId);

  const add = async (d: { amount: number; spentOn: string; description: string; studyZoneId: string | null; file: File | null }) => {
    try {
      let receiptPath: string | null = null;
      if (d.file) {
        try { receiptPath = await uploadReceipt(shopId, d.file); }
        catch { notifications.show({ color: 'orange', message: 'Dépense enregistrée sans le reçu (upload échoué).' }); }
      }
      await create.mutateAsync({ amount: d.amount, spentOn: d.spentOn, description: d.description, studyZoneId: d.studyZoneId, receiptPath });
      notifications.show({ color: 'green', message: 'Dépense ajoutée.' });
    } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
  };

  return (
    <Stack>
      <ExpenseForm zones={zones} onSubmit={add} />
      {isLoading ? <Text c="dimmed">Chargement…</Text> : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th><Table.Th>Description</Table.Th>
              <Table.Th>Montant</Table.Th><Table.Th>Reçu</Table.Th><Table.Th>Statut</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {expenses.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{new Date(e.spent_on).toLocaleDateString('fr-FR')}</Table.Td>
                <Table.Td>{e.description}</Table.Td>
                <Table.Td><MaskedAmount value={Number(e.amount)} revealed={revealed} /></Table.Td>
                <Table.Td>{e.receipt_path ? '📎' : <Badge color="orange" variant="light">manquant</Badge>}</Table.Td>
                <Table.Td>
                  <Select
                    size="xs" variant="unstyled" allowDeselect={false}
                    data={Object.entries(STATUS_LABEL).map(([v, { label }]) => ({ value: v, label }))}
                    value={e.status}
                    onChange={(v) => v && update.mutate({ id: e.id, status: v })}
                    renderOption={({ option }) => <Badge color={STATUS_LABEL[option.value as ExpenseStatus].color} variant="light">{option.label}</Badge>}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
            {expenses.length === 0 && (
              <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center">Aucune dépense.</Text></Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
      <Group justify="flex-end">
        <Text size="sm" c="dimmed">Total :</Text>
        <MaskedAmount value={expenses.reduce((a, e) => a + Number(e.amount), 0)} revealed={revealed} />
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 3: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

```bash
git add src/app/ivy/hub/comptes/components/ExpenseForm.tsx src/app/ivy/hub/comptes/components/ExpensesTable.tsx
git commit -m "feat(hub-ledger): tableau dépenses + formulaire + upload reçu"
```

---

## Task 17: Tableau Caisse + formulaire de sortie

**Files:**
- Create: `src/app/ivy/hub/comptes/components/CashOutflowForm.tsx`
- Create: `src/app/ivy/hub/comptes/components/CashTable.tsx`

- [ ] **Step 1: CashOutflowForm**

```tsx
// src/app/ivy/hub/comptes/components/CashOutflowForm.tsx
'use client';
import { useState } from 'react';
import { Button, Group, NumberInput, TextInput } from '@mantine/core';
import { DateInput } from '@mantine/dates';

export function CashOutflowForm({ onSubmit }: {
  onSubmit: (d: { amount: number; spentOn: string; description: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState<number | string>('');
  const [spentOn, setSpentOn] = useState<Date | null>(new Date());
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (typeof amount !== 'number' || !spentOn) return;
    setBusy(true);
    try {
      await onSubmit({ amount, spentOn: spentOn.toISOString().slice(0, 10), description });
      setAmount(''); setDescription('');
    } finally { setBusy(false); }
  };

  return (
    <Group align="flex-end" grow>
      <NumberInput label="Sortie (€)" value={amount} onChange={setAmount} min={0} decimalScale={2} />
      <DateInput label="Date" value={spentOn} onChange={setSpentOn} valueFormat="DD/MM/YYYY" />
      <TextInput label="Motif" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
      <Button onClick={submit} loading={busy} disabled={typeof amount !== 'number'}>Ajouter</Button>
    </Group>
  );
}
```

- [ ] **Step 2: CashTable**

```tsx
// src/app/ivy/hub/comptes/components/CashTable.tsx
'use client';
import { useState } from 'react';
import { ActionIcon, Alert, Button, Group, NumberInput, Select, Stack, Table, Text } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { CashOutflowForm } from './CashOutflowForm';
import { MaskedAmount } from './MaskedAmount';
import { useCashSessions, useCashSessionMutations, useOutflows, useOutflowMutations } from '../hooks/useLedger';

interface Zone { id: string; name: string; }

export function CashTable({ shopId, zones, revealed }: { shopId: string; zones: Zone[]; revealed: boolean }) {
  const { data: sessions = [] } = useCashSessions(shopId);
  const { create: createSession } = useCashSessionMutations(shopId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newFloat, setNewFloat] = useState<number | string>('');
  const [newDate, setNewDate] = useState<Date | null>(new Date());
  const [newZone, setNewZone] = useState<string | null>(null);

  const current = sessions.find((s) => s.id === selectedId) ?? sessions[0] ?? null;
  const { data: outflows = [] } = useOutflows(current?.id);
  const { create: addOutflow, remove: removeOutflow } = useOutflowMutations(shopId, current?.id);

  const openSession = async () => {
    if (typeof newFloat !== 'number' || !newDate) return;
    try {
      const r: any = await createSession.mutateAsync({ openingFloat: newFloat, openedOn: newDate.toISOString().slice(0, 10), studyZoneId: newZone });
      setSelectedId(r.session.id); setNewFloat('');
      notifications.show({ color: 'green', message: 'Caisse ouverte.' });
    } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
  };

  return (
    <Stack>
      <Group align="flex-end" grow>
        <Select label="Festival (caisse)" data={sessions.map((s) => ({ value: s.id, label: `${s.opened_on} — ${zones.find((z) => z.id === s.study_zone_id)?.name ?? 'sans festival'}` }))}
          value={current?.id ?? null} onChange={setSelectedId} placeholder="Choisir une caisse" />
      </Group>

      {sessions.length === 0 || selectedId === '__new__' ? null : null}

      <Alert variant="light" title="Ouvrir une nouvelle caisse">
        <Group align="flex-end" grow>
          <NumberInput label="Fond de caisse (€)" value={newFloat} onChange={setNewFloat} min={0} decimalScale={2} />
          <DateInput label="Date d'ouverture" value={newDate} onChange={setNewDate} valueFormat="DD/MM/YYYY" />
          <Select label="Festival" data={zones.map((z) => ({ value: z.id, label: z.name }))} value={newZone} onChange={setNewZone} clearable searchable />
          <Button onClick={openSession} loading={createSession.isPending}>Ouvrir</Button>
        </Group>
      </Alert>

      {current && (
        <>
          <Group justify="space-between">
            <Group gap="lg">
              <Text size="sm">Fond : <MaskedAmount value={Number(current.opening_float)} revealed={revealed} /></Text>
              <Text size="sm">Sorties : <MaskedAmount value={Number(current.total_outflows)} revealed={revealed} /></Text>
              <Text size="sm" fw={700}>Solde : <MaskedAmount value={Number(current.balance)} revealed={revealed} c={current.balance < 0 ? 'red' : undefined} /></Text>
            </Group>
          </Group>
          {current.balance < 0 && <Alert color="red" variant="light">Solde négatif : plus de sorties que le fond de caisse.</Alert>}

          <CashOutflowForm onSubmit={async (d) => {
            try { await addOutflow.mutateAsync(d); notifications.show({ color: 'green', message: 'Sortie ajoutée.' }); }
            catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
          }} />

          <Table striped withTableBorder>
            <Table.Thead>
              <Table.Tr><Table.Th>Date</Table.Th><Table.Th>Motif</Table.Th><Table.Th>Montant</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {outflows.map((o) => (
                <Table.Tr key={o.id}>
                  <Table.Td>{new Date(o.spent_on).toLocaleDateString('fr-FR')}</Table.Td>
                  <Table.Td>{o.description}</Table.Td>
                  <Table.Td><MaskedAmount value={Number(o.amount)} revealed={revealed} /></Table.Td>
                  <Table.Td><ActionIcon variant="subtle" color="red" onClick={() => removeOutflow.mutate(o.id)}><IconTrash size={16} /></ActionIcon></Table.Td>
                </Table.Tr>
              ))}
              {outflows.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center">Aucune sortie.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
```

- [ ] **Step 3: Compilation + commit**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur. (Si `@tabler/icons-react` manque, vérifier — il est déjà utilisé dans IVY via `TopNavbar`.)

```bash
git add src/app/ivy/hub/comptes/components/CashOutflowForm.tsx src/app/ivy/hub/comptes/components/CashTable.tsx
git commit -m "feat(hub-ledger): tableau caisse (sessions + sorties + solde)"
```

---

## Task 18: Page assemblée + entrée discrète dans le Hub

**Files:**
- Create: `src/app/ivy/hub/comptes/page.tsx`
- Create: `src/app/ivy/hub/comptes/comptes.module.scss`
- Modify: `src/app/ivy/hub/page.tsx` (ajouter l'icône cadenas)

- [ ] **Step 1: Styles**

```scss
// src/app/ivy/hub/comptes/comptes.module.scss
.page { max-width: 900px; margin: 0 auto; padding: 1rem; }
.lockBtn {
  position: absolute; top: 0.75rem; right: 0.75rem; z-index: 10;
  opacity: 0.35; transition: opacity 0.2s;
}
.lockBtn:hover { opacity: 1; }
```

- [ ] **Step 2: Page**

```tsx
// src/app/ivy/hub/comptes/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { ActionIcon, Group, Loader, Tabs, Title, Tooltip } from '@mantine/core';
import { IconLock, IconReceipt, IconCash } from '@tabler/icons-react';
import { useShop } from '@/context/ShopContext';
import { hubJson } from './api-client';
import { usePinLock } from './hooks/usePinLock';
import { PinSetup } from './components/PinSetup';
import { PinGate } from './components/PinGate';
import { ExpensesTable } from './components/ExpensesTable';
import { CashTable } from './components/CashTable';
import styles from './comptes.module.scss';

interface Zone { id: string; name: string; }

export default function ComptesPage() {
  const { currentShop } = useShop();
  const shopId = currentShop?.id;
  const { state, setup, unlock, lock } = usePinLock(shopId);
  const [zones, setZones] = useState<Zone[]>([]);

  useEffect(() => {
    if (!shopId || state !== 'unlocked') return;
    hubJson<{ zones: Zone[] }>(`/api/pos/study-zones?shopId=${shopId}`).then((r) => setZones(r.zones)).catch(() => setZones([]));
  }, [shopId, state]);

  if (!shopId || state === 'loading') return <Group justify="center" mt="xl"><Loader /></Group>;
  if (state === 'needs-setup') return <div className={styles.page}><PinSetup onSubmit={setup} /></div>;
  if (state === 'locked') return <div className={styles.page}><PinGate onUnlock={unlock} /></div>;

  return (
    <div className={styles.page}>
      <Tooltip label="Verrouiller">
        <ActionIcon className={styles.lockBtn} variant="subtle" onClick={lock} aria-label="Verrouiller"><IconLock size={18} /></ActionIcon>
      </Tooltip>
      <Title order={2} mb="md">Comptes de stand</Title>
      <Tabs defaultValue="depenses">
        <Tabs.List>
          <Tabs.Tab value="depenses" leftSection={<IconReceipt size={16} />}>Dépenses</Tabs.Tab>
          <Tabs.Tab value="caisse" leftSection={<IconCash size={16} />}>Caisse</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="depenses" pt="md"><ExpensesTable shopId={shopId} zones={zones} revealed /></Tabs.Panel>
        <Tabs.Panel value="caisse" pt="md"><CashTable shopId={shopId} zones={zones} revealed /></Tabs.Panel>
      </Tabs>
    </div>
  );
}
```

> Note : `revealed` est `true` une fois déverrouillé (les données ne sont chargées qu'après PIN, le serveur exigeant le jeton). Le masquage `••••` couvre l'état verrouillé/auto-lock où la page n'affiche de toute façon que le `PinGate`.

- [ ] **Step 3: Icône cadenas dans le Hub**

Ouvrir `src/app/ivy/hub/page.tsx`. Repérer le JSX racine retourné (le conteneur principal de la page caisse). Ajouter en tête de ce conteneur un lien discret :

```tsx
// imports à ajouter en haut de src/app/ivy/hub/page.tsx
import Link from 'next/link';
import { ActionIcon, Tooltip } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
```

```tsx
// à insérer comme premier enfant du conteneur racine du rendu
<Tooltip label="Comptes (privé)" position="left">
  <ActionIcon
    component={Link}
    href="/ivy/hub/comptes"
    variant="subtle"
    aria-label="Comptes"
    style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, opacity: 0.25 }}
  >
    <IconLock size={16} />
  </ActionIcon>
</Tooltip>
```

(Si le conteneur racine n'est pas positionné, l'`ActionIcon` en `position: absolute` se placera par rapport au premier ancêtre positionné ; au besoin ajouter `position: relative` au conteneur. Vérifier visuellement en Step 5.)

- [ ] **Step 4: Compilation**

Run: `pnpm exec tsc --noEmit`
Expected: pas d'erreur.

- [ ] **Step 5: Lancer et vérifier visuellement**

Run: `pnpm dev` puis ouvrir `http://localhost:3000/ivy/hub`.
Expected : icône cadenas discrète en haut à droite ; clic → `/ivy/hub/comptes` → écran PinSetup (premier accès).

- [ ] **Step 6: Commit**

```bash
git add src/app/ivy/hub/comptes/page.tsx src/app/ivy/hub/comptes/comptes.module.scss src/app/ivy/hub/page.tsx
git commit -m "feat(hub-ledger): page Comptes de stand + entrée discrète dans le Hub"
```

---

## Task 19: Vérification end-to-end manuelle

**Files:** (aucun — QA manuelle via `pnpm dev`)

- [ ] **Step 1: Parcours complet**

Run: `pnpm dev`, se connecter avec le compte IVY, aller sur `/ivy/hub` → icône cadenas.

Vérifier dans l'ordre :
1. **1ère config** : écran PinSetup ; PIN < 4 chiffres refusé ; PIN ≠ confirmation refusé ; PIN valide → page déverrouillée.
2. **Dépense** : ajouter (montant, date, description, festival), joindre une photo → ligne créée, 📎 présent ; total mis à jour.
3. **Statut** : passer une dépense `engagé` → `soumis` → `remboursé` ; le badge change.
4. **Caisse** : ouvrir une caisse (fond + festival) ; ajouter 2 sorties ; vérifier **solde = fond − Σ sorties** ; supprimer une sortie → solde recalculé ; mettre une sortie > fond → solde négatif + alerte rouge.
5. **Verrou** : cliquer l'icône cadenas (verrouiller) → retour PinGate ; recharger l'onglet → PinGate (pas d'affichage des montants) ; attendre 2 min d'inactivité → auto-lock ; changer d'onglet navigateur puis revenir → verrouillé.
6. **PIN erroné** : 1 mauvais PIN → message générique, pas de données affichées.

- [ ] **Step 2: Vérifier l'isolation des données (sécurité)**

Dans un terminal, tenter d'appeler une route sans jeton :
```bash
curl -s "http://localhost:3000/api/hub/comptes/expenses?shopId=<SHOP_ID>"
```
Expected: `401` (« Non authentifié ») — aucune donnée renvoyée sans Bearer + sans jeton PIN.

- [ ] **Step 3: PWA / mobile**

Ouvrir les DevTools → device mobile, vérifier que les formulaires et tableaux sont utilisables au pouce (saisie le soir au téléphone). Si IVY expose déjà un manifest PWA, confirmer que la page est atteignable hors nav par l'URL directe.

- [ ] **Step 4: Build de production**

Run: `pnpm build`
Expected: build réussit sans erreur de type ni d'import.

- [ ] **Step 5: Commit (si correctifs)**

```bash
git add -A
git commit -m "fix(hub-ledger): correctifs vérification end-to-end"
```

---

## Self-Review (rempli par l'auteur du plan)

**Spec coverage :**
- Module privé `/ivy/hub/comptes` hors nav → Tasks 18 (page + entrée discrète). ✅
- 2 tableaux (dépenses / caisse) → Tasks 16, 17. ✅
- Champs dépense (montant, date, description, reçu, statut, festival) → Tasks 7, 16. ✅
- Fond de caisse + sorties, solde déduit → Tasks 8, 9, 17. ✅
- Pivots `locations` / `pos_study_zones` → study_zones câblés (Task 18 charge les zones) ; `location_id` présent en DB/routes, exposé en UI = post-MVP léger (champ optionnel déjà stocké). ✅ (note ci-dessous)
- 4 tables `hub_ledger_*` + RLS + bucket → Task 1. ✅
- PIN hashé + écran 1ère config → Tasks 3, 6, 12, 14. ✅
- Jeton de déverrouillage requis côté serveur → Tasks 4, 5, 7-10. ✅
- Montants masqués + auto-lock → Tasks 12, 15. ✅
- Reçus bucket privé + URL signée → Tasks 10, 13. ✅
- Pas de vente enregistrée (NF525) → aucune table/route n'enregistre de prix de vente. ✅

**Écart assumé (YAGNI) :** la sélection d'`emplacement` (`location_id`) dans l'UI n'est pas exposée au MVP — la colonne existe et les routes l'acceptent, mais le filtre par festival (`study_zone`) couvre le besoin de regroupement décrit. À activer si besoin via le `LocationContext` existant (post-MVP).

**Placeholder scan :** aucun TODO/TBD ; code complet à chaque step. ✅

**Type consistency :** `Expense`/`CashSession`/`CashOutflow` (types.ts) cohérents entre routes (snake_case DB) et hooks/composants ; `hubFetch`/`hubJson` signatures stables ; `usePinLock` expose `{ state, setup, unlock, lock }` utilisés tels quels dans `page.tsx`. ✅
