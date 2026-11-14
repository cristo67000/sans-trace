"""Fabrique des photos d'essai chargées de métadonnées, puis (--verifier)
compare les pixels des fichiers nettoyés avec ceux des originaux."""
import sys, struct
from pathlib import Path
from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo

D = Path(__file__).parent / "essais"
D.mkdir(exist_ok=True)

XMP = b"""<?xpacket begin="\xef\xbb\xbf" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Essai 1.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmp:CreatorTool="Retouche 3" xmp:CreateDate="2026-08-02T15:04:05+02:00"
    exif:GPSLatitude="48,34.9N" exif:GPSLongitude="7,45.0E" photoshop:City="Strasbourg">
   <dc:creator><rdf:Seq><rdf:li>Camille Essai</rdf:li></rdf:Seq></dc:creator>
   <exif:GPSAltitude>142/1</exif:GPSAltitude>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def image():
    im = Image.new("RGB", (640, 480), (30, 90, 110))
    d = ImageDraw.Draw(im)
    for i in range(0, 640, 16):
        d.line([(i, 0), (640 - i, 480)], fill=(200, (i * 3) % 255, 80), width=3)
    d.ellipse([200, 120, 440, 360], fill=(240, 220, 120))
    return im


def exif(orientation=6):
    e = Image.Exif()
    e[0x010F] = "Samsung"
    e[0x0110] = "SM-A266B"
    e[0x0112] = orientation
    e[0x0131] = "A266BXXU1AYA1"
    e[0x0132] = "2026:08:02 15:04:05"
    e[0x013B] = "Camille Essai"
    x = e.get_ifd(0x8769)
    x[0x9003] = "2026:08:02 15:04:05"
    from PIL.TiffImagePlugin import IFDRational as R
    x[0x829A] = R(1, 250)
    x[0x829D] = R(18, 10)
    x[0x920A] = R(54, 10)
    x[0x8827] = 80
    x[0xA431] = "R58X123456"
    x[0xA434] = "Objectif 5,4 mm"
    g = e.get_ifd(0x8825)
    g[1] = "N"
    g[2] = (48.0, 34.0, 54.12)
    g[3] = "E"
    g[4] = (7.0, 45.0, 2.5)
    g[5] = 0
    g[6] = 142.0
    g[0x1D] = "2026:08:02"
    return e


def fabriquer():
    im = image()
    mini = im.copy()
    mini.thumbnail((160, 120))
    im.save(D / "photo.jpg", quality=88, exif=exif(), xmp=XMP, comment=b"Fait avec un outil d'essai", icc_profile=None)
    # même photo suivie d'une « vidéo » de photo animée
    b = (D / "photo.jpg").read_bytes()
    (D / "animee.jpg").write_bytes(b + b"\0\0\0\x18ftypmp42" + b"\x00" * 5000)
    im.save(D / "droite.jpg", quality=88, exif=exif(1))
    im.save(D / "nue.jpg", quality=88)
    im.save(D / "progressive.jpg", quality=88, progressive=True, exif=exif(3), xmp=XMP)
    p = PngInfo()
    p.add_text("Software", "Essai PNG")
    p.add_text("Author", "Camille Essai")
    p.add_itxt("XML:com.adobe.xmp", XMP.decode("utf-8"))
    im.save(D / "image.png", pnginfo=p, exif=exif())
    im.save(D / "image.webp", quality=85, exif=exif(), xmp=XMP)
    im.save(D / "simple.webp", quality=85)
    print("essais fabriqués dans", D)


def verifier():
    ok = True
    for f in sorted((D / "sortie").glob("*")):
        source = D / f.name.split("__", 1)[1]
        a, b = Image.open(source), Image.open(f)
        memes = a.size == b.size and a.convert("RGB").tobytes() == b.convert("RGB").tobytes()
        ex = b.getexif()
        gps = dict(ex.get_ifd(0x8825))
        print(f"{'OK ' if memes else 'ÉCHEC'} pixels  {f.name:34s} orientation={ex.get(0x0112)} gps={len(gps)} exif={len(ex)}")
        ok &= memes
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    verifier() if "--verifier" in sys.argv else fabriquer()
