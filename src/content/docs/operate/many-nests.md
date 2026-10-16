---
title: Run many nests
description: One runtime hosting many nests across one or more chains, with one isolated cursor per chain and tenancy handled by the runtime itself.
order: 8
checked: 5.7.0
---

One **runtime** hosts one nest or many. Nests on the same chain share a single cursor and one
`getLogs` per window - N nests for roughly one nest's RPC cost - and a runtime can also span
**multiple chains**, running one isolated cursor per chain: a Base nest and an Arbitrum nest in one
process. Each cursor has its own tip, finality, and reorg boundary, and a per-cursor footprint
budget.

:::note[The roost is gone in 2.0]
There used to be a separate *roost* concept and a `nuthatch roost dev` command, so you had to choose which
shape you wanted before you knew which you wanted. There is now **one command**: `nuthatch dev`. What it runs is a
property of the directory - a `nuthatch.toml` runs that one nest, a `mounts.toml` runs every nest it
mounts. Run `nuthatch migrate` on a pre-2.0 directory and it rewrites itself; it moves data and never
re-indexes.
:::

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
and the runtime keeps them in step, so you do not hand-write those.

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
`--seal-direct`, `--concurrency`, `--window`, `--rpc` overrides, `--no-admin`.

## Mount and unmount without a restart

Since **0.7.0** the mounted set is changeable while it runs, and since **3.13.0** the runtime owns the
whole lifecycle: a runtime may start with chains declared and **nothing mounted**, and every nest can
arrive, pause, change version and leave over the admin API. Before 0.7.0, adding or removing a nest
meant editing config and restarting, which stops every *co-tenant* nest too.

```sh
curl -XPOST   localhost:8288/_admin/nests -H 'Content-Type: application/json' -d '{"name":"usdc","nid":"9f2c…"}'   # 202, a job
curl          localhost:8288/_admin/mounts/usdc                            # until "phase": "live"
curl -XDELETE localhost:8288/_admin/nests/usdc
```

Started with `--registry`, the runtime fetches a NID it does not hold, verifies it as `nest load` does
and installs it at `data/<nid>/` first. All of these routes are gated by the admin token when bound
off-localhost, and `--no-admin` removes them entirely. The full guide, with suspend, move, dry runs and
reclaiming disk, is [Host nests for others](/docs/operate/hosting-nests/).

What the runtime guarantees:

- **A mount is admitted, not assumed.** It is refused with `507` if it would breach the cursor's RAM
  budget (the reason carries the projected and ceiling figures), and `409` for a name already mounted
  or a chain this runtime does not declare. `?dry_run=true` answers the same question without mounting.
  A refused mount leaves nothing behind, including a nest it fetched to find out.
- **It catches up before it joins.** A cursor advances from the *slowest* of its live nests, so a nest
  spliced in while far behind would drag every co-tenant back through history. A new nest backfills
  alongside the cursor and joins once it is level. The first nest onto a chain starts that chain's
  cursor, exactly as boot would.
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

## When one nest goes wrong

A runtime survives its sick nests (RFC-0026). A nest that faults is **quarantined**, not fatal: its
healthy siblings keep indexing and serving, and it is re-admitted on a backoff if the fault was
retryable. A terminal fault (a corrupt registry, a config that can't load) stays quarantined until
you fix it. The blast radius is bounded in both directions - a nest's error doesn't kill its cursor,
and a cursor's death doesn't kill the runtime.

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

A runtime is bounded **per cursor** at 2 GB, and the sum of a machine's cursors has to fit the machine.
When it stops fitting - or when serving load and ingestion load want different dials - the same crates
run as a fleet across machines: a writer pool taking cursor leases, and an independently-scaled serving
tier. See [scaled mode](/docs/operate/scaled/).

It is a trade rather than an upgrade: one runtime on one box is simpler, and that simplicity is the point
of the embedded path.
