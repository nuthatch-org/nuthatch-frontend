---
title: Authoring modes
description: Incremental entities and request-time SQL views - both declarative, both deterministic.
order: 6
checked: 5.8.0
---

There are two ways to author what a nest computes, and both are declarative. One is maintained as
blocks arrive; the other is evaluated when a reader asks. Both sit over the same deterministic core.

## Incremental (maintained as blocks arrive)

Entities are **incremental views over decoded events**, maintained by the IVM core (DBSP / Feldera
crates). You *state* a derivation - "balance = Σ(in) − Σ(out)" - as a circuit, and it's maintained
incrementally: a new transfer is a +1 delta, a reorg is the *same* transfer re-fed with weight −1 (a
retraction). Backfill and tip run the identical circuit.

This is the differentiator. You never hand-write "on transfer, load balance, add, save." You declare the
answer, and reorgs, backfills, and tip-following all fall out of the same statement. Your own
maintained relations are [incremental entities](/docs/build/entities/), declared in `entities.toml`.

## Request-time (evaluated when asked)

[Authored SQL views](/docs/build/views/) and [recipes](/docs/build/recipes/) are declarative too, but
not incremental: they are named queries evaluated when a reader asks, over hot and sealed data. A
join-heavy view can be listed in `maintained.toml`, which answers it from a stored copy of its own
evaluation, reused only while every input hashes the same.

## No imperative escape hatch

Until 4.15.2 a nest could also run WASM components (Wasmtime, WASIp2) over stored transfers. 5.0.0
removed that layer, with `nuthatch transform`, the `wit/` interfaces and the components: no
production nest used it, and it was never in the indexing path. Logic a view cannot express is now
written as an entity, a view, or a change to nuthatch itself.

> A freshly-`init`-ed nest is a working indexer with nothing hand-written - generated decode plus
> declarative views.

## Next

- [Authored SQL views](/docs/build/views/) - the request-time logic layer
- [Incremental entities](/docs/build/entities/) - relations maintained as blocks arrive
- [Determinism](/docs/concepts/determinism/) - why the data path stays pure
