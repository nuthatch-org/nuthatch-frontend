---
title: "Nuthatch, embedded: the indexer as a wasm blob"
date: "2026-10-31"
description: "Nuthatch's core now builds as one WebAssembly module with a small, versioned interface. It runs in a browser tab, Node and wasmtime, and answers byte for byte as the binary does. The binary is still the point; this is for the cases where the data belongs to one person."
author: "cargopete"
tags: ["nuthatch", "webassembly", "wasmtime", "embedding", "verification", "lodestar", "the-graph", "rust"]
---

Chris at GraphOps asked us a question on 27 October, in passing, about rotki: "one of nuthatch's
super interesting properties is that it's pure rust and can(?) be embedded as a wasm blob". It was
the question mark that did it. We had two spikes that said yes in two incompatible ways, and no
promise anybody could build on.

Four days later the answer is **yes, with one stated exception**. Nuthatch's core builds as a single
`wasm32-unknown-unknown` module with no WebAssembly bindings of any kind. It talks to whatever hosts
it through three imports and a short list of exports, written down as version 1 of an interface.
The same file, unmodified, runs in Chrome, in Node and in wasmtime, and gives answers byte-identical
to the binary's. On Lodestar's `/profile` page it recomputed 409 figures for seven real wallets from
the chain, in the visitor's browser, and none of them differed from the server's.

This post is what that is, how it works, and where it stops.

## The binary is still the point

The first thing to say is what has not changed. Nuthatch is a single static binary: `init`, `dev`,
a live API in under two minutes, no Postgres, no Docker. That is the product, and every slice of
this work was gated on the binary being unchanged by it. Its CLI help is byte-identical, two levels
deep, across all 60 pages. So are the files `init` writes, its dependencies, its on-disk layout and
its test suite (2,879 passed at the last slice). Its restart bench was measured before and after
the code it shares with the module moved, and is no slower.

The principle we built to is the one Chief set before any code was written: **nuthatch is one
indexer with many ways to run it.** The binary is the main path. The embeddable engine sits beside
it in its own crate, `embed/`, off by default and built only when someone asks for it. Delete
`embed/` from the tree and a binary user loses nothing.

The two have a clean division of labour:

- **Run the binary when many people share one view.** Dashboards, APIs, a protocol's whole
  history, anything past a few hundred megabytes. That is almost everyone.
- **Embed the engine when the data belongs to one person on one device.** A wallet showing its
  owner's positions. rotki indexing its user's addresses without an Etherscan key. A dapp's frontend
  that would rather not trust its own backend. Somebody checking that a dashboard is telling them the
  truth about their own money.

Because the two give byte-identical answers, an app can start on one and move to the other without
any of its numbers changing.

## Two spikes that agreed on nothing

Before this, we had already put nuthatch in two strange places, and they shared no glue at all.

The nest in a tab ([RFC-0075](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0075-the-whole-nest-in-a-tab.md))
ran a whole nest in a browser worker: ingest, the hot store, reorgs, the built-in views, authored
entities and SQL. It is what [`/play/live`](/play/live/) runs. It reached the browser through
wasm-bindgen, which meant the Rust awaited `fetch` and opened browser storage itself. Its module
imported 84 functions, every one of them JavaScript glue: `Response.arrayBuffer`, `getDirectory`,
`createSyncAccessHandle`, `performance.now`, Node's `require` for randomness. None of that was the
engine. All of it was one host's way of answering five questions.

The rotki spike ([RFC-0074](https://github.com/nuthatch-org/nuthatch/issues/2474))
went the other way. It put address history inside rotki's Python through wasmtime, with two imports
and a store held in a byte buffer. It answered every list for `vitalik.eth` over two million blocks
equal to Etherscan's, and it lived on a branch, because nothing else could use it.

[RFC-0077](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0077-the-embeddable-engine.md)
makes those two spikes into two hosts of one engine.

## The guest asks, the host acts

The design decision everything else hangs on is that **the module performs no I/O**. It runs until
it needs something only a host can give, then returns and says what it needs.

A host drives it with a small loop:

```text
nh_open(config)              the nest's files, the storage mode, a memory ceiling
loop:
  r = nh_step()
  {"idle": true}             caught up; step again later
  {"requests": [...]}        RPC calls, storage opens, mirror fetches: do them,
                             then nh_resume(answers), in order
  {"wait_ms": n}             the RPC client wants a rest; come back in n ms
nh_request("GET", "/sql?q=...")   answered from storage, never yields
```

The reason is the hosts, which disagree about almost everything. A browser cannot answer a
synchronous import with a network round trip without `Atomics.wait` and cross-origin isolation. Python,
Node and wasmtime are happiest calling in and getting an answer back. A guest that yields serves all
of them, and the host keeps every decision that is properly its own: which HTTP client, which retry
policy, which RPC key, whether to go through a proxy.

The imports that remain are the ones that cannot be yielded: `now_ms` for the clock, `random_fill`
for the engine's hash maps (nothing stored depends on it), `log`, and six synchronous calls on an open
storage handle. Synchronous storage works because every host has a synchronous file: a
`FileSystemSyncAccessHandle` in a browser worker, `fs.*Sync` in Node, a plain file in Rust or Python.

Queries come out as the node's own HTTP routes. `nh_request` answers `/sql`, `/entity/{id}`,
`/balances`, `/derived/*`, `/ready` and the rest through the same code the binary serves them with. A
host that wants HTTP maps it one to one; the tab's Service Worker does exactly that. A host that wants
a function call passes a path. There is no second query API, so there is no second query API to keep
equal to the first.

Everything crosses as JSON at a pointer and a length. RPC bodies travel as JSON strings inside that
JSON, because a reply has to pass whole even when it is a provider's HTML error page. That costs 12.7%
in escaping on our test chain, and we decided it was worth it rather than make every host implement a
framing. A [pinned-interface test](https://github.com/nuthatch-org/nuthatch/blob/main/embed/README.md)
holds all 33 shapes of version 1 and fails the build if one changes without the version moving.

**It is a plain core module, not wasm-bindgen and not the component model.** A core module runs
unchanged in a browser, Node, wasmtime from Rust or Python and any other runtime, with no generator on
either side. It can be wrapped as a component later without touching the guest.

One clarification, because we removed WebAssembly from nuthatch on 8 October and readers will
reasonably ask: that was nuthatch as a *host*, running other people's code in its data path. This is
the opposite, nuthatch as a *guest* inside someone else's process. The binary gained no wasmtime.
wasmtime appears in exactly one lockfile, that of a test harness under `embed/tests`.

## What it took, in six slices

Each slice had a gate that could fail, and each ran in CI on every PR that touched it.

| Slice | What it did | What it proved |
|---|---|---|
| S0 | Removed every wasm-bindgen import | The module imports `nuthatch.now_ms`, `random_fill` and `log`, nothing else; segment hashes equal the node's in Node and wasmtime |
| S1 | One codebase | The spike became `embed/`; the binary's shared code moved into crates; a test fails if any shared crate drifts from the binary's version |
| S2 | The interface, version 1 | One unmodified `.wasm` gives byte-identical answers in Chrome, Node and wasmtime, equal to the node's |
| S3 | Survives a restart | Each host was killed mid-follow and reopened; history, views and entities all came back equal to the node's |
| S4 | Any nest, from a mirror | DeFi Pulse opened from the public mirror and answered equal to a node seeded from the same mirror |
| S5 | Trust and parity | A verified head stops a forged header by name; 13 nest shapes from the binary's own tests, 175 answers, all equal |

Two of those found something worth knowing.

S1's version check failed on its first run with **144 crates** in the engine's lockfiles at different
versions from the binary's, alloy among them. That matters more than it sounds. Parquet writes its own
version string into every file it produces, so a stray patch release moves the segment hash, and a
module that seals different bytes from the node cannot be used to check the node. The lockfiles are now
aligned and held there.

S5's parity run found a real defect in the module: after a reorg it kept the replaced blocks' old
timestamps, because it never cleared the cache the node clears. A test suite we had considered complete
did not cover it, and the comparison against the node did.

## Where it stops

We set the rule before the first slice that a measurement which narrowed the promise would narrow the
promise, and two of them did.

**A server host pays to compile it, once.** The event build is about 34 MB of WebAssembly, most of it
DataFusion and Arrow. Compiling it in wasmtime peaked at up to 1.9 GiB on an M5 Pro and 1.37 GiB on CI's
4-core Linux runner, with Cranelift and Winch alike. A precompiled module loads in under 70 ms after
that, and the whole follow-and-query run peaks near 120 MiB. So a non-browser host must compile once
and cache the result, and the reference host does. A host that has to compile on every start inside a
phone-sized budget, or a 128 MB isolate, cannot run the event build at all. It will get the address
build, which is 390 KB gzipped and does not include the SQL engine.

**It is 5.27 MB of brotli.** Browsers download it once and cache it, and CI now fails any build past
5.5 MB. It is not small, and we are not going to pretend that it is.

What it costs to open a real nest, measured on 30 October against the public mirror:

| | DeFi Pulse | GRT supply |
|---|---|---|
| Sealed history fetched | 1,529 segments, 138 MB | 2,297 segments, 286 MB |
| Open, public mirror, Node | 46.4 s | |
| Open, local copy | 0.86 s | 5.5 s |
| Wasm memory after open | 17 MiB | 242 MiB |
| Process peak, Node | 616 MiB | 564 MiB |

The GRT column is the one that changed the design. Rebuilding its views by replaying every one of its
2.96 million sealed transfers took the module to 1,519 MiB and 26.7 seconds. Folding the sealed history
in the query engine first, as the binary already does on restart, took it to 242 MiB and 5.5 seconds,
with answers equal to the node's at both the 2 GiB and 600 MiB ceilings. A nest too large for its
ceiling is refused before anything is downloaded, with the figures.

## The worked example: Lodestar checks its own numbers

[Lodestar](https://www.lodestar-dashboard.com) is our Graph protocol dashboard. Its network-wide pages are
the shared-view case, and they stay on a hosted nest. Its `/profile` page is the other case: once you
connect a wallet, it shows that wallet's delegations, curation signals and rewards, from our API.

The new switch on that page, "Verify it locally", is off by default, and the page with it off fetches
exactly what it did before. Turn it on and the visitor's own browser does this:

1. reads the server's figures and the block they are true at;
2. loads the engine and opens a nest for that wallet alone, on Arbitrum One, against the visitor's RPC.
   It fetches only the wallet's own staking and curation logs, filtered by the wallet's address as an
   indexed topic, up to the server's block and no further;
3. opens a second nest with the delegation pools of the indexers the wallet holds shares with, which is
   what turns shares into GRT;
4. runs the server's own portfolio queries over both, and shows the two sets of figures side by side,
   each marked "Agrees", "Differs" or "One side only".

The gate ran it through the real page, in Brave headless (Chromium) on 31 October. Each address
started from cold storage and used the free public endpoint, `arb1.arbitrum.io`:

| Wallet | What it holds | Figures | Differ | Time from cold |
|---|---|---|---|---|
| 0xcdb9…b2c3 | delegator, 2 open positions | 81 | 0 | 220 s |
| 0x3a35…bb3c | delegator since 2023, 110,000 GRT thawing | 43 | 0 | 662 s |
| 0xe3af…2ac2 | delegator since February 2025 | 32 | 0 | 529 s |
| 0xd7d7…d076 | delegator in one of the network's largest pools | 53 | 0 | 1,995 s |
| 0x96a3…65b2 | curator, 9 signals | 50 | 0 | 89 s |
| 0x6d64…24bc | curator, 9 signals | 50 | 0 | 73 s |
| 0xacbd…0db5 | curator, 19 signals | 100 | 0 | 178 s |

The positions' values go through the server's floating-point arithmetic for the fractional share and the
weighted average price. The tab reproduces them to the wei, because it is the same SQL running on the
same query engine. Nothing in it is a second implementation that happens to agree.

The times are the honest part of that table. **From cold, on a keyless public RPC, it takes between one
minute and thirty-three**, and almost all of that is the endpoint's rate limit; the largest pool alone
is eleven thousand requests. A second visit reopens the stored nest and catches up in about two seconds.
A keyed RPC is the other way round it.

Three things on `/profile` it cannot compute, and the page names them instead of showing a number:

- **The 90-day rewards history.** Lodestar builds it from exchange-rate snapshots that its own scheduled
  job writes to Postgres every day. The moment a snapshot was taken is not on the chain, so there is
  nothing to reproduce it from.
- **Network-wide figures**, such as an indexer's own stake or a deployment's total signal. Those are
  everyone's history, not the wallet's, and `/profile` does not show them anyway.
- **Pools for closed positions**, whose value is zero whatever the pool holds, so they are not fetched.

## What it does not do yet

- **Nothing verifies an Arbitrum block.** On mainnet the engine can take a finalized block from a light
  client and seal only history that hashes up to it; a forged header stops sealing by name. Our light
  client covers mainnet's beacon chain only, and Arbitrum's finality is an L1 batch. On Lodestar, then,
  the tab trusts the visitor's RPC, a log the RPC leaves out is not caught, and the page says both.
- **Safari, Firefox and phones have not been run.** Chrome and Brave on desktop have, and Node and
  wasmtime on macOS and Linux. Safari's driver needs an administrator to enable, and that has not
  happened yet.
- **The address build for rotki is not on main.** It works on its branch and has been parked since 28
  October; extracting it into the shared crate needs decisions RFC-0074 left open. rotki will get it when
  rotki asks.
- **The gate above ran on a local build of Lodestar.** The switch went live on
  [`/profile`](https://www.lodestar-dashboard.com/profile) the same day, and has not yet been run by a
  stranger's wallet.
- **The wasmtime host cannot open a mirrored nest.** Only the browser and Node hosts answer mirror
  fetches today.

## Further reading

- [RFC-0077, the embeddable engine](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0077-the-embeddable-engine.md),
  with every slice's measured outcome in §12 to §18
- [`embed/README.md`](https://github.com/nuthatch-org/nuthatch/blob/main/embed/README.md), the version 1
  host interface, for anyone writing a host
- [`/play/live`](/play/live/), a whole nest running in your tab
- [Where Nuthatch uses WebAssembly, and where it refuses to](/blog/where-nuthatch-uses-webassembly/),
  the earlier position, kept as written
