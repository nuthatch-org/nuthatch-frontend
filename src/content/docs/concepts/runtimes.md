---
title: Runtimes & cursors
description: One runtime, many nests, across one or more chains, with one isolated cursor per chain.
order: 2
checked: 5.15.0 (2026-10-31)
---

A **runtime** is one process hosting one nest or many. A **cursor** is a single chain's follow
position - the thing that reads the tip, tracks finality, and handles reorgs. The relationship between
them is the whole story.

In 2.0 the runtime also owns **tenancy**: a mount is `(tenant, nest identity)`, two tenants mounting
the same nest share one dataset, and a tenant label left out means
`default`. One tenant may still mount many nests. There used to be a separate *roost* concept wrapping all this; it was retired, and
the runtime absorbed it.

## The single-cursor law

A **cursor is single-chain, single-writer, one observable failure boundary.** One cursor tracks exactly
one chain's canonical history - never two. Chains reorg, finalize, and advance on independent clocks, so
sharing a cursor between two of them is incoherent, not merely inadvisable. This law is
non-negotiable: nuthatch never multiplexes two chains behind one cursor.

## One chain, many nests

Nests on the **same chain** co-located in one runtime share **one cursor**: a single `getLogs` per window,
fanned out to the owning nests. So N nests cost roughly one nest's worth of RPC chatter - the density
win. Per-nest tables stay byte-identical to running each nest solo, because the same per-window code
runs either way.

Sharing the fetch no longer means sharing the pace. Since 5.14.0 a runtime's cursor is an extraction
stage that fetches each window once and appends it to a bounded buffer, and each nest is its own task
reading that buffer from its own position. A slow nest delays only itself; one that falls behind the
buffer fetches for itself until it catches up, and extraction never moves back for it. The cursor is
still one fetch position, one finality view and one reorg authority, which decides each reorg once.
See [Run many nests](/docs/operate/many-nests/#how-a-chains-nests-advance).

Isolation is by construction: each nest keeps its own dataset directory (`data/<nid>/` - its own hot
store and views), so one nest's bad view or runaway factory can't touch another's data. Sealed
segments are the deliberate exception: they are content-addressed and shared in `segments/`, so two
nests that decode the same contract hold one byte-identical copy between them rather than two.

## Many chains, one runtime

A runtime can also span **multiple chains** - one Base nest and one Arbitrum nest in a single process - by
running **one isolated cursor per distinct chain**. Each cursor has its own RPC source, tip-follow loop,
finality view, reorg boundary, and hot-store partition. A reorg on one chain touches only that chain's
cursor; another chain's data is left byte-identical.

```toml
# mounts.toml - multichain form: declare each chain's RPC, nests carry their own chain.
# [runtime] and [[chains]] are yours; [[mounts]] are written by the admin API or `nuthatch migrate`.
[runtime]
name = "my-runtime"

[[mounts]]
alias = "base-pool"
nid = "9f2c…"

[[mounts]]
alias = "arb-pool"
nid = "4a71…"

[[chains]]
chain = "base"
chain_id = 8453
rpc_urls = ["https://base-rpc"]

[[chains]]
chain = "arbitrum-one"
chain_id = 42161
rpc_urls = ["https://arb-rpc"]
```

> **A capability, not a mandate.** One-chain-per-runtime stays fully valid and is the simplest default.
> Multichain is there for operators who want the density; the runtime enables the option, it never forces
> co-location.

## The footprint budget

The footprint budget is **per active-chain cursor: ≤2 GB RAM**. A single-chain runtime is one cursor
(≤2 GB); a multichain runtime's total is the sum of its cursors. Each chain's cursor is held to the budget
independently - a mount that would take a cursor's *projected* footprint past it is refused. Density
is RAM-bounded, not free.

2 GB is the default ceiling and the budget nuthatch's own design is gated to in CI. Since 5.13.0 an
operator may give a cursor more with `max_rss_mb`, in `mounts.toml` or live over the admin API, as a
choice nothing in nuthatch requires.

## When a cursor starts and stops

A cursor exists while its chain has something to follow. A runtime may start with chains declared and
nothing mounted: the first nest mounted onto a chain starts that chain's cursor, exactly as boot would,
and only then dials its RPC. A cursor whose nests have all been unmounted or suspended idles rather than
stopping, so the next mount onto that chain rejoins it. See
[Host nests for others](/docs/operate/hosting-nests/).

## Failure boundaries

Each cursor is one observable failure boundary. One chain stalling or reorging cannot harm another
chain's nests. A cursor that dies is **quarantined**: its nests keep serving what they had and report
themselves unhealthy, its siblings keep indexing, and a mount onto that chain is refused until restart.
The runtime exits, non-zero, only when every cursor has died, since nothing will advance again and a
restart is the only thing that can help.

## Next

- [Run a runtime](/docs/operate/many-nests/) - the operational guide
- [Reorgs &amp; finality](/docs/concepts/reorgs/) - how a cursor handles a reorg
- [Storage &amp; sealing](/docs/concepts/storage/) - what a cursor writes
