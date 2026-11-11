// What the public mirror holds for each published nest, read at build time from the same index
// /play reads. A page built from this is a snapshot: it says when it was taken and links to Play,
// which reads the mirror live. A failed fetch fails the build, as the catalogue's does.
const PLAY_INDEX = 'https://nuthatch-play.vercel.app/nests.json';
// The mirror's Worker refuses requests with no browser-like agent.
const HEADERS = { 'user-agent': 'curl/8 (nuthatch-frontend build)' };

export interface MirrorTable { name: string; segments: number; rows: number; from: number; to: number }
export interface MirrorView { path: string; text: string; names: string[] }
export interface Published {
  nest: string;
  repo: string;
  commit: string;
  dataset: string;
  views: MirrorView[];
  tables: MirrorTable[];
  segments: number;
  rows: number;
  /** Highest block any sealed segment reaches; null when the mirror holds no segment yet. */
  sealedThrough: number | null;
}

interface Segment { rows: number; from_block: number; to_block: number }

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`mirror fetch failed: ${res.status} ${res.statusText} (${url})`);
  return (await res.json()) as T;
}

async function load(): Promise<Published[]> {
  const index = await json<{
    base: string;
    nests: Array<{ nest: string; repo: string; commit: string; dataset: string; views: Array<{ path: string; text: string }> }>;
  }>(PLAY_INDEX);
  return Promise.all(
    index.nests.map(async (n) => {
      const manifest = await json<{ tables: Record<string, Segment[]> }>(`${index.base}/${n.dataset}/manifest.json`);
      const tables = Object.entries(manifest.tables)
        .map(([name, segs]) => ({
          name,
          segments: segs.length,
          rows: segs.reduce((a, s) => a + s.rows, 0),
          from: segs.length ? Math.min(...segs.map((s) => s.from_block)) : 0,
          to: segs.length ? Math.max(...segs.map((s) => s.to_block)) : 0,
        }))
        .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
      const sealed = tables.filter((t) => t.segments > 0);
      return {
        nest: n.nest,
        repo: n.repo.replace(/\/$/, ''),
        commit: n.commit,
        dataset: n.dataset,
        views: n.views.map((v) => ({
          ...v,
          names: [...v.text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]),
        })),
        tables,
        segments: tables.reduce((a, t) => a + t.segments, 0),
        rows: tables.reduce((a, t) => a + t.rows, 0),
        sealedThrough: sealed.length ? Math.max(...sealed.map((t) => t.to)) : null,
      };
    }),
  );
}

let cached: Promise<Published[]> | undefined;
export function published(): Promise<Published[]> {
  return (cached ??= load());
}

export const sameRepo = (a: string | undefined, b: string) => !!a && a.replace(/\/$/, '') === b;
