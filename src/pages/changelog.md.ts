import type { APIRoute } from 'astro';
import { releases } from '../data/releases';
import { markdownResponse, markdownTwin } from '../lib/markdown-twin';

// The changelog's Markdown twin is rendered from the same generated release data as its HTML page.
export const GET: APIRoute = () => {
  const entries = releases.map((release) =>
    `## v${release.version}\n\n${release.date}\n\n${release.headline}\n\n[Full release notes](${release.url})`,
  );
  return markdownResponse(
    markdownTwin({
      title: 'Nuthatch changelog',
      description: 'Every published Nuthatch release, newest first.',
      canonical: '/changelog',
      body: entries.join('\n\n'),
    }),
  );
};
