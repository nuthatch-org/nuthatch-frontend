---
title: Host nests for others
description: Run one runtime that other people's nests are mounted into over an API - publish, price, mount by identity, pause, move, reclaim and meter, with no orchestration on your side.
order: 8.5
checked: 5.14.1 (2026-10-31)
---

This is the guide for running nuthatch **as a host**: one runtime, started with nothing in it, that
nests are added to, paused, moved and removed over an HTTP API while it keeps serving the rest. It is
the shape a platform uses, and it is equally the shape of one operator who wants to manage a box by
script instead of by editing files and restarting.

The whole contract fits in a sentence: **you hand the runtime a nest identity (NID), and the runtime
fetches it, verifies it, stores it, indexes it and serves it.** Nothing on your side unpacks bundles,
runs schema tools or starts processes. The lifecycle below is available since **3.13.0**, and what later releases added is marked with its version; run **3.13.1** or later, which fixes restarts
during moves and suspensions, validates names, and serves `/metrics` at the runtime root.

What stays outside the runtime, by design: who your callers are, what they may do, what they pay, and
how the process is supervised. nuthatch sees a tenant as an opaque label and knows nothing else about
it. Since **5.13.0** it enforces the shares and limits you configure for a label or a mount
([step 9](#9-shares-and-limits)), without knowing who is behind either. Sign-in, plans, per-caller
authorisation and billing belong to a gateway in front of the runtime; process supervision belongs to
systemd or a container restart policy.

Hosting is for operators, and the nuthatch team is one of them. It
[offers to host nests](/subgraphs/) for people and teams who ask on the
[Nuthatch Discord](https://discord.gg/p9Xc45txWa): the stock binary run as any operator would run it,
on our own boxes, with no billing, no accounts and no platform. One use is
[subgraph stopgap nests](https://learn-thegraph.com/dispatches/stopgap-nests-for-stranded-subgraphs/)
for BNB Chain and Polygon subgraphs The Graph network does not serve, until an indexer picks each one
up. The first is BetSwirl on BNB Chain, and its
[handback](https://github.com/nuthatch-org/nuthatch/blob/main/docs/stopgap/betswirl-bnb.md) says how
to run it yourself and how to go back to the network.

## The moving parts

- **A nest** is authored inputs (config, ABIs, views) packed into a content-addressed **bundle**.
- **A NID** is the nest's identity: the key its data is stored under, `data/<nid>/`. Change anything
  that changes what the nest indexes and you get a new NID; upgrading the nuthatch binary does not.
- **A registry** is where bundles live: a directory or an S3-compatible bucket. See
  [the nest registry](/docs/operate/registry/).
- **A runtime** is one `nuthatch dev --dir <dir>` process over a directory with a `mounts.toml`. It
  hosts many nests, with one cursor per chain. See [run many nests](/docs/operate/many-nests/).
- **A mount** gives a NID a name, served at `/<name>/`. Two mounts may share one NID and one dataset.

## 1. Publish the nests you will host

On the machine where a nest is built, bundle it into `usdc-<hash>.bundle`, publish that, and print the
NID a host mounts it by:

```sh
nuthatch nest bundle ./usdc
nuthatch nest publish usdc-<hash>.bundle --registry /srv/registry --as usdc@1.0.0
nuthatch nest nid --dir ./usdc
```

`nest publish` prints the NID as well as the hash. The registry indexes every bundle by NID, so a NID
is all a host needs: `nuthatch nest load <nid> --registry /srv/registry` pulls it anywhere, and refuses
a bundle whose own manifest does not compute to the NID asked for.

`nuthatch nest inspect <bundle|dir> --json` (since 5.13.0) describes a nest without running it or
touching the network: its NID, chain, contracts, entities, the cargo features and RPC kinds it needs,
and every endpoint it would reach, keyed URLs cut to scheme and host. Read it before you mount a
stranger's bundle.

A host that never runs the binary itself can do the same over the admin API (since 5.13.0), sending
the bundle file as the body with `Content-Type: application/octet-stream`:

```sh
curl -s -H "Authorization: Bearer $NUTHATCH_ADMIN_TOKEN" -H 'Content-Type: application/octet-stream' \
  --data-binary @usdc-<hash>.bundle 'localhost:8288/_admin/bundles?dry_run=true'
```

`?dry_run=true` checks the bundle exactly as `nest load` does and answers with the `nest inspect`
document and the price of mounting it; `?as=usdc@1.0.0` publishes it to the runtime's `--registry`;
`GET /_admin/bundles/<nid>` reads what the registry holds; and `POST /_admin/bundles/prune` deletes
what neither a NID in its `keep` list nor any mount of the runtime reaches (`?dry_run=true` lists
only). A bundle that fails the check is `422` and nothing is written; one over 64 MiB is `413`
(`--max-bundle-mb` changes it).

## 2. Start an empty runtime

Declare the chains you will serve, and nothing else:

```toml
# /srv/runtime/mounts.toml
[runtime]
name = "host-1"
max_rss_mb = 2048              # per-cursor RAM ceiling

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[[chains]]
chain = "base"
chain_id = 8453
rpc_urls = ["https://…"]
```

```sh
export NUTHATCH_ADMIN_TOKEN=$(openssl rand -hex 32)
nuthatch dev --dir /srv/runtime --listen 0.0.0.0:8288 --registry /srv/registry
```

- **Chains are declared here, or later over the API.** A chain's RPC is dialled when the first nest
  is mounted onto it, so an unused chain, or one whose endpoint is down when the process starts,
  cannot stop the runtime. Since 5.13.0 `POST /_admin/chains` declares another on a running runtime
  and `PUT /_admin/chains/<chain>/rpc` replaces a chain's RPC pool, with no restart: both ask every
  endpoint for `eth_chainId` first, refuse a wrong or silent one, and write `mounts.toml` before
  taking effect. A runtime started with `--rpc` or `--rpc-fallback` refuses both with `409`.
- **`--registry`** lets a mount fetch a NID the runtime does not hold. Without it, only NIDs already
  under `data/` can be mounted.
- **The admin API needs `NUTHATCH_ADMIN_TOKEN` off localhost.** Bound anywhere but localhost without
  it, the runtime serves no admin routes at all, and an empty runtime then refuses to start, since
  nothing could ever be mounted into it. On localhost a token is required too: without the variable
  the runtime makes one on first start in `<runtime>/.admin-token`, owner-only, and prints the admin
  URL with it in the startup log (since 5.11.0). `--no-admin` removes the routes everywhere.

Every admin call below takes the token as `Authorization: Bearer <token>` (or `?token=<token>`);
the examples set it once in a shell alias, with the `Content-Type: application/json` every `POST` needs,
including the bodiless suspend and resume (without it the API answers `415`):

```sh
alias nh='curl -s -H "Authorization: Bearer $NUTHATCH_ADMIN_TOKEN" -H "Content-Type: application/json"'
```

## 3. Price a nest before you mount it

```sh
nh -XPOST 'localhost:8288/_admin/nests?dry_run=true' -d '{"name":"usdc","nid":"9f2c…"}'
```

```json
{
  "name": "usdc", "nid": "9f2c…", "fetched": true, "shares": null,
  "chain": "mainnet", "start_block": 6082465, "tip": 21000000, "blocks_to_backfill": 14917535,
  "has_data": false, "per_block_rpc": ["[extract] blocks"],
  "incoming_mb": 180, "projected_mb": 420, "ceiling_mb": 2048,
  "refusal": null, "refusal_status": null
}
```

A dry run runs **the same admission checks a real mount runs** and mounts nothing, so its
`refusal_status` is exactly what the mount would answer. What each field tells you:

- `blocks_to_backfill` is the history ahead of it. `tip` is known only for a chain whose cursor is
  already running, since a dry run dials nothing; `has_data: true` means a dataset is already on disk
  and the figure is an upper bound.
- `per_block_rpc` lists extraction that costs RPC calls for every block on top of the shared
  `eth_getLogs`: `[extract] blocks`, `traces`, `top_level_calls`, `state`, `[[calls]]`. An empty list
  is the cheap case. See [costs](/docs/operate/costs/).
- `projected_mb` is the chain cursor's footprint with this nest added, against `ceiling_mb`.
- `shares` names a mount that already indexes this dataset: mounting it again costs nothing further.

If the NID had to be fetched, it was fetched and verified, and it stays installed for the real mount.

## 4. Mount it

```sh
nh -XPOST localhost:8288/_admin/nests -d '{"name":"usdc","nid":"9f2c…"}'
```

It answers `202 {"name":"usdc","nid":"9f2c…","phase":"accepted","since_unixtime":1790700000,"generation":0}`.
A mount is a **job**, because fetching and catching up can take minutes. Poll the one job, or list
every mount the runtime knows as `{"mounts": [...]}`:

```sh
nh localhost:8288/_admin/mounts/usdc
nh localhost:8288/_admin/mounts
```

| `phase` | Meaning |
|---|---|
| `accepted` | Recorded, not yet started. |
| `fetching` | Pulling the bundle from the registry and verifying it. Only when the runtime did not hold it. |
| `seeding` | Filling the dataset from a mirror, every file checked against its hash. Only for `"seed": true` (since 5.13.0). |
| `joining` | Catching up beside its chain's cursor before joining it, so co-tenants are never dragged back through history. |
| `live` | Indexing and serving at `/<name>/`. |
| `failed` | Refused or broken; `reason` says why. |
| `suspended` | Paused by the operator: off its cursor, answering `503`, until resumed. |

**`live` means indexing and serving, not caught up.** A mount onto a chain that already has a cursor
catches up beside it before it goes live. The first mount onto a chain starts the cursor and backfills
inside it, so it is `live` while history is still arriving. `/<name>/ready` gives the distance:
`lag_blocks` is how far behind the tip the nest is, and `ready` stays `true` while it catches up, since
readiness means serving and advancing. Treat a nest as caught up when `lag_blocks` is small.

Reading a job never waits on a mount in progress. Jobs are written to `mount-jobs.json` in the
runtime directory: after a restart an unfinished job resumes, and a failed one stays readable until
the name is mounted again or unmounted.

**Posting again is safe.** The same name and NID answers `202` with the running job, or `200` once it
is live. The same name with another NID is `409`: changing a live mount's nest is a move (step 7).

`?wait=true` answers only when the mount has finished, with the synchronous statuses below. It suits a
script; a platform should poll.

| Status | Why |
|---|---|
| `400` | A malformed NID, or a name the runtime would not accept (see step 5). |
| `401` | No token, or the wrong one. |
| `404` | The runtime does not hold the NID and was started without `--registry`. With `--registry`, a NID the registry lacks ends the job `failed` instead, its reason naming the NID. |
| `409` | The name is taken, the nest's chain is not declared, or that chain's cursor has died (restart the runtime). |
| `507` | The mount would breach the chain cursor's RAM ceiling; the reason carries projected and ceiling MB. |

On the job route the same refusals end the job `failed` with the same reason. A nest the runtime
fetched and then refused is removed again: a refusal leaves nothing on disk.

Since 5.13.0 a failed job also carries a `code` for a script to branch on, where `reason` is for a
person: `not_found` (the registry or mirror holds no such NID or file), `access_denied` (an S3 `401`
or `403`), `verification_failed` (the bytes served are not that nest, or a segment does not hash to
its address) and `other`, which covers every refusal above. A retry clears it.

### Rebuilding a runtime from its mirror

Re-indexing every nest over RPC is the slow way back from a lost box. Since 5.13.0 a mount can be
filled from a mirror first: point `[runtime.publish]` in `mounts.toml` at a bucket the old runtime
published to (a mount's own `[mounts.publish]`, or a `publish` table in the request, wins), and mount
each NID with `"seed": true`:

```sh
nh -XPOST localhost:8288/_admin/nests -d '{"name":"usdc","nid":"9f2c…","seed":true}'
```

The job reads `seeding` with `seed_progress`, checks every file against its content address exactly
as `nuthatch seed` does, and then follows the chain from the block after the mirror ends. A corrupt
segment fails it `verification_failed`; posting the same body again fetches only what is missing. A
dataset that has already indexed, or that another mount already serves, is not seeded again. S3
credentials come from the runtime's `AWS_*` environment, never the request.

Once live, the nest's full API is under its name: `/usdc/sql`, `/usdc/tables`, `/usdc/ready`. `GET
/nests` lists every live mount with its health, and `GET /ready` answers for the whole runtime.

## 5. Tenants and names

A mount's name is its route. For more than one party, name mounts `tenant/alias`:

```sh
nh -XPOST localhost:8288/_admin/nests -d '{"name":"acme/usdc","nid":"9f2c…"}'
nh -XPOST localhost:8288/_admin/nests -d '{"name":"globex/usdc","nid":"9f2c…"}'
```

Both mounts serve **one dataset**, indexed once. The tenant is a label nuthatch refcounts and knows
nothing else about: it never authenticates it or bills it. Since 5.13.0 it does divide query capacity
between labels, and honours the shares you set for them ([step 9](#9-shares-and-limits)).

**A mount's route depends on its own tenant alone** (3.13.1): the default tenant's mounts serve by
alias, under `/usdc`, and every other tenant's under `/acme/usdc`. Adding or removing another tenant, and
restarting, never moves a route.

A name is `alias` or `tenant/alias`, each part letters, digits, `_` and `-`, at most 64 characters. An
alias may not end in `__moving`, which a move uses for the nest it stages, and the default tenant is
never spelled out: mount `usdc`, not `default/usdc`. A name may not be a runtime route (`health`,
`nests`, `metrics`, `ready`, `_admin`), and a tenant may not share its name with a default-tenant
mount's alias, since their routes would collide. Any other name is refused with `400` before anything is written. A NID given to
the admin API is lower-cased, so one dataset has one directory.

## 6. Pause and resume

Suspending answers `200 {"suspended":"usdc"}`; resuming answers `202` with a mount job:

```sh
nh -XPOST localhost:8288/_admin/suspend/usdc
nh -XPOST localhost:8288/_admin/resume/usdc
```

A suspended mount leaves its cursor and releases its store, and its routes answer `503` with
`"suspended": true`, so a caller can tell a paused nest from a missing one. Its data and its record are
kept, and it **stays suspended across a restart** (`mounts.toml` lists it under `suspended`). A
suspended mount costs no RPC and no memory; it keeps its disk.

Resume is an ordinary mount of the recorded NID: it catches up from where it stopped, and serves the
`503` until it has joined. Resuming a quarantined mount is its explicit release. Suspending a name that
is not mounted is `404`; resuming one that is not suspended is `404`. While paused, its job reads
`suspended`, and posting a mount for the name resumes it just as `resume` does.

## 7. Move a name to a new version

A new version of a nest is a new NID. To repoint a name without a gap, move it; the answer is `202`, a
job under `"usdc"`:

```sh
nh -XPOST localhost:8288/_admin/move/usdc -d '{"nid":"4a71…"}'
```

The runtime mounts the new NID beside the old one, catches it up, and then switches the name's routes in
**one step**. A reader polling `/usdc` sees the old nest until that step and the new nest after it,
and never an error in between. The old nest is then taken off its cursor. A move keeps its chain; a
move whose new nest is refused leaves the old one serving and removes anything it fetched.

To keep the old version reachable, mount its NID under another name first; the move leaves that mount
alone.

## 8. Unmount and reclaim disk

Unmount a name, which answers `200 {"unmounted":"usdc"}`; unmount it and free the disk with
`?reclaim=true`; or free a dataset unmounted earlier:

```sh
nh -XDELETE localhost:8288/_admin/nests/usdc
nh -XDELETE 'localhost:8288/_admin/nests/usdc?reclaim=true'
nh -XDELETE localhost:8288/_admin/datasets/9f2c…
```

An unmount keeps the dataset, so mounting it again is free. Reclaiming removes it once **no mount
names it**; a dataset another mount still uses is kept and the answer says by whom:

```json
{"outcome": "kept", "nid": "9f2c…", "mounted_by": ["globex/usdc"]}
```

`DELETE /_admin/datasets/<nid>` answers `200` when it reclaimed, `409` when it kept, `404` when there
was nothing there. Inside a running runtime a reclaim removes the dataset and the segments only it
references. Segments a live nest may still be reading are left for `nuthatch prune`, run offline:
`prune --yes` refuses while a runtime holds the directory's `runtime.lock`.

## 9. Shares and limits

Since 5.13.0 (RFC-0073), with 5.14.0's changes (RFC-0076), the runtime divides what its tenants
share and lets you narrow what each mount may do. All of it is operator configuration, written to
`mounts.toml` before it takes effect and changed with no restart; none of it touches a NID or
re-indexes anything.

**Tenant shares.** Each chain's cursor has one SQL gate of `sql_permits` permits (two by default),
and the process has one budget of response bytes in flight. Both are divided by tenant label. Only a
tenant with a query queued or running is seated on a gate, so a tenant with a thousand idle mounts
holds nothing (since 5.14.0; in 5.13 every mounted tenant held one permit). A gate keeps a reserve of
`max(1, sql_permits / 8)` permits that only a tenant holding none may take, so a newly active tenant
finds one within the 250 ms admission wait unless more tenants arrive in that wait than the reserve
holds. A tenant past its share is answered `429` with `"reason": "tenant_share"`; a full gate still
answers `503` `busy`. A runtime with one tenant, and a lone nest, behave as before.

```sh
nh -XPUT localhost:8288/_admin/tenants/acme -d '{"weight":2,"max_permits":1,"max_response_mib":32}'
nh localhost:8288/_admin/tenants
```

`weight` (1 to 1000, default 1) sets the tenant's fair share, `max_permits` caps the permits it holds
on any one gate, and `max_response_mib` its response bytes in flight; they persist under
`[tenants.acme]`. `PUT` with `{}` restores the default. `GET /_admin/tenants` shows each tenant's
share, what it holds, its waits and its refusals, per chain too.

**The memory ceiling and the permit count.** `PUT /_admin/runtime` changes `max_rss_mb`, each
cursor's RAM ceiling, and since 5.14.0 `sql_permits`, the size of every cursor's gate:

```sh
nh -XPUT localhost:8288/_admin/runtime -d '{"max_rss_mb":4096,"sql_permits":6}'
```

A ceiling below what a cursor already holds is `409`, and so is a permit count, or a ceiling, that
the cursor's memory split cannot hold. 2,048 MB is the default and the budget nuthatch is designed and
gated for; above it is your choice, the answer says `"above_default": true`, and nothing measures it
for you. `GET /_admin/runtime` reports both with what each cursor holds. Without `[runtime]
sql_permits`, `NUTHATCH_SQL_MAX_CONCURRENCY` sets the count at boot.

**Per-mount limits.** A mount may lower the `/sql` guards for itself, on `POST /_admin/nests` or
live with `PATCH /_admin/mounts/<name>`:

```sh
nh -XPATCH localhost:8288/_admin/mounts/acme/usdc -d '{"limits":{"statement_timeout_ms":5000,"max_rows":1000}}'
```

The fields are `statement_timeout_ms`, `max_rows`, `max_result_bytes`, `max_hot_rows`,
`max_hot_bytes`, `max_named_scan_bytes`, `analytics_memory_bytes`, `max_queued` and, since 5.14.0,
`window_deadline_ms`, which is not a query guard but how long one window of indexing may take before
it is abandoned and asked for again. A limit only lowers: a value above the process's is `400`,
naming the ceiling. They are kept under `[mounts.limits]`, outside the NID, so two mounts of one
dataset may carry different ones. `{"limits": {}}` returns a mount to the process values. Requests
already running finish under the limits they started with. `analytics_memory_bytes` is approximate:
two mounts of one NID share the dataset's engine pool, so one mount's cap can refuse its query while
the other is busy.

**Strict isolation.** By default every mount of one dataset shares its SQL session, engine memory
pool and answer cache, which is right when one operator owns every mount. `[runtime] isolation =
"strict"` gives each tenant label its own of all three, holds `/sql` and the views it reaches to a
function allow-list, and runs only `CREATE VIEW` from a nest's `views/*.sql`. **The isolation
guarantee is not claimed**: the threat model,
[`docs/security/shared-runtime.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/security/shared-runtime.md),
says what it is meant to stop and what it does not defend (timing, shared CPU, the engine's own memory
safety), and it is not a guarantee until an independent review has run against it.

## 10. Meter it

The runtime serves `/metrics` at its root, before anything is mounted, broken down per mount with the
label `{nest="<name>"}`:

| Series | Use |
|---|---|
| `nuthatch_nest_hot_store_bytes` | This nest's hot store on disk. |
| `nuthatch_nest_sealed_segments_bytes` | The sealed segments this nest's manifest names. |
| `nuthatch_nest_last_block`, `nuthatch_nest_tip_lag_blocks` | Where it is, and whether it is keeping up. |
| `nuthatch_nest_rows_decoded_total` | Indexing work done. |
| `nuthatch_nest_health` | `1` indexing, `0` quarantined. |

Segments are content-addressed and shared: a segment two datasets both contain counts under both
nests. For disk actually used, read the unlabelled `nuthatch_sealed_segments_bytes`, which counts each
segment store once. A mount that shares another's dataset has no storage series of its own; its bytes
are reported under the mount that indexes it.

Since 5.13.0 the serving counters are per mount too, labelled by the name a request arrived through,
so two aliases of one dataset are counted apart: `nuthatch_nest_http_requests_total`,
`nuthatch_nest_sql_queries_total`, `nuthatch_nest_sql_rejections_total{nest,reason}` and the
`nuthatch_nest_sql_duration_seconds` histogram. See [metrics](/docs/operate/metrics/) for the full
list.

**What one request cost.** A request to `/sql`, `/q/{name}` or a typed route that sends
`Nuthatch-Cost: 1` is answered with a `Nuthatch-Cost` header:

```text
Nuthatch-Cost: sealed_bytes=1409; hot_rows=12; engine_us=3793; peak_mem_bytes=0; queue_us=0; result_bytes=219712; sealed_bytes_read=1409; scan_cpu_us=2140
```

`sealed_bytes` is worked out from segment footers before the statement runs, so the same statement
over the same segments always reports the same figure, and it is the one to build on.
`sealed_bytes_read` is what was actually fetched and can vary between runs; `engine_us` is wall time,
and `scan_cpu_us` the thread CPU spent in segment scans, not in the joins and aggregates above them.
It is a report, not a price: nuthatch bills nothing, and a request that does not ask computes none of
it.

## 11. Put a gateway in front

The runtime is the data plane. What it protects is itself: a RAM budget per cursor, query timeouts, a
bounded SQL surface per mount, and the admin token. What it does not do is know your users. A gateway
in front should:

- terminate TLS and authenticate callers;
- map a caller to the mounts they may read, and route `/<name>/` only for those;
- hold the admin token and never expose `/_admin/` to callers;
- meter and bill from the per-nest series above, the `Nuthatch-Cost` header and its own request log.

Keep the admin API on a private interface or behind the gateway only. The token is the one thing
between the network and a mount.

## 12. Faults, restarts and upgrades

- **One nest's fault stays its own.** Since 5.13.0 a panic in a nest's ingest quarantines that nest
  alone, terminally, with the panic message as its reason; the cursor and its co-tenants carry on,
  and the nest keeps answering from its last committed window. A nest that fails to build at boot,
  or no longer fits its cursor's ceiling, boots quarantined and answers `503` with the reason while
  the rest boot. Boot fails only when every nest does; `--fail-fast` restores the strict behaviour.
- **A slow nest stays its own too.** Since 5.14.0 a runtime's cursor is an extraction stage feeding a
  bounded window buffer, with one ingest task per nest reading it from its own position, so a nest
  whose windows are slow delays only itself; see [Run many nests](/docs/operate/many-nests/).
  `window_deadline_ms` ([step 9](#9-shares-and-limits)) bounds how long one of its windows may take.
- **Restart** at any time. Mounts come back from `mounts.toml`, suspended mounts stay suspended,
  unfinished jobs resume, and a fetch a killed process left half-staged is cleared first.
- **Upgrade the binary** by replacing it and restarting. NIDs are independent of the nuthatch version,
  so no dataset moves and nothing re-indexes. See [upgrades](/docs/operate/upgrades/).
- **Supervise** the process with systemd or a container restart policy. A runtime whose every cursor
  has died exits non-zero so the supervisor restarts it; a runtime with nothing mounted, or whose
  nests have all been unmounted, stays up and waits.

### Read replicas, and upgrades without an outage

A runtime alone is unavailable while it restarts: its listener binds only after every mount is
built. Since 5.13.0 a **follower** serves every mount read-only beside it, from the sealed segments
and a copy of each hot tip fed by the writer's `GET /_admin/feed`:

```sh
NUTHATCH_ADMIN_TOKEN=<the writer's token> \
  nuthatch serve --runtime /srv/runtime --follow http://127.0.0.1:8288 --listen 127.0.0.1:8289
```

Its answers are the writer's, with the same `as_of`, `sealed_through` and `nid`, so the followers and
the writer can sit behind one load balancer. Adding one needs no writer restart and re-indexes nothing.
A mount answers `503` `catching_up` until its snapshot arrives, and `/<tenant>/<alias>/ready` reports
the writer as `connected` or `absent` and the follower's lag in generations. A follower keeps serving
through a writer restart. It has no admin surface: mounts, limits and shares go to the writer.

Since 5.14.0 a follower can run on **another host**, sharing no path with the writer:

```sh
NUTHATCH_ADMIN_TOKEN=<the writer's token> \
  nuthatch serve --follow https://writer.internal:8288 \
    --mirror s3://nests/mirror --registry s3://nests/registry \
    --cache /var/lib/nuthatch/follower --max-rss-mb 2048 --listen 0.0.0.0:8289
```

It takes sealed segments from the writer's mirror, each checked against the hash its catalogue names,
and each nest's config from the registry by NID. The mirror must publish for followers, which is off by
default because it uploads offchain snapshots too and needs delete permission: set `followers = true`
in `[runtime.publish]` or `[mounts.publish]`, and publish each nest's bundle to the registry. A slow
mirror shows as lag, never as a short answer. Cross-region latency has not been measured.

To upgrade with no outage, roll the followers first, one at a time, waiting for each to report
`"writer": "connected"` and `"lag_generations": 0`, then the writer last; while it restarts the
followers keep answering as of the last block it committed. `scripts/rolling-upgrade.sh` in the
repository does exactly this. The release gate runs it from the previous release and reports the
result without blocking the tag; 5.14.0 is the first release it ran across two. 5.12 had no feed, so
the first rolling upgrade is from 5.13.

## The whole walkthrough

On the build side:

```sh
nuthatch nest bundle ./usdc
nuthatch nest publish usdc-<hash>.bundle --registry /srv/registry --as usdc@1.0.0
NID=$(nuthatch nest nid --dir ./usdc)
```

On the host side, polling the mount until its `"phase"` is `"live"` before the query:

```sh
nuthatch dev --dir /srv/runtime --listen 0.0.0.0:8288 --registry /srv/registry &
nh -XPOST 'localhost:8288/_admin/nests?dry_run=true' -d "{\"name\":\"acme/usdc\",\"nid\":\"$NID\"}"
nh -XPOST localhost:8288/_admin/nests -d "{\"name\":\"acme/usdc\",\"nid\":\"$NID\"}"
nh localhost:8288/_admin/mounts/acme/usdc
curl -s 'localhost:8288/acme/usdc/sql?q=SELECT%201'
```

Later:

```sh
nh -XPOST localhost:8288/_admin/suspend/acme/usdc
nh -XPOST localhost:8288/_admin/resume/acme/usdc
nh -XPOST localhost:8288/_admin/move/acme/usdc -d '{"nid":"<new nid>"}'
nh -XDELETE 'localhost:8288/_admin/nests/acme/usdc?reclaim=true'
```

The same API is documented route by route in the [HTTP API reference](/docs/reference/http-api/).
