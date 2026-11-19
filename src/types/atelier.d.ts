/** Le pont d'IVY Atelier (atelier/src/preload.ts), absent dans un navigateur. */
interface Window {
  ivyAtelier?: {
    /** Pose le fichier dans le cache de l'application ; vrai s'il est sur le disque. */
    preparer(url: string, nom: string): Promise<boolean>;
    /** Glisse le vrai fichier (déjà préparé) vers un autre logiciel. */
    glisser(url: string, nom: string): void;
  };
}
