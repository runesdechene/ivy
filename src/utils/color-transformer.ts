interface ColorMapping {
  displayName: string | null;
  hexValue: string;
}

// Mapping statique par défaut - displayName null = pas de transformation
// Ces couleurs sont uniquement pour avoir une couleur hex par défaut
export const colorMappings: { [key: string]: ColorMapping } = {};

// Cache pour les mappings dynamiques depuis Supabase
let dynamicColorMappings: { [key: string]: ColorMapping } | null = null;
let colorMappingsLoaded = false;

/**
 * Charge les mappings de couleurs depuis Supabase
 */
export async function loadColorMappingsFromSupabase(shopId: string): Promise<void> {
  try {
    const response = await fetch(`/api/settings?shopId=${shopId}`);
    if (response.ok) {
      const data = await response.json();
      dynamicColorMappings = {};
      if (data.colorRules && data.colorRules.length > 0) {
        data.colorRules.forEach((rule: { reception_name: string; display_name: string | null; hex_value: string }) => {
          dynamicColorMappings![rule.reception_name] = { 
            displayName: rule.display_name,
            hexValue: rule.hex_value 
          };
        });
      }
      colorMappingsLoaded = true;
    }
  } catch (err) {
    console.error('Error loading color mappings from Supabase:', err);
  }
}

/**
 * Vérifie si les mappings ont été chargés
 */
export function areColorMappingsLoaded(): boolean {
  return colorMappingsLoaded;
}

/**
 * Retourne les mappings actifs (dynamiques si disponibles, sinon statiques)
 */
export function getActiveColorMappings(): { [key: string]: ColorMapping } {
  return dynamicColorMappings || colorMappings;
}

/**
 * Cherche une correspondance de couleur insensible à la casse
 */
function findColorMapping(color: string, mappings: { [key: string]: ColorMapping }): [string, ColorMapping] | undefined {
  // Normaliser l'entrée (minuscules, sans accents)
  const normalizedInput = color.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return Object.entries(mappings).find(([key]) => {
    const normalizedKey = key.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return normalizedKey === normalizedInput;
  });
}

/**
 * Transforme le nom d'une couleur vers son nom d'affichage (Ivy)
 * La recherche est insensible à la casse (Bleu Marine = bleu marine = BLEU MARINE)
 * @param color - Le nom de la couleur à transformer (nom de réception)
 * @returns Le nom d'affichage si configuré, sinon le nom original
 */
export function transformColor(color: string): string {
  if (!color) return 'Sans couleur';
  
  const activeMappings = getActiveColorMappings();
  
  // Nettoyer la couleur (enlever les parenthèses et leur contenu)
  const cleanColor = color.replace(/\s*\([^)]*\)/g, '').trim();

  // Chercher une correspondance insensible à la casse
  const foundColor = findColorMapping(cleanColor, activeMappings);

  if (foundColor) {
    return foundColor[1].displayName || cleanColor;
  }

  // Si aucune correspondance n'est trouvée, retourner la couleur originale
  return cleanColor;
}

/**
 * Transforme le nom d'affichage d'une couleur vers son nom de réception
 * Utilisé pour la génération des strings de facturation (règles en français)
 * @param displayColor - Le nom d'affichage de la couleur
 * @returns Le nom de réception correspondant
 */
export function reverseTransformColor(displayColor: string): string {
  if (!displayColor) return '';
  
  const activeMappings = getActiveColorMappings();
  
  // Chercher la correspondance inverse (displayName → reception_name)
  const foundEntry = Object.entries(activeMappings).find(([_, mapping]) => 
    mapping.displayName?.toLowerCase() === displayColor.toLowerCase()
  );
  
  if (foundEntry) {
    return foundEntry[0]; // Retourner le nom de réception
  }
  
  // Si pas de correspondance, retourner la couleur telle quelle
  return displayColor;
}

/**
 * Retourne la couleur hexadécimale associée à un nom de couleur
 * La recherche est insensible à la casse
 * @param color - Le nom de la couleur (réception ou affichage)
 * @returns Le code hexadécimal ou un gris par défaut
 */
export function getColorHex(color: string): string {
  if (!color) return '#808080';
  
  const activeMappings = getActiveColorMappings();
  
  // Chercher par nom de réception (insensible à la casse)
  const foundByReception = findColorMapping(color, activeMappings);
  if (foundByReception) {
    return foundByReception[1].hexValue;
  }
  
  // Chercher par displayName (insensible à la casse)
  const normalizedInput = color.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
    
  const foundByDisplay = Object.entries(activeMappings).find(([_, mapping]) => {
    if (!mapping.displayName) return false;
    const normalizedDisplay = mapping.displayName.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return normalizedDisplay === normalizedInput;
  });
  
  if (foundByDisplay) {
    return foundByDisplay[1].hexValue;
  }
  
  return '#808080';
}

/**
 * Vérifie si un nom d'option correspond à une option de type couleur
 */
export function isColorOption(optionName: string): boolean {
  if (!optionName) return false;
  const normalized = optionName.toLowerCase().trim();
  return normalized === 'couleur' || normalized === 'color' || normalized === 'colour';
}
