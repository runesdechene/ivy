import { inflateRawSync } from 'node:zlib';

/**
 * Lecture du « Rapport de ventes » SumUp exporté en .xlsx.
 *
 * Le rapport donne une ligne par article saisi : sur un stand, c'est toujours un
 * « Montant personnalisé », sans produit ni réduction. Une même transaction peut
 * compter plusieurs lignes : on les regroupe par référence. Les remboursements
 * viennent en déduction.
 *
 * Aucune dépendance : un .xlsx est un zip de fichiers XML.
 */

export interface PaiementSumUp {
  ref: string;
  /** Heure locale du rapport, AAAA-MM-JJTHH:MM. */
  date: string;
  /** Montant encaissé, en euros (SumUp encaisse toujours en euros). */
  eur: number;
}

const ERREUR = "Ce fichier n'est pas un rapport SumUp au format .xlsx";

/** Fichiers d'une archive zip, décompressés à la demande. */
function lireZip(octets: Uint8Array): Map<string, () => Buffer> {
  const buf = Buffer.from(octets.buffer, octets.byteOffset, octets.byteLength);
  // Fin du répertoire central : dans les 65 557 derniers octets.
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error(ERREUR);
  const nombre = buf.readUInt16LE(fin + 10);
  let pos = buf.readUInt32LE(fin + 16);
  const fichiers = new Map<string, () => Buffer>();
  for (let k = 0; k < nombre; k++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error(ERREUR);
    const methode = buf.readUInt16LE(pos + 10);
    const tailleCompressee = buf.readUInt32LE(pos + 20);
    const longueurNom = buf.readUInt16LE(pos + 28);
    const longueurExtra = buf.readUInt16LE(pos + 30);
    const longueurCommentaire = buf.readUInt16LE(pos + 32);
    const entete = buf.readUInt32LE(pos + 42);
    const nom = buf.toString('utf8', pos + 46, pos + 46 + longueurNom);
    fichiers.set(nom, () => {
      const debut = entete + 30 + buf.readUInt16LE(entete + 26) + buf.readUInt16LE(entete + 28);
      const donnees = buf.subarray(debut, debut + tailleCompressee);
      return methode === 8 ? inflateRawSync(donnees) : Buffer.from(donnees);
    });
    pos += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return fichiers;
}

const entites = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Numéro de colonne (0 = A) depuis une référence de cellule « AB12 ». */
const colonne = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function lignesFeuille(fichiers: Map<string, () => Buffer>): string[][] {
  const partages: string[] = [];
  const sst = fichiers.get('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst().toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      partages.push(entites([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    }
  }
  const feuille = fichiers.get('xl/worksheets/sheet1.xml');
  if (!feuille) throw new Error(ERREUR);
  const lignes: string[][] = [];
  for (const row of feuille().toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cellules: string[] = [];
    for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributs = c[1];
      const contenu = c[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attributs)?.[1];
      const type = /t="([^"]+)"/.exec(attributs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(contenu)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(contenu)?.[1];
      const valeur = type === 's' && v !== undefined ? partages[Number(v)] ?? '' : entites(inline ?? v ?? '');
      cellules[ref ? colonne(ref) : cellules.length] = valeur;
    }
    lignes.push(Array.from(cellules, (x) => x ?? ''));
  }
  return lignes;
}

/**
 * Mois écrits par SumUp, en entier (« août ») ou abrégés (« sept. »), avec ou
 * sans accents. On compare sur les trois premières lettres sans accent : « jui »
 * ne suffit pas à départager juin de juillet, d'où les entrées à quatre lettres.
 */
const MOIS: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', avr: '04', mai: '05', juin: '06', juil: '07',
  aou: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const sansAccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function moisSumUp(mot: string): string | undefined {
  const m = sansAccent(mot).replace(/\.$/, '');
  return MOIS[m.slice(0, 4)] ?? MOIS[m.slice(0, 3)];
}

/** « 27 août 2026 18:07 » ou « 21 sept. 2026 12:26 » → 2026-08-27T18:07. */
function dateSumUp(texte: string): string {
  const m = /^(\d{1,2})\s+(\S+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/.exec(texte.trim());
  const mois = m && moisSumUp(m[2]);
  if (!m || !mois) throw new Error(`Date SumUp illisible : « ${texte} »`);
  return `${m[3]}-${mois}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}`;
}

export function lireRapportSumUp(octets: Uint8Array): { paiements: PaiementSumUp[]; devise: string } {
  let lignes: string[][];
  try {
    lignes = lignesFeuille(lireZip(octets));
  } catch (err) {
    throw err instanceof Error && err.message.startsWith('Date') ? err : new Error(ERREUR);
  }
  const entete = lignes[0] ?? [];
  const col = (nom: string) => entete.indexOf(nom);
  const [cDate, cType, cRef, cDevise, cPrix] = ['Date', 'Type', 'Réf. transaction', 'Devise', 'Prix (TTC)'].map(col);
  if ([cDate, cType, cRef, cDevise, cPrix].some((c) => c < 0)) throw new Error(ERREUR);

  const parRef = new Map<string, PaiementSumUp & { centimes: number }>();
  const devises = new Set<string>();
  for (const l of lignes.slice(1)) {
    const type = l[cType];
    // Les lignes ajoutées sous le tableau (totaux, notes) n'ont pas de type : ignorées.
    if (type !== 'Vente' && type !== 'Remboursement') continue;
    devises.add(l[cDevise]);
    const centimes = Math.round(Number(l[cPrix]) * 100) * (type === 'Vente' ? 1 : -1);
    const p = parRef.get(l[cRef]) ?? { ref: l[cRef], date: dateSumUp(l[cDate]), eur: 0, centimes: 0 };
    p.centimes += centimes;
    parRef.set(l[cRef], p);
  }
  if (devises.size > 1) throw new Error(`Rapport SumUp en plusieurs devises : ${[...devises].join(', ')}`);

  const paiements = [...parRef.values()]
    .filter((p) => p.centimes !== 0) // entièrement remboursé
    .map(({ ref, date, centimes }) => ({ ref, date, eur: centimes / 100 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { paiements, devise: [...devises][0] ?? 'EUR' };
}
