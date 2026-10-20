---
title: "Scaled mode: a fleet"
description: When one machine is no longer enough - a writer pool, an independently-scaled serving tier, and a control plane.
order: 11
checked: 5.8.0
---

Everything else in these docs is **embedded mode**: one binary, no external services, the thing
`curl | sh` gets you. That is still the primary way to run nuthatch and the one you should reach for
first.

Scaled mode is a different deployment for a different problem - **one operator running many nests
across many machines**. It is opt-in at build time (`--features postgres-store`), so the default
published binary carries no database driver and embedded mode stays a single file with nothing beside
it. Each release also ships the scaled build as a separate `nuthatch-scaled-*` tarball and a
`ghcr.io/nuthatch-org/nuthatch:<version>-scaled` image.

## When to reach for it

Two reasons, and neither of them is "it sounds more serious":

- **A single box can no longer hold your cursors** inside its RAM budget. A runtime is bounded per
  cursor at 2 GB, and Σ cursors has to fit the machine.
- **Serving load and ingestion load want different dials.** A backfill that saturates a writer
  shouldn't slow queries, and a traffic spike shouldn't slow indexing.

If neither applies, a [runtime](/docs/operate/many-nests/) on one machine is simpler, and that simplicity is
the point of the embedded path. Scaled mode is not an upgrade; it is a trade.

## The three roles

The same crates, run three ways. A role flag, never a fork.

| Role | Command | Owns |
|---|---|---|
| **Control plane** | `nuthatch control --db <postgres>` | *desired state* - what should run |
| **Writer** | `nuthatch worker --control-db <postgres> --hot-store <postgres> --chains <chain>` | cursors it holds a **lease** on; ingests, decodes, seals |
| **Query-FE** | `nuthatch serve --dir <nest> --hot-store <postgres>` | nothing - serves from shared state |

```sh
nuthatch init 0xYourContract --chain arbitrum-one --dir nest
sudo chown -R 10001:10001 nest      # see below - this one is easy to miss

# Both are required. The stack refuses to start without them, by design.
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export NUTHATCH_CONTROL_TOKEN=$(openssl rand -hex 32)

docker compose -f docker-compose.scaled.yml --profile fleet up \
  --scale writer=2 --scale fe=3
```

Three prerequisites, all of which cost us time before they were written down:

- **The credentials have no defaults, deliberately.** The compose file used to ship
  `POSTGRES_PASSWORD: nuthatch` and a `dev-token-change-me` fallback, which defeated the binary's own
  guard in the one case it exists for: `CONTROL_BIND` is parameterised, so reaching the control plane
  from another host means setting it to `0.0.0.0` - at which point a baked-in token means the bind is
  *accepted*, protected by a string published in a public repo. Compose now fails with a message
  naming what to set, rather than starting something reachable with a credential anyone can read.

- **The fleet mounts `./nest`.** Without it the FE nodes exit and the **writers keep running** - they
  take work from the control plane rather than from disk. That asymmetry makes it look like an FE bug
  rather than a missing directory.
- **It must be owned by uid 10001.** The image runs unprivileged, so a root-owned bind mount is
  unwritable to it and the FE nodes exit with `Permission denied`. This **passes on Docker Desktop and
  fails on Linux**, because Desktop fakes mount permissions - so a Mac that works is not evidence.

## Three things to understand before you run it

These are the ones that will otherwise puzzle you at an unsociable hour.

### The control plane states intent; it commands nothing

`POST /nests` records that a nest should run and returns `200`. That does **not** mean it is running - 
it means the fleet has been told to run it. A writer picks it up on its next tick.

There is deliberately no "start this nest on worker w3" endpoint. It would be the one call able to put
a cursor somewhere the scheduler did not choose and the lease did not arbitrate.

### Ownership is a lease, and the store enforces it

A cursor is held by exactly one writer at a time. If a writer stalls - long GC, paused container, a
host that goes away for ninety seconds - its lease expires and another writer takes over.

When the original wakes up, **its writes are refused by the store**, not merely unlikely to collide.
Every write carries a fence, and a stale fence is rejected inside the same transaction as the write. A
worker that checked its own lease before writing would be checking a fact that can expire between the
check and the write; this cannot.

The worker stops on its own as well. Since 4.11.0, a worker whose tick finds a cursor's lease held by
another worker aborts that cursor's ingestion on the same tick and keeps running the cursors it still
holds. Before, it carried on fetching and only the fence refused its writes.

That is why `--scale writer=N` is safe.

### The control plane and the lease are independent, on purpose

A control-plane outage stops *rescheduling*, not *ingestion*. Writers keep their leases and keep
working.

It follows that the two can legitimately **disagree**: a writer whose heartbeat has lapsed but whose
lease is still live keeps its cursor, and the scheduler's wish to rehome it is refused. That is
correct, not a fault. A plan is not permission.

## "Why is my nest not running?"

`GET /plan` runs the same placement logic the writers run, and reports what could not be placed and
why:

```json
{"assign":[{"chain":"mainnet","worker":"writer-1"}],
 "unplaceable":[{"chain":"base","rss_mb":2400,"reason":"toolargeforanyworker",
   "detail":"this cursor alone exceeds the largest worker's budget - adding workers will not help"}]}
```

The two reasons need different responses:

- `noroomrightnow` - every worker is at its budget. **Add a worker.**
- `toolargeforanyworker` - the cursor alone exceeds the largest worker's entire budget. **Adding
  workers will not help.** Split the nests across chains, or raise the budget.

Collapsing those into one message would send you shopping for hardware that cannot fix it.

## Versions are pinned fleet-wide

Every FE node resolves an endpoint through the control plane, not through the registry's movable
`latest`:

```sh
curl -XPUT localhost:8290/nests/usdc/pin \
  -H 'Content-Type: application/json' -d '{"version":"1.3.0","bundle_hash":"0x…"}'
```

If each node read `latest` for itself, then during an upgrade one node would serve the new schema
while another served the old - **the same endpoint answering differently depending on where the load
balancer sent the request.** Nothing errors; the only symptom is a consumer watching a column appear
and disappear.

A declared-but-unpinned endpoint is explicitly **not servable**. An FE refuses rather than guesses,
because guessing is each node choosing a version for itself.

A *compatible* update re-pins the same endpoint. A *breaking* one is a second endpoint served
alongside the first, so existing consumers keep working - which is the whole point of the breaking
path.

## Secrets never enter a bundle

Private RPC URLs and API keys live in the control plane, keyed by nest:

```sh
curl -XPUT localhost:8290/nests/usdc/secrets \
  -H 'Content-Type: application/json' -d '{"key":"rpc_url","value":"https://private…"}'
```

A writer receives only the secrets of the nests it is actually assigned. The interface is
**write-only** - you can list which keys exist, never read a value back.

Baking a credential into a content-addressed bundle would leak it *and* break addressing, since two
nests differing only in credentials would hash differently. Because secrets sit outside, **rotating
one changes no bundle hash**, so it never invalidates segment reuse or forces a re-index.

## Exposure

The control plane **refuses to start** off-localhost without `NUTHATCH_CONTROL_TOKEN`. Not a warning - 
a refusal. It decides what an entire fleet runs, so an unauthenticated one on a public interface is
not a configuration anyone chooses on purpose.

`/health` stays unauthenticated so a load balancer can probe it; it reveals nothing.

## What scaled mode is not

Per-tenant billing, metering, quotas, or authz between mutually-untrusting **paying** customers. Those
belong to a gateway in front of nuthatch and are deliberately out of scope.

The line: *multi-nest co-tenancy* and *distributed self-hosted* mode are both in scope - one operator's
cooperating nests. Charging strangers for isolated access is a different product.

## Where nests come from

The scheduler decides which machine holds a cursor, so the machine that ends up holding it may have
nothing on disk. A worker indexes whatever is under `--nest-root` and **pulls anything else** from a
registry:

```sh
nuthatch worker --registry s3://my-nests/registry …
```

What is on the box wins. A nest you placed there is a deliberate act - often a hand-edited view or a
debug build - and is never silently replaced by the registry's copy.

**Pin the bundle, not just the version.** With a `bundle_hash` pinned, a worker fetches by **content
address** and never consults the registry's index, so re-tagging `1.0.0` cannot change what any worker
runs. Unpinned, your fleet is exactly as trustworthy as your registry.

Pulled bundles are cached at `<--nest-cache>/<name>/<hash>`. Content-addressed, so re-pinning resolves
to a different directory and actually re-pulls rather than quietly reusing what is already there - and
so the cache is safe to delete at any time.

## Honest limits

**Until 0.9.3 the writer pool did not write.** `worker` registered, took leases, loaded secrets and
reported - and contained no indexing code at all. A worker acquired a cursor and did nothing with it.

Read the previous version of this section as a cautionary tale: it said *"10/10, nothing skipped"*, and
that was **true**. Those ten checks are real and they passed. But every one of them tested the control
plane - registration, planning, lease fencing, version pinning, secrets - and **not one asserted that a
row appeared.** A suite that verifies the machinery around a thing rather than the thing reads exactly
like a suite that works.

**Now verified across real machines** (three Hetzner boxes on a private network, published artifacts,
control plane and store on one box and writers on their own):

- workers registering and being scheduled from another machine
- a real lease handover under contention, with the store-enforced fence advancing
- a 10-minute clock jump moving lease expiry rather than ownership
- **indexing into the shared store** - `last_block` advancing, the check that could not have passed before
- **377 blocks indexed through a 90-second control-plane outage.** Losing the control plane stops
  *rescheduling*, not *ingestion*; that split is the design, and it now has a number attached.

**Not yet verified:** the registry pull above has a runbook check that deletes a writer's nest and
asserts it pulls one anyway, and that check has not been run on real machines yet.

**Scaled mode remains younger and less exercised than embedded mode**, which runs in production. If one
process per box is enough, that is still the shape to reach for.

The full design and its acceptance criteria are in
[RFC-0022](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0022-distributed-scaled-mode.md);
the operator guide covers it at
[docs/operators.md](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md#scaled-mode-a-fleet-across-machines-rfc-0022).
