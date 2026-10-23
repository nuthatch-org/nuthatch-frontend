import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const site = 'https://nuthatch-indexer.com';
const routes = ['/', '/install', '/changelog', '/example', '/stories', '/roadmap', '/nests', '/mirror', '/manifesto', '/the-graph', '/platform', '/blog', '/docs', '/subgraphs', '/rotki', '/count', '/play/', '/play/build/'];

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  }));
  return nested.flat();
}

// Hosted dataset pages are built from src/data/hosted.ts; read their ids rather than import TypeScript.
const hostedSource = await readFile(join(root, 'src/data/hosted.ts'), 'utf8');
for (const [, id] of hostedSource.matchAll(/^    id: '([^']+)',$/gm)) routes.push(`/nests/hosted/${id}`);

const docsRoot = join(root, 'src/content/docs');
const docs = await markdownFiles(docsRoot);
for (const file of docs) {
  routes.push(`/docs/${relative(docsRoot, file).split(sep).join('/').replace(/\.md$/, '')}`);
}

// Local, static documentation search. The client fetches this only when a reader searches, so the
// feature adds neither a third-party service nor a client-side framework.
const readField = (frontmatter, field) => {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, 'm'));
  return match?.[1] ?? '';
};
const searchEntry = (source, href) => {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title: readField(frontmatter, 'title'),
    description: readField(frontmatter, 'description'),
    href,
    text,
  };
};
const searchIndex = await Promise.all(docs.map(async (file) =>
  searchEntry(await readFile(file, 'utf8'), `/docs/${relative(docsRoot, file).split(sep).join('/').replace(/\.md$/, '')}/`)
));
await writeFile(join(root, 'public/docs-search.json'), `${JSON.stringify(searchIndex)}\n`);

// The same index for the blog, in its own file: the docs sidebar search reads only the one above,
// and the command palette reads both.
const blogRoot = join(root, 'src/content/blog');
const blogIndex = [];
for (const file of await markdownFiles(blogRoot)) {
  const source = await readFile(file, 'utf8');
  if (!/^draft:\s*true\s*$/m.test(source)) {
    const route = `/blog/${relative(blogRoot, file).replace(/\.md$/, '')}`;
    routes.push(route);
    blogIndex.push(searchEntry(source, `${route}/`));
  }
}
await writeFile(join(root, 'public/blog-search.json'), `${JSON.stringify(blogIndex)}\n`);

const urls = [...new Set(routes)].sort((a, b) => a.localeCompare(b));
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((route) => `  <url><loc>${site}${route}</loc></url>`).join('\n')}\n</urlset>\n`;
await writeFile(join(root, 'public/sitemap.xml'), xml);
console.log(`wrote sitemap with ${urls.length} URLs`);
