import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { DOCS_GROUPS, SITE, markdownResponse, markdownTwin } from '../lib/markdown-twin';

// The twin of /docs: every docs page's twin, in the sidebar's groups and order.
export const GET: APIRoute = async () => {
  const all = await getCollection('docs');
  const sections = DOCS_GROUPS.map((g) => {
    const pages = all
      .filter((d) => d.id === g.dir || d.id.startsWith(`${g.dir}/`))
      .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99))
      .map((d) => `- [${d.data.title}](${SITE}/docs/${d.id}.md): ${d.data.description}`);
    return pages.length ? `## ${g.label}\n\n${pages.join('\n')}` : '';
  }).filter(Boolean);
  return markdownResponse(
    markdownTwin({
      title: 'Nuthatch documentation',
      description:
        'Every docs page as Markdown. Each page is also served as HTML at the same path without `.md`.',
      canonical: '/docs/',
      body: sections.join('\n\n'),
    }),
  );
};
