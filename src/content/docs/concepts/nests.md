---
title: What is a nest?
description: A nest is a content-addressed specification of a question about on-chain data - a spec, not a program.
order: 1
checked: 5.8.2
---

A **nest** is the unit of everything in nuthatch. It's a content-addressed, reproducible
*specification* of a question about on-chain data - machine-generated at the floor, human- and
AI-refinable in meaning and logic, and instantiable like a function rather than copied like a file.

**A nest is a spec, never a program.** That distinction is load-bearing: because a nest is a
declaration of *inputs* (config + ABIs + authored logic), the same inputs always produce the same
decode, the same tables, the same derived state - verifiably, on any machine.

## The four layers

- **Sources** - generated. `nuthatch.toml` (the chain, the contracts, the events to decode) plus the
  vendored ABIs. This is what `init` scaffolds from an address. See [nuthatch.toml](/docs/build/config/).
- **Meaning** - `semantic.toml`, describing what each table and column *means*, so an agent (or a human)
  can query the nest without guessing. See [The semantic layer](/docs/build/semantic/).
- **Logic** - authored SQL views over the decoded events (the tip ∪ sealed surface), plus recipes. Where
  a nest computes derived answers. See [Authored SQL views](/docs/build/views/).
- **Identity** - the content-addressed manifest: a `sha256` over the canonical inputs, so a nest is a
  reproducible blob you can bundle, publish, and pull by hash. See [The registry](/docs/operate/registry/).

The property that ties them together: **a nest is a function, not a fork.** You instantiate one; you
don't copy it.

## On disk

`init 0xAddr` produces roughly:

```text
my-nest/
  nuthatch.toml        # the [nest] header + [[contracts]] - the sources layer
  abis/                # vendored ABIs (Sourcify → Blockscout → Etherscan), never re-fetched at runtime
  schema.json          # generated: the decoded tables + columns
  views/               # authored SQL derivations (a commented starter to uncomment)
  semantic.toml        # the meaning layer
  llms.txt             # a machine-readable index for coding agents
  .claude/skills/      # a querying skill for a coding agent (nuthatch/SKILL.md)
  nuthatch.redb        # the hot store (runtime, not an input - excluded from the hash)
  segments/            # sealed Parquet past finality (runtime, content-addressed)
```

Only the *authored inputs* are part of a nest's identity - the hot store and sealed segments are
*derived*, so they never enter the content hash.

## Decoding

Decode is deterministic Rust, keyed by `topic0`, with contract-ABI priority and a generic fallback.
ABIs are acquired at `init` (Sourcify first, then keyless Blockscout, then Etherscan if
`ETHERSCAN_API_KEY` is set) and cached locally - nuthatch never phones home for them at runtime.
Every declared event of every contract becomes a table
`{alias}__{event}` with implicit columns (`block_number`, `block_hash`, `block_timestamp`, `tx_hash`,
`log_index`, `address`, `_seq`) alongside the decoded fields. See [ABIs, events &amp; tables](/docs/build/tables/).

> **Never retroactively re-decoded.** When an ABI improves, nuthatch does *not* rewrite stored history -
> decodings are versioned. Old rows keep the decoding they were indexed with; a better ABI applies going
> forward. Determinism over convenience.

## Next

- [Runtimes &amp; cursors](/docs/concepts/runtimes/) - hosting many nests in one runtime
- [Storage &amp; sealing](/docs/concepts/storage/) - where a nest's data lives
- [Nest identity &amp; reuse](/docs/concepts/nest-identity/) - immutable packages, dataset adoption, and shared segments
- [Build a nest](/docs/build/config/) - the config, tables, views, and recipes
