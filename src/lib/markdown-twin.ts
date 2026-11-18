// The .md twin of a docs page or blog post (#2980): the same Markdown source the HTML page is
// rendered from, served at the page's path plus `.md` for agents that read Markdown better than a
// rendered page. Built from the collection entry at build time, so it cannot drift from the page.

export const SITE = 'https://nuthatch-indexer.com';

// The docs sidebar groups, in order. DocsLayout renders the sidebar from these and /docs.md lists
// the twins from them, so a page appears in both or neither.
export const DOCS_GROUPS = [
  { dir: 'start', label: 'Start here' },
  { dir: 'concepts', label: 'Concepts' },
  { dir: 'build', label: 'Build a nest' },
  { dir: 'operate', label: 'Operate' },
  { dir: 'errors', label: 'getLogs errors' },
  { dir: 'reference', label: 'Reference' },
  { dir: 'ai', label: 'AI-native' },
  { dir: 'contributing', label: 'Contributing' },
  { dir: 'book', label: 'Read the book' },
];

// The twin URL of a docs or blog page path, e.g. `/docs/ai/mcp/` -> `/docs/ai/mcp.md`.
export function twinPath(path: string): string {
  return `${path.replace(/\/+$/, '')}.md`;
}

// Site-relative links point at the twin of a docs or blog page and at the absolute URL of anything
// else, so a twin read on its own, outside the site, still resolves.
function absoluteLinks(body: string): string {
  return body.replace(/\]\((\/[^)\s]*)\)/g, (_, target: string) => {
    const [path, hash = ''] = target.split(/(?=#)/);
    const twin = /^\/(docs|blog)\/[^?]+$/.test(path) ? twinPath(path) : path;
    return `](${SITE}${twin}${hash})`;
  });
}

export function markdownTwin(opts: {
  title: string;
  description?: string;
  canonical: string;
  meta?: string;
  body?: string;
}): string {
  const head = [`# ${opts.title}`, ''];
  if (opts.description) head.push(`> ${opts.description}`, '');
  if (opts.meta) head.push(opts.meta, '');
  head.push(`HTML version: ${SITE}${opts.canonical}`, '');
  return `${head.join('\n')}\n${absoluteLinks((opts.body ?? '').trim())}\n`;
}

export function markdownResponse(text: string): Response {
  return new Response(text, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
}
