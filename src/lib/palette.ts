import { getCollection, render } from 'astro:content';
import { hosted } from '../data/hosted';

export type PaletteKind = 'page' | 'doc' | 'section' | 'post' | 'nest';

export interface PaletteItem {
  kind: PaletteKind;
  title: string;
  url: string;
  /** The second line of a row. Matched, at a lower weight than the title. */
  note: string;
  /** The mono label on the right: a docs group, a date, a status. */
  tag?: string;
  /** Other words for the same thing. Matched, never shown. */
  also?: string;
}

// Pages that are neither a doc, a post nor a nest. Notes are each page's own description, cut down.
const PAGES: Omit<PaletteItem, 'kind'>[] = [
  { title: 'Install', url: '/install', note: 'One-line installer, prebuilt binaries, container images, or cargo', also: 'download setup binary docker' },
  { title: 'Documentation', url: '/docs', note: 'The golden path, every component, and guides for building and operating nests', also: 'docs guides' },
  { title: 'Book', url: '/docs/book', note: 'A guided tour of how Nuthatch turns chain logs into durable, queryable data' },
  { title: 'Worked example', url: '/example', note: 'Index USDC from its contract address, then choose a view or an entity', also: 'tutorial usdc' },
  { title: 'Nests', url: '/nests', note: 'The catalogue of prebuilt indexing definitions', also: 'catalogue registry' },
  { title: 'Mirror', url: '/mirror', note: 'Seed a nest from published history instead of an RPC backfill', also: 'seed backfill snapshot download' },
  { title: 'Blog', url: '/blog', note: 'Field notes from running Nuthatch in production', also: 'posts news' },
  { title: 'Stories', url: '/stories', note: 'Who runs Nuthatch: app backends, analysts and agents', also: 'use cases personas' },
  { title: 'Roadmap', url: '/roadmap', note: 'What is shipped, in progress and planned', also: 'rfcs plans' },
  { title: 'Manifesto', url: '/manifesto', note: 'Why Nuthatch is deterministic, free and permissively licensed' },
  { title: 'Nuthatch & The Graph', url: '/the-graph', note: 'A network for indexed data and a binary that produces it', also: 'horizon subgraph' },
  { title: 'Hosting', url: '/subgraphs', note: 'We port a subgraph to a nest and host it on request, with no billing and no accounts', also: 'hosted subgraphs stopgap' },
  { title: 'rotki', url: '/rotki', note: 'Account history for rotki from your own machine', also: 'address history etherscan' },
  { title: 'Changelog', url: '/changelog', note: 'Every published release, newest first', also: 'releases versions' },
  { title: 'Head count', url: '/count', note: 'How many people said yes to being counted', also: 'telemetry count' },
];

/** Everything the palette matches by name. The full text is a separate, larger file. */
export async function paletteIndex(): Promise<PaletteItem[]> {
  const docs = (await getCollection('docs')).sort((a, b) => a.id.localeCompare(b.id));
  const docItems: PaletteItem[] = [];
  const sections: PaletteItem[] = [];
  for (const doc of docs) {
    const url = `/docs/${doc.id}`;
    const group = doc.id.includes('/') ? doc.id.split('/')[0] : undefined;
    docItems.push({ kind: 'doc', title: doc.data.title, url, note: doc.data.description, tag: group });
    const { headings } = await render(doc);
    for (const h of headings) {
      if (h.depth !== 2 && h.depth !== 3) continue;
      sections.push({ kind: 'section', title: h.text, url: `${url}#${h.slug}`, note: doc.data.title, tag: group });
    }
  }

  const posts: PaletteItem[] = (await getCollection('blog', ({ data }) => !data.draft))
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
    .map((p) => ({
      kind: 'post',
      title: p.data.title,
      url: `/blog/${p.id}`,
      note: p.data.description,
      tag: p.data.date.toISOString().slice(0, 10),
      also: p.data.tags.join(' '),
    }));

  const nests: PaletteItem[] = (await getCollection('nests')).map((n) => ({
    kind: 'nest',
    title: n.data.name,
    url: `/nests#nest-${n.id}`,
    note: n.data.summary,
    tag: n.data.status,
    also: `${n.id} ${n.data.category} ${n.data.chains.join(' ')}`,
  }));

  const hostedItems: PaletteItem[] = hosted.map((h) => ({
    kind: 'nest',
    title: h.name,
    url: `/nests/hosted/${h.id}`,
    note: h.summary,
    tag: h.status,
    also: `hosted ${h.kind} ${h.chains.join(' ')}`,
  }));

  return [
    ...PAGES.map((p) => ({ kind: 'page' as const, ...p })),
    ...docItems,
    ...sections,
    ...posts,
    ...hostedItems,
    ...nests,
  ];
}
