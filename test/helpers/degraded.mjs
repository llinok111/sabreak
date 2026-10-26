// SPDX-License-Identifier: MIT
// These builds deliberately simulate runtimes that expose Intl.Segmenter but carry
// no dictionary data (small-ICU), and runtimes that lack the constructor entirely.
// They print a JSON line so the parent test can assert on it.
/* eslint-disable no-console */

const mode = process.argv[2];

if (mode === 'no-dictionary') {
  // Constructor present, dictionaries absent: every script segments as one word.
  Intl.Segmenter = class SegmenterStub {
    constructor() {}
    segment(input) {
      const s = typeof input === 'string' ? input : String(input);
      return [{ segment: s, index: 0, input: s, isWordLike: true }];
    }
  };
} else if (mode === 'no-segmenter') {
  delete Intl.Segmenter;
} else {
  throw new Error(`unknown mode: ${mode}`);
}

const { default: LineBreaker, saCapabilities } = await import('../../dist/module.mjs');
const Thai = 'การพัฒนาซอฟต์แวร์';

const out = {
  mode,
  capabilities: saCapabilities(),
  segments: []
};

const b = new LineBreaker(Thai);
let last = 0;
let bk;
while ((bk = b.nextBreak())) {
  out.segments.push(Thai.slice(last, bk.position));
  last = bk.position;
}

out.offSegments = [];
const b2 = new LineBreaker(Thai, { sa: 'off' });
last = 0;
while ((bk = b2.nextBreak())) {
  out.offSegments.push(Thai.slice(last, bk.position));
  last = bk.position;
}

try {
  // eslint-disable-next-line no-new
  new LineBreaker(Thai, { sa: 'require' });
  out.requireThrew = false;
  out.requireMessage = null;
} catch (err) {
  out.requireThrew = true;
  out.requireMessage = err.message;
}

console.log(JSON.stringify(out));
