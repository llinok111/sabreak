#!/usr/bin/env node
import fs from 'node:fs';
import LineBreaker from '../dist/module.mjs';

const USAGE = `sabreak - inspect UAX #14 break opportunities

Usage
  sabreak [options] [text]
  cat file.txt | sabreak [options]

Options
  --sa <mode>      auto | off | require   (default: auto)
  --locale <tag>   BCP 47 tag passed to the dictionary segmenter
  --json           emit JSON instead of a table
  --capabilities   print runtime capability self-check and exit
  --only-sa        print only breaks that came from dictionary analysis
  -h, --help       show this help

Exit codes
  0  ran successfully
  1  runtime error (e.g. --sa require without dictionary data)
  2  bad usage
`;

function parseArgs(argv) {
  const opts = { sa: 'auto', locale: undefined, json: false, onlySA: false, words: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    else if (a === '--json') opts.json = true;
    else if (a === '--only-sa') opts.onlySA = true;
    else if (a === '--capabilities') opts.capabilities = true;
    else if (a === '--sa') { opts.sa = argv[++i]; }
    else if (a === '--locale') { opts.locale = argv[++i]; }
    else if (a.startsWith('--')) return { error: `unknown option: ${a}` };
    else opts.words.push(a);
  }
  return opts;
}

const parsed = parseArgs(process.argv.slice(2));
if (parsed.help) { process.stdout.write(USAGE); process.exit(0); }
if (parsed.error) { process.stderr.write(`sabreak: ${parsed.error}\n\n${USAGE}`); process.exit(2); }
if (!['auto', 'off', 'require'].includes(parsed.sa)) {
  process.stderr.write(`sabreak: --sa must be auto, off or require\n`);
  process.exit(2);
}

if (parsed.capabilities) {
  const caps = LineBreaker.saCapabilities({ locale: parsed.locale });
  process.stdout.write(JSON.stringify(caps, null, 2) + '\n');
  process.exit(caps.dictionary ? 0 : 1);
}

let text;
if (parsed.words.length > 0) {
  text = parsed.words.join(' ');
} else if (!process.stdin.isTTY) {
  text = fs.readFileSync(0, 'utf8');
} else {
  process.stderr.write(USAGE);
  process.exit(2);
}

const options = { sa: parsed.sa };
if (parsed.locale !== undefined) options.locale = parsed.locale;

let breaker;
try {
  breaker = new LineBreaker(text, options);
} catch (err) {
  process.stderr.write(`sabreak: ${err.message}\n`);
  process.exit(1);
}

const extra = new Set(breaker.extra);
const rows = [];
let last = 0;
let bk;
while ((bk = breaker.nextBreak())) {
  rows.push({
    position: bk.position,
    required: bk.required,
    source: extra.has(bk.position) ? 'dictionary' : 'uax14',
    segment: text.slice(last, bk.position)
  });
  last = bk.position;
}

const shown = parsed.onlySA ? rows.filter(r => r.source === 'dictionary') : rows;

if (parsed.json) {
  process.stdout.write(JSON.stringify({
    text,
    options: { sa: parsed.sa, locale: parsed.locale ?? null },
    capabilities: LineBreaker.saCapabilities({ locale: parsed.locale }),
    breaks: shown
  }, null, 2) + '\n');
} else {
  const caps = LineBreaker.saCapabilities({ locale: parsed.locale });
  process.stdout.write(`dictionary analysis: ${caps.dictionary ? 'available' : 'UNAVAILABLE'}${caps.reason ? ` (${caps.reason})` : ''}\n`);
  process.stdout.write(`breaks: ${rows.length} (dictionary-derived: ${rows.filter(r => r.source === 'dictionary').length})\n\n`);
  for (const r of shown) {
    const flag = r.required ? 'REQ' : '   ';
    process.stdout.write(`${String(r.position).padStart(6)}  ${flag}  ${r.source.padEnd(10)}  ${JSON.stringify(r.segment)}\n`);
  }
}
