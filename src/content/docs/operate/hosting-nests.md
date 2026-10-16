---
title: Host nests for others
description: Run one runtime that other people's nests are mounted into over an API - publish, price, mount by identity, pause, move, reclaim and meter, with no orchestration on your side.
order: 8.5
checked: 5.6.3
---

This is the guide for running nuthatch **as a host**: one runtime, started with nothing in it, that
nests are added to, paused, moved and removed over an HTTP API while it keeps serving the rest. It is
the shape a platform uses, and it is equally the shape of one operator who wants to manage a box by
script instead of by editing files and restarting.

The whole contract fits in a sentence: **you hand the runtime a nest identity (NID), and the runtime
fetches it, verifies it, stores it, indexes it and serves it.** Nothing on your side unpacks bundles,
runs schema tools or starts processes. Everything below is available since **3.13.0**; run **3.13.1** or later, which fixes restarts
during moves and suspensions, validates names, and serves `/metrics` at the runtime root.

What stays outside the runtime, by design: who your callers are, what they may do, what they pay, and
how the process is supervised. nuthatch sees a tenant as an opaque label and knows nothing else about
it. Sign-in, plans, per-tenant authorisation, quotas and billing belong to a gateway in front of the
runtime; process supervision belongs to systemd or a container restart policy.

Hosting is for operators. The nuthatch team runs no hosted nest service, with one
exception approved on 2026-10-06: it serves
[subgraph stopgap nests](https://learn-thegraph.com/dispatches/stopgap-nests-for-stranded-subgraphs/)
for BNB Chain and Polygon subgraphs The Graph network does not serve, until an indexer picks each one
up. Each is the stock binary run as any operator would run it, with no billing, no accounts and no
platform. The first is BetSwirl on BNB Chain, and its
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

On the machine where a nest is built:

```sh
nuthatch nest bundle ./usdc                  # → usdc-<hash>.bundle
nuthatch nest publish usdc-<hash>.bundle --registry /srv/registry --as usdc@1.0.0
nuthatch nest nid --dir ./usdc               # the NID a host mounts it by
```

`nest publish` prints the NID as well as the hash. The registry indexes every bundle by NID, so a NID
is all a host needs: `nuthatch nest load <nid> --registry /srv/registry` pulls it anywhere, and refuses
a bundle whose own manifest does not compute to the NID asked for.

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

- **Chains are declared at boot**, and only there. A chain's RPC is dialled when the first nest is
  mounted onto it, so an unused chain, or one whose endpoint is down when the process starts, cannot
  stop the runtime. Adding a chain means a restart.
- **`--registry`** lets a mount fetch a NID the runtime does not hold. Without it, only NIDs already
  under `data/` can be mounted.
- **The admin API needs `NUTHATCH_ADMIN_TOKEN` off localhost.** Bound anywhere but localhost without
  it, the runtime serves no admin routes at all, and an empty runtime then refuses to start, since
  nothing could ever be mounted into it. `--no-admin` removes the routes everywhere.

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
# 202 {"name":"usdc","nid":"9f2c…","phase":"accepted","since_unixtime":1790700000}
```

A mount is a **job**, because fetching and catching up can take minutes. Poll it:

```sh
nh localhost:8288/_admin/mounts/usdc     # one job
nh localhost:8288/_admin/mounts          # {"mounts": [...]} - every mount the runtime knows
```

| `phase` | Meaning |
|---|---|
| `accepted` | Recorded, not yet started. |
| `fetching` | Pulling the bundle from the registry and verifying it. Only when the runtime did not hold it. |
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

Once live, the nest's full API is under its name: `/usdc/sql`, `/usdc/tables`, `/usdc/ready`. `GET
/nests` lists every live mount with its health, and `GET /ready` answers for the whole runtime.

## 5. Tenants and names

A mount's name is its route. For more than one party, name mounts `tenant/alias`:

```sh
nh -XPOST localhost:8288/_admin/nests -d '{"name":"acme/usdc","nid":"9f2c…"}'
nh -XPOST localhost:8288/_admin/nests -d '{"name":"globex/usdc","nid":"9f2c…"}'
```

Both mounts serve **one dataset**, indexed once. The tenant is a label nuthatch refcounts and knows
nothing else about: it never authenticates it, limits it or bills it.

**A mount's route depends on its own tenant alone** (3.13.1): the default tenant's mounts serve by
alias, under `/usdc`, and every other tenant's under `/acme/usdc`. Adding or removing another tenant, and
restarting, never moves a route.

A name is `alias` or `tenant/alias`, each part letters, digits, `_` and `-`, at most 64 characters. An
alias may not end in `__moving`, which a move uses for the nest it stages, and the default tenant is
never spelled out: mount `usdc`, not `default/usdc`. Any other name is refused with `400` before
anything is written.

## 6. Pause and resume

```sh
nh -XPOST localhost:8288/_admin/suspend/usdc     # 200 {"suspended":"usdc"}
nh -XPOST localhost:8288/_admin/resume/usdc      # 202, a mount job
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

A new version of a nest is a new NID. To repoint a name without a gap:

```sh
nh -XPOST localhost:8288/_admin/move/usdc -d '{"nid":"4a71…"}'    # 202, a job under "usdc"
```

The runtime mounts the new NID beside the old one, catches it up, and then switches the name's routes in
**one step**. A reader polling `/usdc` sees the old nest until that step and the new nest after it,
and never an error in between. The old nest is then taken off its cursor. A move keeps its chain; a
move whose new nest is refused leaves the old one serving and removes anything it fetched.

To keep the old version reachable, mount its NID under another name first; the move leaves that mount
alone.

## 8. Unmount and reclaim disk

```sh
nh -XDELETE localhost:8288/_admin/nests/usdc                    # 200 {"unmounted":"usdc"}
nh -XDELETE 'localhost:8288/_admin/nests/usdc?reclaim=true'     # and free the disk
nh -XDELETE localhost:8288/_admin/datasets/9f2c…                # free one unmounted earlier
```

An unmount keeps the dataset, so mounting it again is free. Reclaiming removes it once **no mount
names it**; a dataset another mount still uses is kept and the answer says by whom:

```json
{"outcome": "kept", "nid": "9f2c…", "mounted_by": ["globex/usdc"]}
```

`DELETE /_admin/datasets/<nid>` answers `200` when it reclaimed, `409` when it kept, `404` when there
was nothing there. Inside a running runtime a reclaim removes the dataset and the segments only it
references. Segments a live nest may still be reading are left for `nuthatch prune`, run offline.

## 9. Meter it

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
are reported under the mount that indexes it. See [metrics](/docs/operate/metrics/) for the full list.

## 10. Put a gateway in front

The runtime is the data plane. What it protects is itself: a RAM budget per cursor, query timeouts, a
bounded SQL surface per mount, and the admin token. What it does not do is know your users. A gateway
in front should:

- terminate TLS and authenticate callers;
- map a caller to the mounts they may read, and route `/<name>/` only for those;
- hold the admin token and never expose `/_admin/` to callers;
- meter and bill from the per-nest series above and from its own request log.

Keep the admin API on a private interface or behind the gateway only. The token is the one thing
between the network and a mount.

## 11. Restarts and upgrades

- **Restart** at any time. Mounts come back from `mounts.toml`, suspended mounts stay suspended,
  unfinished jobs resume, and a fetch a killed process left half-staged is cleared first.
- **Upgrade the binary** by replacing it and restarting. NIDs are independent of the nuthatch version,
  so no dataset moves and nothing re-indexes. See [upgrades](/docs/operate/upgrades/).
- **Supervise** the process with systemd or a container restart policy. A runtime whose every cursor
  has died exits non-zero so the supervisor restarts it; a runtime with nothing mounted, or whose
  nests have all been unmounted, stays up and waits.

## The whole walkthrough

```sh
# build side
nuthatch nest bundle ./usdc
nuthatch nest publish usdc-<hash>.bundle --registry /srv/registry --as usdc@1.0.0
NID=$(nuthatch nest nid --dir ./usdc)

# host side
nuthatch dev --dir /srv/runtime --listen 0.0.0.0:8288 --registry /srv/registry &
nh -XPOST 'localhost:8288/_admin/nests?dry_run=true' -d "{\"name\":\"acme/usdc\",\"nid\":\"$NID\"}"
nh -XPOST localhost:8288/_admin/nests -d "{\"name\":\"acme/usdc\",\"nid\":\"$NID\"}"
nh localhost:8288/_admin/mounts/acme/usdc          # until "phase": "live"
curl -s 'localhost:8288/acme/usdc/sql?q=SELECT%201'

# later
nh -XPOST localhost:8288/_admin/suspend/acme/usdc
nh -XPOST localhost:8288/_admin/resume/acme/usdc
nh -XPOST localhost:8288/_admin/move/acme/usdc -d '{"nid":"<new nid>"}'
nh -XDELETE 'localhost:8288/_admin/nests/acme/usdc?reclaim=true'
```

The same API is documented route by route in the [HTTP API reference](/docs/reference/http-api/).
