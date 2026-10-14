---
title: "Internals: how it actually works"
description: A component-by-component walk through the binary - the ingest loop, the decode registry, the two storage layers, reorg handling, the IVM core, and what changes in scaled mode.
order: 2
checked: 5.4.0
---

This is the long version, for people who need to know *why* it is safe rather than *that* it is. It
follows one log entry from an RPC response to a row someone queries, then covers what each component
refuses to do, which is usually the more interesting half.

Line counts are given as a sense of weight, not a metric. The crate's `src/` alone is about 150,000 lines of Rust.

## The shape of it

```text
                        ┌─── one cursor per chain ───────────────────────┐
   eth_getLogs ───►  ingest ──► decode ──► hot store ──► seal ──► segments
                        │        registry     (redb)     past      (Parquet,
                        │                        │      finality    immutable)
                        │                        │                     │
                        │                        └──► IVM circuit      │
                        │                             (DBSP)           │
                        └────────────────────────────────┬─────────────┘
                                                         ▼
                                       serve: point-reads from redb,
                                       analytical SQL from Burrmill over
                                       segments ∪ tip, MCP over the same
```

The whole design turns on one split: **the hot store is mutable and the cold store is not.** Every
other guarantee is downstream of it.

## Ingest - `rpc.rs`, `indexer.rs`

`indexer.rs` is the loop that makes it alive: poll logs, decode, store, and serve concurrently. One
process, one cursor, one observable failure boundary.

`rpc.rs` is a deliberately thin JSON-RPC client - `eth_blockNumber`, `eth_getLogs`, block headers,
and `eth_call` - with round-robin failover across the configured endpoints and per-endpoint health
tracking. Two behaviours are worth calling out because they were both learned the hard way:

**Failures are classified, not merely retried.** A rate limit, a transport blip, an oversized-range
refusal and a rejected credential are four different things. An auth rejection is cooled down loudly
rather than retried forever; a 429 escalates across the pool; an oversized range is split and retried,
taking the provider's own suggested range when it offers one. A refusal of the filter's address
list (publicnode on BSC and Polygon refuses ten or more addresses in one `eth_getLogs`) is a fifth
kind: the list is halved until the endpoint accepts it, and that group size is remembered, rather
than the endpoint being cooled down as if its credentials had been refused. An archive refusal stops
a backfill at once with a hint to supply an archive endpoint.

**A failure we cannot classify is split once anyway.** Providers phrase the same refusal a dozen ways
and invent new phrasings without telling anyone. Running Sentio's OBIB benchmark found the cost of
getting this wrong: Alchemy returns its oversized-range refusal as HTTP **400**, a status the
classifier did not enumerate, so the window was retried unchanged - forever. The benchmark did not run
slowly, it never finished. Speculative splitting means an endpoint whose phrasing we have never seen
degrades instead of hanging.

**The log window adapts.** Every provider caps `eth_getLogs` differently, most document it wrongly,
and several vary it by tier. So the window widens while an endpoint keeps up and narrows the moment it
does not - the real limit is discovered rather than configured. `nuthatch doctor` runs that discovery
on demand and reports what an endpoint will actually serve.

## Decode - `registry.rs`

`registry.rs` is a thin re-export; the decode logic lives in the `nuthatch-decode` crate under
`decode/`, so fuzz targets build without the rest of the binary. The decode registry is the
determinism boundary. Given each contract's resolved ABI, it builds one
immutable map from `topic0` → decoders, filtered by emitting address, and turns any log into a typed
row keyed to a per-`(alias, event)` table.

It is plain deterministic Rust. **No LLM is anywhere near this path**, by rule - models generate code
and tests, never runtime data.

The registry's **content hash** (a sha256 over a canonical, order-independent serialisation) is
recorded in every sealed segment's manifest and returned in query provenance. That hash is what makes
re-execution checkable: two operators indexing the same range with the same registry produce
byte-identical segments, and a query result can be traced to the exact decode that produced it.

Decodings are **versioned, never retroactive**. When an ABI improves, history is not silently
re-decoded - that would change answers under consumers who already have them.

## The hot store - `store.rs`

redb, embedded, holding the mutable tip. Five tables: `entities`, `meta`, `blocks`,
`checkpoint_hashes`, `outbox`.

Entities are keyed `{block:012}-{log_index:06}`, zero-padded so lexicographic iteration is
chain-ordered - which makes "everything above block N" a range scan rather than a filter, and that is
exactly what a reorg needs.

One honest note the module carries about itself: it used to claim a single writer, and that was
wrong. Two tasks write - the ingest loop, and the alert-delivery worker draining the outbox. They
touch disjoint key ranges and redb serialises write transactions internally, so integrity holds, but
the comment was a claim about the code that the code did not honour. It now says what is true.

## Sealing - `seal.rs`

Once a range is final, each table's rows in that range are written to their own content-addressed
Parquet segment - `{table}-{hash}.parquet`, or `segments/<hash>.parquet` in a runtime's shared store -
catalogued in a manifest, and then pruned from hot.

**Finality is per chain, not a constant.** `chains.rs` carries the policy as data:

| chain | finality | default `getLogs` window |
|---|---|---|
| mainnet | `Depth(64)` - 64 blocks behind tip | 20 |
| arbitrum-one | `FinalizedTag` - the node's L1-aware `finalized` tag, falling back to a depth | 2000 |
| base | `FinalizedTag`, same fallback | 1000 |

An L2 is a data entry here, not a fork of the indexer.

Sealing is where the append-only guarantee is made: **a segment is written strictly past finality, so
the columnar layer never sees a reorg.** If a change ever requires mutating a sealed segment, the
design is wrong and we go back rather than add a mutation path.

All tables in a nest seal together per finalized range, so `sealed_through` stays a single global
watermark - which is what lets hot and cold be unioned without deduplication.

## Reorgs - `store.rs::rollback_to`

A reorg only ever touches the hot store. Detection asks whether the last block we committed against
is **still canonical** - the `blocks` table stores each block's hash, so `detect_reorg` re-checks that
hash against the chain and walks back to find the common ancestor. Recovery is `rollback_to(block)`,
a range delete above the fork point inside one write transaction, which is exactly the operation the
zero-padded key ordering makes cheap.

Because sealing is strictly past finality, there is no ordinary case where a reorg reaches a segment.
A reorg *below* `sealed_through` is a finality violation this model cannot repair - the doomed blocks
are already in immutable segments and pruned from hot, so a retraction would be silently incomplete
and the two layers would permanently disagree. So it **bails** rather than quietly rewriting history,
and that nest stays down until an operator looks at it rather than being backed off and re-admitted.

One detail worth having, because it was a real blind spot: if a boundary's hash could not be stored,
treating "no hash here" as "nothing to verify" would skip the check entirely. It walks to the nearest
stored checkpoint instead.

Random reorg depths are property-tested to converge on canonical chain state.

## Derived state - `views.rs`, `exposure.rs` (DBSP)

The differentiator, and it is real rather than aspirational: derived entities are **incremental views
maintained by DBSP circuits**, not hand-written update logic.

Nobody writes "on transfer, load balance, add, save". Balance is stated as `Σ(in) − Σ(out)` and the
circuit maintains it. The payoff is that **a reorg is a retraction** - the same circuit that consumes
a `+1` delta consumes a `−1`, so rollback correctness is a property of the engine rather than of
remembering to write the inverse of every handler.

Counterparty exposure (the compliance path) is a second circuit over the same facts.

## Query - `analytics.rs`, `serve.rs`

Two surfaces over the same data.

**Point-reads** come from redb directly - entity by id, balances, flags. Cheap, no SQL engine
involved.

**Analytical SQL** runs on [Burrmill](https://github.com/nuthatch-org/burrmill), an embedded engine
on DataFusion. A session opens empty and registers, for each table a statement binds, the segment
list and the hot rows staged for it, so the ingestion path never writes to the engine.

`analytics.rs` keeps every policy decision - the read-only gates, the allowlist walk, the deadline -
and Burrmill sits behind the engine trait (`engine.rs`) in `engine_burrmill.rs`. DuckDB sat there
until 4.1, and a `shadow-burrmill` feature ran the two side by side before the cutover
([Replacing DuckDB, after all](/blog/replacing-duckdb-after-all)).

The union is exact **without deduplication**, and that is structural rather than careful: cold
includes only segments at or below `sealed_through`, hot only rows above it. The two sets cannot
overlap, even during the brief window between sealing and pruning.

Results carry **provenance**: the `as_of` and `sealed_through` watermarks, the nest's `nid` and
`registry_hash`, each referenced entity's watermark, and `source`, which is `hot+sealed` normally and
`sealed` when the tip could not be scanned and the answer is cold-only. A number can be cited and
re-derived. It names the dataset and the cut, not the individual segments.

Answers are remembered by `sqlmemo.rs`, and the memo is not a TTL cache. Its key is every input the
answer depends on: the statement and its row cap, the sealed segments it is served, a generation that
moves only when a commit changes hot rows, each entity's watermark, and the authored files. A cursor
poll that commits no rows leaves the key alone, so a quiet nest at the tip answers a repeated
statement from memory (`"cached": true`), and a degraded answer is never remembered. It is bounded
by `NUTHATCH_SQL_MEMO_BYTES` (64 MiB by default, `0` turns it off) and cleared by a restart.

`/sql` is a genuine analytical surface exposed to callers, so it is guarded: a 30-second timeout, a
50,000-row cap, a 64 MiB result ceiling, 2 concurrent analytical queries, a 16 KiB query-length limit,
and a refusal past 2,000,000 unsealed tip rows. That last one **refuses rather than truncating**,
because a partial tip silently changes the answer to an aggregate, and a wrong number is worse than an
error.

Two controls stop `/sql` touching the filesystem, deliberately with different failure modes - see
[security](/docs/operate/security/).

## Factories - `factory.rs`

Uniswap-class protocols are unindexable without dynamic data sources: the children do not exist when
you write the config. A *factory* watches an event (`PoolCreated`) and indexes the child it announces
under a *template* ABI, into shared `{template}__*` tables.

Each window asks for logs by the factory and child addresses, in the backfill, the tip loop and a
runtime's cursor alike, until 500 children have been discovered. Past that the fetch flips to
topic0-only and discards non-children locally, so N children cost roughly one child's RPC budget
rather than N. A chain whose shipped endpoint refuses address-less `eth_getLogs` (BSC) keeps asking by
address past 500, and an endpoint that refuses a topic0-only fetch at runtime switches the cursor to
addresses.

## Packaging - `blob.rs`, `distribution.rs`

A nest's *authored inputs* - config, ABIs, views, labels, skills - canonicalise into a **bundle**
pinned by a Merkle root. `nest load` verifies the manifest, every file's bytes, and that the decode
registry regenerated from those inputs matches the author's pinned hash. A nest that cannot reproduce
its own registry is refused.

That makes a bundle **tamper-evident**, which is not the same as safe - a valid bundle can still
declare outbound endpoints you would rather it did not, so `load` warns about every non-loopback URL
and ranks link-local/metadata addresses at `error`.

A registry (a directory, or any S3-compatible bucket) adds `publish`/`pull` by `name@version`.

## The runtime - `runtime.rs`

One runtime, many nests, **one isolated cursor per distinct chain**. Nests on the same chain share a
cursor and one `getLogs` per window - N nests for roughly one nest's RPC cost - with per-nest
namespaced stores.

The law: **a cursor is always single-chain, single-writer, one observable failure boundary.** Two
chains are never multiplexed behind one cursor. A second chain means a second cursor.

The RAM budget is **≤2 GB per active-chain cursor**, CI-enforced. A mount whose projected footprint
would exceed it is refused with a `507` rather than admitted with a warning - a budget that can be
quietly exceeded is not a budget.

A faulting nest is **quarantined**, not fatal: its healthy siblings keep indexing and serving, and it
is re-admitted on a backoff if the fault was retryable. Blast radius is bounded in both directions - 
a nest's error no longer kills its cursor, a cursor's death no longer kills the runtime.

## What changes in scaled mode - `pgstore.rs`, `worker.rs`, `scheduler.rs`, `controlplane.rs`

The same business logic, pointed at different substrates behind a `HotStore` trait. There are no
`#[cfg]` forks of the pipeline; it is a role flag, and it is opt-in at build time so the default
binary carries no database driver.

- **`pgstore.rs`** - the same `HotStore` contract over Postgres.
- **`controlplane.rs`** - *desired state*. What should run, not what does.
- **`scheduler.rs`** - placement, written as a **pure function** of `(workers, desired nests, current
  assignments)`. No database, no clock, no network, because placement is where the interesting
  mistakes live - double assignment, silent under-scheduling, churn - and none of them need
  distribution to reproduce.
- **`worker.rs`** - the reconcile loop: heartbeat, take a lease per assigned cursor, index what it
  holds, pull from the registry what it does not have.

**Ownership is enforced by the store, not by agreement.** Every write carries a fence; a stalled
worker that wakes to find its lease reassigned has its writes *refused* inside the same transaction as
the write. That is what makes `--scale writer=N` safe. The worker does not lean on the fence alone:
each tick takes what it holds from the leases it actually renewed or acquired, never from memory, and
stops ingesting a cursor whose lease was taken on that tick while its other cursors carry on.

The control plane and the lease are **deliberately independent**: a control-plane outage stops
*rescheduling*, not *ingestion*. Measured - 377 blocks indexed through a 90-second outage.

Scaled mode is younger than embedded and has not carried a production workload for anyone. Until
v0.9.3 the writer pool took leases and ran no indexing at all; see
[verifying a deployment](/docs/operate/verifying/) for what that cost and how it is checked now.

## Where to start reading

`indexer.rs` for the loop, `registry.rs` for what makes it deterministic, `store.rs` and `seal.rs` for
why a reorg cannot corrupt history. The design record is in the
[RFCs](/docs/contributing/rfcs/) - numbered, and honest about what was wrong.
