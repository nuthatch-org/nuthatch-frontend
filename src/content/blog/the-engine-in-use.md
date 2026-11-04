---
title: "The engine in use: what the first real page had to work round"
date: "2026-11-04"
description: "The first page built on nuthatch's embeddable engine needed five workarounds. Four are now fixed in the engine: the slowest cold open went from 1,995 s to 107 s, two nests answer one statement, the host is one file, and any client can check a hosted answer against the chain. The fifth I decided against, and Safari still has not run it."
author: "cargopete"
tags: ["nuthatch", "webassembly", "embedding", "verification", "lodestar", "the-graph", "rust"]
---

> **Update, 4 November, later the same day.** Lodestar can now be verified. Its nest's exact files are
> published as the [`production` branch](https://github.com/nuthatch-org/graph-allocations-nest/tree/production)
> of graph-allocations-nest, and they compute the NID its answers name. Its SQL route now screens
> statements with the same DuckDB dialect the node parses, so the lambdas are no longer refused. All four
> portfolio statements answer through it, and `verify` with those files found 38 of 38 columns equal
> against the production node. The post below is kept as written.

The [last post](/blog/nuthatch-as-a-wasm-blob/) ended with a list of what the embeddable engine did not
do yet, and a table whose slowest row read **1,995 seconds**. That row was a wallet with shares in one
of The Graph's largest delegation pools, opened from cold on a free public RPC. Thirty-three minutes is
the kind of number that makes you close the browser tab and go for a walk, which is roughly what a
visitor would have done.

The page in question is "Verify it locally" on [Lodestar's `/profile`](https://www.lodestar-dashboard.com/profile).
It was the first thing anyone built on the engine rather than on a spike, and its author, who is also
the engine's author, still had to work round the engine in five places. RFC-0081 took those five and
asked for each to be fixed in the engine, not in the next page that embeds it. The test for every
change was the same: **the next embedder writes less code than this page did, and gets an answer it can
trust further.** Four of the five are done and shipped in 5.17.0. I declined the fifth.

## Most of the cold open was other people's data

The slow part was never the wallet. It was the delegation pools of the wallet's indexers, which are the
same rows for every visitor and are already sealed in a nest whose dataset sits on the public mirror.
The page was fetching them log by log from an RPC that throttles, because the engine could open a nest
from a mirror or from an RPC, but not from both.

The plan was a selective read: fetch only the Parquet row groups that hold the wallet's indexers. **The
first spike killed it.** The fifteen pool tables are 1,995 segments, each with exactly one row group, and
min/max statistics admitted 1,949 of them, because an indexer column is random hex and any segment with
a few dozen indexers spans nearly the whole range. Even a perfect index would have saved little: 1,891
segments held a row of the wallet's three indexers at all, since active indexers appear in almost every
block range. Making reads selective would mean reordering sealed data, and the sealed format is not
something a browser convenience gets to change.

So the hybrid open reads **whole segments of the tables the filters name**: 179.4 MiB from the mirror,
then the wallet's own logs and the tail since the mirror's end from the RPC. On the page, in headless
Brave on the same public endpoint:

| | Mirror | RPC requests | Time |
|---|---|---|---|
| 31 October, RPC only, the slowest wallet | 0 bytes | 11,566 | 1,995 s |
| 1 November, hybrid, first visit | 179.4 MiB | 690 | 107 s |
| 1 November, hybrid, second visit | 0 bytes | 4 | 6 s |

The seven wallets of the original gate gave the same 409 figures as the server, none differing. On a
second visit the stored pack is reused after every segment is hashed against its content address, which
took 1.7 s for the 2,000 of them in Node.

**Privacy is the reason the rule is "tables, never values".** What the mirror is asked for is chosen
from the filters' events, never from a filter's value, so no request to a public server names the
wallet or its indexers. Filters are private by default, and a private filter on a mirrored nest is
refused by name before anything is fetched. A test checks that two opens differing only in the
wallet fetch exactly the same URLs.

## Two nests, one statement

The wallet nest and the pools nest were two separate instances, and the page joined them by writing the
pools' rows into the wallet's SQL as literal values. Wide integers had to go in quoted and cast, because
the engine quite rightly refused a bare 256-bit number that "would be read as a float", and one statement
hit `/sql`'s 16,384-byte cap.

`attach` binds another instance's Arrow answer, with its envelope, under a name for one statement. It is
refused by name if that answer was truncated or comes from another block, so two nests can never be
joined across a moment that did not happen. The statement that hit the cap is 5,726 bytes now, and it
reads `pools.indexers` instead of a wall of `VALUES`.

## The host is one file

Lodestar had vendored the module and two host scripts by shell script, and written its own worker,
batching for arb1's ten-request limit and error carry-over. That is the code every embedder would
otherwise write again.

`nuthatch-engine.js` is that code, released beside the module: one ES module, 29,298 bytes (9,895
gzipped), no dependencies, working the same in a browser and in Node. It owns the worker, the store
(OPFS, memory or a directory), retries, batch splitting and throttle pacing. Lodestar's engine-hosting
code fell from 233 lines to 132. The [example in the repository](https://github.com/nuthatch-org/nuthatch/blob/main/docs/examples/engine-defi-pulse.mjs)
opens defi-pulse-nest from the public mirror in 29 lines and gives the same answer as the 5.16.0
binary seeded from the same mirror.

## Checking an answer you did not compute

GraphOps raised the one that was not on the page's list. A hosted nest's `/sql` answer already names
its dataset (`provenance.nid`) and its block (`as_of`), which is everything a client needs to check it,
and nothing let a client do so. Lodestar's page had rebuilt that check by hand for one set of queries.

`Engine.verifier().verify(answer, statement, filters)` opens the nest that answer names, at that block,
from files the caller brings and that must compute that NID, runs the same statement and compares column
by column. Each column comes back equal, differs (with both values), or not computable, named. Against
a 5.16.0 node serving graph-allocations-nest, the seven wallets' four portfolio statements were **266 of
266 columns equal**. With a proxy in front of the node changing one value, the result named that column
alone, with the host's figure and its own.

The part that took thought is a statement that reads beyond what the client fetched: every delegation
on the network, say, when the client holds one wallet's. That must be reported as outside the filters,
never as a mismatch. It must also be decided without trusting the server, or a lying server could
launder a wrong answer as "outside". So the rule is local: a statement naming a table no filter covers
is outside; and on a hybrid nest the statement is run twice, through the filters and over the whole
hydrated tables, and if the two differ, it is outside.

**What it cannot check yet is Lodestar itself.** Lodestar's public SQL route refuses two of the four
statements, because its screening parser cannot read a lambda, and it answers under a NID that none of
the published commits of its nest computes. The production directory differs in files that do not
touch the data, which is enough to fail a check that hashes every file, and `verify` refuses it by name
before making a request. The measurement above used a stand-in node seeded from the public mirror. The
checker works; the thing it was built to check needs tidying first.

## Catching an RPC that leaves a log out

The previous post admitted that a narrowed nest trusts its RPC, and that **an RPC which omits a log is
not caught.** A narrowed nest makes that sharper: it asks for few logs, so one missing is a large share
of the answer.

With `complete: true` under a verified head, the engine tests each block header's `logsBloom` against
the filters. Where the bloom admits a filter and the RPC returned nothing, it fetches the block's
receipts, rebuilds the receipt trie and compares its root with the header's `receiptsRoot`. An omitted
log is recovered; a forged receipts list stops sealing, by name. No new dependency: the trie is about
120 lines.

It does not come cheap on mainnet. Blooms there are mostly full, so a range of 1,894 blocks fetched 966
blocks' receipts, about 1 GB, and took 17 s against 1.4 s without the check. It also does not catch a
partial omission, one of a block's two matching logs, and a log's transaction hash remains the RPC's
word.

## Where it still stops

- **Arbitrum's head is still the RPC's.** The verified head comes from a light client of mainnet's
  beacon chain, and Arbitrum's finality is an assertion on L1 that settles after about a week. I decided
  a head a week old was not worth the work, so on Arbitrum, Lodestar's page included, the engine trusts
  its RPC, and the page says so.
- **Safari and phones have not run it.** Firefox now passes the same 13 chain shapes and the same kill
  and reopen as Chrome, in CI. Safari's driver needs an administrator to switch it on, and that has not
  happened.
- **Reuse is per pool set.** A different wallet, or the same wallet in a new pool, fetches the 179 MiB
  again. Sharing the pack between stores is not built, and old stores are not cleaned up.
- **The wasmtime host** now answers mirror fetches and seals under a verified head, but a Python embedder
  such as rotki is still waiting on the address build, which stays parked until rotki asks for it.

## Try it

- [Lodestar's `/profile`](https://www.lodestar-dashboard.com/profile): connect a wallet and turn on
  "Verify it locally". It runs on the host package in production.
- [`nuthatch-engine.js` and `nuthatch-events.wasm` on the v5.17.0 release](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.17.0),
  each with its SHA-256 and build attestation.
- [The 29-line example](https://github.com/nuthatch-org/nuthatch/blob/main/docs/examples/engine-defi-pulse.mjs),
  which opens a published nest from the mirror and queries it.
- [RFC-0081](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0081-the-engine-in-use.md),
  with each slice's measured outcome in §11 to §16, including the spike that killed the selective read.
