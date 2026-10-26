/**
 * Regenerates the data the demo page reads. The page itself needs no bundler and no
 * copy of the library: every library number is produced here, by the tested build.
 *
 *   npm run build   # parcel build && node scripts/sync-demo.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath, [path.join(HERE, 'build-demo-evidence.mjs')], { stdio: 'inherit' });
