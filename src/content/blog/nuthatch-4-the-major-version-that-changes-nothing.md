---
title: "Nuthatch 4.0: the major version that changes nothing"
date: "2026-10-01"
description: "Nuthatch 4.0.0 is 3.13.3 plus three small fixes. The number is a promise about what later releases will not do to you: what it covers, what it leaves out, and how much of it a test enforces."
author: "cargopete"
tags: ["nuthatch", "release", "stability", "semver", "indexing", "rust"]
---

Nuthatch 4.0.0 is out, and there is no headline feature in it. It is 3.13.3 plus three fixes, the
largest of which adds 306 lines. There is no storage migration, no configuration change, no NID change
and no re-index: replace the binary and restart.

**The major version is a promise about what happens next, not a claim about what changed.** From
4.0.0 to the last 4.x release, your config keeps its meaning, your data directory opens in place, and
the HTTP, SQL and MCP surfaces do not lose anything you have wired up. The rest of this post is what
that covers, what it leaves out on purpose, and how we found out the week before that our own README
did not work.

## Why 3.x could not make this promise

Between 29 August and 30 September we tagged 29 stable 3.x releases. That is a pace suited to finding
defects and unsuited to being depended upon, and the record shows it. During 3.x a minor release
refused a config an earlier one had accepted (3.1.0, 3.9.0), required a nest to be indexed again
(3.7.0, 3.8.0), and moved `POST /_admin/nests` from `200` to `202` (3.13.0). Each was a correctness
fix and each was named in its notes, but each is also something a stability table reserves for a
major.

There was a table. Through the whole of 3.x it still said `2.x` at the top, because nobody retargeted
it when 3.0 was cut. A promise addressed to the previous major is not much of a promise.

## What 4.x promises

Three things, from 4.0.0 to the last 4.x:

1. **Config keeps working.** A `nuthatch.toml`, `mounts.toml` or `entities.toml` that works on a 4.x
   release works on every later one, with the same meaning.
2. **Data directories upgrade drop-in.** A later 4.x opens a directory written by an earlier 4.x in
   place. No re-index, no re-seal, no migration command.
3. **The HTTP, SQL and MCP surfaces do not break.** No route, response field, generated table or
   column, or MCP tool is removed, renamed or retyped.

The cadence changes to match. A released 4.x gets only patches, and a patch only fixes. Features wait
for the next monthly minor: 4.1, 4.2 and so on. Correctness and security fixes ship at once. A
deprecation is announced at least one minor ahead, removal comes no sooner than 90 days after that,
and the removal itself waits for 5.0.

One exception is written down rather than left to habit: **a correctness fix is not a break, even
where an answer changes.** If a config was accepted and silently produced wrong data, a patch may
refuse it at startup and say what to change. The release notes name every such case.

## What it does not promise

A vague promise is worse than a narrow one, so the exclusions are in the operator guide in full. The
ones most likely to matter:

- **Downgrades.** The promise runs forwards. A later 4.x may update the on-disk format as it opens a
  directory, and an earlier 4.x is not promised to read the result. Copy the directory first if you
  want a way back.
- **Off-by-default cargo features.** `graph`, `folds`, `counter`, `exex` and `shadow-burrmill` are in
  none of the published binaries or images, and may change in any release.
- **The SQL dialect.** The tables and columns are ours and are covered. The functions and the planner
  behind `/sql` are DuckDB's, and a DuckDB upgrade ships in a minor with a note.
- **Segment hashes across `arrow-rs` versions.** Sealed segments stay readable and are never
  rewritten; compare decoded rows, not hashes.

## How much of it a test enforces

Part of it, and the operator guide says which part.

`tests/upgrade_golden.rs` copies a runtime directory written by v3.13.2 and never regenerated: two
mounts of one dataset, a hot store and one sealed segment. It opens the copy with the current build
and checks exact values: both mount records, the NID recomputed from the stored nest, the segment's
hash, the hot rows, `/sql` over sealed and hot rows, `/entity` point reads and an authored entity. Then
it indexes two more blocks and seals. Renaming a redb table or changing the NID derivation turns it
red, and it runs in the required CI job. The fixture is 3.6 MB on disk and about 7 KB in git. Each 4.x
minor adds its own directory beside it.

**What no test enforces yet:** the fixture is one ERC-20 nest, so factories, contract calls, `[[ipfs]]`
and offchain data have no frozen store behind them. There is no golden of HTTP response shapes beyond
the fields that test reads, and none of MCP tool arguments. Until there is, those rest on a checked
compatibility section in each release's notes, which is a practice and not a mechanism.

## The README demo indexed nothing

The fix that held the release up is the embarrassing one. Before telling anybody about 4.0 we ran the
README's four commands on two clean machines, macOS arm64 and Linux x86_64, on 3.13.3. Install took
seconds, `init` took about twenty, `dev` ran, and `SELECT count(*) FROM usdc__transfer` returned 0.
On both.

`init` records a contract's deployment block, and `dev` backfills from it. For USDC that is block
6,082,465, some 20 million blocks behind the tip. Of the two public endpoints we bundle for mainnet,
one no longer keeps history that old and the other caps `eth_getLogs` at 50 blocks and rate-limits.
Worse, when every endpoint failed the log reported only the last one's error, so a pruned node's
refusal hid the throttle behind it and nothing told the reader what to supply. `init` had in fact
already printed a warning that USDC's early history would decode to zero rows under the current
implementation's ABI, which nobody following a four-line demo was going to read.

4.0.0 names a pruned endpoint and the remedy (#1608), and the demo now starts 300 blocks behind the
tip (#1611). When a full history is long, `init` prints the near-tip command beside the plain one, and
`dev` logs the span it is about to attempt. Measured on 1 October 2026, from an empty directory on
one MacBook against the bundled endpoints: the old demo, built from main before the fix, had 0 rows
after 122 seconds. The published 4.0.0 binary had 10,665 rows eight seconds after `dev` started and
was following the tip within 30. That is one run of each, not a benchmark, and a public endpoint
having a worse afternoon will stretch it.

The full history of a busy contract still wants your own archive-capable RPC. The demo no longer
pretends otherwise.

## Columns now arrive in the order you asked for

`nuthatch sql "SELECT 1 AS z, 2 AS a, 3 AS m"` printed `a | m | z`. A query for `count`, `min` and
`max` came back as `hi | lo | n`, which read at first glance as a minimum larger than its maximum.
Rows passed through a JSON object with sorted keys, and every renderer took its columns from those
keys. The CLI and the MCP SQL tool now keep the query's order, and a `/sql` response gains a `columns`
array (#1610). That is an added field, which is the only kind of change the promise above allows.

## Try it

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48 --alias usdc
nuthatch dev --backfill 300
```

Then, in a second terminal:

```sh
nuthatch sql "SELECT count(*) FROM usdc__transfer"
```

Upgrading from 3.13.x is a binary swap. Coming from an earlier 3.x, read the compatibility section of
each release in between. The
[release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v4.0.0) carry the short form
and the [stability contract](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md#stability-contract)
the long one.
