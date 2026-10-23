---
title: "We were asked to write a JIT, and wrote a batch size instead"
date: "2026-10-23"
description: "An outside note asked whether a Cranelift query JIT would make Burrmill beat DuckDB, and told us to measure first. We measured. The part a JIT could compile is 12-20% of the time; the part nobody had looked at was a 128-row batch that cost every production view twice its time. This is what we found, what we shipped in nuthatch 5.10.0, what we tried that did nothing, and what the release gate caught on the way."
author: "cargopete"
tags: ["nuthatch", "burrmill", "datafusion", "performance", "profiling", "rust"]
---

*On 22 October someone handed us a long, well-sourced research note titled "A Cranelift Query JIT for
Burrmill: Design Space, Evidence, and Whether It Beats DuckDB". Its answer to its own question was
"probably not by much", and its first recommendation was to profile before writing a line of compiler.
That is good advice, and it is also the kind of advice that is easy to nod at and skip. We did not skip
it. Two days later nuthatch 5.10.0 is running on every production nest we operate, the JIT is still not
written, and the allocations nest answers its dashboard in a little over half the time it did on 5.8.2.*

---

## The note set its own threshold, so we held it to it

The note's argument was Amdahl's: a JIT can only speed up the stage it compiles. If filter plus
aggregate is under about 30% of wall time, even an infinitely fast JIT is worth at most 1.4x, and
hand-specialised Rust kernels would take most of that anyway. It cited the evidence well. Kersten et
al. found compiled and vectorised engines within 74% and 32% of each other on TPC-H depending on the
query; DataFusion shipped a Cranelift JIT in 2022 and removed it in 2023 because it could not inline
Rust and ran slower than the code it replaced.

So the question became a measurement. We ran `perf` over the nine heaviest views of Lodestar's
allocations nest, on the ThinkPad that holds a 1,925-segment copy of it, and bucketed every sample by
what it was doing: decoding Parquet, casting text to integers, evaluating expressions, aggregating,
sorting, moving memory.

**Everything a JIT could compile (the casts, the expressions, `LOWER`, and the arithmetic half of
aggregation) came to 12-20% of self-time on every view.** At a generous 2x on that stage, the whole
statement gets 6-11% faster. Moving and comparing memory took 18-32%, sorting up to 18%, Parquet decode
9-15%. The text-to-`i128` parse the note expected to dominate was 4-9%.

The JIT went back where RFC-0044 had already put it, under non-goals, this time with numbers.

## The real cost was a number nobody had questioned since 2 October

The profile above was taken the way every Burrmill profile had been taken: `Engine::open_nest`, eight
threads, DataFusion's default 8,192-row batches. Nuthatch never runs that path. It always opens Burrmill
with a memory budget, and under a budget the session read **128 rows at a time**.

That 128 came from nuthatch #1650, an honest bug: a `repeat('A', 100000)` over eight thousand rows built
an 819 MB Arrow batch before the result cap ever saw a row. Shrinking the batch bounded it. It also,
quietly, made every ordinary view pay per-batch overhead 64 times as often. Measured on the same copy at
2 GB and two threads, warm medians:

| view | 128 rows | 2,048 rows | 8,192 rows |
|---|---|---|---|
| `lodestar_indexer_ledger` | 2,765 ms | 1,419 ms | 1,431 ms |
| `lodestar_indexer_deployment_daily` | 5,049 ms | 2,759 ms | 2,646 ms |
| `lodestar_network` | 6,605 ms | 3,239 ms | 3,176 ms |
| `lodestar_delegator_stakes` | refused for memory | 2,174 ms | 1,987 ms |

**1.7-2.1x on every heavy view, at two threads and at eight, and 2,048 rows recovers all of it.** That is
DuckDB's vector size, and #1650 had itself named it as the size that was fine. At 128 rows the allocator
alone was 17% of the profile; the per-row cost had been replaced by a per-batch one. The fix was one
line in `session.rs`.

It was not quite one line. A sort that spills to disk merges one run per batch it holds, and with
bigger output batches the merge's cursors grew until a 32 MB test refused. The sort's input is now
gathered into runs of 65,536 rows or 8 MiB, and the test passes with either bound halved. That one
came out of the test suite, which is what the test suite is for.

## Then we went through the rest of the list, and most of it did nothing

With the batch fixed we profiled again at the shape production runs, and worked down what was left.
This is the part of the post where the honest thing is a table of things that did not help.

| lead | share of samples | what we did | what it bought |
|---|---|---|---|
| Zero-filled read buffers in `object_store` | 3.2% | A local store that reads into uninitialised memory; `memset` fell to 0.04% | Nothing measurable: 955 ms against 942 on the ledger, interleaved A/B on a quiet box |
| glibc's allocator | 12% | The bench now uses jemalloc, as nuthatch does | 3-6% of wall time; allocation stayed about 11% of samples either way |
| The allocator's callers | 5.7% of a 3 kHz DWARF profile | Looked for one site to fix | None above 2%. The largest piece is freeing Arrow buffers. Closed |
| Planning | 2% per statement | Considered a plan cache | Would not hit: the dashboard's literals vary. Closed |
| Address columns as text | about 10% | Made them 20-byte binary inside the plan | Shipped. Next section |

The reader taught us the lesson worth keeping. Its 3.2% was real self-time, and removing it changed
nothing, because reads run on Tokio's blocking pool beside the two compute threads and are not on the
statement's path. **A share of samples is not a share of the wall clock.** We now A/B any lever that
claims a percentage, interleaved, before landing it. The branch was deleted with its result written
down.

## An address is twenty bytes, so it now is

Every join, sort and group key on the allocations views is an address, and nuthatch writes addresses as
`0x` and forty hex characters. That is 42 bytes of text holding 20 bytes of information, and every copy
between operators moved the 42.

Burrmill's analyzer now decodes a declared `address` column to `FixedSizeBinary(20)` above the scan and
keeps it binary through equality, joins, `GROUP BY`, `ORDER BY`, `min`, `max` and window partitions.
Byte order and lower-case hex order agree, so ordering answers do not change. Anywhere text is wanted
(`||`, `LIKE`, `substr`, a cast to `VARCHAR`, a union with a text column) the address becomes its text
again, and the host sees the text it wrote. A literal of either case compares as an address, and
filters still reach the Parquet reader as text so segment statistics prune exactly as before.

Interleaved A/B, 2 GB and two threads:

| view | text | binary |
|---|---|---|
| `lodestar_network` | 1,914 ms | 1,721 ms |
| `lodestar_delegator_stakes` | 1,560 ms | 1,496 ms |
| `lodestar_indexer_ledger` | 925 ms | 923 ms |

The ledger did not move; its heavy work is keyed on other columns. `lodestar_network`, which groups and
joins on addresses more than anything, gained 10%. The number we had not predicted was memory: **the
allocations copy's peak under the release gate fell from 1,227 MiB to about 950**, which matters more on a
2 GB budget than the milliseconds do. All 22 Lodestar views returned byte-identical answers to DuckDB.

## The release gate caught what the benchmark could not

The first nuthatch candidate with the new Burrmill passed its own 2,709 tests and then failed the
release gate on three of the 75 statements Lodestar sends: a panic inside DataFusion's repartition,
`partition not used yet`. A shared subquery too big to hold in the pool was being re-run by each reader
on the same plan instance, and a repartition runs once. The benchmark never saw it because it had the
memory pool to itself, so the subquery always fitted. The fix, and a test that reproduces the panic,
went in the same afternoon.

The address work then passed Burrmill's suite, the 22-view parity check and the gate, and still broke
four tests in nuthatch's CI that run only with the `graph` feature over the network nest. They walk
shapes the gate's query set does not have: a recursive CTE whose work table kept the parser's text type,
a correlated subquery whose outer reference did the same, a pushed filter that two planner passes
disagreed about, and an older fault where a page's `LIMIT` could cancel a shared subquery's first reader
and leave the next one running a consumed plan. All four are fixed with tests. Nuthatch's own fixtures
write addresses like `0xa`, which is not an address, so the engine also learned to notice that, switch
itself back to text, and answer anyway.

We list these because the order matters. **Each layer of checking found something the one before it
could not**, and none of it reached production.

## What actually shipped, and the one thing we got wrong on the way

Nuthatch 5.10.0 went out on 23 October. It also carries `nuthatch watch` (RFC-0069), which is its own
story. Before rolling, we found that the gate had compared the release against 5.9.0, the latest
release, when production was running 5.8.2: its copies had been frozen since the Helsinki nests stopped
on 13 October, and nobody had unfrozen them when the nests came back. We re-gated against 5.8.2, restored
the live copies, and restarted a gate timer that had quietly stopped.

Against 5.8.2, on production's budget:

| | 5.8.2 | 5.10.0 |
|---|---|---|
| allocations nest, p99 over 75 statements | 2,638 ms | 1,489 ms |
| QoS nest, p99 over 9 statements | 2,262 ms | 1,471 ms |
| allocations nest, peak RSS (2 GB budget) | | 1,026 MiB |
| answers different from 5.8.2 | | 0 of 117 |

Those p99s cover everything between 5.8.2 and 5.10.0, not only this work; three weeks of other Burrmill
changes are in there too. All six production nests were rolled the same day, each passing its smoke
statements. The release also needed one lockfile change on the morning it shipped, because a
Windows-only clipboard crate under our line editor had been yanked overnight.

## What we would still like to fix

- **The 7-9% text cast.** Values are sealed as decimal text and parsed on every query. Storing them as
  integers at seal time would remove it, but that changes the segment format and needs its own RFC.
- **512 MB without spill.** The ledger and `lodestar_indexers` now refuse at 512 MB with no spill
  directory, where they once answered. Holding shared subqueries is now charged to the pool honestly,
  and honest accounting does not fit. Production runs at 2 GB with spill, so nothing in service is
  affected, but nuthatch's default of 512 MB is wrong for this family of views.
- **The JIT.** Still not written. If the stage it compiles ever reaches the 30% its own advocate asked
  for, we will measure it again.

The full profile, every A/B and the transcripts are in Burrmill's repository under
`docs/research/replacing-duckdb/where-the-time-goes.md` and `addresses-as-fixed-binary.md`.
