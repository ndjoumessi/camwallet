#!/usr/bin/env python3
"""
Génère les assets de l'app CamWallet (icône, icône adaptative, splash, favicon)
à partir de l'identité de marque : fond #0A0F1E, logo « ₩ » en émeraude #00C896.

Usage : python3 mobile/scripts/generate-assets.py
Sortie : mobile/assets/{icon,adaptive-icon,splash,favicon}.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

# ── Identité de marque ────────────────────────────────────────────
BG = (10, 15, 30)        # #0A0F1E
EMERALD = (0, 200, 150)  # #00C896
WHITE = (255, 255, 255)  # #FFFFFF

FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT_REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")


def render_glyph(text, font_path, target_h, color):
    """Rend un glyphe sur un calque RGBA recadré sur son encre réelle, puis
    le redimensionne à une hauteur cible. Garantit un centrage optique exact."""
    # On rend grand pour la netteté, puis on recadre sur l'encre.
    probe = ImageFont.truetype(font_path, 1000)
    box = probe.getbbox(text)
    w, h = box[2] - box[0], box[3] - box[1]
    layer = Image.new("RGBA", (w + 40, h + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((20 - box[0], 20 - box[1]), text, font=probe, fill=color + (255,))
    layer = layer.crop(layer.getbbox())
    # Redimensionne à la hauteur cible en gardant le ratio.
    ratio = target_h / layer.height
    return layer.resize((max(1, round(layer.width * ratio)), target_h), Image.LANCZOS)


def paste_centered(base, layer, cx, cy):
    base.alpha_composite(layer, (round(cx - layer.width / 2), round(cy - layer.height / 2)))


def base_canvas(w, h):
    return Image.new("RGBA", (w, h), BG + (255,))


def make_icon(path, size=1024, glyph_h_ratio=0.52):
    img = base_canvas(size, size)
    glyph = render_glyph("₩", FONT_BOLD, round(size * glyph_h_ratio), EMERALD)
    paste_centered(img, glyph, size / 2, size / 2)
    img.convert("RGB").save(path)
    print("✓", path)


def make_adaptive_icon(path, size=1024):
    # Zone sûre Android : le contenu doit tenir dans ~66 % central.
    make_icon(path, size=size, glyph_h_ratio=0.66 * 0.52)


def make_splash(path, w=1284, h=2778):
    img = base_canvas(w, h)
    # Logo ₩ au-dessus du centre.
    glyph = render_glyph("₩", FONT_BOLD, round(w * 0.34), EMERALD)
    paste_centered(img, glyph, w / 2, h * 0.40)
    # Nom de l'app en blanc.
    wordmark = render_glyph("CamWallet", FONT_BOLD, round(w * 0.085), WHITE)
    paste_centered(img, wordmark, w / 2, h * 0.40 + glyph.height / 2 + h * 0.045)
    # Tagline en émeraude.
    tag = render_glyph("Votre Portefeuille QR", FONT_REG, round(w * 0.038), EMERALD)
    paste_centered(img, tag, w / 2, h * 0.40 + glyph.height / 2 + h * 0.095)
    img.convert("RGB").save(path)
    print("✓", path)


def make_favicon(path, size=48):
    img = base_canvas(size, size)
    glyph = render_glyph("₩", FONT_BOLD, round(size * 0.62), EMERALD)
    paste_centered(img, glyph, size / 2, size / 2)
    img.convert("RGB").save(path)
    print("✓", path)


if __name__ == "__main__":
    make_icon(os.path.join(ASSETS, "icon.png"))
    make_adaptive_icon(os.path.join(ASSETS, "adaptive-icon.png"))
    make_splash(os.path.join(ASSETS, "splash.png"))
    make_favicon(os.path.join(ASSETS, "favicon.png"))
    print("Assets générés dans", os.path.normpath(ASSETS))
