// Sans trace — interface. Tout le traitement est local ; aucune requête réseau
// n'est émise en dehors du chargement de l'appli elle-même.
import { analyser, nettoyer, coordonnees } from './moteur.js';

const VERSION = '1.0.2';
const $ = (id) => document.getElementById(id);
const photos = [];
let prochainId = 1;
let pretes = null; // copies en attente d'un geste pour le partage

/* ───────────── petits outils ───────────── */

function h(balise, attrs, ...enfants) {
  const e = document.createElement(balise);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const x of enfants.flat(Infinity)) if (x != null && x !== false) e.append(x);
  return e;
}
function taille(n) {
  if (n < 1000) return `${n} o`;
  if (n < 1e6) return `${Math.round(n / 1000)} ko`;
  return `${(n / 1e6).toFixed(1).replace('.', ',')} Mo`;
}
const pluriel = (n, mot, mots = mot + 's') => `${n} ${n > 1 ? mots : mot}`;
let minuterie;
function dire(texte, duree = 4500) {
  const m = $('message');
  m.textContent = texte;
  m.hidden = false;
  clearTimeout(minuterie);
  minuterie = setTimeout(() => { m.hidden = true; }, duree);
}
const mode = () => document.querySelector('input[name=mode]:checked').value;
const renommer = () => $('renommer').checked;

/* ───────────── ajout et analyse ───────────── */

async function ajouter(fichiers) {
  const images = [...fichiers].filter((f) => f && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i.test(f.name)));
  if (!images.length) { if (fichiers.length) dire('Ces fichiers ne sont pas des images.'); return; }
  for (const fichier of images) {
    let a;
    try { a = analyser(new Uint8Array(await fichier.arrayBuffer())); }
    catch { a = analyser(new Uint8Array(0)); a.erreur = 'Lecture impossible'; }
    photos.push({ id: prochainId++, fichier, a, url: URL.createObjectURL(fichier), resultat: null });
  }
  afficher();
}

/* ───────────── nettoyage ───────────── */

async function recompresser(fichier) {
  const image = await createImageBitmap(fichier);
  const toile = document.createElement('canvas');
  toile.width = image.width;
  toile.height = image.height;
  toile.getContext('2d').drawImage(image, 0, 0);
  image.close?.();
  const blob = await new Promise((ok) => toile.toBlob(ok, 'image/jpeg', 0.92));
  if (!blob) throw new Error('recompression impossible');
  return new Uint8Array(await blob.arrayBuffer());
}

function nomCopie(p, rang, extension) {
  if (renommer()) return `photo-${rang}.${extension}`;
  const base = p.fichier.name.replace(/\.[^.]+$/, '') || 'photo';
  return `${base}.${extension}`;
}

async function preparer(p) {
  const cle = `${mode()}|${renommer()}|${photos.indexOf(p)}`;
  if (p.resultat?.cle === cle && !p.resultat.erreur) return p.resultat;
  const rang = photos.indexOf(p) + 1;
  try {
    const o = new Uint8Array(await p.fichier.arrayBuffer());
    let r = nettoyer(o, mode());
    let recompresse = false;
    if (!r) {
      r = { octets: await recompresser(p.fichier), mime: 'image/jpeg', extension: 'jpg' };
      recompresse = true;
    }
    const apres = analyser(r.octets);
    p.resultat = {
      cle, recompresse, mode: recompresse ? 'tout' : mode(), apres,
      avant: o.length,
      fichier: new File([r.octets], nomCopie(p, rang, r.extension), { type: r.mime }),
    };
  } catch (e) {
    p.resultat = { cle, erreur: p.a.format === 'heif' ? 'Ce navigateur ne sait pas ouvrir ce format (HEIC) : la copie n’a pas pu être faite.' : 'Cette image n’a pas pu être traitée.' };
  }
  majResultat(p);
  return p.resultat;
}

async function copies(liste) {
  const r = [];
  for (const p of liste) { const x = await preparer(p); if (x.fichier) r.push(x.fichier); }
  return r;
}

async function partager(liste) {
  const fichiers = await copies(liste);
  if (!fichiers.length) return;
  if (!navigator.canShare?.({ files: fichiers })) {
    dire('Le partage de fichiers n’est pas proposé par ce navigateur : utilisez « Enregistrer ».', 6000);
    return;
  }
  try {
    await navigator.share({ files: fichiers });
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Le navigateur exige un geste récent : on le redemande, copies déjà prêtes.
    pretes = fichiers;
    $('pretes-texte').textContent = `${pluriel(fichiers.length, 'copie nettoyée', 'copies nettoyées')} ${fichiers.length > 1 ? 'sont prêtes' : 'est prête'}.`;
    $('pretes').showModal();
  }
}

async function enregistrer(liste) {
  const fichiers = await copies(liste);
  for (const f of fichiers) {
    const url = URL.createObjectURL(f);
    const a = h('a', { href: url, download: f.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (fichiers.length > 1) await new Promise((ok) => setTimeout(ok, 350));
  }
  if (fichiers.length) dire(fichiers.length > 1 ? `${fichiers.length} copies enregistrées dans les téléchargements.` : `« ${fichiers[0].name} » enregistrée dans les téléchargements.`);
}

/* ───────────── affichage ───────────── */

const GROUPES = [
  ['position', 'Lieu'], ['date', 'Date et heure'], ['auteur', 'Identité et textes'], ['appareil', 'Appareil'],
  ['prise', 'Réglages de prise de vue'], ['logiciel', 'Logiciel'], ['autres', 'Autres données'],
];
const FORMATS = { jpeg: 'JPEG', png: 'PNG', webp: 'WebP', heif: 'HEIC', gif: 'GIF', inconnu: 'Image' };

function pastilles(a) {
  const l = [];
  const b = a.bilan;
  if (a.positionMasquee && !a.position) l.push(['Lieu masqué par Android', 'moyen']);
  else if (b.position) l.push(['Lieu', 'fort']);
  if (b.identite) l.push(['Identité, textes', 'fort']);
  if (b.video) l.push(['Vidéo cachée', 'fort']);
  if (b.date) l.push(['Date', 'moyen']);
  if (b.appareil) l.push(['Appareil', 'moyen']);
  if (b.miniature) l.push(['Miniature', 'moyen']);
  if (!l.length) l.push(a.traces ? [pluriel(a.traces, 'information technique', 'informations techniques'), ''] : ['Aucune métadonnée', 'bien']);
  return h('div', { class: 'pastilles' }, l.map(([t, c]) => h('span', { class: `pastille ${c}` }, t)));
}

function detail(a) {
  const visibles = a.champs.filter((c) => !c.neutre || a.champs.length > 1);
  if (!visibles.length && !a.blocs.length) return null;
  const corps = [];
  for (const [g, titre] of GROUPES) {
    const l = visibles.filter((c) => c.g === g);
    if (!l.length) continue;
    corps.push(h('div', { class: 'groupe' }, h('h3', null, titre),
      h('dl', null, l.map((c) => [h('dt', null, c.l), h('dd', { class: c.s === 2 ? 'fort' : null }, c.v)]))));
  }
  if (a.blocs.length) corps.push(h('p', { class: 'blocs' }, 'Blocs du fichier : ' + a.blocs.map((b) => `${b.nom}${b.taille ? ` (${taille(b.taille)})` : ''}`).join(', ') + '.'));
  return h('details', { class: 'detail' }, h('summary', null, visibles.length ? `Voir ${pluriel(visibles.length, 'information', 'informations')}` : 'Voir les blocs du fichier'), corps);
}

function texteResultat(p) {
  const r = p.resultat;
  if (!r) return null;
  if (r.erreur) return h('div', { class: 'resultat erreur' }, r.erreur);
  const reste = r.apres.traces;
  const poids = `${taille(r.avant)} → ${taille(r.fichier.size)}`;
  if (r.recompresse) return h('div', { class: 'resultat reserve' }, `Copie réenregistrée en JPEG (${poids}) : ce format ne permet pas un retrait sans recompression. ${reste ? `${pluriel(reste, 'information restante', 'informations restantes')}.` : 'Aucune métadonnée dans la copie.'}`);
  if (r.mode === 'position') {
    const ok = !r.apres.bilan.position;
    return h('div', { class: `resultat ${ok ? '' : 'erreur'}` }, ok
      ? `Copie prête : lieu retiré, ${reste ? pluriel(reste, 'autre information conservée', 'autres informations conservées') : 'rien d’autre à conserver'}. Image intacte (${poids}).`
      : 'Attention : une information de lieu subsiste dans la copie. Choisissez « Tout enlever ».');
  }
  return h('div', { class: `resultat ${reste ? 'erreur' : ''}` }, reste
    ? `Attention : ${pluriel(reste, 'information subsiste', 'informations subsistent')} dans la copie.`
    : `Copie prête et vérifiée : aucune métadonnée. Image intacte, sans recompression (${poids}).`);
}
function majResultat(p) {
  const zone = document.querySelector(`[data-id="${p.id}"] .zone-resultat`);
  if (zone) zone.replaceChildren(...[texteResultat(p)].filter(Boolean));
}

function carte(p) {
  const a = p.a;
  const vignette = h('img', { class: 'vignette', src: p.url, alt: '', loading: 'lazy' });
  vignette.addEventListener('error', () => vignette.replaceWith(h('div', { class: 'vignette vide' }, FORMATS[a.format])));
  const fiche = [FORMATS[a.format] || 'Image', a.largeur ? `${a.largeur} × ${a.hauteur}` : null, taille(p.fichier.size)].filter(Boolean).join(' · ');
  let lieu = null;
  if (a.position) {
    const { lat, lon } = a.position;
    const lien = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=16/${lat.toFixed(5)}/${lon.toFixed(5)}`;
    lieu = h('div', { class: 'lieu' }, 'Cette photo dit où elle a été prise :', h('b', null, coordonnees(lat, lon)),
      h('a', { href: lien, target: '_blank', rel: 'noopener noreferrer' }, 'Voir l’endroit sur une carte (en ligne)'));
  }
  else if (a.positionMasquee) {
    lieu = h('div', { class: 'lieu masque' }, h('b', null, 'Le lieu a été masqué par Android.'),
      'La photo de votre galerie contient toujours ses coordonnées, mais Android les efface avant de la confier à une appli web : elles ne peuvent pas être affichées ici. La copie faite ici n’en contient aucune.');
  }
  return h('article', { class: 'photo', 'data-id': p.id },
    h('div', { class: 'photo-tete' }, vignette, h('div', null, h('div', { class: 'nom' }, p.fichier.name), h('div', { class: 'fiche' }, fiche), pastilles(a))),
    lieu,
    detail(a),
    h('div', { class: 'zone-resultat' }, texteResultat(p)),
    h('div', { class: 'actions' },
      h('button', { class: 'bouton petit principal', onclick: () => partager([p]) }, 'Partager la copie'),
      h('button', { class: 'bouton petit', onclick: () => enregistrer([p]) }, 'Enregistrer'),
      h('button', { class: 'bouton petit retirer', 'aria-label': `Retirer ${p.fichier.name} de la liste`, onclick: () => retirer(p) }, 'Retirer')));
}

function retirer(p) {
  URL.revokeObjectURL(p.url);
  photos.splice(photos.indexOf(p), 1);
  for (const x of photos) x.resultat = null; // les rangs ont changé
  afficher();
}

function afficher() {
  const n = photos.length;
  $('accueil').hidden = n > 0;
  $('reglages').hidden = $('suite').hidden = n === 0;
  $('barre').hidden = n < 2;
  $('partager-tout').textContent = `Partager les ${n} photos sans traces`;
  $('liste').replaceChildren(...photos.map(carte));
}

function invalider() {
  for (const p of photos) { p.resultat = null; majResultat(p); }
}

/* ───────────── branchements ───────────── */

$('version').textContent = VERSION;
$('choix').addEventListener('change', (e) => { ajouter(e.target.files).then(() => { e.target.value = ''; }); });
$('vider').addEventListener('click', () => { for (const p of photos) URL.revokeObjectURL(p.url); photos.length = 0; afficher(); });
$('partager-tout').addEventListener('click', () => partager(photos));
$('enregistrer-tout').addEventListener('click', () => enregistrer(photos));
$('renommer').addEventListener('change', invalider);
for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', invalider);
$('pretes-fermer').addEventListener('click', () => $('pretes').close());
$('pretes-partager').addEventListener('click', async () => {
  $('pretes').close();
  try { await navigator.share({ files: pretes }); }
  catch (e) { if (e.name !== 'AbortError') dire('Le partage a échoué : utilisez « Enregistrer ».', 6000); }
});

// Glisser-déposer et coller (ordinateur)
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('survol'); });
addEventListener('dragleave', () => document.body.classList.remove('survol'));
addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('survol'); ajouter(e.dataTransfer.files); });
addEventListener('paste', (e) => { if (e.clipboardData?.files.length) ajouter(e.clipboardData.files); });

// Installation. Samsung Internet fabrique un paquet que Play Protect bloque : on renvoie vers Chrome.
let invite = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (/SamsungBrowser/i.test(navigator.userAgent)) return;
  invite = e;
  $('installer').hidden = false;
});
$('installer').addEventListener('click', async () => { $('installer').hidden = true; await invite?.prompt(); invite = null; });
addEventListener('appinstalled', () => { $('installer').hidden = true; });

// Photos reçues par le menu « Partager » du téléphone (appli installée).
async function recevoirPartage() {
  if (!new URLSearchParams(location.search).has('partage') || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('sans-trace-partage');
    const fichiers = [];
    for (const requete of await cache.keys()) {
      const reponse = await cache.match(requete);
      const nom = decodeURIComponent(reponse.headers.get('X-Nom') || 'photo');
      fichiers.push(new File([await reponse.blob()], nom, { type: reponse.headers.get('Content-Type') || '' }));
      await cache.delete(requete);
    }
    await ajouter(fichiers);
  } catch { dire('Les photos partagées n’ont pas pu être lues.'); }
}

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('sans-sw')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
recevoirPartage();
afficher();
