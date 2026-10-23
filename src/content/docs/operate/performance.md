---
title: "Performance"
description: What has been measured, what has not, and the three things that actually decide your backfill's wall clock.
order: 12
checked: 5.9.0 (2026-10-23)
---

## The number

We ran **someone else's** benchmark rather than writing one that flattered us: Sentio's
[OBIB](https://github.com/sentioxyz/open-blockchain-indexer-benchmark). Case 6 is the Uniswap V2
factory over 10,001 mainnet blocks (19,000,000 to 19,010,000): `PairCreated` discovering children and
`Swap` on each child, `block_timestamps = false`, write-only, no serving.

| | |
|---|---|
| wall clock | **5.9 s**, the median of five runs (5.4, 6.6, 6.3, 5.9, 5.5) |
| events | **35,271** in every run: 35,039 `Swap`, OBIB's expected count exactly, plus 232 `PairCreated` |
| children discovered | **232** |
| RPC requests | **14** |
| peak RSS | **241 MB** |

The published 4.10.1 binary on 2026-10-05, against Tenderly's keyless public gateway (no key, no
account), on an 18-core Apple M5 Pro laptop, `--seal-direct`, adaptive window, one fetch at a time.
Re-runnable with `nuthatch bench backfill --from 19000000 --to 19010000 --runs 5 --seal-direct` on
[`nuthatch-org/obib-case6`](https://github.com/nuthatch-org/obib-case6); the 4.7.0 run on the same
machine and endpoint, 4.7 s, is
[recorded in the repo](https://github.com/nuthatch-org/nuthatch/blob/main/docs/bench/obib-case6-4.7.0-tenderly-2026-10-05.md).

**The record count matching Sentio's is the part worth trusting.** A fast indexer that quietly drops
events is not fast, it is wrong, and an event count agreeing with an independent implementation is a
much stronger signal than a stopwatch.

This proves that one fixed workload completed correctly under those conditions. It does not prove a
general seal-direct or pipeline multiplier.

## The multiplier we do not quote

The project previously published about **8.7x** for seal-direct and **20x** for seal-direct plus the
pipeline. Their denominator came from an older benchmark harness which wrote one redb transaction
and one fsync per row, unlike the real indexer. Reusing that `289 events/sec` baseline after the
harness was fixed made the ratios invalid.

Fresh public-RPC measurements did not settle the question. One run put seal-direct at **0.92x** the
hot-store path, contradicting both the architecture and a **5.2x** run measured hours earlier at the
same commit lineage. Another session varied by **3.8x inside one arm**. Those numbers describe the
endpoint, machine contention, and workload as well as the code. That is why the bench can take the
network out: `nuthatch bench backfill --record <tape>` records every RPC call a run makes, and
`--replay <tape>` runs the same range from disk. No storage-path multiplier is published here until
it has been re-measured that way.

The invariant remains tested: hot-store, seal-direct, and pipelined paths produce byte-identical
sealed segments for the same inputs. That is a correctness claim, not a throughput claim.

## It did not finish at all before v0.9.0

Worth stating plainly, because it is the reason we now run outside benchmarks.

Alchemy returns its oversized-range refusal as HTTP **400**. Our status classifier did not enumerate
400, so it fell through to `Transient` - which meant the window was retried **unchanged**, forever.
Case 1 (`Transfer` from LBTC across 22.2M Ethereum blocks) never completed. Our own test suite was
green throughout, because every fixture returned the error shape we had thought to write down. It now
completes with the record count Sentio publishes, 294,278 events; the timings this page once quoted
for it came from an Alchemy account that has since closed, so they are withdrawn rather than repeated
([#1844](https://github.com/nuthatch-org/nuthatch/issues/1844)).

That is the whole argument for benchmarking against a real provider instead of a mock: mocks return
the failures you imagined.

## What actually decides your wall clock

Not CPU. Nuthatch is round-trip bound on ordinary workloads, and three things dominate:

### 1. `block_timestamp` - most of the RPC cost, if you let it

Timestamps require block headers for event-bearing blocks. On a measured set of real backfills they
accounted for roughly 80% of provider compute units. Partial batch responses are divided and retried;
since 2.7.0 the top-level halves descend concurrently rather than serially, reducing retry storms on
very long ranges. The header work itself remains.

They are now **demand-driven**: a nest that never asks a time-series question does not pay. Drop the
column at scaffold time with `init --no-timestamps`. Since 3.11 the timestamp is taken from the log's
own `blockTimestamp` wherever the node supplies it, and a header is fetched only for a block whose logs
lack it: the same 20,000-block Sepolia backfill paid 4,444 `eth_getBlockByNumber` on 3.9.0 and 34 after.

This is an **init-time** decision, deliberately not a flag you can flip: changing it later is a
breaking schema change and a full re-index. Blocks give you ordering; only timestamps give you time.
If you are unsure, keep them - the default is on for a reason.

### 2. The log window, and whether it fits your provider

Every provider caps `eth_getLogs` differently, most document it wrongly, and several change it by
tier. So nuthatch **adapts**: it widens while an endpoint keeps up and narrows the moment it does not,
discovering the real limit rather than trusting a config value.

Check an endpoint before you trust a backfill to it:

```sh
nuthatch doctor --rpc https://your-endpoint.example --address 0xADDR
```

It reports the largest window the endpoint will actually serve, its batch limit, and whether it has
archive history - measured against that endpoint, not read from its documentation. For a configured
nest, pass `--dir`; since 2.7.0 the probe uses the full declared contract set rather than measuring
only its first address.

### 3. Your endpoint

The shipped free public endpoints exist so `init` → `dev` works with zero setup. They are rate-limited,
shared, and frequently lack archive history. A deep backfill on one will crawl or stop. `--rpc` is
repeatable and nuthatch round-robins with per-endpoint health tracking, so two or three endpoints buy
failover as well as throughput.

## Footprint

**≤2 GB RAM per active-chain cursor**, enforced in CI rather than aspired to. A runtime's total is the
sum of its cursors, and a nest whose projected footprint would exceed the budget is **refused** at
mount with a `507` rather than admitted with a warning.

Two measurements bound it. CI's footprint job fails a build whose peak RSS passes 256 MB indexing a
fixed 8,004-row fixture. The release gate serves a copy of the largest nest we run, the Lodestar
allocations nest, under its production limits and runs the 74 statements its consumers send, two at a
time as production runs them; 4.4.0 peaked at 1,595 to 1,788 MiB over four runs on Linux, and a peak
over 2 GiB fails the gate ([release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v4.4.0)). Most of that is
analytical SQL, not indexing. The 241 MB in the OBIB run above is a full-throttle backfill.

## Query speed, and the engine question

Analytical queries run on [Burrmill](https://github.com/nuthatch-org/burrmill), a Rust engine on
DataFusion, over sealed Parquet segments and the hot tip. Until 4.1 they ran on DuckDB. How that
changed is below.

DataFusion - one Arrow-native, pure-Rust engine across both modes - has been the recorded *direction*
since RFC-0013, gated on a benchmark. We ran the gate rather than arguing about it, on the fold that
matters (a signed 128-bit aggregate over a string-typed `uint256` column):

| rows | DuckDB | DataFusion | ratio |
|---|---|---|---|
| 2 M | 41 ms | 76 ms | 1.85× |
| 8 M | 95 ms | 244 ms | 2.57× |
| 20 M | 229 ms | 606 ms | 2.65× |

Each size was run twice with the engine order reversed, because whichever goes first warms the page
cache. Results were **identical** at every size, in both orders - correctness was never the question.

What failed the gate is that the gap **widens with segment size**, and segments only grow. So in
August DuckDB stayed in both modes: measure-then-switch worked, and the measurement said don't.

In September that was reversed, and 4.1.0 (2026-10-02) shipped Burrmill as the only engine. The
change was not made for speed: measured on a production nest on 2026-10-01, Burrmill takes about
2.5× DuckDB's time per statement and needs more memory for the same joins. What it buys is one
language in the binary and exact arithmetic that refuses rather than wraps. See
[Replacing DuckDB, after all](/blog/replacing-duckdb-after-all).

## A repeated statement

`/sql` remembers answers. A statement whose inputs have not changed is answered from memory, marked
`"cached": true`, and never stale: the key is the statement, its row cap, the authored files and the
rows and segments it reads, so a committed row or a newly sealed segment in a table it reads means the
next request computes. Since 4.11.0 the key covers only what the statement reads, not every cursor
poll, so a quiet nest at the tip answers a repeat from memory. The 4.11.0
[release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v4.11.0) measured a repeated
`bets` query on the BetSwirl stopgap nest at 10.4 s before and 3 ms after; the memo does nothing for
the first run of a statement. The memo is bounded by `NUTHATCH_SQL_MEMO_BYTES` (default 64 MiB, `0`
turns it off), lives in the process and is cleared by a restart. Statements that call `now()`,
`random()` and the like are never remembered.

For a first request, since 4.14.0 a view listed in `maintained.toml` is
[maintained](/docs/book/maintaining-an-answer/): after each commit or seal at the tip, the nest
evaluates it in the background and stores the answer under `maintained/`, keyed on every input it
read. A request whose inputs hash to a stored copy reads it; one that arrives before the copy for its
inputs is built falls back to evaluating the definition, as slow as before. The memo and a maintained
copy are separate: the first remembers whole statements in memory, the second stores one view on
disk and survives a restart.

## Measuring your own

```sh
nuthatch bench backfill --from <block> --to <block> --runs 3
```

If the nest declares `[[calls]]`, also pass `--state-rpc <archive-url>`. Both the hot-store and
seal-direct arms resolve those reads in 2.7.0, and the benchmark refuses to run without the endpoint
rather than silently measuring a cheaper workload. The URL is redacted from output so a report does
not publish an API key along with the result.

Benchmarks are CI artifacts here, not blog posts. Peak RSS (one nest and a dense multi-nest runtime),
entity point-read p50 and the tip's after-seen p50 fail the build on a regression. Backfill events/sec,
total tip lag and the p99s are measured on every PR and tracked, not gated: the CI fixture could not see
a 4x decode cost ([#1723](https://github.com/nuthatch-org/nuthatch/issues/1723)).
