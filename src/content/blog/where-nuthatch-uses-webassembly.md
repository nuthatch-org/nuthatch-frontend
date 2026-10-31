---
title: "Where Nuthatch uses WebAssembly, and where it refuses to"
date: "2026-08-29"
description: "An indexer with a WASM runtime usually means mappings. Nuthatch runs none. WebAssembly is used here for exactly one thing - a capability boundary you can read off a component's type - and one component actually ships inside the binary."
author: "cargopete"
tags: ["nuthatch", "webassembly", "wasmtime", "component-model", "determinism", "compliance", "the-graph", "rust"]
---

> **Superseded, 2026-10-09.** Nuthatch 5.0.0 removed the WASM layer described below: `nuthatch
> transform`, live screening, `nuthatch screen`, `audit replay`, the `wit/` interfaces, the embedded
> component and wasmtime with them. No production nest used it. Nuthatch now runs no WebAssembly at
> all. Kept as written, because a project that quietly edits its old positions is harder to trust
> than one that dates them.
>
> **And again, 2026-10-31.** The binary still runs no WebAssembly, but nuthatch's core now also builds
> as a WebAssembly module that other programs embed: nuthatch as the guest rather than the host. See
> [Nuthatch, embedded: the indexer as a wasm blob](/blog/nuthatch-as-a-wasm-blob/).

*The obvious guess is wrong, so it is worth stating plainly at the top: Nuthatch runs no mapping
WASM at all.*

When an indexer says it has a WebAssembly runtime, the usual meaning is mappings. A subgraph
compiles AssemblyScript handlers to a module, `graph-node` calls one per event, and that module is
the programming model: it is where your logic lives, and it is also the reason the manifest cannot
tell you which template a factory creates, because that fact lives in the compiled bytes.

Nuthatch has a WASM runtime and does none of that. Authored logic is SQL. Entity derivation is a
DBSP circuit. Nothing in the ordinary indexing path is a guest module, and a freshly `init`-ed nest
contains zero user-written components. WebAssembly is used for one job only: to draw a boundary
around code whose privileges you want to be able to *read* rather than trust.

Which is a narrower use than most, and, I would argue, the only one that pays for itself.

## The boundary, not the programming model

The thing that makes the component model useful here has nothing to do with portability or with
letting people write handlers in other languages. It is that a component's imports are part of its
type. A component that never asks for the filesystem cannot be handed the filesystem by accident,
and, more usefully, an auditor can establish that from the binary alone with no access to the source
and no code review.

That property is what the compliance pack (RFC-0008) needed. The pack's whole claim to an operator's
customer is: *these alerts were produced by this code, over this list, against these blocks, and you
can reproduce them on your own hardware.* An address-screening stage that could quietly call a
vendor API, or read the clock, or remember something between runs, would make that claim
unprovable. So screening is a component with no granted capabilities, and the sanctions list is
handed to it as an input rather than looked up.

There are three interfaces in `wit/`, and they are the honest summary of the design:

```text
wit/transform.wit   world pure-transform   export stage       imports: base WASI only
wit/screen.wit      world screen-stage     export screen      imports: base WASI only
wit/effectful.wit   world effectful-kv     export effectful   imports: base WASI + kv
```

Two pure worlds and one effectful one. A pure stage may feed canonical entities, because a component
with nothing granted is re-executable. An effectful stage may produce annotations only, and it does
not get to write canonical state, because it has no import that could. That is enforced by the
absence of a capability rather than by a rule someone might forget.

## The one that ships

Of the three, exactly one runs in production, and it is embedded in the binary:

```rust
const EMBEDDED_SCREEN: &[u8] = include_bytes!("../components/screen.wasm");
```

1,112,148 bytes of `wasm32-wasip2`, sha256 `117cbcce4559…`, travelling inside the single static
binary so that screening works with no external artefact to fetch and no version to get wrong. A
nest may drop its own `components/screen.wasm` in place to pin a reviewed build; either way the
bytes are hashed at load and that hash is stamped onto every annotation the component produces, as
the `source` field. When an auditor asks which code decided an address was sanctioned, that is the
answer, and it is checkable.

There is a test for the obvious attack on that, and it asserts a disjunction rather than a specific
outcome, which I like: a tampered component must either be refused by Wasmtime or come out with a
visibly different hash. What must never happen is that it loads *and* reports the pristine hash.

The stage runs in two places. Live, inside the indexing loop, screening each window's transfers
before the window commits, so hits share the transfers' block keys and therefore seal, roll back and
prune with exactly the same range. And in `nuthatch screen`, over sealed Parquet segments, after the
fact. The pair is deliberate: `nuthatch audit replay` re-runs the second and diffs it against what
the first stored. If `(list snapshot, block range, component hash)` does not reproduce the recorded
hits byte for byte, replay says so.

## What the imports actually say

This is the part that is easiest to assert and hardest to verify, so here is the verification. The
shipped component, interrogated with `wasm-tools`:

```text
$ wasm-tools component wit components/screen.wasm
  export nuthatch:transform/screen@0.1.0;
  import wasi:cli/environment@0.2.6;
  import wasi:cli/exit@0.2.6;
  import wasi:cli/stderr@0.2.6;
  import wasi:cli/stdin@0.2.6;
  import wasi:cli/stdout@0.2.6;
  import wasi:cli/terminal-input@0.2.6;
  import wasi:cli/terminal-output@0.2.6;
  import wasi:cli/terminal-stderr@0.2.6;
  import wasi:cli/terminal-stdin@0.2.6;
  import wasi:cli/terminal-stdout@0.2.6;
  import wasi:io/error@0.2.6;
  import wasi:io/poll@0.2.6;
  import wasi:io/streams@0.2.6;
  import wasi:random/insecure-seed@0.2.6;
```

Fifteen imports, all of them the standard-library floor that any Rust `wasm32-wasip2` build carries.
No filesystem. No sockets. No clock. No HTTP. The `recurrence` component, which exists to
demonstrate the effectful path, has the identical list plus exactly one line:
`import nuthatch:transform/kv@0.1.0`. The capability is not documented, it is declared, in the place
a tool can find it.

The host enforces this twice. `check_imports` walks the component's actual imports before
instantiation and refuses one that exceeds its declared grant, with an error naming the capability.
Then the linker is wired with base WASI plus only what was granted, so anything the first check
somehow missed fails to instantiate anyway. `nuthatch pack verify` runs the same reasoning over a
signed manifest, and flags a pure stage that has grown a grant.

## The honest caveats about "deterministic by construction"

The phrase is used in the source, and I want to be precise about how far it goes, because it is
nearly true rather than entirely true.

Base WASI is not empty. `wasmtime_wasi::p2::add_to_linker_sync` wires `wasi:clocks/wall-clock` and
`wasi:random/random` into the linker along with everything else, and the default `WasiCtx` gives
both of them the real host implementations. So a component that *chose* to read the wall clock would
link and would get a real answer. What actually holds the line is the import list: the shipped
component does not import clocks, and you can see that it does not. Determinism here is checkable
rather than structurally impossible, which is a meaningfully weaker claim and still a much better
one than "we reviewed the mappings".

Filesystem and sockets are a different case, and there the sandbox is genuine. Both are in the
linker, but the context is built with `WasiCtxBuilder::new().inherit_stderr()`: no preopened
directories, so no path resolves, and `SocketAddrCheck` defaults to a closure that returns `false`
for every address, so no connection is permitted. A component asking for either gets an error rather
than access.

One more, since the grant struct advertises it: `Grants` carries an `http_hosts` allowlist, and
`check_imports` knows to refuse a `wasi:http` import when that list is empty. There is currently no
way for that grant to be satisfied, because `wasmtime-wasi-http` is not in the dependency tree at
all. The field is a placeholder for a design, not a shipped capability, and the reason is the next
section.

## The things that were considered for WASM and put elsewhere

**Alert delivery.** RFC-0008 planned the webhook sink as an effectful component with granted HTTP.
It ended up host-side, in `alerts.rs`, and the reason is stated in the module's own header:
at-least-once delivery is host state by nature. It needs a durable outbox in redb that survives a
restart, a background drain so a stalled endpoint never blocks the indexer, a bound past which the
outbox sheds its oldest entries loudly, and reorg retractions. None of that becomes easier by living
in a sandbox, and the endpoint is operator-configured anyway, so the sandbox is protecting you from
a URL you wrote down yourself.

**Authored logic.** Rejected explicitly as the front door in RFC-0018, in language I would not
improve on: shipping imperative handlers as the logic layer is the subgraph-mapping tax again.
Nests declare what a relation *is*, in SQL, and RFC-0041 compiles the subset that admits it into
DBSP circuits maintained as blocks arrive. The host owns state, ordering, replay and rollback,
which means components never see a reorg and need no rollback interface. That is not a small
simplification; it is most of why the boundary can be a pure function at all.

## Why the boundary is a batch

The one design decision inherited from the *liminal* prototype and then changed: the call takes a
whole batch, never one event.

```wit
run: func(batch: list<u8>) -> result<list<u8>, string>;
```

Both directions are Arrow IPC. A per-event call across the component boundary cannot keep up with a
backfill, and Arrow is already the interchange format on both sides, so nothing bespoke was
invented. It has a pleasing side effect: the host builds its batches with `arrow` 58 and the guest
reads them with `arrow-array` 56, and neither cares, because what crosses the boundary is a
serialised stream rather than a linked type.

The screening call takes two batches, the transfers and the sanctioned set, and returns a third. The
component holds a `HashSet` of addresses and emits hits in input row order, sender side before
recipient side. Which is why that `wasi:random/insecure-seed` import above is harmless: it is the
seed for the standard library's hasher, the set is only ever asked `contains`, and nothing iterates
it. Had the output order come from set iteration, the one non-deterministic thing the component
imports would have quietly become the thing that broke replay.

## The ledger

What is genuinely in production: one pure component, screening, embedded in the binary, running live
and in backfill, with its hash on every annotation and `audit replay` as the check.

What exists and is not yet load-bearing: the effectful runtime, whose only guest today is a toy that
counts how many times it has seen an address, and `nuthatch transform`, which runs a pure component
over a nest's stored transfers from the command line and is an escape hatch nobody has needed to
reach for.

And one rough edge worth naming rather than tidying away. `LiveScreener::screen_window` logs a
failed batch as a warning and carries on, which is out of step with the rest of the codebase, where
a dead view thread is fatal precisely so that stale data is never served as healthy. A dropped
screening batch is not silent forever, because replay will report the recomputed hits as `extra`
against what was stored, but it is silent until someone runs replay. That should be a fault, not a
warning.

Everything above is checkable from the tree. The component list, the import list, the grant checks
and the two enforcement layers are a hundred and fifty lines apiece, which is roughly the amount of
machinery the guarantee is worth.

## Next

- [Authoring modes](/docs/concepts/authoring/) - declarative first, components as the escape hatch
- [Determinism](/docs/concepts/determinism/) - where the line is drawn and why
- [Compliance pack](/docs/build/compliance/) - the stage the shipped component powers
