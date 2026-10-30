---
title: Run many nests
description: One runtime hosting many nests across one or more chains, with one isolated cursor per chain and tenancy handled by the runtime itself.
order: 8
checked: 5.14.0 (2026-10-30)
---

One **runtime** hosts one nest or many. Nests on the same chain share a single cursor and one
`getLogs` per window - N nests for roughly one nest's RPC cost - and a runtime can also span
**multiple chains**, running one isolated cursor per chain: a Base nest and an Arbitrum nest in one
process. Each cursor has its own tip, finality, and reorg boundary, and a per-cursor footprint
budget.

> **The roost is gone in 2.0.** There used to be a separate *roost* concept and a `nuthatch roost dev` command, so you had to choose which
> shape you wanted before you knew which you wanted. There is now **one command**: `nuthatch dev`. What it runs is a
> property of the directory - a `nuthatch.toml` runs that one nest, a `mounts.toml` runs every nest it
> mounts. Run `nuthatch migrate` on a pre-2.0 directory and it rewrites itself; it moves data and never
> re-indexes.

## Layout

A runtime directory holds a `mounts.toml` and its datasets, keyed by **nest identity** rather than by
a name you picked:

```text
my-runtime/
  mounts.toml
  segments/      # shared, content-addressed: two nests that decode the same
                 #   contract hold ONE copy here, not two
  data/
    9f2c…/       # a dataset: nuthatch.toml, abis/, views/, its own hot store
    4a71…/
```

```toml
[runtime]
name = "my-runtime"
max_rss_mb = 2048            # optional per-cursor RAM ceiling
# sql_permits = 2            # optional: SQL permits on each cursor's gate (5.14.0)
# isolation = "strict"       # optional: separate tenants' SQL sessions and pools (5.13.0)

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[[mounts]]
tenant = "default"           # opaque to nuthatch; omit it and you get "default"
alias = "usdc"               # what it is served as: /usdc/…
nid = "9f2c…"                # which nest identity it serves
sql = "open"                 # how much SQL this mount exposes - see Security
```

The `[runtime]` block and the `[[chains]]` are yours to write: they are all an empty runtime needs to
start. The `[[mounts]]` records are **runtime state**: the admin API and `nuthatch migrate` write them
and the runtime keeps them in step, so you do not hand-write those. Since 5.13.0 the admin API also
writes `[runtime]`'s `max_rss_mb` and `sql_permits`, `[[chains]]` it declares, and `[tenants.<tenant>]`
shares when you change them live; each change is written to the file before it takes effect. The
keys are in the [config reference](/docs/reference/config/#mountstoml).

A nest cannot tell it is co-hosted: its config, storage, and routes are identical to a solo `dev`.

**Two mounts may name the same nest identity, and that is the point.** They share one dataset: one
store, one place in the cursor, one backfill, two routes. Two tenants running the same nest never
index it twice.

## Run it

```sh
nuthatch dev --dir my-runtime
```

This brings up every mounted nest and serves them behind one listener (`--listen`, default
`127.0.0.1:8288`):

- `GET /nests` - the roster: each nest's name, chain, registry hash, table count, and footprint.
- `GET /<name>/…` - each nest's **full API** under its prefix: `/usdc/sql`, `/usdc/tables`,
  `/weth/_admin/`, and so on. Byte-identical routes to a solo nest, just prefixed.

The backfill flags you know from `dev` apply to every mounted nest: `--backfill N`,
`--seal-direct`, `--concurrency`, `--window`, `--rpc` overrides, `--no-admin`. `--rpc` and
`--rpc-fallback` work only for a single-chain runtime: a multichain runtime refuses them as
ambiguous, and takes each chain's endpoints from its `rpc_urls` under `[[chains]]`.

## Mount and unmount without a restart

Since **0.7.0** the mounted set is changeable while it runs, and since **3.13.0** the runtime owns the
whole lifecycle: a runtime may start with chains declared and **nothing mounted**, and every nest can
arrive, pause, change version and leave over the admin API. Before 0.7.0, adding or removing a nest
meant editing config and restarting, which stops every *co-tenant* nest too.

Mount a nest, which answers `202` with a job; poll the mount until its `"phase"` is `"live"`; and
unmount it:

```sh
curl -XPOST   localhost:8288/_admin/nests -H 'Content-Type: application/json' -d '{"name":"usdc","nid":"9f2c…"}'
curl          localhost:8288/_admin/mounts/usdc
curl -XDELETE localhost:8288/_admin/nests/usdc
```

Started with `--registry`, the runtime fetches a NID it does not hold, verifies it as `nest load` does
and installs it at `data/<nid>/` first. All of these routes need the admin token on every bind: `NUTHATCH_ADMIN_TOKEN`, or on localhost
without it the one the runtime makes in `<dir>/.admin-token` and prints at startup. `--no-admin` removes them entirely. The full guide, with suspend, move, dry runs and
reclaiming disk, is [Host nests for others](/docs/operate/hosting-nests/).

What the runtime guarantees:

- **A mount is admitted, not assumed.** It is refused with `507` if it would breach the cursor's RAM
  budget (the reason carries the projected and ceiling figures), and `409` for a name already mounted
  or a chain this runtime does not declare. `?dry_run=true` answers the same question without mounting.
  A refused mount leaves nothing behind, including a nest it fetched to find out.
- **It catches up before it joins.** A new nest backfills alongside the cursor and joins once it is
  level, so its history is never fetched on its co-tenants' time. The first nest onto a chain starts
  that chain's cursor, exactly as boot would.
- **An unmount is a drain.** The cursor finishes its current window and releases the nest's store
  before the routes are removed - not the other way round. The dataset stays on disk, so a remount is
  free; `?reclaim=true` removes it once no mount names it.
- **A suspend keeps its place.** A suspended mount answers `503`, holds no store and no cursor slot,
  and resumes from where it stopped.
- **A move has no gap.** `POST /_admin/move/<name>` switches a name to a new NID in one step after the
  new nest has caught up.
- **The set is persisted** to `mounts.toml`, and mount jobs to `mount-jobs.json`, so a restart comes
  back with what you last asked for and resumes what was in flight. At runtime nuthatch owns those
  files; use `--no-admin` if you manage `mounts.toml` with configuration management.

The same API divides query capacity between tenants, narrows a mount's limits, changes the memory
ceiling, the permit count and the chains live, seeds a mount from a mirror, and checks and publishes
bundles (5.13.0 and 5.14.0); [Host nests for others](/docs/operate/hosting-nests/) covers each.

## How a chain's nests advance

Since **5.14.0** a runtime's cursor is in two parts (RFC-0076). **Extraction** fetches each range
once, with the union filter of every nest on the chain, and appends the window to a bounded
**buffer**. **Each nest is a task of its own**, the only writer of its dataset, reading the buffer
from its own position. The chain still has one cursor: one fetch position, one finality view, and
one reorg authority, which decides each reorg once, drops the buffered windows above the common
ancestor, and leaves a marker each nest rolls back from at its own position.

What that changes is pace. Before, the cursor ran each nest's window in turn, so one slow nest set the
tip lag of every nest on its chain. Now a slow nest delays only itself until it falls behind the
buffer, and then fetches for itself by its own filter until it catches up; it never moves extraction
back, and no sibling fetches anything twice. With one nest slowed tenfold, its siblings' p50 tip lag
was 8 to 9.5 ms on the buffered cursor against 541 to 802 ms on the shared one (RFC-0076 §9).

| | |
|---|---|
| `window_buffer_mb` | What the buffer may hold in memory: 64 MiB at the default 2,048 MB ceiling, scaling with `max_rss_mb`, and charged to the cursor's admission beside its mounts. `GET /_admin/runtime` reports it. |
| spill | Past it, windows go to `<runtime>/cursors/<chain>/buffer/`, up to four times the bound. Scratch, never data: emptied when the cursor starts. |
| `NUTHATCH_INGEST_CONCURRENCY` | How many nests on a cursor process a window at once; the core count by default, at most 4. A sibling waits for a slow nest only when every permit is held by slower ones, so keep it above the number of nests you expect to be slow. |
| `NUTHATCH_CURSOR_BUFFER` | `0` or `off` restores the shared cursor, for 5.14 only. A number sets the most windows the buffer holds, 64 by default. |
| `window_deadline_ms` | Per mount, under `[mounts.limits]`: how long the part of a window before its commit may take. Past it the window is abandoned with nothing stored and asked for again; the third overrun in a row is a retryable quarantine. Unset by default. |

A lone nest run with `nuthatch dev` over a `nuthatch.toml` is unaffected: it runs its own loop, as
before.

## When one nest goes wrong

A runtime survives its sick nests (RFC-0026). A nest that faults is **quarantined**, not fatal: its
healthy siblings keep indexing and serving, and it is re-admitted on a backoff if the fault was
retryable. A terminal fault (a corrupt registry, a config that can't load) stays quarantined until
you fix it. The blast radius is bounded in both directions - a nest's error doesn't kill its cursor,
and a cursor's death doesn't kill the runtime.

Since 5.13.0 that covers a panic too: a panic in one nest's window, reorg rollback or rejoin
quarantines that nest alone, terminally, and it keeps answering from its last committed window. A
nest that fails to build at boot, or no longer fits its cursor's ceiling, boots quarantined with the
reason, and the rest boot; boot fails only when every nest does. A re-admitted nest resumes from its
own position, checked against its own checkpoints; on the buffered cursor it fetches its missed range
for itself, so extraction never moves back for it.

You see it in three places: `GET /nests` carries each nest's live health and re-admission time,
`GET /ready` at the runtime root answers runtime-wide while `GET /<name>/ready` answers per nest, and
`nuthatch_nest_health` / `nuthatch_nest_quarantine_total` / `nuthatch_cursor_live` cover the
[metrics](/docs/operate/metrics/) side.

Pass `--fail-fast` to opt out and exit on the first fault instead - the right call for CI and
deterministic tests, and for operators who would rather a process die loudly than serve partially.

## Multichain

To span more than one chain, add a second entry under `[[chains]]` (a top-level array beside
`[runtime]`); each nest declares its own `chain` in its `nuthatch.toml`. A second chain is a second
cursor. The pre-2.0 form, with `chain`/`chain_id`/`rpc_urls` directly under `[runtime]`, is refused at
startup with a pointer to `nuthatch migrate`, which rewrites it:

```toml
[runtime]
name = "my-runtime"
max_rss_mb = 2048              # per-cursor; a runtime's total budget is Σ cursors

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[[chains]]
chain = "base"
chain_id = 8453
rpc_urls = ["https://…"]

[[mounts]]
tenant = "default"
alias = "usdc"
nid = "<64-hex-mainnet-nest-identity>"

[[mounts]]
tenant = "default"
alias = "base-app"
nid = "<64-hex-base-nest-identity>"
```

Current runtimes declare chains under `[[chains]]` and datasets under `[[mounts]]`. The old flat
`runtime.nests` list survives only so a partly migrated directory can still be recovered; do not use it
for a new runtime.

## Isolation

Chain identity is shared per cursor; **hot stores are per-nest and isolated**, while sealed Parquet
segments are content-addressed in the runtime-wide shared store. A reorg rolls back every affected
nest's hot store on that cursor; sealed history is immutable everywhere. The roster and
[per-nest metrics](/docs/operate/metrics/) let you see each nest's own progress and footprint
rather than one blended number.

One rule to keep: **one cursor per chain, one chain per cursor.** To index a second chain, add a
second `[[chains]]` cursor (or run a second process) - never try to multiplex chains behind one
cursor.

## When one machine is not enough

A runtime is bounded **per cursor** at 2 GB by default, and the sum of a machine's cursors has to fit
the machine. Since 5.13.0 an operator may give a cursor more with `max_rss_mb`, by choice; nuthatch's
own design is held to 2 GB in CI, and nothing measures a larger ceiling for you. For more query
capacity without a second writer, run [followers](/docs/operate/hosting-nests/#read-replicas-and-upgrades-without-an-outage)
beside the runtime or, since 5.14.0, on other hosts. When the writing itself stops fitting - or when
serving load and ingestion load want different dials - the same crates run as a fleet across
machines: a writer pool taking cursor leases, and an independently-scaled serving tier. See
[scaled mode](/docs/operate/scaled/).

It is a trade rather than an upgrade: one runtime on one box is simpler, and that simplicity is the point
of the embedded path.
