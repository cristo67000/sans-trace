# Sans trace

Appli web installable (PWA) pour téléphone : elle **affiche les métadonnées** d'une photo
(lieu GPS, date, appareil, auteur, miniature, vidéo cachée…), **les enlève** et permet de
**partager** ou d'enregistrer la copie nettoyée. Tout se passe sur l'appareil, hors ligne.

- JPEG, PNG, WebP : retrait **sans recompression** (les pixels sont recopiés tels quels) ;
  l'orientation et le profil de couleur sont conservés.
- Deux modes : *Tout enlever* ou *Le lieu seulement* (GPS et noms de lieux).
- HEIC et autres : lecture des informations, copie réenregistrée en JPEG si le navigateur sait ouvrir l'image.
- Appli installée : elle apparaît dans le menu « Partager » d'Android (galerie → Partager → Sans trace).

## Fichiers

- `js/moteur.js` — lecture et retrait des métadonnées (fonctions pures, sans dépendance)
- `js/app.js`, `css/style.css`, `index.html` — interface
- `sw.js`, `manifest.webmanifest` — hors ligne, installation, cible de partage

## Épreuves

```bash
python build/fabriquer_essais.py
node build/essais.mjs
python build/fabriquer_essais.py --verifier
```

La troisième commande compare les pixels des copies nettoyées à ceux des originaux.
En développement : `http://localhost:8260/?sans-sw` (sans service worker).
