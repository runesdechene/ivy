# IVY Atelier — application Windows d'impression

> Conception validée par Uriel le 19/11/2026 (approche A). À planifier ensuite (`docs/superpowers/plans/`).

## Pourquoi

Tanguy imprime à l'atelier avec Brother GTX Graphics Lab / ArtCraft. Les fichiers d'impression de chaque ligne
de commande existent déjà dans IVY (étiquettes sous les métachamps, commandes clients et de stock, tâche 12).
Mais **aucun navigateur ne sait faire glisser un vrai fichier vers un logiciel installé** : Chrome et Brave lâchent
un fichier « virtuel » que l'Explorateur accepte et qu'ArtCraft refuse (constaté le 19/11/2026). ArtCraft accepte
en revanche un fichier glissé depuis l'Explorateur (vérifié par Uriel). Le clic pour télécharger marche, mais
impose un détour par les téléchargements.

Une application Windows peut poser le fichier sur le disque et le lâcher comme l'Explorateur. C'est aussi ce qui
rend IVY vendable à d'autres ateliers : « vos fichiers d'impression glissés droit dans votre RIP ».

## Ce que Tanguy doit y trouver

**Quoi imprimer, et pour qui.** Rien d'autre (Uriel : « Osef de la partie Facture, etc. »).

## Objectifs

- Une application Windows « IVY Atelier » installée sur le PC de Tanguy.
- Elle n'affiche que **deux pages d'IVY en ligne** : Commandes (commandes clients, `/ivy/commandes/boutique`) et
  Commandes stock (`/ivy/commandes/stock` et le détail d'une commande), plus la page de connexion.
- Le menu d'IVY y est masqué ; seule une navigation entre ces deux pages reste.
- **Glisser natif** : faire glisser une étiquette de fichier d'impression dépose un vrai PNG (300 dpi, nom de
  l'atelier, ex. `LOKI DTG-OPA C-LARGE.png`) dans ArtCraft / Graphics Lab.
- L'application se met à jour seule.

## Non-objectifs

- Pas de nouvelle page « À imprimer » (approche B écartée par Uriel) : les pages existantes, telles quelles.
- Pas de Facturation, Suivi interne, Archives, Vue d'ensemble, Inventaire, Mockups, Hub, Stand.
- Pas de fonctionnement hors ligne.
- Pas de certificat de signature pour l'instant (atelier seul) : Windows affichera « Éditeur inconnu » à
  l'installation. À prendre avant de vendre l'application (200–400 €/an).
- Pas de macOS / Linux.

## Anti-objectifs

- Un deuxième IVY à maintenir : l'application n'a **aucune logique métier**, elle affiche l'IVY en ligne.
  Tout ce qui change dans IVY lui arrive sans nouvelle version.
- Exposer à Tanguy les autres parties d'IVY par un lien ou un retour arrière.

## Approches considérées

| | Approche | Pour | Contre |
|---|---|---|---|
| **A — retenue** | Coquille Electron autour des pages Commandes existantes, menu masqué | La plus rapide ; zéro logique en double | Les pages montrent aussi coûts, prix, feuillets ; deux pages au lieu d'une |
| B | Nouvelle page IVY « À imprimer » (clients + stock réunis), seule affichée par la coquille | Écran pensé pour l'impression, simple à vendre | Une page de plus à construire |
| C | Application Windows indépendante lisant la base | — | Deuxième logiciel, ses propres droits d'accès, même résultat que B |

Uriel a choisi **A**.

## Comment ça marche (décidé)

### La coquille
- **Electron**, une fenêtre qui charge `https://ivy.runesdechene.com/ivy/commandes/boutique`.
- **Liste blanche d'adresses** : `/login`, `/` (qui redirige vers les commandes), `/ivy/commandes/boutique`
  (exact), `/ivy/commandes/stock`, `/ivy/commandes/stock/<id>` et ses deux sous-pages `/impression` et
  `/feuillet` (leurs boutons sont sur la commande ; les pages restent telles quelles — *choix de Claude*).
  Toute autre navigation dans la fenêtre est refusée, y compris celle interne à Next (`did-navigate-in-page`) ;
  les liens externes s'ouvrent dans le navigateur par défaut.
- La session IVY (Supabase) vit dans le profil de l'application : Tanguy se connecte une fois avec son compte.

### Le mode Atelier dans IVY
- La coquille se signale (suffixe `IvyAtelier/<version>` dans le User-Agent).
- `IvyLayout` le détecte et remplace son menu par **deux onglets** : « Commandes » et « Commandes stock ».
  Les autres entrées et la barre du haut (Inventaire, Hub, Festivals…) disparaissent.
- **« Synchroniser » reste**, avec l'heure de la dernière synchro et le nombre de commandes en attente : c'est
  le seul chemin par lequel les commandes Shopify arrivent dans IVY (ni webhook ni tâche planifiée). Validé par
  Uriel le 19/11/2026. La synchronisation automatique est un chantier à part, pour tout IVY.

### Le glisser natif
- Le preload expose `window.ivyAtelier` : `preparer(url, nom)` et `glisser(nom)`.
- Au survol d'une étiquette, `preparer` fait télécharger le fichier par le processus principal dans un cache
  local, sous son vrai nom. **Un même nom peut changer de contenu** (motif modifié, refait sous le même nom) :
  le cache est donc rangé par l'empreinte du fichier, lue dans le chemin de son adresse signée
  (`<nom>.<empreinte>.png`), soit `%LOCALAPPDATA%\IVY Atelier\impression\<empreinte>\<nom>` — un motif changé
  donne un autre dossier, jamais un vieux fichier (*choix de Claude*). `preparer` n'accepte que des adresses du
  stockage d'IVY.
- Au `dragstart`, si `window.ivyAtelier` existe, le composant `FichiersDeLaLigne` annule le glisser web et appelle
  `glisser(nom)` ; le processus principal lance `webContents.startDrag({ file, icon })` avec le fichier en cache.
  Sans la coquille (navigateur), le comportement actuel reste : clic pour télécharger, glisser `DownloadURL`.
- Le clic pour télécharger reste dans l'application.

### Mises à jour
- `electron-builder` (installateur NSIS) et `electron-updater`. Au démarrage, l'application vérifie s'il existe
  une version plus récente et l'installe à la fermeture.

## Contraintes

- Le dépôt IVY reste un projet Next.js déployé par Netlify à chaque poussée sur `main` : la coquille ne doit pas
  entrer dans son build.
- Les adresses signées des fichiers expirent après 1 h : le cache local garde le fichier, le nom suffit pour le
  glisser.
- Graphics Lab / ArtCraft reçoivent le fichier par son chemin : le nom doit rester celui de l'atelier.

## Laissé au constructeur

- L'emplacement du code de la coquille dans le dépôt IVY (dossier à part, son propre `package.json`).
- Où publier les versions pour `electron-updater` (stockage public, hors du build Netlify).
- L'icône de l'application et celle montrée pendant le glisser.
- Le vidage du cache local (âge, taille).
