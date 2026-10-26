/**
 * Downstream impact check: how many lines does PDFKit actually produce?
 *
 * PDFKit wraps text through `linebreak` (`var LineBreaker = require('linebreak')` in
 * pdfkit.js). Whatever that module fails to report as a break opportunity can never be
 * wrapped, no matter how wide the text is. This script lays out the identical document
 * twice — once with the stock `linebreak`, once with `sabreak` substituted in its place
 * — and prints the number of lines PDFKit used for each paragraph.
 *
 * Using a real font matters: with a font that has no Thai glyphs every advance is
 * zero, nothing ever overflows, and the measurement is meaningless. The fonts in
 * test/fixtures/fonts are Noto Sans Thai / Lao / Khmer / Myanmar (SIL OFL 1.1), the
 * same families Google Fonts ships.
 *
 *   node scripts/downstream-pdfkit.cjs upstream
 *   node scripts/downstream-pdfkit.cjs sabreak
 */
const fs = require('node:fs');
const path = require('node:path');

const impl = process.argv[2] || 'upstream';
if (!['upstream', 'sabreak'].includes(impl)) {
  process.stderr.write('usage: node scripts/downstream-pdfkit.cjs upstream|sabreak\n');
  process.exit(2);
}

const upstreamEntry = require.resolve('linebreak');
const replacement = impl === 'sabreak'
  ? require(path.join(__dirname, '..', 'dist', 'main.cjs'))
  : require(upstreamEntry);

// Substitute the module PDFKit resolves for 'linebreak'.
require.cache[upstreamEntry] = {
  id: upstreamEntry,
  filename: upstreamEntry,
  loaded: true,
  exports: replacement
};

const PDFDocument = require('pdfkit');

// PDFKit force-splits a "word" that is wider than the line, so a script with no
// reported break opportunity still ends up on several lines — broken at arbitrary
// character positions. Line COUNT therefore hides the defect; the produced lines are
// what matter. `_line(text, options, wrapper)` is invoked once per rendered line, so
// wrapping it captures the real line contents.
const FONT_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'fonts');

const SAMPLES = [
  { name: 'Latin', font: null, text: 'Software development is a process that requires continuous discipline and teamwork across the whole organization.' },
  { name: 'Thai', font: 'NotoSansThai.ttf', text: 'การพัฒนาซอฟต์แวร์เป็นกระบวนการที่ต้องใช้ความพยายามอย่างต่อเนื่องและมีระเบียบวินัยในการทำงานร่วมกันเป็นทีม' },
  { name: 'Lao', font: 'NotoSansLao.ttf', text: 'ການພັດທະນາຊອບແວເປັນຂະບວນການທີ່ຕ້ອງການຄວາມພະຍາຍາມຢ່າງຕໍ່ເນື່ອງ' },
  { name: 'Khmer', font: 'NotoSansKhmer.ttf', text: 'ទ្រព្យរោងចក្រនិងបរិក្ខារត្រូវបានកំណត់តាមថ្លៃដើមប្រវត្តិដករំលស់បង្គរ' },
  { name: 'Myanmar', font: 'NotoSansMyanmar.ttf', text: 'ဆော့ဖ်ဝဲလ်ဖွံ့ဖြိုးတိုးတက်ရေးသည်စဉ်ဆက်မပြတ်အားထုတ်မှုလိုအပ်သောလုပ်ငန်းစဉ်တစ်ခုဖြစ်သည်' }
];

const WIDTHS = [140, 160, 180, 200, 220, 240, 260, 300, 340, 380, 400, 460, 520, 600];
const SIZE = 14;

const doc = new PDFDocument({ size: 'A4', margin: 50, autoFirstPage: false });
doc.addPage();

let captured = null;
const originalLine = doc._line;
doc._line = function instrumentedLine (text, options, wrapper) {
  if (captured && typeof text === 'string') captured.push(text);
  return originalLine.call(this, text, options, wrapper);
};

function wordStartsOf (text) {
  return new Set(
    [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)]
      .filter(x => x.isWordLike)
      .map(x => x.index)
  );
}

const rows = [];
for (const s of SAMPLES) {
  if (s.font) doc.font(path.join(FONT_DIR, s.font));
  else doc.font('Helvetica');
  doc.fontSize(SIZE);

  const wordStarts = wordStartsOf(s.text);
  const perWidth = [];
  for (const width of WIDTHS) {
    doc.addPage();
    captured = [];
    try {
      doc.text(s.text, { width, align: 'left' });
    } catch (err) {
      captured = null;
      perWidth.push({ width, error: err.message });
      continue;
    }
    const fragments = captured;
    captured = null;

    let consumed = 0;
    const breaks = [];
    for (let i = 0; i < fragments.length - 1; i++) {
      consumed += fragments[i].length;
      breaks.push(consumed);
    }
    // A break is "inside a word" when it is neither a word start nor right after a
    // space — i.e. the renderer had to split a word to make the line fit.
    const insideWord = breaks.filter(p => !wordStarts.has(p) && s.text[p - 1] !== ' ');
    perWidth.push({ width, lines: fragments.length, breaks, insideWord });
  }

  const measured = perWidth.filter(x => !x.error);
  const badWidths = measured.filter(x => x.insideWord.length > 0);
  rows.push({
    name: s.name,
    font: s.font || 'Helvetica (built-in)',
    chars: [...s.text].length,
    widthsMeasured: measured.length,
    widthsWithBreakInsideWord: badWidths.length,
    totalBreaksInsideWord: measured.reduce((n, x) => n + x.insideWord.length, 0),
    errors: perWidth.filter(x => x.error).length,
    sample: badWidths[0] ? { width: badWidths[0].width, insideWord: badWidths[0].insideWord } : null
  });
}

doc.end();

process.stdout.write(JSON.stringify({ impl, widths: WIDTHS, fontSize: SIZE, rows }, null, 2) + '\n');
