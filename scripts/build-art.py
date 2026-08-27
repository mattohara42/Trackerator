#!/usr/bin/env python3
"""
Derives the two shipped art assets from the original artwork.

Kept in the repo so the assets in `public/` are reproducible rather than
mystery binaries — if the source art is re-exported, run this again instead of
hand-editing a PNG. Needs Pillow; it is a one-off tool, not part of the build.

    python3 scripts/build-art.py path/to/trackerator-logo.png

Two outputs, because the artwork does two different jobs:

  public/logo.webp      The wordmark, cropped tight and luminance-keyed to
                        transparency so it sits on the topbar panel rather
                        than on a black rectangle.

  public/backdrop.webp  The whole scene, blurred hard and darkened, as an
                        ambient layer behind the app. Blurring is not just a
                        style choice: unblurred, the wordmark in the art
                        competes with the UI text on top of it, and a busy
                        background is exactly wrong for a dashboard you are
                        meant to scan. Blurred, it keeps the glow, the grid
                        horizon and the palette, and loses the detail that
                        would fight the content.
"""

import sys
from PIL import Image, ImageEnhance, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else "trackerator-logo.png"
src = Image.open(SRC).convert("RGB")
W, H = src.size


def scaled(box):
    """Crop box given in fractions of the source, so it survives a re-export
    at a different resolution."""
    l, t, r, b = box
    return (int(l * W), int(t * H), int(r * W), int(b * H))


# ── logo ────────────────────────────────────────────────────────────────────
# The wordmark plus the triangle it sits in. Fractions measured from the
# original 1536x1024 composition.
# Bottom edge stops just under the wordmark: the triangle's lower vertex and
# the grid below it read as a stray band once the logo is only ~46px tall.
logo = src.crop(scaled((0.06, 0.145, 0.96, 0.78)))

# Key the near-black background out by luminance. The wordmark is chrome and
# neon against an almost-black sky, so brightness separates them cleanly; a
# ramp rather than a hard cutoff keeps the outer glow soft instead of leaving
# a cut-out edge.
LO, HI = 26, 96
alpha = logo.convert("L").point(lambda v: 0 if v <= LO else (255 if v >= HI else int(255 * (v - LO) / (HI - LO))))
logo = logo.convert("RGBA")
logo.putalpha(alpha)

# 560px covers a ~280px topbar logo at 2x, which is all it is ever drawn at.
logo.thumbnail((560, 560), Image.LANCZOS)
logo.save("public/logo.webp", "WEBP", quality=82, method=6)

# ── backdrop ────────────────────────────────────────────────────────────────
# Only the lower band of the art: the grid, the horizon glow and the mountains.
# The wordmark is deliberately excluded rather than blurred away — blurred, it
# still read as a bright smear behind the cards, a ghost of the logo that is
# already in the topbar. Cropping it out means the scene is the background and
# the type is the logo, each doing one job.
back = src.crop(scaled((0.0, 0.60, 1.0, 1.0)))
back.thumbnail((1600, 1600), Image.LANCZOS)
back = back.filter(ImageFilter.GaussianBlur(radius=7))
# Only lightly darkened here. The heavy lifting for legibility is the scrim in
# style.css, which is adjustable without re-running this script — darkening the
# asset too far as well made the backdrop invisible rather than subtle.
back = ImageEnhance.Brightness(back).enhance(0.92)
back = ImageEnhance.Color(back).enhance(1.25)
back.save("public/backdrop.webp", "WEBP", quality=72, method=6)

print(f"logo.webp     {logo.size}")
print(f"backdrop.webp {back.size}")
