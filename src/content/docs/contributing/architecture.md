---
title: "Architecture"
description: "The pipeline, storage, the IVM core, and the module map."
order: 1
checked: 5.5.0
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
  → sealed Parquet segments       (immutable, content-addressed, past finality)
  → IVM views                     (incrementally-maintained derivations, e.g. balances)
  → serve                         (axum HTTP + the MCP bridge)
```

The load-bearing properties:

- **Determinism in the core.** Decode, reorg handling, and anything feeding stored state is
  deterministic and re-executable - same inputs, same bytes. LLMs may generate code and tests;
  LLM output never sits in the runtime data path.
- **Single writer.** Only the ingestion thread writes. The analytical engine only reads the sealed
  segments and the hot rows; never design around a second writer.
- **The hot/cold seam.** Reorgs only ever touch the hot store; a sealed segment is immutable and
  content-addressed. The `/sql` surface unions both so queries never see the seam.
- **The footprint budget.** ≤2 GB RAM per active-chain cursor, CI-enforced. A design that
  threatens it must surface the tradeoff first.

## The module map

The crate is a library (`lib.rs`) so a second front-end - notably a colocated reth-ExEx build
(RFC-0003) - can reuse the same core rather than fork it; the `nuthatch` binary is one front-end,
and both drive the pipeline through the `Source` trait (`source.rs`).

- **Ingest & decode**: `rpc` (batched extraction, failover, the adaptive getLogs window), `chunker`,
  `abi`, `chains`, `factory` (dynamic child discovery), `registry` (the decode registry, re-exported
  from the `nuthatch-decode` crate in `decode/`), `indexer` (the loop), `progress`.
- **Storage**: `store` (redb hot store), `seal` (Parquet segments), `blob` + `distribution`
  (content-addressed bundles and the nest registry), `publish` + `seed` (mirroring sealed segments to
  a bucket, and filling a nest from one).
- **Derivation & query**: `views` (the DBSP IVM core, e.g. balances), `entities` (authored
  incremental entities), `recipes`, `analytics` (read-only SQL over hot ∪ sealed, and authored SQL
  views), `sqlmemo` (the `/sql` answer cache, keyed on the rows and segments a statement reads),
  `engine` + `engine_burrmill` (the engine trait, with Burrmill behind it), `serve` (the HTTP
  surface), `sql_errors` (errors-as-prompts).
- **Subgraph porting**: `subgraph_import` (`init --from-subgraph`), `port_emit` + `port_report` (the
  per-field coverage report), `graph_schema` + `graph_query` (the Graph-dialect GraphQL read surface,
  routed only in a `--features graph` build, which each release ships as `nuthatch-graph-<target>`).
- **Meaning & agents**: `semantic` (the governed semantic layer), `mcp`, `skill` (the generated
  CLI reference), `metadata`.
- **Compliance**: `labels`, `lists`, `flags`, `velocity`, `exposure`, `alerts`, `webhooks`, `pack`,
  `audit`, `sealed_audit`.
- **Lifecycle & ops**: `config`, `project` (init/add/scaffolding), `lifecycle` (the
  compatible-vs-breaking classifier), `migrate`, `prune`, `runtime`, `metrics`, `bench`, `check`,
  `cli`.

## Where to start reading

`CLAUDE.md` states the non-negotiables every change is judged against (single static binary; the
2 GB budget; no phone-home; determinism; MIT OR Apache-2.0). The [RFC series](/docs/contributing/rfcs/) is
the design record - each module's header comments name the RFC that shaped it. The release notes in
`docs/releases/` say what each version changed.
