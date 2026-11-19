/** Le pont entre IVY et l'application : préparer un fichier d'impression, puis le glisser. Rien d'autre. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ivyAtelier', {
  preparer: (url: string, nom: string): Promise<boolean> => ipcRenderer.invoke('atelier:preparer', url, nom),
  glisser: (url: string, nom: string): void => ipcRenderer.send('atelier:glisser', url, nom),
});
