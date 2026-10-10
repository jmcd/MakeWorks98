Fonts
=====

sans_8_regular and sans_8_bold are the user-interface font: 11-pixel bitmap
glyph sheets (AngelCode BMFont .fnt descriptors with .bmp pages) rendered from
the "Tahoma" replacement fonts in ReactOS (media/fonts/tahoma.ttf and
tahomabd.ttf, Wine's fonts by Larry Snyder, based on Bitstream Vera Sans).

They are licensed under the GNU Lesser General Public License, version 2.1 or
any later version; the text is in LGPL-2.1.txt in this folder. The source fonts
are at https://github.com/reactos/reactos/tree/deb11f4e678d941552a23c04f6706b88c867970c/media/fonts
and the sheets were made from them with https://github.com/jmcd/BMFontGen:

    bmfont_gen tahoma.ttf   11 0 gasp sans_8_regular
    bmfont_gen tahomabd.ttf 11 0 gasp sans_8_bold

(then the "face" and "file" names in each .fnt changed to Sans and sans_8_*).

The program reads these files from this folder when it starts. You may replace
them with your own build of the same fonts, or any BMFont sheet of your own,
under the same file names.
