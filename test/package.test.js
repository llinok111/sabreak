// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// APIs that exist only in newer runtimes than the declared minimum. This repository
// targets Node >= 16, which is also what CI exercises. A local `node` that is newer
// cannot catch these, so they are asserted instead.
const TOO_NEW = [
  { name: 'import.meta.dirname', re: /import\.meta\.dirname/, min: '20.11' },
  { name: 'fs.promises.glob', re: /fs\.promises\.glob/, min: '22' },
  { name: 'Array.prototype.findLast', re: /\.findLast\s*\(/, min: '18' },
  { name: 'structuredClone', re: /\bstructuredClone\s*\(/, min: '17' },
  { name: 'Object.groupBy', re: /Object\.groupBy\s*\(/, min: '21' },
  { name: 'Promise.withResolvers', re: /Promise\.withResolvers\s*\(/, min: '22' }
];

describe('sabreak: package invariants', () => {
  it('declares the Node range this code actually supports', () => {
    assert.ok(pkg.engines && pkg.engines.node, 'engines.node must be declared');
    const major = Number(String(pkg.engines.node).replace(/[^0-9.]/g, '').split('.')[0]);
    assert.ok(major <= 16, `declared minimum ${pkg.engines.node} must be the true minimum`);
  });

  it('does not use APIs newer than the declared minimum', () => {
    const files = ['src/sabreak.js', 'bin/sabreak.js', 'scripts/record-oracle.mjs'];
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const api of TOO_NEW) {
        assert.ok(!api.re.test(text), `${rel} uses ${api.name}, which requires Node ${api.min}+`);
      }
    }
  });

  it('keeps the upstream core byte-identical to the vendored commit', () => {
    // The npm tarball of `linebreak` ships only dist/, so the pristine sources are
    // pinned by hash instead. Provenance: test/fixtures/upstream-hashes.json records
    // the upstream commit these files were taken from.
    //
    // Line endings are normalised to LF before hashing because a Windows checkout with
    // `core.autocrlf=true` rewrites the working tree to CRLF without touching the
    // committed blob. Normalising keeps the check meaningful on every platform and
    // still fails the moment a byte of content changes.
    const pinned = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'upstream-hashes.json'), 'utf8'));
    assert.strictEqual(pinned.upstream, 'foliojs/linebreak');
    for (const [rel, expected] of Object.entries(pinned.files)) {
      const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
      const actual = createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex');
      assert.strictEqual(actual, expected, `${rel} was modified — the zero-diff guarantee would no longer hold`);
    }
  });

  it('tests the whole suite without relying on shell glob expansion', () => {
    assert.ok(pkg.scripts.test.includes('parcel build'), 'test must build first');
    assert.ok(!/["']test\/\*/.test(pkg.scripts.test), 'quoted globs are not portable across Node versions');
    assert.ok(pkg.scripts.test.includes('test/index.js'), 'the upstream conformance suite must run');
    assert.ok(pkg.scripts.test.includes('test/sabreak.test.js'), 'the sabreak suite must run');
  });

  it('ships a licence and an upstream attribution notice', () => {
    const license = fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8');
    assert.match(license, /MIT License/);
    assert.match(license, /Devon Govett/, 'the upstream copyright line must be preserved');
    const notice = fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8');
    assert.match(notice, /linebreak/);
    assert.match(notice, /MIT/);
  });

  it('exposes a working CLI', () => {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'sabreak.js'), '--capabilities'], { cwd: ROOT, encoding: 'utf8' });
    const caps = JSON.parse(out);
    assert.strictEqual(typeof caps.dictionary, 'boolean');
  });

  it('exports the documented surface from the build', async () => {
    const mod = await import('sabreak');
    for (const name of ['default', 'LineBreaker', 'Break', 'saCapabilities', 'findSARuns', 'saBreakOpportunities']) {
      assert.ok(mod[name] !== undefined, `missing export: ${name}`);
    }
  });
});
