// Sans trace — moteur de lecture et de retrait des métadonnées.
// Fonctions pures sur des Uint8Array : aucune dépendance, aucun accès réseau.
// Le retrait est « sans perte » pour JPEG, PNG et WebP : les données de l'image
// sont recopiées telles quelles, seuls les blocs de métadonnées sont ôtés.

const MIMES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heif: 'image/heic', gif: 'image/gif' };
const EXTENSIONS = { jpeg: 'jpg', png: 'png', webp: 'webp' };

/* ───────────── utilitaires d'octets ───────────── */

function latin(o, a, b) {
  let s = '';
  for (let i = a; i < b; i++) s += String.fromCharCode(o[i]);
  return s;
}
function egal(o, pos, texte) {
  if (pos < 0 || pos + texte.length > o.length) return false;
  for (let i = 0; i < texte.length; i++) if (o[pos + i] !== texte.charCodeAt(i)) return false;
  return true;
}
function texte8(o, a, b) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(o.subarray(a, b)); }
  catch { return latin(o, a, b); }
}
function chercher(o, texte, depuis = 0, jusque = o.length) {
  const c0 = texte.charCodeAt(0);
  let p = depuis;
  while ((p = o.indexOf(c0, p)) !== -1 && p < jusque) {
    if (egal(o, p, texte)) return p;
    p++;
  }
  return -1;
}
const u32be = (o, p) => ((o[p] << 24) | (o[p + 1] << 16) | (o[p + 2] << 8) | o[p + 3]) >>> 0;
const u32le = (o, p) => ((o[p + 3] << 24) | (o[p + 2] << 16) | (o[p + 1] << 8) | o[p]) >>> 0;
function joindre(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const r = new Uint8Array(n);
  let q = 0;
  for (const p of parts) { r.set(p, q); q += p.length; }
  return r;
}
const octetsDe = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

let TABLE_CRC = null;
function crc32(o, a = 0, b = o.length, crc = 0xFFFFFFFF) {
  if (!TABLE_CRC) {
    TABLE_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABLE_CRC[n] = c >>> 0;
    }
  }
  for (let i = a; i < b; i++) crc = TABLE_CRC[(crc ^ o[i]) & 0xFF] ^ (crc >>> 8);
  return crc;
}

export function detecterFormat(o) {
  if (o.length < 12) return 'inconnu';
  if (o[0] === 0xFF && o[1] === 0xD8 && o[2] === 0xFF) return 'jpeg';
  if (egal(o, 0, '\x89PNG\r\n\x1a\n')) return 'png';
  if (egal(o, 0, 'RIFF') && egal(o, 8, 'WEBP')) return 'webp';
  if (egal(o, 4, 'ftyp')) return 'heif';
  if (egal(o, 0, 'GIF8')) return 'gif';
  return 'inconnu';
}

/* ───────────── TIFF / EXIF ───────────── */

const TAILLES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

function lireTiff(o, base, fin) {
  fin = Math.min(fin, o.length);
  if (fin - base < 8) return null;
  const v = new DataView(o.buffer, o.byteOffset + base, fin - base);
  const n = v.byteLength;
  const marque = v.getUint16(0);
  let le;
  if (marque === 0x4949) le = true; else if (marque === 0x4D4D) le = false; else return null;
  if (v.getUint16(2, le) !== 42) return null;

  function valeur(type, compte, p) {
    if (type === 2) {
      let b = p;
      const lim = p + compte;
      while (b < lim && v.getUint8(b) !== 0) b++;
      return texte8(o, base + p, base + b).trim();
    }
    if (type === 1 || type === 6 || type === 7) {
      if (compte === 1 && type !== 7) return v.getUint8(p);
      return o.subarray(base + p, base + p + compte);
    }
    const nb = Math.min(compte, 64);
    const l = [];
    for (let i = 0; i < nb; i++) {
      const q = p + i * TAILLES[type];
      if (type === 3) l.push(v.getUint16(q, le));
      else if (type === 4 || type === 13) l.push(v.getUint32(q, le));
      else if (type === 8) l.push(v.getInt16(q, le));
      else if (type === 9) l.push(v.getInt32(q, le));
      else if (type === 5) l.push({ n: v.getUint32(q, le), d: v.getUint32(q + 4, le) });
      else if (type === 10) l.push({ n: v.getInt32(q, le), d: v.getInt32(q + 4, le) });
      else if (type === 11) l.push(v.getFloat32(q, le));
      else if (type === 12) l.push(v.getFloat64(q, le));
    }
    return compte === 1 ? l[0] : l;
  }

  const vus = new Set();
  function lireIfd(pos) {
    if (typeof pos !== 'number' || pos < 8 || pos + 2 > n || vus.has(pos)) return null;
    vus.add(pos);
    const nb = v.getUint16(pos, le);
    if (nb > 2000 || pos + 2 + nb * 12 > n) return null;
    const entrees = new Map();
    let effaces = 0; // rubriques entièrement remises à zéro (masquage d'Android)
    for (let i = 0; i < nb; i++) {
      const e = pos + 2 + i * 12;
      const tag = v.getUint16(e, le);
      const type = v.getUint16(e + 2, le);
      const compte = v.getUint32(e + 4, le);
      if (!tag && !type && !compte) { effaces++; continue; }
      const t = (TAILLES[type] || 0) * compte;
      const pv = t > 4 ? v.getUint32(e + 8, le) : e + 8;
      if (!t || pv + t > n) { entrees.set(tag, { tag, type, compte, e, pv: -1, t: 0, valeur: null }); continue; }
      entrees.set(tag, { tag, type, compte, e, pv, t, valeur: valeur(type, compte, pv) });
    }
    const ps = pos + 2 + nb * 12;
    return { pos, nb, entrees, effaces, suivant: ps + 4 <= n ? v.getUint32(ps, le) : 0 };
  }

  const ifd0 = lireIfd(v.getUint32(4, le));
  if (!ifd0) return null;
  const exif = lireIfd(ifd0.entrees.get(0x8769)?.valeur);
  const gps = lireIfd(ifd0.entrees.get(0x8825)?.valeur);
  const ifd1 = lireIfd(ifd0.suivant);
  let miniature = 0;
  if (ifd1) {
    const t = ifd1.entrees.get(0x0202)?.valeur;
    if (typeof t === 'number' && ifd1.entrees.has(0x0201)) miniature = t;
  }
  return { le, ifd0, exif, gps, ifd1, miniature };
}

function orientationTiff(o, base, fin) {
  const t = lireTiff(o, base, fin);
  const x = t?.ifd0.entrees.get(0x0112)?.valeur;
  return typeof x === 'number' && x >= 1 && x <= 8 ? x : 1;
}

// TIFF minimal ne portant que l'orientation : sans elle, une photo prise
// téléphone tourné s'afficherait couchée une fois l'EXIF retiré.
function tiffOrientation(x) {
  return Uint8Array.from([0x49, 0x49, 0x2A, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, x, 0, 0, 0, 0, 0, 0, 0]);
}

// Efface le répertoire GPS d'un bloc TIFF, sur place (la taille ne change pas).
function retirerGpsTiff(o, base, fin) {
  fin = Math.min(fin, o.length);
  const t = lireTiff(o, base, fin);
  const e = t?.ifd0.entrees.get(0x8825);
  if (!e) return false;
  if (t.gps) {
    for (const x of t.gps.entrees.values()) if (x.t > 4 && x.pv >= 0) o.fill(0, base + x.pv, base + x.pv + x.t);
    o.fill(0, base + t.gps.pos, Math.min(fin, base + t.gps.pos + 2 + t.gps.nb * 12 + 4));
  }
  const debut = base + e.e;
  const finIfd = Math.min(fin, base + t.ifd0.pos + 2 + t.ifd0.nb * 12 + 4);
  o.copyWithin(debut, debut + 12, finIfd);
  o.fill(0, finIfd - 12, finIfd);
  const nb = t.ifd0.nb - 1;
  const p = base + t.ifd0.pos;
  if (t.le) { o[p] = nb & 255; o[p + 1] = nb >> 8; } else { o[p] = nb >> 8; o[p + 1] = nb & 255; }
  return true;
}

/* ───────────── mise en forme des valeurs ───────────── */

const fr = (x, d = 1) => String(+x.toFixed(d)).replace('.', ',');
const ratio = (r) => (Array.isArray(r) ? ratio(r[0]) : r && typeof r === 'object' && 'n' in r ? (r.d ? r.n / r.d : 0) : +r || 0);

function dateFr(s) {
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s));
  if (!m) return String(s);
  return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` à ${m[4]}:${m[5]}${m[6] ? ':' + m[6] : ''}` : '');
}
const ORIENTATIONS = ['', 'Normale', 'Miroir horizontal', 'Tournée de 180°', 'Miroir vertical', 'Miroir + quart de tour', 'Quart de tour à droite', 'Miroir + quart de tour', 'Quart de tour à gauche'];

const FORMES = {
  date: dateFr,
  orient: (x) => ORIENTATIONS[x] || String(x),
  pose: (x) => { const r = ratio(x); if (!r) return ''; return r < 1 ? `1/${Math.round(1 / r)} s` : `${fr(r)} s`; },
  ouv: (x) => `f/${fr(ratio(x))}`,
  mm: (x) => `${fr(ratio(x))} mm`,
  ev: (x) => { const r = ratio(x); return `${r > 0 ? '+' : ''}${fr(r, 2)} IL`; },
  flash: (x) => (x & 1 ? 'Déclenché' : 'Non déclenché'),
  octets: (x) => `${x?.length ?? 0} octets de données propriétaires`,
  ucs2: (x) => (x instanceof Uint8Array ? new TextDecoder('utf-16le').decode(x).replace(/\0+$/, '') : String(x)),
  comment: (x) => {
    if (!(x instanceof Uint8Array) || x.length <= 8) return '';
    const code = latin(x, 0, 8);
    const corps = x.subarray(8);
    const t = code.startsWith('UNICODE') ? new TextDecoder('utf-16le').decode(corps) : texte8(corps, 0, corps.length);
    return t.replace(/\0/g, '').trim();
  },
};

// tag → [groupe, libellé, sensibilité 0-2, forme]
const BALISES = {
  0x010E: ['auteur', 'Description', 2],
  0x010F: ['appareil', 'Marque', 1],
  0x0110: ['appareil', 'Modèle', 1],
  0x0112: ['prise', 'Orientation', 0, 'orient'],
  0x0131: ['logiciel', 'Logiciel', 1],
  0x0132: ['date', 'Date de modification', 1, 'date'],
  0x013B: ['auteur', 'Auteur', 2],
  0x013C: ['appareil', 'Ordinateur', 2],
  0x8298: ['auteur', 'Copyright', 2],
  0x9C9B: ['auteur', 'Titre', 2, 'ucs2'],
  0x9C9C: ['auteur', 'Commentaire', 2, 'ucs2'],
  0x9C9D: ['auteur', 'Auteur', 2, 'ucs2'],
  0x9C9E: ['auteur', 'Mots-clés', 2, 'ucs2'],
  0x9C9F: ['auteur', 'Sujet', 2, 'ucs2'],
  0x829A: ['prise', 'Temps de pose', 0, 'pose'],
  0x829D: ['prise', 'Ouverture', 0, 'ouv'],
  0x8827: ['prise', 'Sensibilité ISO', 0],
  0x9003: ['date', 'Date de prise de vue', 1, 'date'],
  0x9004: ['date', 'Date de numérisation', 1, 'date'],
  0x9010: ['date', 'Fuseau horaire', 1],
  0x9011: ['date', 'Fuseau horaire (prise de vue)', 1],
  0x9012: ['date', 'Fuseau horaire (numérisation)', 1],
  0x9204: ['prise', 'Correction d’exposition', 0, 'ev'],
  0x9209: ['prise', 'Flash', 0, 'flash'],
  0x920A: ['prise', 'Focale', 0, 'mm'],
  0x927C: ['appareil', 'Notes du fabricant', 1, 'octets'],
  0x9286: ['auteur', 'Commentaire', 2, 'comment'],
  0xA405: ['prise', 'Focale équivalente 24×36', 0, 'mm'],
  0xA420: ['auteur', 'Identifiant unique de l’image', 2],
  0xA430: ['auteur', 'Propriétaire de l’appareil', 2],
  0xA431: ['appareil', 'Numéro de série de l’appareil', 2],
  0xA433: ['appareil', 'Marque de l’objectif', 1],
  0xA434: ['appareil', 'Objectif', 1],
  0xA435: ['appareil', 'Numéro de série de l’objectif', 2],
};
const NOMS = {
  0x0100: 'Largeur', 0x0101: 'Hauteur', 0x011A: 'Résolution horizontale', 0x011B: 'Résolution verticale',
  0x0128: 'Unité de résolution', 0x0213: 'Position YCbCr', 0x8822: 'Programme d’exposition', 0x9000: 'Version EXIF',
  0x9101: 'Composantes', 0x9201: 'Vitesse (APEX)', 0x9202: 'Ouverture (APEX)', 0x9203: 'Luminosité',
  0x9205: 'Ouverture maximale', 0x9207: 'Mode de mesure', 0x9208: 'Source de lumière', 0x9290: 'Fractions de seconde',
  0x9291: 'Fractions de seconde (prise de vue)', 0x9292: 'Fractions de seconde (numérisation)', 0xA000: 'Version FlashPix',
  0xA001: 'Espace de couleur', 0xA002: 'Largeur en pixels', 0xA003: 'Hauteur en pixels', 0xA217: 'Type de capteur',
  0xA301: 'Type de scène', 0xA402: 'Mode d’exposition', 0xA403: 'Balance des blancs', 0xA404: 'Zoom numérique',
  0xA406: 'Type de prise de vue', 0xA408: 'Contraste', 0xA409: 'Saturation', 0xA40A: 'Netteté', 0xA432: 'Caractéristiques de l’objectif',
};
const STRUCTURE = new Set([0x8769, 0x8825, 0xA005, 0x0201, 0x0202, 0x0111, 0x0117, 0x0103, 0xEA1C, 0xC4A5]);

function brut(x) {
  if (x == null) return '';
  if (x instanceof Uint8Array) return x.length <= 8 ? Array.from(x).join(' ') : `${x.length} octets`;
  if (Array.isArray(x)) return x.slice(0, 8).map(brut).join(' ; ') + (x.length > 8 ? ' …' : '');
  if (typeof x === 'object') return fr(ratio(x), 4);
  return String(x).slice(0, 300);
}

function champsIfd(ifd, r) {
  if (!ifd) return;
  for (const e of ifd.entrees.values()) {
    if (STRUCTURE.has(e.tag) || e.valeur == null) continue;
    const b = BALISES[e.tag];
    let v;
    try { v = b?.[3] ? FORMES[b[3]](e.valeur) : brut(e.valeur); } catch { v = brut(e.valeur); }
    if (v === '' || v == null) continue;
    if (b) r.champs.push({ g: b[0], l: b[1], v: String(v).slice(0, 400), s: b[2], neutre: e.tag === 0x0112 });
    else r.champs.push({ g: 'autres', l: NOMS[e.tag] || `Balise 0x${e.tag.toString(16).toUpperCase().padStart(4, '0')}`, v, s: 0 });
  }
}

function dms(v, ref, negatif) {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = ratio(v[0]) + ratio(v[1]) / 60 + ratio(v[2] ?? 0) / 3600;
  if (!isFinite(x)) return null;
  return String(ref).toUpperCase().startsWith(negatif) ? -x : x;
}
export function coordonnees(lat, lon) {
  const f = (x) => Math.abs(x).toFixed(5).replace('.', ',');
  return `${f(lat)}° ${lat < 0 ? 'S' : 'N'}, ${f(lon)}° ${lon < 0 ? 'O' : 'E'}`;
}

function champsGps(gps, r) {
  if (!gps) return;
  const g = (t) => gps.entrees.get(t)?.valeur;
  const p = (l, v) => { if (v !== '' && v != null) r.champs.push({ g: 'position', l, v: String(v), s: 2 }); };
  const lat = dms(g(2), g(1) ?? 'N', 'S');
  const lon = dms(g(4), g(3) ?? 'E', 'W');
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
    r.position = { lat, lon };
    p('Coordonnées GPS', coordonnees(lat, lon));
  } else if (gps.entrees.has(2) || gps.entrees.has(4) || gps.effaces) {
    // Rubriques aux valeurs à zéro, ou rubriques entièrement effacées : c'est la
    // marque d'Android, qui masque la position avant de confier une photo à une appli.
    r.positionMasquee = true;
    r.champs.push({ g: 'position', l: 'Coordonnées GPS', v: 'effacées avant d’arriver ici', s: 1 });
  }
  if (g(6) != null) {
    const alt = ratio(g(6)) * (g(5) === 1 ? -1 : 1);
    if (r.position) r.position.alt = alt;
    p('Altitude', `${fr(alt)} m`);
  }
  if (g(0x1D)) p('Date du relevé GPS', dateFr(g(0x1D)));
  if (Array.isArray(g(7))) p('Heure du relevé GPS (UTC)', g(7).map((x) => String(Math.floor(ratio(x))).padStart(2, '0')).join(':'));
  if (g(0x11) != null) p('Direction de visée', `${fr(ratio(g(0x11)))}°`);
  if (g(0x0D) != null) p('Vitesse', `${fr(ratio(g(0x0D)))} ${{ K: 'km/h', M: 'mi/h', N: 'nœuds' }[g(0x0C)] || ''}`);
  if (g(0x1F) != null) p('Précision estimée', `${fr(ratio(g(0x1F)))} m`);
  if (g(0x1B) instanceof Uint8Array) p('Méthode de localisation', latin(g(0x1B), 0, g(0x1B).length).replace(/^[A-Z]+\0+/, '').replace(/\0/g, '').trim());
  if (!r.champs.some((c) => c.g === 'position')) p('Bloc GPS', `${gps.nb} information(s)`);
}

function ajouterExif(o, base, fin, r, taille) {
  const t = lireTiff(o, base, fin);
  if (!t) { r.blocs.push({ nom: 'EXIF (illisible)', taille }); return; }
  const avant = r.champs.length;
  champsIfd(t.ifd0, r);
  champsIfd(t.exif, r);
  champsGps(t.gps, r);
  const x = t.ifd0.entrees.get(0x0112)?.valeur;
  if (typeof x === 'number' && x >= 1 && x <= 8) r.orientation = x;
  const neufs = r.champs.slice(avant);
  r.blocs.push({ nom: 'EXIF', taille, garde: !t.miniature && neufs.every((c) => c.neutre) });
  if (t.miniature) r.blocs.push({ nom: 'Miniature embarquée', taille: t.miniature, miniature: true });
}

/* ───────────── XMP ───────────── */

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const sansEntites = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) =>
  c[0] === '#' ? String.fromCodePoint(c[1].toLowerCase() === 'x' ? parseInt(c.slice(2), 16) : +c.slice(1)) : ENTITES[c] ?? m);

const XMP_NOMS = {
  'xmp:CreatorTool': 'Logiciel', 'xmp:CreateDate': 'Date de création', 'xmp:ModifyDate': 'Date de modification',
  'xmp:MetadataDate': 'Date des métadonnées', 'dc:creator': 'Auteur', 'dc:title': 'Titre', 'dc:description': 'Description',
  'dc:subject': 'Mots-clés', 'dc:rights': 'Droits', 'photoshop:City': 'Ville', 'photoshop:State': 'Région',
  'photoshop:Country': 'Pays', 'photoshop:DateCreated': 'Date de création', 'Iptc4xmpCore:Location': 'Lieu',
  'tiff:Make': 'Marque', 'tiff:Model': 'Modèle', 'aux:SerialNumber': 'Numéro de série', 'aux:Lens': 'Objectif',
  'xmpMM:DocumentID': 'Identifiant du document', 'xmpMM:InstanceID': 'Identifiant de la version',
  'xmpMM:OriginalDocumentID': 'Identifiant du document d’origine', 'x:xmptk': 'Bibliothèque XMP',
  'exif:GPSLatitude': 'Latitude', 'exif:GPSLongitude': 'Longitude', 'exif:GPSAltitude': 'Altitude',
  'exif:GPSTimeStamp': 'Heure du relevé GPS', 'exif:DateTimeOriginal': 'Date de prise de vue',
};
function classerXmp(cle) {
  if (/GPS|City|Country|State|Location|Sublocation/i.test(cle)) return ['position', 2];
  if (/creator$|Owner|Artist|rights|Serial|Credit|Author|DocumentID|InstanceID|title|description|subject|Caption|Person/i.test(cle)) return ['auteur', 2];
  if (/Date|Time/i.test(cle)) return ['date', 1];
  if (/Make|Model|Lens/i.test(cle)) return ['appareil', 1];
  if (/CreatorTool|Software|xmptk/i.test(cle)) return ['logiciel', 1];
  return ['autres', 0];
}
function ajouterXmp(t, r, taille, nom = 'XMP') {
  r.blocs.push({ nom, taille });
  const vus = new Set();
  let n = 0;
  const pousser = (cle, v) => {
    v = sansEntites(v).replace(/\s+/g, ' ').trim();
    if (!v || vus.has(cle) || n >= 80) return;
    vus.add(cle); n++;
    const [g, s] = classerXmp(cle);
    const l = XMP_NOMS[cle] || cle;
    r.champs.push({ g, l: /date/i.test(l) && g === 'date' ? l : l, v: (g === 'date' ? dateFr(v) : v).slice(0, 400), s, xmp: true });
  };
  for (const m of t.matchAll(/<([\w-]+):([\w-]+)[^>]*>\s*<rdf:(Seq|Bag|Alt)[^>]*>([\s\S]*?)<\/rdf:\3>/g)) {
    const items = [...m[4].matchAll(/<rdf:li[^>]*>([^<]*)<\/rdf:li>/g)].map((x) => x[1].trim()).filter(Boolean);
    if (items.length) pousser(`${m[1]}:${m[2]}`, items.join(', '));
  }
  for (const m of t.matchAll(/\s([\w-]+):([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (m[1] === 'xmlns' || m[1] === 'rdf' || m[1] === 'xml') continue;
    pousser(`${m[1]}:${m[2]}`, m[3] ?? m[4]);
  }
  for (const m of t.matchAll(/<([\w-]+):([\w-]+)(?:\s[^>]*)?>([^<]+)<\/\1:\2>/g)) {
    if (m[1] === 'rdf') continue;
    pousser(`${m[1]}:${m[2]}`, m[3]);
  }
  if (!r.position) {
    const c = (cle, neg) => {
      const m = new RegExp(`${cle}\\s*(?:=\\s*["']|>)\\s*(\\d+)[,;\\s]+(\\d+(?:\\.\\d+)?)(?:[,;\\s]+(\\d+(?:\\.\\d+)?))?\\s*([NSEW])`, 'i').exec(t);
      if (!m) return null;
      const x = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
      return m[4].toUpperCase() === neg ? -x : x;
    };
    const lat = c('GPSLatitude', 'S'), lon = c('GPSLongitude', 'W');
    if (lat != null && lon != null) r.position = { lat, lon };
  }
}
// Coordonnées et noms de lieux, en attribut ou en élément.
const XMP_LIEUX = [
  /\s+[\w-]+:(?:GPS\w*|City|State|ProvinceState|Country\w*|Location\w*|Sublocation)\s*=\s*("[^"]*"|'[^']*')/g,
  /<([\w-]+:(?:GPS\w*|City|State|ProvinceState|Country\w*|Location\w*|Sublocation))(\s[^>]*)?>[\s\S]*?<\/\1>/g,
  /<[\w-]+:(?:GPS\w*|City|State|ProvinceState|Country\w*|Location\w*|Sublocation)(\s[^>]*)?\/>/g,
];
function xmpSansGps(t) {
  for (const e of XMP_LIEUX) t = t.replace(e, '');
  return t;
}
function octetsXmpSansGps(o, a, b) {
  const t = new TextDecoder('utf-8').decode(o.subarray(a, b));
  const u = xmpSansGps(t);
  return u === t ? null : new TextEncoder().encode(u);
}

/* ───────────── IPTC (bloc Photoshop) ───────────── */

const IPTC = {
  5: ['auteur', 'Titre'], 25: ['auteur', 'Mots-clés'], 55: ['date', 'Date de création'], 60: ['date', 'Heure de création'],
  80: ['auteur', 'Auteur'], 85: ['auteur', 'Fonction de l’auteur'], 90: ['position', 'Ville'], 92: ['position', 'Lieu'],
  95: ['position', 'Région'], 101: ['position', 'Pays'], 105: ['auteur', 'Titre'], 110: ['auteur', 'Crédit'],
  115: ['auteur', 'Source'], 116: ['auteur', 'Copyright'], 120: ['auteur', 'Légende'], 122: ['auteur', 'Rédacteur'],
};
const IPTC_LIEUX = new Set([26, 27, 90, 92, 95, 100, 101]);
// effacerLieux : recouvre d'espaces, sur place, les rubriques de lieu.
function ajouterIptc(o, a, b, r, effacerLieux = false) {
  let p = a;
  while (p + 12 <= b && egal(o, p, '8BIM')) {
    const id = (o[p + 4] << 8) | o[p + 5];
    let q = p + 6;
    const ln = o[q];
    q += 1 + ln + ((ln + 1) & 1);
    const t = u32be(o, q);
    q += 4;
    if (q + t > b) break;
    if (id === 0x0404) {
      let k = q;
      const cumul = new Map();
      while (k + 5 <= q + t && o[k] === 0x1C) {
        const rec = o[k + 1], ds = o[k + 2], len = (o[k + 3] << 8) | o[k + 4];
        if (len & 0x8000 || k + 5 + len > q + t) break;
        if (effacerLieux) { if (rec === 2 && IPTC_LIEUX.has(ds)) o.fill(0x20, k + 5, k + 5 + len); }
        else if (rec === 2 && IPTC[ds] && len) {
          const v = texte8(o, k + 5, k + 5 + len).trim();
          if (v) cumul.set(ds, cumul.has(ds) ? `${cumul.get(ds)}, ${v}` : v);
        }
        k += 5 + len;
      }
      for (const [ds, v] of cumul) {
        const [g, l] = IPTC[ds];
        r.champs.push({ g, l, v: (ds === 55 ? dateFr(v.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')) : v).slice(0, 400), s: g === 'date' ? 1 : 2 });
      }
    }
    p = q + t + (t & 1);
  }
}

/* ───────────── JPEG ───────────── */

function segmentsJpeg(o) {
  const segs = [];
  const n = o.length;
  let p = 2;
  let finImage = n;
  while (p + 1 < n) {
    if (o[p] !== 0xFF) { p++; continue; }
    const m = o[p + 1];
    if (m === 0xFF) { p++; continue; }
    if (m === 0xD9) { segs.push({ m, a: p, b: p + 2 }); finImage = p + 2; break; }
    if (m === 0x01 || m === 0x00 || (m >= 0xD0 && m <= 0xD8)) { segs.push({ m, a: p, b: p + 2 }); p += 2; continue; }
    if (p + 4 > n) break;
    const L = (o[p + 2] << 8) | o[p + 3];
    let b = p + 2 + L;
    if (L < 2 || b > n) { segs.push({ m, a: p, b: n, d: p + 4, de: n }); break; }
    const de = b;
    if (m === 0xDA) {
      let q = b;
      for (;;) {
        q = o.indexOf(0xFF, q);
        if (q === -1 || q + 1 >= n) { q = n; break; }
        const x = o[q + 1];
        if (x === 0 || (x >= 0xD0 && x <= 0xD7)) { q += 2; continue; }
        if (x === 0xFF) { q++; continue; }
        break;
      }
      b = q;
    }
    segs.push({ m, a: p, b, d: p + 4, de });
    p = b;
  }
  return { segs, finImage };
}

const estExif = (o, s) => s.m === 0xE1 && egal(o, s.d, 'Exif\0\0');
const XMP_ENTETE = 'http://ns.adobe.com/xap/1.0/\0';
const estXmp = (o, s) => s.m === 0xE1 && egal(o, s.d, XMP_ENTETE);
const estIcc = (o, s) => s.m === 0xE2 && egal(o, s.d, 'ICC_PROFILE\0');

function decrireQueue(o, a) {
  const t = o.length - a;
  const video = chercher(o, 'ftyp', a, Math.min(o.length, a + 4096)) !== -1;
  return { nom: video ? 'Vidéo cachée après l’image (photo animée)' : 'Données ajoutées après l’image', taille: t, queue: true, video };
}

function analyserJpeg(o, r) {
  const { segs, finImage } = segmentsJpeg(o);
  for (const s of segs) {
    const t = s.b - s.a;
    if (s.m >= 0xC0 && s.m <= 0xCF && s.m !== 0xC4 && s.m !== 0xC8 && s.m !== 0xCC && !r.largeur && s.de - s.d >= 5) {
      r.hauteur = (o[s.d + 1] << 8) | o[s.d + 2];
      r.largeur = (o[s.d + 3] << 8) | o[s.d + 4];
    } else if (estExif(o, s)) ajouterExif(o, s.d + 6, s.de, r, t);
    else if (estXmp(o, s)) ajouterXmp(texte8(o, s.d + XMP_ENTETE.length, s.de), r, t);
    else if (s.m === 0xE1 && egal(o, s.d, 'http://ns.adobe.com/xmp/extension/')) r.blocs.push({ nom: 'XMP étendu', taille: t });
    else if (estIcc(o, s)) r.blocs.push({ nom: 'Profil de couleur', taille: t, garde: true });
    else if (s.m === 0xE2 && egal(o, s.d, 'MPF\0')) r.blocs.push({ nom: 'Index d’images multiples (MPF)', taille: t });
    else if (s.m === 0xED) { r.blocs.push({ nom: 'IPTC / Photoshop', taille: t }); const p = chercher(o, '8BIM', s.d, s.de); if (p !== -1) ajouterIptc(o, p, s.de, r); }
    else if (s.m === 0xEB && chercher(o, 'c2pa', s.d, Math.min(s.de, s.d + 64)) !== -1) r.blocs.push({ nom: 'Certificat de provenance (C2PA)', taille: t });
    else if (s.m === 0xE0 && egal(o, s.d, 'JFXX')) r.blocs.push({ nom: 'Miniature JFIF', taille: t, miniature: true });
    else if (s.m === 0xFE) {
      r.blocs.push({ nom: 'Commentaire', taille: t });
      const v = texte8(o, s.d, s.de).replace(/\0/g, '').trim();
      if (v) r.champs.push({ g: 'auteur', l: 'Commentaire du fichier', v: v.slice(0, 400), s: 1 });
    } else if (s.m >= 0xE1 && s.m <= 0xEF && s.m !== 0xEE) r.blocs.push({ nom: `Bloc d’application APP${s.m - 0xE0}`, taille: t });
  }
  if (finImage < o.length) r.blocs.push(decrireQueue(o, finImage));
}

function segmentExif(tiff) {
  const L = 2 + 6 + tiff.length;
  return joindre([Uint8Array.from([0xFF, 0xE1, L >> 8, L & 255]), octetsDe('Exif\0\0'), tiff]);
}

function nettoyerJpeg(o, mode) {
  const { segs, finImage } = segmentsJpeg(o);
  const parts = [o.subarray(0, 2)];
  if (mode === 'position') {
    for (const s of segs) {
      if (estExif(o, s)) {
        const c = o.slice(s.a, s.b);
        retirerGpsTiff(c, 10, c.length);
        parts.push(c);
      } else if (estXmp(o, s)) {
        const debut = s.d + XMP_ENTETE.length;
        const x = octetsXmpSansGps(o, debut, s.de);
        if (!x) { parts.push(o.subarray(s.a, s.b)); continue; }
        const L = 2 + XMP_ENTETE.length + x.length;
        parts.push(Uint8Array.from([0xFF, 0xE1, L >> 8, L & 255]), octetsDe(XMP_ENTETE), x);
      } else if (s.m === 0xED) {
        const c = o.slice(s.a, s.b);
        const p = chercher(c, '8BIM', 4);
        if (p !== -1) ajouterIptc(c, p, c.length, null, true);
        parts.push(c);
      } else parts.push(o.subarray(s.a, s.b));
    }
    // Une vidéo de photo animée peut porter sa propre position : on la retire.
    if (finImage < o.length && !decrireQueue(o, finImage).video) parts.push(o.subarray(finImage));
    return joindre(parts);
  }
  let orientation = 1;
  for (const s of segs) if (estExif(o, s)) { orientation = orientationTiff(o, s.d + 6, s.de); break; }
  const garder = (s) => {
    if (s.m === 0xE0) return egal(o, s.d, 'JFIF\0');
    if (s.m === 0xE2) return estIcc(o, s);
    if (s.m === 0xEE) return true;
    if ((s.m >= 0xE1 && s.m <= 0xEF) || s.m === 0xFE) return false;
    return true;
  };
  let pose = orientation === 1;
  segs.forEach((s, i) => {
    const jfifEnTete = i === 0 && s.m === 0xE0 && garder(s);
    if (!pose && !jfifEnTete) { parts.push(segmentExif(tiffOrientation(orientation))); pose = true; }
    if (garder(s)) parts.push(o.subarray(s.a, s.b));
  });
  return joindre(parts);
}

/* ───────────── PNG ───────────── */

function morceauxPng(o) {
  const l = [];
  let p = 8;
  while (p + 12 <= o.length) {
    const len = u32be(o, p);
    const b = p + 12 + len;
    if (b > o.length) break;
    const type = latin(o, p + 4, p + 8);
    l.push({ type, a: p, d: p + 8, de: p + 8 + len, b });
    p = b;
    if (type === 'IEND') break;
  }
  return { l, fin: p };
}
function morceauPng(type, data) {
  const r = new Uint8Array(12 + data.length);
  const n = data.length;
  r.set([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255], 0);
  r.set(octetsDe(type), 4);
  r.set(data, 8);
  const c = (crc32(r, 4, 8 + n) ^ 0xFFFFFFFF) >>> 0;
  r.set([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255], 8 + n);
  return r;
}
function lireItxt(o, m) {
  let p = o.indexOf(0, m.d);
  if (p === -1 || p >= m.de) return null;
  const cle = latin(o, m.d, p);
  const compresse = o[p + 1] === 1;
  p += 3;
  for (let i = 0; i < 2; i++) { p = o.indexOf(0, p); if (p === -1 || p >= m.de) return null; p++; }
  return { cle, compresse, debut: p };
}
const PNG_A_RETIRER = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'caBX', 'dSIG', 'zxIf']);
const PNG_CLES = { Software: ['logiciel', 'Logiciel', 1], Author: ['auteur', 'Auteur', 2], Copyright: ['auteur', 'Copyright', 2], 'Creation Time': ['date', 'Date de création', 1], Title: ['auteur', 'Titre', 2], Description: ['auteur', 'Description', 2], Comment: ['auteur', 'Commentaire', 2], Source: ['appareil', 'Source', 1] };

function analyserPng(o, r) {
  const { l, fin } = morceauxPng(o);
  const texte = (cle, v) => {
    const k = PNG_CLES[cle] || ['auteur', cle, 1];
    v = v.replace(/\0/g, '').trim();
    if (v) r.champs.push({ g: k[0], l: k[1], v: (k[0] === 'date' ? dateFr(v) : v).slice(0, 400), s: k[2] });
  };
  for (const m of l) {
    const t = m.b - m.a;
    if (m.type === 'IHDR') { r.largeur = u32be(o, m.d); r.hauteur = u32be(o, m.d + 4); }
    else if (m.type === 'eXIf') ajouterExif(o, m.d, m.de, r, t);
    else if (m.type === 'iCCP') r.blocs.push({ nom: 'Profil de couleur', taille: t, garde: true });
    else if (m.type === 'tEXt') {
      const p = o.indexOf(0, m.d);
      r.blocs.push({ nom: 'Texte', taille: t });
      if (p !== -1 && p < m.de) texte(latin(o, m.d, p), latin(o, p + 1, m.de));
    } else if (m.type === 'zTXt') {
      const p = o.indexOf(0, m.d);
      r.blocs.push({ nom: 'Texte compressé', taille: t });
      r.champs.push({ g: 'auteur', l: p !== -1 && p < m.de ? latin(o, m.d, p) : 'Texte', v: 'texte compressé', s: 1 });
    } else if (m.type === 'iTXt') {
      const x = lireItxt(o, m);
      if (x && !x.compresse && x.cle === 'XML:com.adobe.xmp') ajouterXmp(texte8(o, x.debut, m.de), r, t);
      else {
        r.blocs.push({ nom: 'Texte', taille: t });
        if (x) x.compresse ? r.champs.push({ g: 'auteur', l: x.cle, v: 'texte compressé', s: 1 }) : texte(x.cle, texte8(o, x.debut, m.de));
      }
    } else if (m.type === 'tIME' && m.de - m.d >= 7) {
      const z = (i) => String(o[m.d + i]).padStart(2, '0');
      r.blocs.push({ nom: 'Date', taille: t });
      r.champs.push({ g: 'date', l: 'Date de modification', v: `${z(3)}/${z(2)}/${(o[m.d] << 8) | o[m.d + 1]} à ${z(4)}:${z(5)}:${z(6)}`, s: 1 });
    } else if (m.type === 'caBX') r.blocs.push({ nom: 'Certificat de provenance (C2PA)', taille: t });
  }
  if (fin < o.length) r.blocs.push(decrireQueue(o, fin));
}

function nettoyerPng(o, mode) {
  const { l, fin } = morceauxPng(o);
  const parts = [o.subarray(0, 8)];
  if (mode === 'position') {
    for (const m of l) {
      if (m.type === 'eXIf') {
        const c = o.slice(m.d, m.de);
        retirerGpsTiff(c, 0, c.length);
        parts.push(morceauPng('eXIf', c));
      } else if (m.type === 'iTXt') {
        const x = lireItxt(o, m);
        const u = x && !x.compresse && x.cle === 'XML:com.adobe.xmp' ? octetsXmpSansGps(o, x.debut, m.de) : null;
        parts.push(u ? morceauPng('iTXt', joindre([o.subarray(m.d, x.debut), u])) : o.subarray(m.a, m.b));
      } else parts.push(o.subarray(m.a, m.b));
    }
    if (fin < o.length) parts.push(o.subarray(fin));
    return joindre(parts);
  }
  let orientation = 1;
  for (const m of l) if (m.type === 'eXIf') orientation = orientationTiff(o, m.d, m.de);
  let pose = orientation === 1;
  for (const m of l) {
    if (PNG_A_RETIRER.has(m.type)) continue;
    if (!pose && m.type === 'IDAT') { parts.push(morceauPng('eXIf', tiffOrientation(orientation))); pose = true; }
    parts.push(o.subarray(m.a, m.b));
  }
  return joindre(parts);
}

/* ───────────── WebP ───────────── */

function morceauxWebp(o) {
  const l = [];
  const fin = Math.min(o.length, 8 + u32le(o, 4));
  let p = 12;
  while (p + 8 <= fin) {
    const t = u32le(o, p + 4);
    const de = p + 8 + t;
    if (de > o.length) break;
    l.push({ id: latin(o, p, p + 4), a: p, d: p + 8, de, b: Math.min(de + (t & 1), o.length) });
    p = de + (t & 1);
  }
  return { l, fin: Math.min(p, o.length) };
}
function morceauWebp(id, data) {
  const n = data.length;
  const r = new Uint8Array(8 + n + (n & 1));
  r.set(octetsDe(id), 0);
  r.set([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24], 4);
  r.set(data, 8);
  return r;
}
function fichierWebp(parts) {
  const corps = joindre(parts);
  const n = corps.length + 4;
  return joindre([octetsDe('RIFF'), Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]), octetsDe('WEBP'), corps]);
}
const baseExifWebp = (o, m) => (egal(o, m.d, 'Exif\0\0') ? m.d + 6 : m.d);

function analyserWebp(o, r) {
  const { l, fin } = morceauxWebp(o);
  for (const m of l) {
    const t = m.b - m.a;
    if (m.id === 'VP8X') { r.largeur = 1 + (o[m.d + 4] | (o[m.d + 5] << 8) | (o[m.d + 6] << 16)); r.hauteur = 1 + (o[m.d + 7] | (o[m.d + 8] << 8) | (o[m.d + 9] << 16)); }
    else if (m.id === 'VP8 ' && !r.largeur) { r.largeur = (o[m.d + 6] | (o[m.d + 7] << 8)) & 0x3FFF; r.hauteur = (o[m.d + 8] | (o[m.d + 9] << 8)) & 0x3FFF; }
    else if (m.id === 'VP8L' && !r.largeur) { const b = u32le(o, m.d + 1); r.largeur = 1 + (b & 0x3FFF); r.hauteur = 1 + ((b >>> 14) & 0x3FFF); }
    else if (m.id === 'EXIF') ajouterExif(o, baseExifWebp(o, m), m.de, r, t);
    else if (m.id === 'XMP ') ajouterXmp(texte8(o, m.d, m.de), r, t);
    else if (m.id === 'ICCP') r.blocs.push({ nom: 'Profil de couleur', taille: t, garde: true });
  }
  if (fin < o.length) r.blocs.push(decrireQueue(o, fin));
}

const WEBP_IMAGE = new Set(['VP8X', 'ICCP', 'ANIM', 'ANMF', 'ALPH', 'VP8 ', 'VP8L']);
function nettoyerWebp(o, mode) {
  const { l } = morceauxWebp(o);
  const parts = [];
  if (mode === 'position') {
    for (const m of l) {
      if (m.id === 'EXIF') {
        const c = o.slice(m.d, m.de);
        retirerGpsTiff(c, baseExifWebp(o, m) - m.d, c.length);
        parts.push(morceauWebp('EXIF', c));
      } else if (m.id === 'XMP ') {
        const u = octetsXmpSansGps(o, m.d, m.de);
        parts.push(u ? morceauWebp('XMP ', u) : o.subarray(m.a, m.b));
      } else parts.push(o.subarray(m.a, m.b));
    }
    return fichierWebp(parts);
  }
  let orientation = 1;
  for (const m of l) if (m.id === 'EXIF') orientation = orientationTiff(o, baseExifWebp(o, m), m.de);
  for (const m of l) {
    if (!WEBP_IMAGE.has(m.id)) continue;
    if (m.id === 'VP8X') {
      const c = o.slice(m.a, m.b);
      c[8] &= ~0x0C; // drapeaux EXIF et XMP
      if (orientation !== 1) c[8] |= 0x08;
      parts.push(c);
    } else parts.push(o.subarray(m.a, m.b));
  }
  if (orientation !== 1) parts.push(morceauWebp('EXIF', tiffOrientation(orientation)));
  return fichierWebp(parts);
}

/* ───────────── HEIC / AVIF et GIF (lecture seule) ───────────── */

function analyserHeif(o, r) {
  const marque = latin(o, 8, 12);
  r.mime = /avi[fs]/.test(marque) ? 'image/avif' : 'image/heic';
  let p = 0;
  while ((p = chercher(o, 'ispe', p)) !== -1) {
    const L = u32be(o, p + 8), H = u32be(o, p + 12);
    if (L * H > r.largeur * r.hauteur && L < 65536 && H < 65536) { r.largeur = L; r.hauteur = H; }
    p += 4;
  }
  for (const entete of ['MM\0*\0\0\0\x08', 'II*\0\x08\0\0\0']) {
    const q = chercher(o, entete);
    if (q !== -1) { ajouterExif(o, q, o.length, r, 0); break; }
  }
  const x = chercher(o, '<x:xmpmeta');
  if (x !== -1) {
    const f = chercher(o, '</x:xmpmeta>', x);
    if (f !== -1) ajouterXmp(texte8(o, x, f + 12), r, f + 12 - x);
  }
}
function analyserGif(o, r) {
  r.largeur = o[6] | (o[7] << 8);
  r.hauteur = o[8] | (o[9] << 8);
}

/* ───────────── interface publique ───────────── */

const ANALYSEURS = { jpeg: analyserJpeg, png: analyserPng, webp: analyserWebp, heif: analyserHeif, gif: analyserGif };
const NETTOYEURS = { jpeg: nettoyerJpeg, png: nettoyerPng, webp: nettoyerWebp };

/** Décrit tout ce qu'un fichier image raconte en dehors de ses pixels. */
export function analyser(o) {
  const format = detecterFormat(o);
  const r = { format, mime: MIMES[format] || '', largeur: 0, hauteur: 0, orientation: 1, champs: [], blocs: [], position: null, sansPerte: format in NETTOYEURS };
  try { ANALYSEURS[format]?.(o, r); } catch (e) { r.erreur = String(e?.message || e); }
  const vus = new Set();
  r.champs = r.champs.filter((c) => { const k = `${c.l}\n${c.v}`; if (vus.has(k)) return false; vus.add(k); return true; });
  const a = (g) => r.champs.some((c) => c.g === g);
  r.bilan = {
    position: a('position'), date: a('date'), appareil: a('appareil'), identite: a('auteur'),
    miniature: r.blocs.some((b) => b.miniature), video: r.blocs.some((b) => b.video),
  };
  // Ce qui compte comme « trace » : tout champ hors orientation, tout bloc hors profil de couleur.
  r.traces = r.champs.filter((c) => !c.neutre).length + r.blocs.filter((b) => !b.garde && (b.queue || b.miniature || !/^(EXIF|XMP)$/.test(b.nom))).length;
  return r;
}

/**
 * Retire les métadonnées sans toucher aux pixels.
 * mode 'tout' : tout sauf l'orientation et le profil de couleur ;
 * mode 'position' : seulement les coordonnées GPS et les noms de lieux.
 * Renvoie null si le format ne permet pas un retrait sans recompression.
 */
export function nettoyer(o, mode = 'tout') {
  const format = detecterFormat(o);
  const f = NETTOYEURS[format];
  if (!f) return null;
  return { octets: f(o, mode), mime: MIMES[format], extension: EXTENSIONS[format] };
}
