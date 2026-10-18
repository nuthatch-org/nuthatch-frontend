// The public mirror's figures, read at build time like the nest catalogue. A visitor's browser never
// talks to the bucket; it only gets the commands that will. A dataset that cannot be read renders
// without figures rather than failing the build, because the mirror is optional and the site is not.
import config from '../data/mirror.json';

export interface MirrorEntry {
  nest: string;
  repo: string;
  dataset: string;
  commit: string;
  /** The nest's directory in its repository, when the repository holds more than one. */
  path?: string;
  devArgs?: string;
  note?: string;
  chainId?: number;
  indexedFrom?: number;
  completeThrough?: number;
  publishedAt?: string;
  tables?: number;
  segments?: number;
  rows?: number;
  error?: string;
}

export const mirrorBase: string = config.base;
export const mirrorLive: boolean = config.live;

async function read(path: string): Promise<unknown> {
  const url = `${config.base.replace(/\/$/, '')}/${path}`;
  if (url.startsWith('/') || url.startsWith('file:')) {
    const { readFile } = await import('node:fs/promises');
    return JSON.parse(await readFile(url.replace(/^file:\/\//, ''), 'utf8'));
  }
  const res = await fetch(url, { headers: { 'user-agent': 'nuthatch-frontend build' } });
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return res.json();
}

export async function mirrorEntries(): Promise<MirrorEntry[]> {
  return Promise.all(
    config.datasets.map(async (d): Promise<MirrorEntry> => {
      if (!config.base || !d.dataset) return { ...d };
      try {
        const [publish, seed, manifest] = (await Promise.all([
          read(`${d.dataset}/publish.json`),
          read(`${d.dataset}/_seed/seed.json`),
          read(`${d.dataset}/manifest.json`),
        ])) as [
          { chain_id: number; published_at: string; tables: string[] },
          { indexed_from: number; complete_through: number; tails: Record<string, { rows: number }> },
          { tables: Record<string, Array<{ rows: number }>> },
        ];
        const sealed = Object.values(manifest.tables).flat();
        const tails = Object.values(seed.tails);
        return {
          ...d,
          chainId: publish.chain_id,
          indexedFrom: seed.indexed_from,
          completeThrough: seed.complete_through,
          publishedAt: publish.published_at,
          tables: publish.tables.length,
          segments: sealed.length + tails.length,
          rows: [...sealed, ...tails].reduce((n, s) => n + s.rows, 0),
        };
      } catch (e) {
        return { ...d, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
