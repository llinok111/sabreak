// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import LineBreaker, { saCapabilities, findSARuns, saBreakOpportunities } from 'sabreak';
import Upstream from 'linebreak';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(HERE, '..');

const SA_SAMPLES = {
  Thai: 'การพัฒนาซอฟต์แวร์เป็นกระบวนการที่ต้องใช้ความพยายามอย่างต่อเนื่องและมีระเบียบวินัยในการทำงานร่วมกันเป็นทีมเพื่อให้ได้ผลลัพธ์ที่มีคุณภาพสูง',
  Lao: 'ການພັດທະນາຊອບແວເປັນຂະບວນການທີ່ຕ້ອງການຄວາມພະຍາຍາມຢ່າງຕໍ່ເນື່ອງເພື່ອໃຫ້ໄດ້ຜົນລັບທີ່ມີຄຸນນະພາບ',
  Khmer: 'ទ្រព្យរោងចក្រនិងបរិក្ខារត្រូវបានកំណត់តាមថ្លៃដើមប្រវត្តិដករំលស់បង្គរនិងការខាតពីការថយចុះតម្លៃ',
  Myanmar: 'ဆော့ဖ်ဝဲလ်ဖွံ့ဖြိုးတိုးတက်ရေးသည်စဉ်ဆက်မပြတ်အားထုတ်မှုလိုအပ်သောလုပ်ငန်းစဉ်တစ်ခုဖြစ်သည်ဟုဆိုနိုင်ပါသည်'
};

const NON_SA_CORPUS = [
  'software development is a process that requires continuous discipline',
  'Hello, world! (a test) [bracketed] {braced}',
  '中文测试内容，包含标点、符号和数字12345。',
  'a\u0301bc combining acute',
  '-- --- ... // etc',
  'e.g. i.e. 12:59 $100.00 10,000',
  '한국어 텍스트 조각',
  '日本語のテキスト断片です。',
  'tab\tseparated\nvalues\r\n',
  'e\u0301\u0323 multi mark'
];

function segments(Breaker, text, options) {
  const b = new Breaker(text, options);
  const out = [];
  let last = 0;
  let bk;
  while ((bk = b.nextBreak())) {
    out.push({ position: bk.position, required: bk.required, text: text.slice(last, bk.position) });
    last = bk.position;
  }
  return out;
}

function textOnly(rows) {
  return rows.map(r => r.text);
}

function graphemeStarts(text) {
  const g = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return new Set([...g.segment(text)].map(s => s.index));
}

function readConformanceCases() {
  const data = fs.readFileSync(path.join(HERE, 'LineBreakTest.txt'), 'utf8');
  const cases = [];
  for (const line of data.split('\n')) {
    if (!line || /^#/.test(line)) continue;
    const [cols] = line.split('#');
    if (!cols || !/[×÷]/.test(cols)) continue;
    let codePoints; let expected;
    try {
      codePoints = cols.split(/\s*[×÷]\s*/).slice(1, -1).map(c => parseInt(c, 16));
      expected = cols.split(/\s*÷\s*/).slice(0, -1).map((c) => {
        const codes = c.split(/\s*×\s*/);
        if (codes[0] === '') codes.shift();
        return String.fromCodePoint(...codes.map(x => parseInt(x, 16)));
      });
    } catch {
      continue;
    }
    if (!codePoints.length) continue;
    cases.push({ codePoints, string: String.fromCodePoint(...codePoints), expected });
  }
  return cases;
}

const CONFORMANCE = readConformanceCases();

describe('sabreak: runtime capability self-check', () => {
  it('detects dictionary segmentation on this runtime', () => {
    const caps = saCapabilities();
    assert.strictEqual(caps.segmenter, true, 'Intl.Segmenter should exist on Node 16+');
    assert.strictEqual(caps.dictionary, true, `expected ICU dictionary data: ${caps.reason}`);
    assert.ok(caps.probeWords >= 3, `probe produced ${caps.probeWords} word(s)`);
    assert.strictEqual(caps.reason, null);
  });

  it('never reports dictionary support when the probe cannot split a known word sequence', () => {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'helpers', 'degraded.mjs'), 'no-dictionary'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
    assert.strictEqual(out.capabilities.segmenter, true, 'stub still exposes the constructor');
    assert.strictEqual(out.capabilities.dictionary, false, 'must not claim dictionary support');
    assert.match(out.capabilities.reason, /dictionary segmentation unavailable/i);
  });
});

describe('sabreak: SA run detection', () => {
  it('finds one run spanning an all-Thai string', () => {
    const runs = findSARuns(SA_SAMPLES.Thai);
    assert.deepStrictEqual(runs, [{ start: 0, end: SA_SAMPLES.Thai.length }]);
  });

  it('returns no runs for pure Latin text', () => {
    assert.deepStrictEqual(findSARuns('plain latin text'), []);
  });

  it('splits runs at non-SA boundaries and reports UTF-16 offsets', () => {
    const text = 'abการcd';
    assert.deepStrictEqual(findSARuns(text), [{ start: 2, end: 5 }]);
  });

  it('handles strings that are only the Thai sample code point', () => {
    assert.deepStrictEqual(findSARuns('\u0E01'), [{ start: 0, end: 1 }]);
  });
});

describe('sabreak: dictionary break opportunities', () => {
  it('produces opportunities for every complex script sample', () => {
    for (const [name, text] of Object.entries(SA_SAMPLES)) {
      const ops = saBreakOpportunities(text);
      assert.ok(ops.length > 5, `${name}: expected > 5 opportunities, got ${ops.length}`);
    }
  });

  it('places every opportunity strictly inside an SA run', () => {
    for (const text of Object.values(SA_SAMPLES)) {
      const runs = findSARuns(text);
      for (const pos of saBreakOpportunities(text)) {
        const inside = runs.some(r => pos > r.start && pos < r.end);
        assert.ok(inside, `position ${pos} is not strictly inside an SA run`);
      }
    }
  });

  it('places every opportunity on a grapheme cluster boundary', () => {
    for (const text of Object.values(SA_SAMPLES)) {
      const clusters = graphemeStarts(text);
      for (const pos of saBreakOpportunities(text)) {
        assert.ok(clusters.has(pos), `position ${pos} splits a grapheme cluster`);
      }
    }
  });

  it('returns strictly increasing, duplicate-free positions', () => {
    for (const text of Object.values(SA_SAMPLES)) {
      const ops = saBreakOpportunities(text);
      for (let i = 1; i < ops.length; i++) {
        assert.ok(ops[i] > ops[i - 1], 'positions must be strictly increasing');
      }
    }
  });

  it('returns nothing when the text has no SA code point', () => {
    for (const text of NON_SA_CORPUS) {
      assert.deepStrictEqual(saBreakOpportunities(text), [], `unexpected opportunities for ${JSON.stringify(text)}`);
    }
  });
});

describe('sabreak: upstream equivalence on non-SA text', () => {
  it('is identical to upstream on a mixed corpus', () => {
    for (const text of NON_SA_CORPUS) {
      assert.deepStrictEqual(
        segments(LineBreaker, text),
        segments(Upstream, text),
        `diverged on ${JSON.stringify(text)}`
      );
    }
  });

  it('is identical to upstream for every official conformance case', () => {
    let compared = 0;
    for (const c of CONFORMANCE) {
      const mine = segments(LineBreaker, c.string);
      const theirs = segments(Upstream, c.string);
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
        assert.fail(`diverged on ${c.codePoints.map(x => x.toString(16)).join(' ')}`);
      }
      compared++;
    }
    assert.strictEqual(compared, 7654, 'the full official suite must be compared');
  });

  it('sa:off is byte-identical to upstream on complex scripts too', () => {
    for (const text of Object.values(SA_SAMPLES)) {
      assert.deepStrictEqual(
        segments(LineBreaker, text, { sa: 'off' }),
        segments(Upstream, text),
        'sa:off must not change anything'
      );
    }
  });
});

describe('sabreak: official conformance suite is unchanged', () => {
  const results = { upstream: 0, sabreak: 0, sabreakOff: 0, total: 0 };

  before(() => {
    for (const c of CONFORMANCE) {
      results.total++;
      const check = (Breaker, options) => {
        const got = segments(Breaker, c.string, options).map(r => r.text);
        return got.length === c.expected.length && got.every((g, i) => g === c.expected[i]);
      };
      if (check(Upstream)) results.upstream++;
      if (check(LineBreaker, undefined)) results.sabreak++;
      if (check(LineBreaker, { sa: 'off' })) results.sabreakOff++;
    }
  });

  it('passes exactly as many official cases as upstream does', () => {
    assert.strictEqual(results.sabreak, results.upstream,
      `upstream passed ${results.upstream}/${results.total}, sabreak passed ${results.sabreak}/${results.total}`);
  });

  it('keeps sa:off at the upstream pass count', () => {
    assert.strictEqual(results.sabreakOff, results.upstream);
  });

  it('compares the whole suite', () => {
    assert.strictEqual(results.total, 7654);
    assert.ok(results.upstream > 7500, 'sanity: upstream baseline should be high');
  });
});

describe('sabreak: gains on complex-context scripts', () => {
  it('breaks unspaced Thai where upstream could not', () => {
    const mine = segments(LineBreaker, SA_SAMPLES.Thai);
    const theirs = segments(Upstream, SA_SAMPLES.Thai);
    assert.strictEqual(theirs.length, 1, 'upstream is expected to emit a single unbreakable run');
    assert.ok(mine.length >= 15, `expected many break opportunities, got ${mine.length}`);
  });

  it('improves every complex script sample', () => {
    for (const [name, text] of Object.entries(SA_SAMPLES)) {
      const mine = segments(LineBreaker, text).length;
      const theirs = segments(Upstream, text).length;
      assert.ok(mine > theirs, `${name}: expected ${mine} > ${theirs}`);
    }
  });

  it('marks dictionary opportunities as optional, never required', () => {
    const ops = new Set(saBreakOpportunities(SA_SAMPLES.Thai));
    for (const row of segments(LineBreaker, SA_SAMPLES.Thai)) {
      if (ops.has(row.position)) {
        assert.strictEqual(row.required, false, 'dictionary break must not be required');
      }
    }
  });

  it('never loses a required hard break that upstream reported', () => {
    const text = 'บทที่ 1\nบทที่ 2\nบทที่ 3';
    const theirs = segments(Upstream, text).filter(r => r.required).map(r => r.position);
    const mine = segments(LineBreaker, text).filter(r => r.required).map(r => r.position);
    assert.ok(theirs.length >= 2, 'sanity: upstream must report the interior hard breaks');
    for (const pos of theirs) {
      assert.ok(mine.includes(pos), `required break at ${pos} was dropped`);
    }
  });
});

describe('sabreak: stream integrity', () => {
  // These invariants exist because an earlier revision of the merge logic fetched a
  // base break, then discarded it whenever a dictionary position came first, silently
  // dropping the tail of the string. Counting segments did not catch it; completeness
  // does.
  const CORPUS = [
    ...Object.values(SA_SAMPLES),
    ...NON_SA_CORPUS,
    'การพัฒนาซอฟต์แวร์ 123 (ทดสอบ) 50% ครับ',
    'mixed ภาษาไทย and English',
    'ການພັດທະນາ ຊອບແວ',
    'aก',
    'ก',
    '',
    '\n',
    'ก\nข\nค',
    'ราคา\t12,500',
    '🙂การพัฒนา🙂'
  ];

  it('reproduces the input exactly when segments are concatenated', () => {
    for (const text of CORPUS) {
      const joined = segments(LineBreaker, text).map(r => r.text).join('');
      assert.strictEqual(joined, text, `lost or duplicated text for ${JSON.stringify(text)}`);
    }
  });

  it('ends at text.length (or reports nothing for an empty string)', () => {
    for (const text of CORPUS) {
      const rows = segments(LineBreaker, text);
      if (text.length === 0) {
        assert.deepStrictEqual(rows, []);
        continue;
      }
      assert.strictEqual(rows[rows.length - 1].position, text.length, `wrong final position for ${JSON.stringify(text)}`);
    }
  });

  it('keeps positions strictly increasing and within bounds', () => {
    for (const text of CORPUS) {
      let prev = 0;
      for (const r of segments(LineBreaker, text)) {
        assert.ok(r.position > prev, 'positions must increase');
        assert.ok(r.position <= text.length, 'position out of bounds');
        prev = r.position;
      }
    }
  });

  it('holds the same invariants under randomised mixed-script input', () => {
    // Deterministic PRNG: the corpus is reproducible, no seed drift between runs.
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = [
      'a', 'Z', '0', ' ', ',', '.', '(', ')', '\n', '\u0E01', '\u0E32', '\u0E48', '\u0EB2',
      '\u1780', '\u17D2', '\u1000', '\u103A', '\u4E2D', '\uD83D\uDE42', '\u00A0', '\u200D'
    ];
    for (let round = 0; round < 200; round++) {
      const len = 1 + Math.floor(rand() * 40);
      let text = '';
      for (let i = 0; i < len; i++) text += alphabet[Math.floor(rand() * alphabet.length)];
      const rows = segments(LineBreaker, text);
      assert.strictEqual(rows.map(r => r.text).join(''), text, `round ${round}: text lost`);
      assert.strictEqual(rows[rows.length - 1].position, text.length, `round ${round}: wrong final position`);
      const clusters = graphemeStarts(text);
      const offered = new Set(saBreakOpportunities(text));
      for (const r of rows) {
        if (offered.has(r.position)) {
          assert.ok(clusters.has(r.position), `round ${round}: dictionary break split a cluster`);
        }
      }
    }
  });

  it('stays identical to upstream on the mixed corpus, character for character', () => {
    for (const text of CORPUS) {
      assert.deepStrictEqual(
        segments(LineBreaker, text, { sa: 'off' }),
        segments(Upstream, text),
        `sa:off diverged on ${JSON.stringify(text)}`
      );
    }
  });
});

describe('sabreak: browser oracle replay', () => {
  const fixturePath = path.join(HERE, 'fixtures', 'browser-oracle.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  it('has a recorded fixture with word-boundary breaks', () => {
    const total = Object.values(fixture.samples).reduce((n, s) => n + s.wordBoundaryPositions.length, 0);
    assert.ok(total >= 50, `fixture should hold real browser decisions, found ${total}`);
  });

  it('contains every real browser break decision (excluding emergency breaks)', () => {
    for (const [name, sample] of Object.entries(fixture.samples)) {
      const ops = new Set(saBreakOpportunities(sample.text));
      const missing = sample.wordBoundaryPositions.filter(p => !ops.has(p));
      assert.deepStrictEqual(missing, [], `${name}: browser broke at positions this library does not offer`);
    }
  });

  it('documents emergency breaks as positions the browser only uses for over-long words', () => {
    for (const [name, sample] of Object.entries(fixture.samples)) {
      if (sample.emergencyPositions.length === 0) continue;
      const ws = new Intl.Segmenter(undefined, { granularity: 'word' });
      const wordStarts = new Set([...ws.segment(sample.text)].filter(s => s.isWordLike).map(s => s.index));
      for (const pos of sample.emergencyPositions) {
        assert.ok(!wordStarts.has(pos), `${name}: ${pos} was recorded as emergency but is a word boundary`);
      }
      // The library deliberately does not offer these: they are line-filling behaviour.
      const offered = new Set(saBreakOpportunities(sample.text));
      for (const pos of sample.emergencyPositions) {
        assert.ok(!offered.has(pos), `${name}: ${pos} should not be offered as an opportunity`);
      }
    }
  });
});

describe('sabreak: graceful degradation', () => {
  it('falls back to upstream behaviour when no dictionary data is present', () => {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'helpers', 'degraded.mjs'), 'no-dictionary'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
    assert.deepStrictEqual(out.segments, ['การพัฒนาซอฟต์แวร์'], 'must match the single unbreakable run upstream produces');
    assert.deepStrictEqual(out.offSegments, ['การพัฒนาซอฟต์แวร์']);
  });

  it('throws in require mode when dictionary data is absent', () => {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'helpers', 'degraded.mjs'), 'no-dictionary'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
    assert.strictEqual(out.capabilities.dictionary, false);
    assert.strictEqual(out.requireThrew, true);
    assert.match(out.requireMessage, /dictionary analysis requested but unavailable/i);
  });

  it('degrades cleanly when Intl.Segmenter is missing entirely', () => {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(HERE, 'helpers', 'degraded.mjs'), 'no-segmenter'], { cwd: PROJECT_ROOT, encoding: 'utf8' }));
    assert.strictEqual(out.capabilities.segmenter, false);
    assert.strictEqual(out.capabilities.dictionary, false);
    assert.match(out.capabilities.reason, /Intl\.Segmenter is not available/i);
    assert.deepStrictEqual(out.segments, ['การพัฒนาซอฟต์แวร์']);
    assert.deepStrictEqual(out.offSegments, ['การพัฒนาซอฟต์แวร์']);
  });
});
