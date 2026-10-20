---
title: "Run it in production"
description: The whole path from a fresh box to a nest serving unattended - endpoint check, layout, service, exposure, backups, alerts, and what to do when it breaks.
order: 3
checked: 5.7.1
---

The other pages in this section each cover one surface. This one is the **path**: follow it top to
bottom on a fresh box and you end up with something you can leave running.

It assumes one machine and one chain. For many nests see [running many nests](/docs/operate/many-nests/); for more
than one machine see [scaled mode](/docs/operate/scaled/). Neither is a prerequisite, and one box is
the honest default.

## 0. What you need

- A Linux box. Two cores and 4 GB of RAM is comfortable for a single cursor, whose budget is 2 GB.
- Disk for sealed history. Parquet segments are compact but they grow forever, so give it room and
  watch it. A busy nest's segments are the thing that fills a disk, not the hot store.
- **An RPC endpoint that can actually serve a backfill.** This is the single most common cause of a
  bad first day, and it is checkable in advance. Do not skip step 1.

## 1. Check the endpoint before you trust it

```sh
nuthatch doctor --rpc https://your-endpoint/ --address 0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48
```

`doctor` probes the three limits that otherwise surface mid-backfill as a retry loop that merely looks
like slowness: max `eth_getLogs` width, max JSON-RPC batch size, and archive depth. It prints the
largest safe `--window` for that endpoint. With `--dir`, it probes the full declared contract set,
not merely the first address, so the advice matches the filter the backfill will actually issue.

Three failure modes worth knowing before they cost you an afternoon:

- **Archive depth.** Several well-known free endpoints answer only ~100 blocks behind tip and return
  an "archive requests require a token" error beyond that. Such an endpoint cannot serve a backfill at
  all, however fast it looks on a tip query. Since 4.11.0 a backfill that meets that refusal stops at
  once and says to supply an archive-capable endpoint, rather than retrying.
- **Range caps.** Providers refuse an oversized range in inconsistent ways, sometimes with a 400 that
  reads like a client error. nuthatch splits and adapts around these, but an endpoint with a tight cap
  and no batching will be slow no matter what you set.
- **Address caps.** Some endpoints refuse an `eth_getLogs` naming too many addresses (publicnode on
  BSC: 10 or more). A nest with several contracts, or a factory nest, asks by address, so since 4.11.0
  nuthatch halves the address list until the endpoint accepts it, rather than reading the refusal as a
  credentials error.

Pass `--address` so the probe matches what a real nest asks for; some endpoints cap an unfiltered
query harder than a filtered one.

## 2. Lay the box out

```text
/opt/nuthatch/my-nest/       the nest: nuthatch.toml, abis/, views/, checks/, and its data
/usr/local/bin/nuthatch      the binary
```

Create an unprivileged user that owns only the nest directory:

```sh
sudo useradd --system --home /opt/nuthatch --shell /usr/sbin/nologin nuthatch
sudo install -d -o nuthatch -g nuthatch /opt/nuthatch
```

Get the nest itself either by scaffolding from a contract address:

```sh
nuthatch init 0xA0b8… --chain mainnet --dir /opt/nuthatch/my-nest
```

or by loading a published nest, verified by content hash:

```sh
nuthatch nest load https://…/my-nest.bundle --dir /opt/nuthatch/my-nest
```

A loaded bundle is checked against its manifest: every file's hash, plus a decode registry
regenerated from the inputs and compared to the pinned one. A nest that loads decodes exactly as its
author intended. See [the registry](/docs/operate/registry/).

## 3. Do the backfill deliberately, before it is a service

Run the history once by hand so you watch it finish and know how long it takes:

```sh
sudo -u nuthatch nuthatch dev --dir /opt/nuthatch/my-nest \
  --seal-direct --concurrency 8 --window "$(: use what doctor told you)"
```

`--seal-direct` writes finalized history straight to Parquet instead of through the hot store, which
avoids writing and later pruning the same rows in redb. Its speedup over the ordinary path is being
re-measured on a deterministic replay rig after public-RPC runs disagreed, so do not plan from an old
multiplier. Let it reach the tip, then stop it. The service you install next will resume rather than
start over.

If the nest ships `checks/`, prove it before serving anyone:

```sh
nuthatch check --dir /opt/nuthatch/my-nest
```

## 4. Install the service

```ini
# /etc/systemd/system/nuthatch@.service   (templated, so one unit serves many nests)
[Unit]
Description=nuthatch indexer (%i)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nuthatch
WorkingDirectory=/opt/nuthatch/%i
ExecStart=/usr/local/bin/nuthatch dev --dir /opt/nuthatch/%i \
          --listen 127.0.0.1:8288 --seal-direct --concurrency 8
Restart=on-failure
RestartSec=5
# The per-cursor budget. A regression gets killed and restarted rather than taking the box with it.
MemoryMax=2G
# Least privilege: it needs its own directory and the network, nothing else.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nuthatch/%i

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now nuthatch@my-nest
journalctl -u nuthatch@my-nest -f
```

`MemoryMax=2G` matches the budget nuthatch holds itself to, so the two agree rather than fight.

Shutdown is graceful: SIGTERM drains in-flight requests and checkpoints the ingest task, so a restart
resumes cleanly.

## 5. Decide exposure on purpose

nuthatch binds `127.0.0.1` by default and that default is doing real work. **The API has no
authentication of its own** - the guards bound *how much* a query can cost, never *who* may ask.

**A public nest without an allowlist is an open query engine.** `sql = "open"` is the default, and it
is the right one for a local `nuthatch dev` where exploration is the point. On an endpoint strangers
can reach it means anyone may run arbitrary analytical SQL over your disk. Set `sql = "allowlist"` on
the mount and declare the queries it answers, or `sql = "deny"` to close SQL while the typed routes
keep serving - see [Security](/docs/operate/security/#bounding-what-a-mount-will-answer).

Put a reverse proxy in front and give it TLS and auth:

```caddy
indexer.example.com {
    basic_auth {
        reader $2a$14$…          # caddy hash-password
    }
    reverse_proxy 127.0.0.1:8288
}
```

Then make three decisions explicitly rather than by default:

| Surface | Decision |
|---|---|
| `/sql` | A real analytical surface. Guarded, but a caller can still ask expensive questions. Read [security](/docs/operate/security/) before exposing it to anyone you do not trust. |
| `/_admin/` | **Mutates state** - it mounts and unmounts nests. Off localhost it requires `NUTHATCH_ADMIN_TOKEN` set *and* presented per request. Want no remote admin at all? Bind localhost and pass `--no-admin`. |
| `/health`, `/ready` | Unauthenticated by design so a load balancer can probe them. Leave them reachable. |

## 6. Watch the two numbers that matter

Scrape `GET /metrics`. Alert on these and treat everything else as diagnosis material:

- **`nuthatch_tip_lag_blocks`** - sustained growth means you are not keeping up, and it is nearly
  always the RPC endpoint rather than nuthatch.
- **`nuthatch_rss_bytes`** - approaching the 2 GB per-cursor ceiling.

A frozen `nuthatch_last_poll_unixtime` means a stalled poller, which is the failure that otherwise
looks like "the data just stopped being interesting". In a runtime, add `nuthatch_nest_health` and
`nuthatch_cursor_live`, because a *partly* unwell runtime still answers `/health` on the whole. Full
list in [metrics](/docs/operate/metrics/).

`/ready` is the honest liveness signal for a load balancer: it answers *is this nest serving and making
progress*, and reports `stalled` when every endpoint in the pool is refusing a window. A nest still
backfilling is ready, so if "caught up" is what you need, add a `lag_blocks` threshold on top.

## 7. Back it up

The nest directory is the whole of it. Sealed segments are content-addressed and immutable, so they
copy safely **while the process runs**:

```sh
rsync -a /opt/nuthatch/my-nest/ backup:/backups/my-nest/
```

Restoring is putting the directory back and starting the binary. No schema migration, no external
state to reconcile.

Worth knowing what is precious and what is not: `nuthatch.toml`, `abis/`, `views/` and `checks/` are
authored and must be kept. `nuthatch.redb` and `segments/` are derived - losing them costs
a re-backfill, not data you cannot recover.

## 8. Know your upgrade path before you need it

Two different axes, and conflating them is the usual confusion:

- **The binary**: a swap and a restart. A newer release reads an older one's hot store and sealed
  segments as they are. Back up the old binary first, restart one nest, check it, then the rest.
- **The nest** (its schema, views or decode): stage the new version and run `nuthatch migrate`. The
  runtime classifies the change itself and **refuses a breaking one by name** until you accept it; a
  cosmetic edit adopts the existing data and re-indexes nothing. See
  [upgrades](/docs/operate/upgrades/).

Verify parity rather than assuming it: note a few row counts before, re-run them after. Query
responses carry a `provenance` block whose `registry_hash` fingerprints the decode and schema. An
unchanged hash across an upgrade says the rows are decoded the same way; it says nothing about
authored views or entities, which can change without moving it. Parity of answers is the row counts
and query results you compare at a fixed watermark.

## 9. Prove it, do not assume it

```sh
./scripts/verify.sh 0 1 2 3 4
```

An acceptance runbook where every step is falsifiable, covering the artifact, a single nest,
correctness, a runtime, and the guards. See [verifying a deployment](/docs/operate/verifying/), which
also states plainly which levels we have run ourselves and which we have not.

## Pre-flight checklist

Before you walk away from it:

- [ ] `doctor` passed against the endpoint you are actually using
- [ ] Backfill completed by hand, and you know how long it took
- [ ] `nuthatch check` passes, if the nest ships checks
- [ ] Service is enabled, survives `systemctl restart`, and comes back after a reboot
- [ ] `MemoryMax` set, and the box has headroom above it for queries
- [ ] Bound to localhost, with a proxy terminating TLS and auth in front
- [ ] `NUTHATCH_ADMIN_TOKEN` set, or `--no-admin` passed, and you know which and why
- [ ] `/metrics` scraped, with alerts on tip lag and RSS
- [ ] A backup that has been **restored once**, because an untested backup is a hope
- [ ] Someone knows where [troubleshooting](/docs/operate/troubleshooting/) lives

## When it breaks

Start at [troubleshooting](/docs/operate/troubleshooting/), which is organised symptom to metric to
remedy. The three that account for most of it:

- **Tip lag climbing** - the endpoint, nearly always. Re-run `doctor` against it.
- **A `503` from `/sql`** - a guard did its job. Two queries are already running, or one asked for
  more of the unsealed tip than the budget allows. Retry or narrow the query; do not raise the gate.
- **A nest quarantined in a runtime** - its siblings are fine by design. `GET /nests` carries the fault
  and the re-admission time.
