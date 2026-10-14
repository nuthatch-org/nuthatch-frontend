---
title: "RFCs"
description: "The numbered design record - every decision, what shipped, what's deferred."
order: 3
checked: 5.3.2
---

Every non-trivial design decision in nuthatch is written down first, as a numbered RFC in
[`docs/rfcs/`](https://github.com/nuthatch-org/nuthatch/tree/main/docs/rfcs). They're numbered
in build order, each states its dependencies and what it blocks, and the status lifecycle is
**Draft → Accepted → Implemented → (Superseded / Parked)**. Statuses are reconciled against the
[release notes](https://github.com/nuthatch-org/nuthatch/tree/main/docs/releases); measured numbers
are cited, and targets are labeled as targets, never as results.

## The series

- **0001 Generalized decode & nests** *(Implemented)* - the foundation: multi-contract nests, the
  decode registry.
- **0002 The Horizon nest** *(Implemented)* - the first real-world nest.
- **0003 reth ExEx tip mode** *(Accepted; deferred)* - colocated-node ingestion. Designed, not built:
  5.0.0 removed the `exex` feature's stub, and the `Source` trait is what an ExEx source would
  implement.
- **0004 Backfill throughput** *(Implemented)* - measure first, optimise second; seal-direct.
- **0005 Release engineering** *(Implemented)* - the v0.1.0 bar and beyond.
- **0006 Grant funding** *(Withdrawn 2026-10-04)* - nuthatch takes no grants and never applied for
  one. It is a self-funded public good, maintained by one person; everything is open source.
- **0007 Launch & validation** *(Accepted; process)* - the non-engineering record.
- **0008 The compliance pack** *(Implemented)* - labels, lists, flags, exposure, alerts and the
  signed pack manifest. Live screening, its WASM component and `audit replay` were removed in 5.0.0.
- **0009 Factories** *(Implemented)* - dynamic child-contract discovery.
- **0010 Admin UI & webhooks** *(Implemented)* - ease-of-use parity.
- **0011 The graph-network nest** *(Parked after pilot)* - the wedge proven in prod.
- **0012 Multi-nest runtime & packaging** *(Implemented)* - runtimes and content-addressed bundles.
- **0013 Storage & query-engine direction** *(Closed 2026-09-08)* - the DuckDB union shipped.
  DataFusion convergence was **benchmark-gated, and DataFusion did not meet the gate**: 1.6-2.7×
  DuckDB's latency on the fold that matters, widening as segments grow, at exact result parity.
  Closed on RFC-0042's answer, keep DuckDB. That answer was reversed on 2026-09-26, and 4.1.0
  replaced DuckDB with Burrmill, on DataFusion, after a shadow period - see
  [Replacing DuckDB, after all](/blog/replacing-duckdb-after-all).
- **0014 Firehose-class extraction** *(Draft; deferred)* - traces and state diffs via ExEx.
- **0015 The delightful core** *(Implemented)* - the REPL, magical init, live feedback, `add`, the
  MCP one-liner.
- **0016 The semantic layer & agent-grade MCP** *(Implemented)* - `semantic.toml`, errors-as-
  prompts, `explain`, result shaping, resources & prompts, the eval harness.
- **0017 The builder skill** *(Implemented)* - the generated, drift-gated CLI reference.
- **0018 What a nest is** *(Closed 2026-09-08; §1 implemented, §2 retired, §3 promoted to
  RFC-0041)* - authored SQL views; the Starlark front-end, retired.
- **0019 The nest registry** *(Implemented)* - publish and pull by `name@version`, and **workers
  pull the nests they are assigned** - by content address when the fleet pins a `bundle_hash`, so
  re-tagging a version in a registry cannot change what a fleet runs.
- **0020 Nest lifecycle & the N-1 upgrade** *(Implemented)* - `diff`, hot-swap, deprecation,
  segment reuse. The resync tax, killed.
- **0021 The multichain runtime** *(Closed 2026-09-08; slice 1 shipped, live two-chain run done)* -
  one runtime, one isolated cursor per chain.
- **0022 Distributed scaled mode** *(Implemented - control plane and ingestion both)* - read/write
  planes for operators, proven across real machines including **377 blocks indexed through a
  90-second control-plane outage**. Until v0.9.3 the writer pool took leases and ran no indexing at
  all (#250); ten level-5 checks passed throughout because every one tested the control plane and
  none asserted a row appears.
- **0023 Contract state, derive-first** *(Deferred 2026-09-08, after tiers 1-3 shipped)* - the `eth_call` you don't need for most
  reads: derived-view recipes and the immutable-metadata cache (tiers 1-2), plus a pinned `[[calls]]`
  executor (tier 3, v2.6.0) for the reads that aren't derivable - `resolve_at` now has a caller,
  verified value-for-value against an archive node.
- **0024 The eth_call execution engine** *(Draft)* - a demand-driven state cache, if the residue
  demands it.
- **0025 Adaptive MCP tool advertisement** *(Implemented)* - advertise only the tools a nest can
  answer, so an agent is never handed an inert tool that returns `{"count":0}`.
- **0026 Fault quarantine & partial health** *(Implemented)* - a runtime survives its sick nests: a
  nest's error no longer kills its cursor, and a cursor's death no longer kills the runtime.
- **0027 The live runtime** *(Implemented; all 7 slices)* - mounting and unmounting nests without a
  restart, so onboarding one tenant doesn't restart every co-tenant.
- **0028 Adaptive log-range control** *(Implemented)* - a fix pack for `eth_getLogs` range control:
  classify RPC failures properly rather than retrying an auth rejection forever.
- **0029 A backfill that finishes** *(Implemented; all 5 slices)* - found by running someone else's
  benchmark, Sentio's OBIB. Case 1 did not merely run slowly, it **never finished**: Alchemy returns
  its oversized-range refusal as HTTP 400, which the classifier did not enumerate, so a window that
  needed splitting was retried unchanged forever. It now completes with the record count Sentio's own
  README gives, 294,278 events; the timings once quoted here came from an Alchemy account since closed
  and are withdrawn (#1844). The reproducible figure is OBIB case 6, on
  [Performance](/docs/operate/performance/).
- **0030 Adding EVM chains** *(Implemented)* - the registry, the endpoint bar, and Gnosis first;
  `nuthatch doctor --rpc` makes that bar self-service, and Gnosis clears it comfortably.
- **0031 Optimism and Polygon** *(Deferred 2026-09-08; Optimism implemented, Polygon shipped but not
  yet reliable)* -
  Optimism has two qualifying endpoints and its tracking issue closed clean. Polygon is registered as
  a built-in chain. As first shipped its default endpoint was not archive and failed the `getLogs`
  bar outright; #688 reordered the list to put the archive endpoint first and narrowed the window.
- **0032 The tenant runtime** *(Implemented; all 5 slices, v2.0.0)* - retires the roost: data keyed by
  content-addressed nest identity, mounts become `(tenant, NID)` records, a shared nest indexed once.
- **0033 Nest identity and derivation grafting** *(Deferred 2026-09-08; slices 1-3, 5-6
  implemented)* - edit a nest
  without re-indexing the chain behind it, via a per-derivation reuse key that sits below the NID.
- **0034 The query allowlist** *(Deferred 2026-09-08; phases 1-2 implemented)* - a bounded public SQL surface without a
  resync: named parameterised queries only, never raw SQL text.
- **0035 The 2.0 breaking surface** *(Implemented, v2.0.0)* - the roost retired, one coordinated
  migration, proven on the Lodestar production box rather than a fixture.
- **0036 Block and transaction tables** *(Deferred 2026-09-08; draft, slices 1-2 done and verified)* -
  OBIB cases 3 and 4
  turn out not to be node-gated after all. Blocks ship as their own table; top-level calls (the
  transactions slice) shipped separately under RFC-0038.
- **0037 IPFS content resolution** *(Accepted; slices 1-8 built, the last in v3.8.0)* - `[[ipfs]]`,
  a verified, content-addressed side table. CID → bytes is checked against the gateway's own answer before
  anything is trusted, not annotations-only.
- **0038 Subgraph parity** *(Implemented; all 5 slices, v2.6.0)* - parameterised calls (arguments
  drawn from the triggering row) and top-level calls decoded with no node required, measured against
  a live Uniswap V3 port: 343 swaps row-for-row identical to the gateway, 219 pools with no misses.
- **0039 The recorded tape** *(Implemented, #785)* - `bench backfill --record` / `--replay`: record RPC once and replay it from disk, so
  a storage-path multiplier can be measured without the endpoint in it.
- **0040 The freshness dial** *(Accepted)* - trade staleness for money: `--poll-interval` and
  `--finality-only` shipped in v3.5.0.
- **0041 Authored incremental entities** *(Implemented; v3.0.0)* - a nest-declared, bounded keyed
  relation maintained as blocks arrive. The alpha's real-chain soak found restart truncation,
  history-growing update cost, a pooled-connection explain leak, a 429 classification error and a
  split-lock freshness label; all are fixed in the stable release.
- **0042 Rust-native without DuckDB** *(Parked; decided 2026-08-30, keep DuckDB)* - the removal
  investigation, run to slice 6. Reversed by the Burrmill decision above, which shipped in 4.1.0.
- **0043 Lessons from Amp** / **0049 Hardening lessons from an audited pipeline** *(Reference and
  analysis)* - read against our own RFCs; neither is a decision.
- **0044 The subgraph port skill** *(Implemented in part)* - one subgraph, one nest; S1, S2 and S5
  shipped, S3 and S4 closed.
- **0045 Offchain data** *(Stage 1 implemented)* - the file drop, `nuthatch offchain`.
- **0046 x402 at the counter** *(Implemented)* - an operator's optional x402 counter, off the default
  binary (`--features counter`).
- **0047 The lakehouse pattern** *(Implemented)* - the sealed directory as a storage contract other
  engines can read.
- **0048 Pricing query access** *(Draft)* - flat pricing first, with a byte-scan admission cap.
- **0050 Robinhood Chain** / **0051 Monad** *(Implemented)* - two more built-in chains on the generic
  EVM path.
- **0052 The mirrored nest** *(Accepted; being implemented)* - `nuthatch publish` mirrors sealed
  segments to object storage for external engines.
- **0053 Graph-subgraph compatibility** *(Parked 2026-09-12)* - a partial GraphQL read surface, not a
  drop-in replacement, served only by the `graph` build. From 4.11.0 that build is a release download
  (`nuthatch-graph-<target>`) for the subgraph stopgap, which fixes what shipped and starts no new
  slices.
- **0054 The head count** *(Accepted 2026-10-08, shipped in 4.15.0)* - an opt-in ping at `init`, off
  until you say yes. The totals are at [/count](/count).
- **0055 The Dune view emitter** *(Withdrawn)* - `emit dune`, DuneSQL models over a mirrored nest.
  Shipped in 3.7.0 and removed in 4.1 with DuckDB, whose parser it depended on.
- **0056 The Dune row-insert sidecar** / **0057 Dune-assisted ingestion** *(Withdrawn)*. The three
  Dune RFCs were deleted from the tree in 5.0.0; they are readable at the
  [v4.15.2 tag](https://github.com/nuthatch-org/nuthatch/tree/v4.15.2/docs/rfcs).
- **0058 Cross-nest SQL** *(Accepted, then parked 2026-09-26 with no user)* - a declared read-only
  query across mounts in one runtime.
- **0059 Checkpointed folds** / **0060 The Network Subgraph endpoint** *(Accepted 2026-09-21, behind
  the off-by-default `folds` and `graph` features; parked in full 2026-09-26 after 0059's S3)* - what
  was built stays in the tree; nothing further is started.
- **0061 256-bit values stay decimal text** *(Accepted 2026-09-23)* - no segment-format change.
- **0062 Maintained views** *(Accepted 2026-10-07, shipped in 4.14.0; S3 and S4 not pursued)* - a
  join-heavy view answered from a stored copy of its own evaluation, reused only while every input hashes
  the same.

## Conventions

Every RFC honours the non-negotiables (single static binary, the ≤2 GB budget, no phone-home,
determinism in the core, MIT OR Apache-2.0) and carries the standard structure: Abstract, Motivation,
Goals/Non-goals, Design, Implementation, Testing, Risks, Alternatives, Open questions. Companions
in `docs/`: **backlog.md** (how to read the issue queue, which is now where everything deferred
lives, and the standing decisions behind it), **prod-readiness.md** (the bar
a release clears before it's pointed at a real workload unattended), and **releases/** (one page of
notes per version, which the statuses are reconciled against).

Proposing a change? Open a [discussion](https://github.com/nuthatch-org/nuthatch/discussions)
first; if it survives contact, it becomes the next number.
