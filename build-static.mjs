// Builds the static edition of Taskmarket Pulse for GitHub Pages.
// The live data is fetched HERE, on the build server (the Taskmarket API does
// not allow direct browser calls), and baked into index.html + data.json.
// A scheduled GitHub Actions workflow re-runs this build every hour, so the
// page is refreshed at least hourly and always shows its "data as of" time.
// The reference implementation is worker.js (Cloudflare Worker, one-command
// deploy: npx wrangler deploy); both editions share the same data layer and
// the same page template, which this script lifts out of worker.js.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = readFileSync(new URL('./worker.js', import.meta.url), 'utf8');

// 1. Reuse the data layer from worker.js (everything before the page template).
const cut = src.indexOf('const PAGE');
if (cut < 0) throw new Error('page template marker not found in worker.js');
const dataLayer = src.slice(0, cut) + '\nexport { buildPayload };\n';
const tmp = join(tmpdir(), 'pulse-data-layer.mjs');
writeFileSync(tmp, dataLayer);
const { buildPayload } = await import(pathToFileURL(tmp).href);
const payload = await buildPayload();

// 2. Extract the page template (a plain template literal with no ${} inside).
const tStart = src.indexOf('`', cut) + 1;
const tEnd = src.indexOf('`;', tStart);
if (tStart <= 0 || tEnd < 0) throw new Error('page template bounds not found');
let html = src.slice(tStart, tEnd);

// 3. Bake the data in and point the client at the static neighbours.
const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');
html = html.replace('/*__DATA__*/null', '/*__DATA__*/' + dataJson);
html = html.replaceAll("'/api/data'", "'data.json'");
html = html.replaceAll('"/og.png"', '"og.png"');
html = html.replaceAll('(/og.png)', '(og.png)');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
writeFileSync('dist/data.json', JSON.stringify(payload));
copyFileSync('og.png', 'dist/og.png');
console.log('built dist/ at', payload.fetchedAt);
