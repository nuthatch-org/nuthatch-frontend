// Hosted datasets: address-free data we publish so a user's own nest can skip the work of building it.
// Listed first on /nests; the page at /nests/hosted/<id> is built from each entry.
export type HostedStatus = 'available' | 'building';

export interface HostedAction { action: string; what: string }

export interface Hosted {
  id: string;
  name: string;
  kind: string;
  status: HostedStatus;
  chains: string[];
  summary: string;
  /** Where it is published, as the bucket and prefix a reader can recognise. */
  location: string;
  /** The public base URL a nest points at; empty until it is published. */
  url: string;
  coverage: string;
  partition: string;
  /** The nuthatch.toml table a nest declares to use it. */
  config: string;
  verified: string[];
  privacy: string;
  answers: HostedAction[];
  limits: string[];
  record: string;
}

// R2's development URL is rate-limited; move to a custom domain before real traffic.
export const ADDRESS_HISTORY_URL = 'https://pub-bc282d5016f242a783a6c28cbcd4401a.r2.dev';

export const hosted: Hosted[] = [
  {
    id: 'ethereum-address-history',
    name: 'Ethereum address history partitions',
    kind: 'Block partitions',
    status: 'building',
    chains: ['ethereum'],
    summary:
      'Verified block partitions for Ethereum mainnet: full headers and withdrawals, 10,000 blocks to a file. A nest that tracks an account’s history reads them instead of fetching every header from its own RPC.',
    location: 'nestsss / address-history/v1/1/',
    url: ADDRESS_HISTORY_URL,
    coverage: 'Ethereum mainnet from the Shanghai upgrade (block 17,034,870) onward',
    partition: '10,000 blocks per file, listed in manifest.json',
    // Keys match MirrorConfig on nuthatch pete/rfc-0063-slice2 (deny_unknown_fields); recheck when it merges.
    config: `[address_history.mirror]
url = "<mirror url>"     # the mirror's root; the nest adds address-history/v1/<chain>/
chain_id = 1
from_block = 17030000   # the range to read from the mirror, in whole partitions
to_block = 26159999
cache_mb = 2048         # local disk the fetched partitions may use`,
    verified: [
      'Every header in a partition is hashed locally and must equal the hash the next header names as its parent, so a partition is one unbroken chain.',
      'Each block’s withdrawals are checked against the withdrawalsRoot its header commits to.',
      'The chain of headers is anchored to a finalized block your own RPC reports. A partition that does not link to it is refused, never served.',
    ],
    privacy:
      'The mirror sees what any file server sees: your IP address and which block ranges you asked for. It never sees an address. The accounts you watch stay in your nest, on your machine.',
    answers: [
      { action: 'block/getblocknobytime', what: 'the block closest before or after a timestamp, from the headers' },
      { action: 'account/txsBeaconWithdrawal', what: 'validator withdrawals to an address, from the block bodies (EIP-4895)' },
      { action: 'account/getminedblocks', what: 'the blocks an address produced as fee recipient, from the headers' },
    ],
    limits: [
      'Ethereum mainnet only, and only from the Shanghai upgrade: blocks before it carry no withdrawals. The L2s follow, one chain at a time.',
      'No uptime promise, no account and no key. A partition is only ever an input your nest checks; nothing in it is served unverified.',
      'It holds headers and withdrawals only. An account’s transactions, transfers and traces are found by your nest, against your RPC, and are never hosted.',
    ],
    record: 'https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0063-address-history.md',
  },
];
