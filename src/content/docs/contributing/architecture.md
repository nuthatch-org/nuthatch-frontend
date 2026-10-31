---
title: "Architecture"
description: "The pipeline, storage, the IVM core, and the module map."
order: 1
checked: 5.15.0 (2026-10-31)
---

One codebase, two modes. **Embedded mode** (the default, and the product) is a single process with
zero external services. **Scaled mode** swaps the storage backends behind the same crates for
operator-run deployments (RFC-0022 - built, and verified across real machines, though younger than
embedded). Everything below describes embedded mode.

This page is the map. For the component-by-component walk - what each part refuses to do, and why a
reorg cannot reach sealed history - see [Internals](/docs/contributing/internals/).

## The pipeline

```text
RPC ingestion                     (a colocated reth ExEx mode is designed, not built, RFC-0003)
  → deterministic decode          (ABI → typed rows; the decode registry)
  → redb hot store                (the mutable tip: entity point-reads, reorg rollback)
      ├→ IVM views                (incrementally-maintained derivations, e.g. balances; fed as rows
      │                            arrive, retracted on a reorg, never waiting for sealing)
      └→ sealed Parquet segments  (immutable, content-addressed, past finality)
  → serve                         (axum HTTP + the MCP bridge, over IVM state, hot and sealed)
```

The load-bearing properties:

- **Determinism in the core.** Decode, reorg handling, and anything feeding stored state is
  deterministic and re-executable - same inputs, same bytes. LLMs may generate code and tests;
  LLM output never sits in the runtime data path.
- **Single cursor.** Exactly one cursor per chain decides that chain's position, finality and reorgs.
  In a runtime since 5.14.0 it is one extraction stage feeding a window buffer, read by one ingest
  task per nest, each the only writer of its own dataset; a lone nest runs one loop. Other tasks do
  write redb (the alert worker drains the outbox; the IPFS resolver stores a document only while the
  row that named it is still there), but none of them advances the chain. Queries only read: the
  analytical engine reads the sealed segments and the hot rows, and only ingestion writes segments.
- **The hot/cold seam.** Reorgs only ever touch the hot store; a sealed segment is immutable and
  content-addressed. The `/sql` surface unions both so queries never see the seam.
- **The footprint budget.** ≤2 GB RAM per active-chain cursor, CI-enforced. A design that
  threatens it must surface the tradeoff first.

## The module map

The crate is a library (`lib.rs`) so a second front-end - notably a colocated reth-ExEx build
(RFC-0003) - can reuse the same core rather than fork it; the `nuthatch` binary is one front-end,
and both drive the pipeline through the `Source` trait (`source.rs`).

- **The core crate**: `core/` (`nuthatch-core`, since 5.14.0, RFC-0075) holds a nest's window path,
  reorg rollback, the redb hot store, the DBSP circuits (`views`, `exposure`, `velocity`, `flags`,
  `labels`, the `entity_*` modules) and the bodies of the query routes, over traits a node and a
  browser tab both implement. The binary re-exports what it uses from it.
- **Ingest & decode**: `rpc` (batched extraction, failover, the adaptive getLogs window), `chunker`,
  `abi`, `chains`, `factory` (dynamic child discovery), `registry` (the decode registry, re-exported
  from the `nuthatch-decode` crate in `decode/`), `indexer` (the loop; `indexer/buffered` is a
  runtime's buffered cursor, since 5.14.0), `progress`.
- **Storage**: `store` (the node's redb hot store, the core's store with the follower feed behind
  it), `seal` (Parquet segments), `blob` + `distribution` (content-addressed bundles and the nest
  registry), `publish` + `seed` (mirroring sealed segments to a bucket, and filling a nest from one).
- **Derivation & query**: `entities` (authored incremental entities), `recipes`, `analytics`
  (read-only SQL over hot ∪ sealed, and authored SQL views), `sqlmemo` (the `/sql` answer cache, keyed
  on the rows and segments a statement reads), `engine` + `engine_burrmill` (the engine trait, with
  Burrmill behind it), `serve` (the HTTP surface), `cost` (the `Nuthatch-Cost` report), `limits`
  (per-mount query limits), `isolation` (strict tenant isolation), `admin_token` (the admin credential
  a localhost nest makes for itself, since 5.11.0), `sql_errors` (errors-as-prompts).
- **Followers**: `feed` and `feed_http` (the writer's hot-state feed and the follower that reads it,
  since 5.13.0); since 5.14.0 `feed_wire` (feed v2, Arrow IPC frames), `feed_metrics` (visibility lag
  and feed cost) and `remote_follow` (a follower on another host, from the mirror and the registry).
- **Subgraph porting**: `subgraph_import` (`init --from-subgraph`), `port_emit` + `port_report` (the
  per-field coverage report), `graph_schema` + `graph_query` (the Graph-dialect GraphQL read surface,
  routed only in a `--features graph` build, which each release ships as `nuthatch-graph-<target>`).
- **Meaning & agents**: `semantic` (the governed semantic layer), `mcp`, `skill` (the generated
  CLI reference), `metadata`.
- **Compliance**: `labels`, `lists`, `flags`, `velocity`, `exposure`, `alerts`, `webhooks`, `pack`,
  `audit`, `sealed_audit`.
- **Maintained views & diff**: `maintained` (stored copies of declared views, keyed by every input
  they read), `diff` + `story` (`nuthatch diff`: a transaction, block or range told by fixed rules
  over the served rows, no model).
- **Address history**: `address_mode` and the `address_*` modules (a nest with `[address_history]`
  and no contracts: its own cursor and an Etherscan-shaped `/api`, sharing nothing with the event
  pipeline above), `address_history` (its config, including the deposit sweep).
- **Lifecycle & ops**: `config`, `project` (init/add/scaffolding), `lifecycle` (the
  compatible-vs-breaking classifier), `migrate`, `prune`, `runtime`, `metrics`, `bench`, `check`,
  `cli`.
- **Shared crates**: `decode/`, `identity/`, `scaffold/` and `seal/` are separate crates so the
  browser playground and nest builder compile the same decode, identity, `init` and sealing code to
  WebAssembly and produce the same bytes a node does; `timelapse/` replays sealed history as frames.
- `watch/` (`nuthatch watch`, RFC-0069, since 5.10.0): a read-only terminal view of a running
  nest.

## Where to start reading

`CLAUDE.md` states the non-negotiables every change is judged against (single static binary; the
2 GB budget; no phone-home; determinism; MIT OR Apache-2.0). The [RFC series](/docs/contributing/rfcs/) is
the design record - each module's header comments name the RFC that shaped it. The release notes in
`docs/releases/` say what each version changed.
