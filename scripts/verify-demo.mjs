/**
 * Verification harness for demo/index.html. Not part of `npm test`.
 *
 * Serves the project directory over an ephemeral local HTTP server (a file:// origin
 * cannot import ES modules), drives the page with a real browser, asserts what the page
 * actually rendered, and writes a screenshot for inspection.
 *
 *   npm i -D playwright-core
 *   node scripts/verify-demo.mjs
 *
 * Requires playwright-core plus a Chromium-family browser; both are deliberately kept
 * out of the package dependencies.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHOTS = path.join(ROOT, 'shots');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'demo/index.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: process.env.SABREAK_BROWSER || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${base}/demo/index.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('#coverage tr').length > 0, { timeout: 15000 });

const thai = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#coverage tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
  return {
    caps: document.getElementById('caps').textContent.replace(/\s+/g, ' ').trim(),
    upstreamChips: document.querySelectorAll('#upChips .chip').length,
    sabreakChips: document.querySelectorAll('#saChips .chip').length,
    dictChips: document.querySelectorAll('#saChips .chip.dict').length,
    rows
  };
});

fs.mkdirSync(SHOTS, { recursive: true });
await page.screenshot({ path: path.join(SHOTS, 'demo-thai.png'), fullPage: true });

// Switch to the Latin control and re-render.
await page.fill('#text', 'software development is a process that requires continuous discipline and teamwork');
await page.waitForTimeout(300);
const latin = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('#coverage tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
  upstreamChips: document.querySelectorAll('#upChips .chip').length,
  sabreakChips: document.querySelectorAll('#saChips .chip').length,
  dictChips: document.querySelectorAll('#saChips .chip.dict').length
}));
await page.screenshot({ path: path.join(SHOTS, 'demo-latin.png'), fullPage: true });

await browser.close();
server.close();

const problems = [];
if (errors.length) problems.push(`page errors: ${errors.join(' | ')}`);
if (!/dictionary data true/.test(thai.caps)) problems.push(`dictionary data not reported as true: ${thai.caps}`);
if (thai.sabreakChips < 5) problems.push(`expected several sabreak segments, got ${thai.sabreakChips}`);
if (thai.dictChips < 5) problems.push(`expected dictionary-derived chips, got ${thai.dictChips}`);
const saRow = thai.rows.find((r) => r[0] === 'sabreak');
if (!saRow) problems.push('no sabreak row rendered');
else {
  if (!/^\d+\/\d+$/.test(saRow[2]) || saRow[2].split('/')[0] !== saRow[2].split('/')[1]) {
    problems.push(`sabreak did not cover every browser break: ${saRow[2]}`);
  }
  if (saRow[3] !== '0') problems.push(`sabreak produced mid-word breaks: ${saRow[3]}`);
}
if (latin.upstreamChips !== latin.sabreakChips) {
  problems.push(`non-SA regression: upstream ${latin.upstreamChips} vs sabreak ${latin.sabreakChips} segments`);
}
if (latin.dictChips !== 0) problems.push(`dictionary chips must be empty for Latin, got ${latin.dictChips}`);

process.stdout.write(JSON.stringify({ thai, latin, problems, screenshots: ['shots/demo-thai.png', 'shots/demo-latin.png'] }, null, 2) + '\n');
process.exit(problems.length ? 1 : 0);
