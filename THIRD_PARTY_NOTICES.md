# Third-party notices

This program is proprietary (see `LICENSE`), but it includes the third-party fonts and
libraries below, each under its own licence. The full licence texts are in `licenses/`.

## Fonts

The bitmap fonts are pre-rendered glyph sheets (AngelCode BMFont `.fnt` + `.bmp`) made
from other people's fonts, all from ReactOS, `media/fonts/`, commit
[`deb11f4e`](https://github.com/reactos/reactos/tree/deb11f4e678d941552a23c04f6706b88c867970c/media/fonts),
and renamed here so no trade mark appears. They were rendered with
[BMFontGen](https://github.com/jmcd/BMFontGen), which takes FreeType's output at the given
pixel size (`bmfont_gen <font> <pixels> 0 gasp <name>` for Sans, `... 0 mono ...` for
Glyphs and Mono); those commands reproduce the committed sheets byte for byte.

### Sans 8 — `GuiDrawing.Core/Fonts/sans_8_regular`, `sans_8_bold` (LGPL)

Rendered at 11 px from `tahoma.ttf` (version 0.020 khmz) and `tahomabd.ttf`
(version 0.021 khmz): Wine's replacement fonts. Both carry hand-drawn embedded bitmaps at
that size, which the sheets reproduce exactly.

> Copyright (c) 2004 Larry Snyder, Based on Bitstream Vera Sans Copyright (c) 2003
> by Bitstream, Inc. Font renamed in accordance with former's license.
> (C) 2018 Red A.N.T. (bold)

The fonts' own name table licenses them under the **GNU Lesser General Public License,
version 2.1 or (at your option) any later version** — `licenses/LGPL-2.1.txt`. ReactOS's
accompanying documentation gives the Bitstream Vera and Arev licences, which require their
notices to be kept and forbid the names "Bitstream", "Vera" and "Arev" on modified fonts —
`licenses/Sans-Vera-Arev.txt`.

So that the LGPL part stays replaceable, Sans 8 is **not compiled into the program**. It
ships as loose files in a `Fonts` folder beside the program (on the web, `Fonts/` beside
`index.html`), with the LGPL text and a README saying where the source fonts are, how the
sheets were made, and that they may be replaced under the same names.

### Glyphs 10/12/14 — `glyphs_10`, `glyphs_12`, `glyphs_14`

Rendered at 10, 12 and 14 px from `Marlett.ttf` (version 0.32): the UI symbol font
(title-bar buttons, scroll arrows, checkbox and radio parts).

> Copyright (c) 2007 Ged Murphy
> Copyright (c) 2007 Wierd_W
> Copyright (c) TransGaming Technologies. All rights reserved.
> Copyright (c) 2019 Katayama Hirofumi MZ

Under the font's own permissive licence, reproduced in `licenses/Glyphs-Marlett.txt`.

### Mono 16 — `mono_16`

Rendered at 16 px from `FSEX301.ttf` (Fixedsys Excelsior 3.01, version 3.010 2007). Used
only when a Jotpad window turns on View > Fixed-Width Font.

> Fixedsys Excelsior 3.01 by Darien Gavin Valentine, http://www.fixedsysexcelsior.com/

Free software that appears to have been released by its author into the public domain; the
author's own words are in ReactOS's README, reproduced in `licenses/Mono-Fixedsys-Excelsior.txt`.

### VGA 8x16 — `vga_8x16.bin`

Rendered by `reference/generate_vga_font.py` from `UniVGA16.ttf` (UNI-VGA, TrueType
conversion by Roy Tam, version 1.01 khmz): the DOS Screen's text-mode font.

> Copyright © 2001 by Dmitry Yu. Bolkhovityanov

Under the X (MIT) licence, as its author states; the author's README and the licence text
are in `licenses/VGA-UniVGA.txt`. Its Basic Latin block was taken from DOSEMU's `vga.bdf`,
after the IBM VGA ROM font.

## Libraries

### .NET runtime and libraries

> Copyright (c) .NET Foundation and Contributors

MIT licence — `licenses/MIT.txt`.

### CommunityToolkit.HighPerformance 8.4.2

> Copyright © .NET Foundation and Contributors

MIT licence — `licenses/MIT.txt`.

### raylib 6.0 (bundled in Raylib-cs 8.0.0, desktop only)

> Copyright (c) Ramon Santamaria (@raysan5)

zlib licence — `licenses/Zlib-raylib.txt` (the text from raylib's repository). Raylib-cs, the C# binding, is also under the
zlib licence (© its contributors).
