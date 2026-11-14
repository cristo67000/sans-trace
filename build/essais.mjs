// Épreuves du moteur : node build/essais.mjs (après python build/fabriquer_essais.py)
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { analyser, nettoyer } from '../js/moteur.js';

const D = new URL('./essais/', import.meta.url);
const S = new URL('./sortie/', D);
rmSync(S, { recursive: true, force: true });
mkdirSync(S, { recursive: true });

let echecs = 0;
const verifier = (cond, message) => { if (!cond) { echecs++; console.log('   ÉCHEC :', message); } };

for (const nom of readdirSync(D).filter((n) => /\.(jpg|png|webp)$/.test(n)).sort()) {
  const o = new Uint8Array(readFileSync(new URL(nom, D)));
  const a = analyser(o);
  console.log(`\n${nom} — ${a.format} ${a.largeur}×${a.hauteur}, ${o.length} o, orientation ${a.orientation}, ${a.traces} trace(s)`);
  console.log('   blocs :', a.blocs.map((b) => `${b.nom} (${b.taille})`).join(', ') || '—');
  console.log('   bilan :', JSON.stringify(a.bilan), a.position ? JSON.stringify(a.position) : '');
  if (nom === 'photo.jpg') for (const c of a.champs) console.log(`     [${c.g}] ${c.l} : ${c.v}`);
  verifier(!a.erreur, a.erreur);
  verifier(a.largeur === 640 && a.hauteur === 480, 'dimensions');
  const masquee = /masquee|effacee/.test(nom);
  const charge = !/nue|simple|masquee|effacee/.test(nom);
  if (masquee) verifier(a.positionMasquee && !a.position && a.bilan.date, 'masquage Android non reconnu');
  else verifier(charge ? a.bilan.position && !a.positionMasquee && a.traces > 5 : a.traces === 0, 'bilan de départ inattendu');
  if (charge) verifier(Math.abs(a.position.lat - 48.58170) < 1e-4 && Math.abs(a.position.lon - 7.75069) < 1e-4, 'position mal lue');

  const tout = nettoyer(o, 'tout');
  const b = analyser(tout.octets);
  console.log(`   tout     → ${tout.octets.length} o, ${b.traces} trace(s), orientation ${b.orientation}, blocs : ${b.blocs.map((x) => x.nom).join(', ') || '—'}`);
  verifier(b.traces === 0, `il reste ${b.traces} trace(s) : ${JSON.stringify(b.champs.filter((c) => !c.neutre))} ${JSON.stringify(b.blocs)}`);
  verifier(b.orientation === a.orientation, 'orientation perdue');
  verifier(!b.position, 'position encore là');
  verifier(analyser(nettoyer(tout.octets, 'tout').octets).traces === 0 && nettoyer(tout.octets, 'tout').octets.length === tout.octets.length, 'second passage instable');
  writeFileSync(new URL(`tout__${nom}`, S), tout.octets);

  const pos = nettoyer(o, 'position');
  const c = analyser(pos.octets);
  console.log(`   position → ${pos.octets.length} o, ${c.traces} trace(s), position : ${c.bilan.position}`);
  if (nom === 'photo.jpg') verifier(['1/250 s', 'f/1,8', '5,4 mm'].every((v) => a.champs.some((x) => x.v === v)), 'réglages mal lus');
  verifier(!c.position && !c.bilan.position, 'lieu encore là : ' + JSON.stringify(c.champs.filter((x) => x.g === 'position')));
  if (charge) verifier(c.bilan.date && c.bilan.appareil, 'le mode position a retiré autre chose');
  verifier(c.orientation === a.orientation, 'orientation perdue (position)');
  if (nom === 'animee.jpg') verifier(!c.bilan.video, 'vidéo conservée');
  writeFileSync(new URL(`position__${nom}`, S), pos.octets);
}

// Fichiers abîmés : le moteur ne doit jamais planter.
const ref = new Uint8Array(readFileSync(new URL('photo.jpg', D)));
for (let i = 0; i < 400; i++) {
  const o = ref.slice(0, i % 7 === 0 ? 20 + ((i * 131) % ref.length) : ref.length);
  for (let k = 0; k < 12; k++) o[(i * 7919 + k * 104729) % Math.min(o.length, 3000)] = (i * 31 + k * 17) & 255;
  try { analyser(o); nettoyer(o, 'tout'); nettoyer(o, 'position'); }
  catch (e) { echecs++; console.log('   ÉCHEC sur fichier abîmé', i, e.message); break; }
}

console.log(echecs ? `\n${echecs} échec(s)` : '\nToutes les épreuves du moteur passent.');
process.exit(echecs ? 1 : 0);
