---
title: Determinism
description: Decode, derivation, and reorg handling are deterministic and re-executable - LLM output never sits in the data path.
order: 5
checked: 5.11.0 (2026-10-23)
---

Determinism is a non-negotiable in nuthatch's core, not a nice-to-have. Anything that feeds stored state
- ABI decoding, entity derivation, reorg handling - must be **deterministic and re-executable**: the
same inputs at the same block always produce the same output, on any machine, on any run.

## Why it matters

- **Verifiability without heavy machinery.** Because everything is re-executable, you verify a nest by
  *re-running* it - no TEE attestation, no zk proofs. Verifiability = deterministic re-execution of pure
  logic plus content-addressed segments. Nothing heavier.
- **Content-addressing works.** A sealed segment is a `sha256` over its bytes; determinism is what makes
  the same range yield the same hash wherever the same release seals it. That's the basis for a
  verifiable shared cache. The Parquet bytes carry the writer's version, so a release that moves the
  writer can hash identical rows differently: across versions, compare decoded rows, not hashes.
  Older segments stay readable and need no resealing.
- **Reorgs become retractions.** A deterministic derivation can be *un-applied* - a reorg re-feeds the
  same facts with negative weight and the state converges. Non-determinism would make that impossible.

## Where the line is drawn

- **ABI decoding** - deterministic Rust, topic0-keyed, versioned (history is never retroactively
  re-decoded).
- **Entity derivation** - incremental views over decoded events (DBSP/IVM), and SQL views evaluated
  over the same stored rows.
- **Contract state** - where nuthatch *derives* a read (see [Recipes](/docs/build/recipes/)) it's pure
  SQL over indexed events, no fetch at all. Token metadata (`decimals`/`symbol`/`name`) is
  pulled once and cached, since it never changes. Mutable state comes only through declared
  [`[[calls]]`](/docs/build/contract-calls/), each an `eth_call` pinned to a block number, sampled
  every N blocks or triggered by a row, so its answer is a pure function of `(code, storage, block,
  calldata)` and re-execution against an archive endpoint returns the same value on the canonical
  chain. A number names a height, not a fork; `canonical = true` (which needs `schema_version = 3`)
  pins the call to the block hash with EIP-1898 `requireCanonical` instead, and its stored answer
  carries that fork identity. A general
  execution engine for arbitrary state (RFC-0024) remains a deferred design.

## LLMs generate code, never data

Nuthatch is AI-native, but with a bright line: **LLMs generate code and tests; LLM output never sits in
the runtime data path.** An agent can scaffold a nest, write a view, or author a test - all reviewed like
any code - but nothing an LLM produces at runtime feeds stored state. The data path stays deterministic;
the AI stays at the authoring layer.

## Next

- [Reorgs &amp; finality](/docs/concepts/reorgs/) - determinism in action
- [Authoring modes](/docs/concepts/authoring/) - incremental entities and request-time views
