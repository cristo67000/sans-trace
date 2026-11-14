// Écrit build/essais/reference.json : ce que le moteur web lit dans chaque photo
// d'essai. Le portage Dart (sans-trace-android) doit lire exactement la même chose.
// À lancer après build/essais.mjs, qui produit aussi les copies de référence (sortie/).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { analyser } from '../js/moteur.js';

const D = new URL('./essais/', import.meta.url);
const ref = {};
for (const nom of readdirSync(D).filter((n) => /\.(jpg|png|webp)$/.test(n)).sort()) {
  const a = analyser(new Uint8Array(readFileSync(new URL(nom, D))));
  ref[nom] = {
    format: a.format, largeur: a.largeur, hauteur: a.hauteur, orientation: a.orientation, traces: a.traces,
    position: a.position, positionMasquee: !!a.positionMasquee,
    champs: a.champs.map((c) => [c.g, c.l, c.v, c.s]),
    blocs: a.blocs.map((b) => [b.nom, b.taille]),
  };
}
writeFileSync(new URL('reference.json', D), JSON.stringify(ref, null, 1));
console.log(`référence écrite pour ${Object.keys(ref).length} fichiers`);
