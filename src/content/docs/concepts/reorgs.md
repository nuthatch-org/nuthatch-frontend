---
title: Reorgs & finality
description: Reorgs only ever touch the mutable hot store; sealed segments are append-only past finality.
order: 4
checked: 5.8.1
---

A chain reorg - where the tip you indexed turns out not to be canonical - is the hard part of indexing.
Nuthatch handles it with one rule that makes the rest simple.

## The rule

**Reorgs only ever touch the mutable hot store.** Segments are sealed strictly *past finality*, so the
columnar layer is append-only and immutable. A reorg can never reach a sealed segment - because a
segment is only ever written for a range that's already final, and final ranges don't reorg.

## How a reorg is handled

The cursor records a block-hash checkpoint per window. When its last committed block falls off the
canonical chain, it detects the divergence, **rolls the hot store back** to the deepest surviving
ancestor (a range-delete of everything above that block, keyed by `(block, log_index)`), and re-indexes
the canonical replacement. Rows are idempotent on `(block, log_index)`, so re-indexing is clean.

For declarative views, a reorg is just a **retraction**: the same transfer re-fed to the incremental
circuit with weight −1. Backfill and tip run the identical circuit - there is no separate reorg code
path. See [Authoring modes](/docs/concepts/authoring/).

## Sub-finality reorgs halt loudly

If a reorg were to reach *below* the finalized watermark - into data already sealed to immutable
segments - that's a finality violation this model can't repair. The cursor **halts with an error** rather
than silently corrupt. In practice this never fires on a correctly-configured finality depth; when it
does, it's telling you the chain did something the finality assumption didn't allow.

## Per-cursor isolation

In a multichain runtime, a reorg on one chain touches only that chain's cursor. Another chain's data is
left **byte-identical** - a property that's tested, not merely asserted. See
[Runtimes &amp; cursors](/docs/concepts/runtimes/).

## Guarantees

Property tests assert the core invariant: for any random reorg depth against a random alternate branch,
the hot store converges to exactly the state you'd get by indexing the winning branch directly. Reorg
handling is deterministic and re-executable, like everything feeding stored state.

## Next

- [Determinism](/docs/concepts/determinism/) - the non-negotiable this rests on
- [Storage &amp; sealing](/docs/concepts/storage/) - the finality boundary
