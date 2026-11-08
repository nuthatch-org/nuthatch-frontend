// The hero's real run of `nuthatch init` then `nuthatch dev`, shared by the DOM terminal and the CRT.
export type TranscriptLine = { kind: 'cmd' | 'ok' | 'serve'; text: string; pause: number };

export const transcript: TranscriptLine[] = [
  { kind: 'cmd', pause: 520, text: 'nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth --chain mainnet' },
  { kind: 'ok', pause: 140, text: 'ABI resolved via Sourcify' },
  { kind: 'ok', pause: 320, text: "scaffolded nest 'weth' (1 contract(s), 4 table(s)): nuthatch.toml, abis/, schema.json, semantic.toml, views/, llms.txt, .claude/skills/nuthatch/" },
  { kind: 'cmd', pause: 520, text: 'nuthatch dev --backfill 300' },
  { kind: 'serve', pause: 160, text: 'API live on http://127.0.0.1:8288  (try GET /  and  /metrics)' },
  { kind: 'ok', pause: 160, text: 'cold start: backfilling from block 26253980 (tip 26254280)' },
  { kind: 'ok', pause: 200, text: 'backfilling 100.0% - block 26254306 of 26254280, 18726 events' },
];

export const prefix = { cmd: '$', ok: '✓', serve: '●' } as const;

// The CRT shows 40 columns, so each line is wrapped there, breaking at spaces and commas where it can.
export function crtRows(width = 40): { rows: string[]; pause: number }[] {
  return transcript.map((l) => {
    const lead = `${prefix[l.kind]} `;
    const cont = '  ';
    const rows: string[] = [];
    let rest = l.text;
    let head = lead;
    while (rest.length) {
      const room = width - head.length;
      if (rest.length <= room) { rows.push(head + rest); break; }
      let cut = Math.max(rest.lastIndexOf(' ', room), rest.lastIndexOf(',', room - 1) + 1);
      if (cut <= 0) cut = room;
      rows.push(head + rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
      head = cont;
    }
    return { rows, pause: l.pause };
  });
}
