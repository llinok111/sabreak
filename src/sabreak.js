import UnicodeTrie from 'unicode-trie';
import BaseLineBreaker from './linebreaker.js';
import classesTrieData from './classes-trie-data.js';
import { SA } from './classes.js';

// UAX #14 LB1 requires SA ("Complex Context Dependent", i.e. Thai / Lao / Khmer /
// Myanmar and friends) to be resolved with "additional, language-specific context
// analysis". The stock algorithm resolves SA -> AL, which yields *no* internal break
// opportunity at all: a paragraph of unspaced Thai collapses into a single
// unbreakable run. This module supplies the missing analysis through the ICU
// dictionary segmenter that ships with the runtime (`Intl.Segmenter`).

const DEFAULT_PROBE = 'การพัฒนาซอฟต์แวร์';
const PROBE_MIN_WORDS = 3;

// General category M (Mn / Mc / Me). `\p{M}` is supported by the RegExp engine of every
// runtime that also ships Intl.Segmenter, so this needs no table of its own.
const MARK_RE = /^\p{M}$/u;

let classTrie = null;

function getClassTrie() {
  if (classTrie === null) {
    classTrie = new UnicodeTrie(classesTrieData);
  }
  return classTrie;
}

function* codePoints(text) {
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i);
    const size = cp > 0xFFFF ? 2 : 1;
    yield { cp, index: i, size };
    i += size;
  }
}

/**
 * Maximal runs of SA-class code points, as UTF-16 [start, end) offsets.
 */
export function findSARuns(text) {
  const trie = getClassTrie();
  const runs = [];
  let start = -1;
  let end = -1;
  for (const { cp, index, size } of codePoints(text)) {
    if (trie.get(cp) === SA) {
      if (start === -1) start = index;
      end = index + size;
    } else if (start !== -1) {
      runs.push({ start, end });
      start = -1;
      end = -1;
    }
  }
  if (start !== -1) runs.push({ start, end });
  return runs;
}

/**
 * Whether this runtime can actually perform dictionary segmentation for SA scripts.
 *
 * `typeof Intl.Segmenter === 'function'` is NOT sufficient: small-ICU builds expose
 * the constructor but carry no Thai/Lao/Khmer/Myanmar dictionaries, in which case
 * segmentation silently returns the whole run as one word — reproducing exactly the
 * bug this module exists to fix. So we probe with a known multi-word string.
 */
export function saCapabilities(options = {}) {
  const result = { segmenter: false, dictionary: false, probeWords: 0, reason: null };
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    result.reason = 'Intl.Segmenter is not available in this runtime';
    return result;
  }
  result.segmenter = true;
  try {
    const seg = new Intl.Segmenter(options.locale, { granularity: 'word' });
    let words = 0;
    for (const s of seg.segment(DEFAULT_PROBE)) {
      if (s.isWordLike) words++;
    }
    result.probeWords = words;
    result.dictionary = words >= PROBE_MIN_WORDS;
    if (!result.dictionary) {
      result.reason = `dictionary segmentation unavailable for SA scripts (probe ${JSON.stringify(DEFAULT_PROBE)} produced ${words} word(s), expected >= ${PROBE_MIN_WORDS})`;
    }
  } catch (err) {
    result.reason = String((err && err.message) || err);
  }
  return result;
}

let wordSegmenter = null;
let wordSegmenterKey = null;
let graphemeSegmenter = null;
let graphemeSegmenterKey = null;

function getWordSegmenter(locale, want) {
  if (want === false) return null;
  if (!saCapabilities({ locale }).dictionary) return null;
  const key = String(locale);
  if (wordSegmenter === null || wordSegmenterKey !== key) {
    wordSegmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    wordSegmenterKey = key;
  }
  return wordSegmenter;
}

function getGraphemeSegmenter(locale) {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return null;
  const key = String(locale);
  if (graphemeSegmenter === null || graphemeSegmenterKey !== key) {
    graphemeSegmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    graphemeSegmenterKey = key;
  }
  return graphemeSegmenter;
}

/**
 * Additional break opportunities contributed by dictionary analysis.
 *
 * Only positions strictly inside an SA run are returned: run edges are ordinary
 * SA/AL transitions that the base pair table already resolves (LB28 and friends),
 * so touching them would be a behaviour change rather than a tailoring.
 */
export function saBreakOpportunities(text, options = {}) {
  const seg = getWordSegmenter(options.locale, options.sa !== 'off');
  if (seg === null) return [];
  const runs = findSARuns(text);
  if (runs.length === 0) return [];

  const grapheme = getGraphemeSegmenter(options.locale);
  const clusterStarts = grapheme === null ? null : new Set();
  // End offset -> start offset, for clusters made of nothing but combining marks.
  //
  // Two things make this check necessary, and the exact form of it matters:
  //   1. A cluster-boundary check alone is not enough. A mark with no base in front of
  //      it starts its own cluster (UAX #29 GB999), so a break may land right after it —
  //      but UAX #14 LB28 forbids a break there, and the official suite asserts exactly
  //      that (LineBreakTest 17.0 rows 14595 and 14871, "SA_Mn × SA").
  //   2. "Never break after a mark" is far too broad. Myanmar syllables end in U+103A
  //      ASAT and U+1038, which are marks, and ICU legitimately reports word boundaries
  //      after them; a category-only rule collapsed Burmese from 13 segments to 1 and
  //      deleted 3 break positions a real browser uses.
  // The distinguishing feature of the suite rows is that the stray mark sits at the very
  // start of the run, with no base anywhere before it — there is nothing for it to
  // attach to. Clusters elsewhere always have a base earlier in the run, so their
  // boundaries are real word boundaries and must be kept.
  const orphanClusterStartByEnd = new Map();
  if (grapheme !== null) {
    for (const s of grapheme.segment(text)) {
      clusterStarts.add(s.index);
      let onlyMarks = true;
      for (const { cp } of codePoints(s.segment)) {
        if (!MARK_RE.test(String.fromCodePoint(cp))) { onlyMarks = false; break; }
      }
      if (onlyMarks) orphanClusterStartByEnd.set(s.index + s.segment.length, s.index);
    }
  }

  const out = [];
  let runIndex = 0;
  for (const s of seg.segment(text)) {
    const pos = s.index;
    if (pos <= 0 || pos >= text.length) continue;
    while (runIndex < runs.length && runs[runIndex].end <= pos) runIndex++;
    const run = runs[runIndex];
    if (run === undefined || pos <= run.start || pos >= run.end) continue;
    // ICU word segments are cluster-aligned by contract; re-check so a future
    // runtime change can never split a combining sequence.
    if (clusterStarts !== null && !clusterStarts.has(pos)) continue;
    if (orphanClusterStartByEnd.get(pos) === run.start) continue;
    if (out.length === 0 || out[out.length - 1] !== pos) out.push(pos);
  }
  return out;
}

class Break {
  constructor(position, required = false) {
    this.position = position;
    this.required = required;
  }
}

/**
 * Drop-in replacement for the upstream `LineBreaker`.
 *
 * For text that contains no SA code points it reproduces upstream output exactly,
 * break for break. Where an SA run is present the additional dictionary-derived
 * opportunities are merged into the stream, at positions strictly inside the run and
 * always on a grapheme cluster boundary.
 *
 * `options.sa`:
 *   'auto' (default) - use dictionary analysis when this runtime provides it
 *   'off'            - byte-identical upstream behaviour, no SA tailoring
 */
class LineBreaker {
  constructor(string, options = {}) {
    this.string = typeof string === 'string' ? string : String(string);
    this.options = options;
    this.sa = options.sa === undefined ? 'auto' : options.sa;

    if (this.sa === 'require') {
      const caps = saCapabilities({ locale: options.locale });
      if (!caps.dictionary) {
        throw new Error(`sabreak: SA dictionary analysis requested but unavailable: ${caps.reason}`);
      }
    }

    this.base = new BaseLineBreaker(this.string);
    const extra = this.sa === 'off' ? [] : saBreakOpportunities(this.string, {
      locale: options.locale,
      sa: this.sa
    });
    this.extra = extra;
    this.extraIndex = 0;
    this.pendingBase = undefined;
    this.lastPos = 0;
  }

  nextBreak() {
    // Hold on to a base break that has been fetched but not yet emitted. Fetching on
    // demand and discarding the result when a dictionary position comes first would
    // drop the tail of the string.
    if (this.pendingBase === undefined) {
      this.pendingBase = this.base.nextBreak();
    }

    // Skip dictionary positions already covered by a returned break.
    while (this.extraIndex < this.extra.length && this.extra[this.extraIndex] <= this.lastPos) {
      this.extraIndex++;
    }

    const extraPos = this.extraIndex < this.extra.length ? this.extra[this.extraIndex] : Infinity;
    const basePos = this.pendingBase === null ? Infinity : this.pendingBase.position;

    if (basePos === Infinity && extraPos === Infinity) return null;

    if (basePos <= extraPos) {
      const bk = this.pendingBase;
      this.pendingBase = undefined;
      if (basePos === extraPos) this.extraIndex++;
      this.lastPos = bk.position;
      return new Break(bk.position, bk.required);
    }

    this.extraIndex++;
    this.lastPos = extraPos;
    return new Break(extraPos, false);
  }
}

LineBreaker.saCapabilities = saCapabilities;
LineBreaker.findSARuns = findSARuns;
LineBreaker.saBreakOpportunities = saBreakOpportunities;

export default LineBreaker;
export { LineBreaker, Break, saCapabilities, findSARuns, saBreakOpportunities };
