// The real run of `nuthatch init` then `nuthatch dev` that the home page's terminal replays.
export type TranscriptLine = { kind: 'cmd' | 'ok' | 'serve'; text: string; pause: number };

export const transcript: TranscriptLine[] = [
  { kind: 'cmd', pause: 520, text: 'nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth --chain mainnet' },
  { kind: 'ok', pause: 140, text: 'ABI resolved via Sourcify' },
  { kind: 'ok', pause: 320, text: "scaffolded nest 'weth' (1 contract(s), 4 table(s)) in ." },
  { kind: 'cmd', pause: 520, text: 'nuthatch dev --backfill 300' },
  { kind: 'serve', pause: 160, text: 'API live on http://127.0.0.1:8288  (try GET /  and  /metrics)' },
  { kind: 'ok', pause: 160, text: 'cold start: backfilling from block 26253980 (tip 26254280)' },
  { kind: 'ok', pause: 200, text: 'caught up to tip at block 26254280 - 18726 events in 4s, 4681 ev/s; now following' },
];

export const prefix = { cmd: '$', ok: '✓', serve: '●' } as const;

