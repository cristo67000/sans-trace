"""Dessine les icônes : une photo dont l'étiquette (les métadonnées) est décrochée."""
from pathlib import Path
from PIL import Image, ImageDraw

D = Path(__file__).parent.parent / "icons"
D.mkdir(exist_ok=True)
FOND, PAPIER, CIEL, MONT, SOLEIL, ETIQ = (15, 76, 76), (250, 247, 240), (150, 205, 200), (15, 95, 95), (245, 190, 80), (226, 106, 62)


def dessin(taille=1024, marge=0.0, arrondi=True):
    S = taille * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22) if arrondi else 0, fill=FOND)
    u = S * (1 - 2 * marge)
    o = S * marge
    P = lambda x, y: (o + x * u, o + y * u)
    # la photo
    d.rounded_rectangle([P(0.17, 0.25), P(0.83, 0.75)], radius=int(u * 0.05), fill=PAPIER)
    d.rounded_rectangle([P(0.21, 0.29), P(0.79, 0.71)], radius=int(u * 0.025), fill=CIEL)
    d.ellipse([P(0.60, 0.34), P(0.71, 0.45)], fill=SOLEIL)
    d.polygon([P(0.21, 0.71), P(0.40, 0.44), P(0.52, 0.60), P(0.60, 0.52), P(0.79, 0.71)], fill=MONT)
    # l'étiquette décrochée, barrée
    d.rounded_rectangle([P(0.56, 0.62), P(0.90, 0.84)], radius=int(u * 0.045), fill=ETIQ, outline=FOND, width=int(u * 0.022))
    for y in (0.69, 0.75):
        d.line([P(0.63, y), P(0.83, y)], fill=PAPIER, width=int(u * 0.022))
    d.line([P(0.60, 0.86), P(0.87, 0.60)], fill=FOND, width=int(u * 0.06))
    d.line([P(0.60, 0.86), P(0.87, 0.60)], fill=PAPIER, width=int(u * 0.028))
    return im.resize((taille, taille), Image.LANCZOS)


dessin(512).save(D / "icone-512.png")
dessin(512).resize((192, 192), Image.LANCZOS).save(D / "icone-192.png")
dessin(512, marge=0.12, arrondi=False).convert("RGB").save(D / "icone-masquable-512.png")
print("icônes écrites dans", D)
