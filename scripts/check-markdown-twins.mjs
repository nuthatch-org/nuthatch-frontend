// Fail the build when a docs page or blog post has no Markdown twin, or when llms.txt links one of
// them by its HTML URL (#2980). Runs after `astro build`, against dist/.
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const failures = [];

async function size(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

const sitemap = await readFile(join(root, 'public/sitemap.xml'), 'utf8');
const routes = [...sitemap.matchAll(/<loc>https:\/\/nuthatch-indexer\.com(\/(?:docs|blog)\/[^<]+)<\/loc>/g)].map((m) => m[1]);
for (const route of [...routes, '/docs']) {
  const twin = join(dist, `${route}.md`);
  if ((await size(twin)) <= 0) {
    failures.push(`${route}: no Markdown twin at ${route}.md`);
    continue;
  }
  if (!(await readFile(twin, 'utf8')).startsWith('# ')) failures.push(`${route}.md: does not start with its title`);
  const html = join(dist, route, 'index.html');
  if ((await size(html)) > 0 && !(await readFile(html, 'utf8')).includes(`rel="alternate" type="text/markdown" href="${route}.md"`)) {
    failures.push(`${route}: the HTML page does not link its twin`);
  }
}

for (const file of ['public/llms.txt', 'public/llms-full.txt']) {
  const text = await readFile(join(root, file), 'utf8');
  for (const [, path] of text.matchAll(/https:\/\/(?:www\.)?nuthatch-indexer\.com(\/(?:docs|blog)[^\s)<>,;]*)/g)) {
    const clean = path.replace(/[.:]$/, '');
    if (!clean.endsWith('.md')) failures.push(`${file}: links ${clean}, not its .md twin`);
    else if ((await size(join(dist, clean))) <= 0) failures.push(`${file}: links ${clean}, which the build did not produce`);
  }
}

if (failures.length) {
  console.error(`Markdown twin check failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`Markdown twins present for ${routes.length + 1} pages; llms.txt links only twins.`);
