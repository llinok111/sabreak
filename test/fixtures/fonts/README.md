# Fonts used by the downstream measurement

These are static instances of the Noto Sans Thai / Lao / Khmer / Myanmar variable
fonts, used only by `scripts/downstream-pdfkit.cjs` so that PDFKit measures real glyph
advances instead of zero-width fallbacks.

- Source: <https://github.com/google/fonts> — `ofl/notosansthai`, `ofl/notosanslao`,
  `ofl/notosanskhmer`, `ofl/notosansmyanmar`
- Licence: SIL Open Font License 1.1 (see `OFL.txt`)
- Instanced with: `python -m fontTools.varLib.instancer <var>.ttf wght=400 wdth=100 -o <static>.ttf`
  (fonttools 4.67). PDFKit's fontkit crashes on the variable originals when applying
  Khmer mark-positioning lookups, hence the static instances.

They are test fixtures, not part of the published package (`files` covers `dist`, `bin`
and `NOTICE` only).
