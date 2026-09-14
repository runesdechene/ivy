'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { TextInput, Loader, Select } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useShop } from '@/context/ShopContext';
import { formatSh, parseSh } from '@/lib/customs/tariffs';
import { depuisSaisie, versSaisie, type LigneSaisie, type ObjetMateriel } from '@/lib/customs/materiel';
import { MaterielEditor } from '@/components/customs/MaterielEditor';
import styles from '../parametres.module.scss';

interface Row {
  productType: string;
  /** Ce qui est affiché dans les champs, tel que tapé. */
  libelle: string;
  codeSh: string;
  /** Dernières valeurs enregistrées : on n'écrit que ce qui a changé. */
  savedLibelle: string;
  savedCodeSh: string;
  saving: boolean;
  codeError: string | null;
}

const complet = (r: Row) => !!r.savedLibelle && !!r.savedCodeSh;

export default function DouaneSettingsPage() {
  const { currentShop } = useShop();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const fetchData = useCallback(async () => {
    if (!currentShop) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/settings/customs-tariffs?shopId=${currentShop.id}`);
      if (!res.ok) throw new Error();
      const data = await res.json() as {
        rows: { product_type: string; code_sh: string | null; libelle: string | null }[];
        productTypes: string[];
      };
      const byType = new Map(data.rows.map((r) => [r.product_type, r]));
      setRows(data.productTypes.map((type) => {
        const r = byType.get(type);
        const libelle = r?.libelle ?? '';
        const codeSh = formatSh(r?.code_sh);
        return { productType: type, libelle, codeSh, savedLibelle: libelle, savedCodeSh: codeSh, saving: false, codeError: null };
      }));
    } catch {
      notifications.show({ title: 'Erreur', message: 'Impossible de charger le référentiel douanier', color: 'rust' });
    } finally {
      setLoading(false);
    }
  }, [currentShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Modèle par emplacement : caisses et matériel d'exposition ---
  // Les pages Paramètres ne sont pas sous LocationProvider : on lit les
  // emplacements directement, avec les mêmes règles que le sélecteur d'Ivy —
  // seulement les emplacements ACTIFS (Shopify garde les désactivés, comme
  // « Fournisseur »), et par défaut celui choisi dans le sélecteur.
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [materiel, setMateriel] = useState<LigneSaisie[]>([]);
  const [modeleCharge, setModeleCharge] = useState(false);
  const [modeleSaving, setModeleSaving] = useState(false);

  useEffect(() => {
    if (!currentShop) return;
    fetch(`/api/locations?shopId=${currentShop.id}`)
      .then((r) => r.json())
      .then((data: { locations?: { id: string; name: string; active: boolean }[] }) => {
        const list = (data.locations ?? []).filter((l) => l.active);
        setLocations(list);
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(`ivy_location_${currentShop.id}`);
        } catch {
          /* stockage indisponible : premier emplacement */
        }
        setLocationId((prev) => prev ?? list.find((l) => l.id === saved)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => notifications.show({ title: 'Erreur', message: 'Emplacements illisibles', color: 'rust' }));
  }, [currentShop]);

  useEffect(() => {
    if (!currentShop || !locationId) return;
    setModeleCharge(false);
    fetch(`/api/settings/customs-templates?shopId=${currentShop.id}&locationId=${locationId}`)
      .then((r) => r.json())
      .then((data: { template: { packaging_kg: Record<string, number>; materiel: ObjetMateriel[] } | null }) => {
        setMateriel(versSaisie(data.template?.materiel ?? []));
      })
      .catch(() => notifications.show({ title: 'Erreur', message: 'Modèle illisible', color: 'rust' }))
      .finally(() => setModeleCharge(true));
  }, [currentShop, locationId]);

  const saveModele = async () => {
    if (!currentShop || !locationId) return;
    const m = depuisSaisie(materiel);
    if ('erreur' in m) {
      notifications.show({ title: 'Matériel incomplet', message: m.erreur, color: 'rust' });
      return;
    }
    // Les caisses par type n'existent plus : elles sont des fournitures cochées « Caisse ».
    const packagingKg: Record<string, number> = {};
    setModeleSaving(true);
    try {
      const res = await fetch('/api/settings/customs-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id, locationId, packagingKg, materiel: m.materiel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      setMateriel(versSaisie(data.template.materiel));
      notifications.show({ title: 'Modèle enregistré', message: 'Repris par les prochains passages de cet emplacement.', color: 'moss' });
    } catch (err) {
      notifications.show({ title: 'Erreur', message: err instanceof Error ? err.message : 'Enregistrement impossible', color: 'rust' });
    } finally {
      setModeleSaving(false);
    }
  };

  const patch = (type: string, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.productType === type ? { ...r, ...p } : r)));

  const save = async (row: Row) => {
    if (!currentShop) return;
    const libelle = row.libelle.trim();
    const saisie = row.codeSh.trim();
    const code = saisie ? parseSh(saisie) : null;
    if (saisie && !code) {
      patch(row.productType, { codeError: '8 chiffres, ex. 6109.1000' });
      return;
    }
    const codeSh = formatSh(code);
    if (libelle === row.savedLibelle && codeSh === row.savedCodeSh) {
      patch(row.productType, { codeError: null, codeSh });
      return;
    }

    patch(row.productType, { saving: true, codeError: null, codeSh });
    try {
      const res = await fetch('/api/settings/customs-tariffs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: currentShop.id, productType: row.productType, codeSh: code ?? '', libelle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      patch(row.productType, { savedLibelle: libelle, savedCodeSh: codeSh, libelle });
    } catch (err) {
      notifications.show({
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Enregistrement impossible',
        color: 'rust',
      });
    } finally {
      patch(row.productType, { saving: false });
    }
  };

  // Les types à compléter d'abord : ce sont eux qui manqueront au guichet.
  // L'ordre ne dépend que de l'état ENREGISTRÉ, pour qu'une ligne ne saute pas
  // pendant la frappe.
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(complet(a)) - Number(complet(b)) || a.productType.localeCompare(b.productType, 'fr')),
    [rows],
  );
  const aCompleter = rows.filter((r) => !complet(r)).length;

  const shopName = currentShop?.name || 'Runes de Chêne';

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <Loader size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pageHead}>
        <div className={styles.pageHeadLeft}>
          <div className={styles.eyebrow}>Paramètres · {shopName}</div>
          <h1 className={styles.title}>
            Référentiel <em>douanier</em>
          </h1>
          <div className={styles.sub}>
            Un libellé et un code SH par type de produit, repris par chaque passage en douane
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <div>
            <h3 className={styles.cardHeadTitle}>
              {aCompleter > 0 ? `${aCompleter} type(s) à renseigner` : 'Tous les types sont renseignés'}
            </h3>
            <p className={styles.cardHeadSub}>
              Le libellé est ce que lit le douanier : un mot courant (« Sweat-shirt »), pas le nom commercial.
              Le code SH se choisit selon la matière — 6110.20 pour un sweat en coton, par exemple.
              Un passage ouvert suit ce référentiel en direct ; un passage clôturé garde ses valeurs.
            </p>
          </div>
        </div>
        {rows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Type de produit</th>
                  <th className={styles.th}>Libellé douanier</th>
                  <th className={styles.th} style={{ width: 170 }}>Code SH</th>
                  <th className={styles.th} style={{ width: 130 }} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr key={row.productType} className={styles.tr}>
                    <td className={styles.td}>{row.productType}</td>
                    <td className={styles.td}>
                      <TextInput
                        value={row.libelle}
                        placeholder="ex. Sweat-shirt"
                        onChange={(e) => patch(row.productType, { libelle: e.currentTarget.value })}
                        onBlur={() => save(row)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)' } }}
                      />
                    </td>
                    <td className={styles.td}>
                      <TextInput
                        value={row.codeSh}
                        placeholder="0000.0000"
                        error={row.codeError}
                        onChange={(e) => patch(row.productType, { codeSh: e.currentTarget.value, codeError: null })}
                        onBlur={() => save(row)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        styles={{ input: { backgroundColor: 'var(--cream)', borderColor: 'var(--divider)', fontVariantNumeric: 'tabular-nums' } }}
                      />
                    </td>
                    <td className={styles.td}>
                      {row.saving ? (
                        <Loader size="xs" />
                      ) : complet(row) ? (
                        <span className={`${styles.badge} ${styles.badge_moss}`}>Renseigné</span>
                      ) : (
                        <span className={`${styles.badge} ${styles.badge_clay}`}>À renseigner</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.cardBody}>
            <p className={styles.emptyStateText}>Aucun type de produit trouvé.</p>
          </div>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: 28 }}>
        <div className={styles.cardHead}>
          <div>
            <h3 className={styles.cardHeadTitle}>Modèle par emplacement</h3>
            <p className={styles.cardHeadSub}>
              Suivi en direct par le passage ouvert de cet emplacement, figé à sa clôture.
              Poids et valeur s&apos;entendent pour UN objet ; la valeur est une estimation en euros.
            </p>
          </div>
          <Select
            data={locations.map((l) => ({ value: l.id, label: l.name }))}
            value={locationId}
            onChange={setLocationId}
            allowDeselect={false}
            placeholder="Emplacement"
            w={240}
          />
        </div>
        <div className={styles.cardBody}>
          {!locationId ? (
            <p className={styles.emptyStateText}>Choisis un emplacement.</p>
          ) : !modeleCharge ? (
            <Loader size="sm" />
          ) : (
            <>
              <h4 className={styles.cardHeadTitle} style={{ fontSize: 14 }}>Fournitures du stand</h4>
              <p className={styles.cardHeadSub} style={{ marginBottom: 8 }}>
                Coche « Caisse » pour ce qui transporte la marchandise : son poids s&apos;ajoute au poids brut
                (réparti par type au prorata du poids net). Le reste s&apos;imprime à part, en matériel d&apos;exposition.
              </p>
              <MaterielEditor lignes={materiel} onChange={setMateriel} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button className={styles.primaryButton} onClick={saveModele} disabled={modeleSaving}>
                  {modeleSaving ? 'Enregistrement…' : 'Enregistrer le modèle'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
