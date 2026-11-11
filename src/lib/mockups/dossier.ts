import { cleMotif } from './regles';

/** Accès au dossier d'un motif sur le disque (Chrome et Edge) : lecture des sources, écriture des fichiers d'impression. */

// Pas encore dans les types DOM de TypeScript.
declare global {
  interface Window { showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle> }
}

export interface DossierMotif { handle: FileSystemDirectoryHandle; nom: string; fichiers: Map<string, File> }

export const dossierPossible = () => typeof window !== 'undefined' && !!window.showDirectoryPicker;

/** Demande le dossier ; `null` si annulé ou si le navigateur ne sait pas faire. Fichiers de la racine seulement. */
export async function ouvrirDossier(): Promise<DossierMotif | null> {
  if (!window.showDirectoryPicker) return null;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null; // fenêtre fermée
    throw e;
  }
  const fichiers = new Map<string, File>();
  for await (const entree of handle.values()) {
    if (entree.kind === 'file') fichiers.set(entree.name, await (entree as FileSystemFileHandle).getFile());
  }
  return { handle, nom: cleMotif(handle.name), fichiers };
}

export async function ecrireFichier(handle: FileSystemDirectoryHandle, nom: string, contenu: Blob): Promise<void> {
  const ecriture = await (await handle.getFileHandle(nom, { create: true })).createWritable();
  await ecriture.write(contenu);
  await ecriture.close();
}
