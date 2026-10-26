/**
 * Records real browser line-break positions for Complex Context Dependent scripts.
 *
 * This is an ORACLE generator, not part of the test run. It needs a browser and is
 * therefore not covered by the package dependencies. To regenerate the fixture:
 *
 *   npm i -D playwright-core
 *   node scripts/record-oracle.mjs            # uses the installed Edge/Chrome channel
 *   npm uninstall playwright-core
 *
 * What it records: for each sample text and container width, the UTF-16 offsets at
 * which the browser actually started a new line. Those positions are the browser's
 * break decisions; `test/sabreak.test.js` replays the file offline and asserts that
 * every decision which is NOT an emergency break of an over-long word is present in
 * this library's break-opportunity set.
 *
 * Honest caveat: Chromium resolves these scripts through ICU, and so does
 * `Intl.Segmenter`. Agreement therefore validates the *integration* (run detection,
 * grapheme safety, stream merging) rather than the dictionary itself. The dictionary
 * content is validated separately, against the runtime's own ICU data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'test', 'fixtures', 'browser-oracle.json');

const SAMPLES = {
  Thai: 'การพัฒนาซอฟต์แวร์เป็นกระบวนการที่ต้องใช้ความพยายามอย่างต่อเนื่องและมีระเบียบวินัยในการทำงานร่วมกันเป็นทีมเพื่อให้ได้ผลลัพธ์ที่มีคุณภาพสูง',
  Lao: 'ການພັດທະນາຊອບແວເປັນຂະບວນການທີ່ຕ້ອງການຄວາມພະຍາຍາມຢ່າງຕໍ່ເນື່ອງເພື່ອໃຫ້ໄດ້ຜົນລັບທີ່ມີຄຸນນະພາບ',
  Khmer: 'ទ្រព្យរោងចក្រនិងបរិក្ខារត្រូវបានកំណត់តាមថ្លៃដើមប្រវត្តិដករំលស់បង្គរនិងការខាតពីការថយចុះតម្លៃ',
  Myanmar: 'ဆော့ဖ်ဝဲလ်ဖွံ့ဖြိုးတိုးတက်ရေးသည်စဉ်ဆက်မပြတ်အားထုတ်မှုလိုအပ်သောလုပ်ငန်းစဉ်တစ်ခုဖြစ်သည်ဟုဆိုနိုင်ပါသည်'
};
const WIDTHS = [120, 160, 200, 260, 320, 400];

const browser = await chromium.launch({ channel: process.env.SABREAK_BROWSER || 'msedge', headless: true });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const measured = await page.evaluate(({ samples, widths }) => {
  const out = {};
  for (const [name, text] of Object.entries(samples)) {
    out[name] = { text, byWidth: {} };
    for (const width of widths) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;width:${width}px;font-size:16px;line-height:1.5;`;
      el.textContent = text;
      document.body.appendChild(el);
      const node = el.firstChild;
      const gr = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const clusters = [...gr.segment(text)];
      const tops = clusters.map((c) => {
        const r = document.createRange();
        r.setStart(node, c.index);
        r.setEnd(node, c.index + 1);
        return Math.round(r.getBoundingClientRect().top);
      });
      const breaks = [];
      for (let i = 1; i < tops.length; i++) if (tops[i] !== tops[i - 1]) breaks.push(clusters[i].index);
      out[name].byWidth[width] = breaks;
      el.remove();
    }
  }
  return out;
}, { samples: SAMPLES, widths: WIDTHS });

const ua = await page.evaluate(() => navigator.userAgent);
await browser.close();

// Classify every recorded position: is it an ICU word boundary or an emergency break
// inside an over-long word?
const fixture = {
  meta: {
    generatedBy: 'scripts/record-oracle.mjs',
    browser: ua,
    nodeIcu: process.versions.icu,
    widths: WIDTHS,
    note: 'positions are UTF-16 offsets at which the browser began a new line'
  },
  samples: {}
};

for (const [name, data] of Object.entries(measured)) {
  const ws = new Intl.Segmenter(undefined, { granularity: 'word' });
  const wordStarts = new Set([...ws.segment(data.text)].filter((s) => s.isWordLike).map((s) => s.index));
  const observed = new Set();
  for (const width of WIDTHS) data.byWidth[width].forEach((p) => observed.add(p));
  const positions = [...observed].sort((a, b) => a - b);
  const wordBoundaryPositions = positions.filter((p) => wordStarts.has(p));
  const emergencyPositions = positions.filter((p) => !wordStarts.has(p));
  fixture.samples[name] = {
    text: data.text,
    byWidth: data.byWidth,
    wordBoundaryPositions,
    emergencyPositions
  };
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n');
process.stdout.write(`wrote ${path.relative(process.cwd(), OUT)}\n`);
for (const [name, s] of Object.entries(fixture.samples)) {
  process.stdout.write(`${name.padEnd(8)} word-boundary breaks=${s.wordBoundaryPositions.length} emergency=${s.emergencyPositions.length}${s.emergencyPositions.length ? ' ' + JSON.stringify(s.emergencyPositions) : ''}\n`);
}
