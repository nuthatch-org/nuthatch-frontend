// Stopgap nests: subgraphs The Graph network does not serve, answered from a nuthatch nest until an
// indexer allocates. One entry per deployment; the page at /subgraphs/<deployment> is built from it.
export interface Example { title: string; query: string; variables?: string }
export interface Stopgap {
  deployment: string;
  name: string;
  coverage: string;
  repository: string;
  chain: string;
  since: string;
  lastActivity: string;
  record: string;
  entities: string[];
  refused: { field: string; why: string }[];
  examples: Example[];
}

export const ENDPOINT_BASE = 'https://subgraphs.nuthatch-indexer.com/subgraphs/id/';

export const stopgaps: Stopgap[] = [];
