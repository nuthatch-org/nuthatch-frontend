---
title: "Deploy it"
description: systemd, Docker, and a reverse proxy - the whole distance from "it works on my laptop" to "it is running on my box".
order: 2
checked: 5.3.2
---

`nuthatch dev` **is** the serve command. It backfills, follows the tip, and serves the API in one
process - so deploying is running that under a supervisor. There is no separate server to stand up,
no queue, no database.

> This page is the **mechanics**: systemd, Docker, a proxy, backups. If you want the whole path from a
> fresh box to something you can leave running unattended, follow
> [Run it in production](/docs/operate/production/) instead, which puts these pieces in order and ends
> in a pre-flight checklist.

## systemd

```ini
# /etc/systemd/system/nuthatch.service
[Unit]
Description=nuthatch indexer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nuthatch
WorkingDirectory=/var/lib/nuthatch/mynest        # the nest directory (holds nuthatch.toml)
ExecStart=/usr/local/bin/nuthatch dev --listen 127.0.0.1:8288 --seal-direct --concurrency 8
Restart=on-failure
RestartSec=5
# Off-localhost the admin UI requires this; unset it and bind 127.0.0.1 to disable remote admin.
Environment=NUTHATCH_ADMIN_TOKEN=change-me
# Keep it inside the footprint budget; the box needs headroom for analytical queries.
MemoryMax=2G

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload && sudo systemctl enable --now nuthatch
journalctl -u nuthatch -f      # a clean progress line during backfill, then quiet tip-following
```

`MemoryMax=2G` matches the per-cursor budget nuthatch enforces on itself. Setting it means an
unexpected regression is killed and restarted rather than taking the box with it.

## Docker

```sh
docker run -d --name nuthatch --restart unless-stopped \
  -v "$PWD/mynest:/nest" -p 127.0.0.1:8288:8288 \
  -e NUTHATCH_ADMIN_TOKEN=change-me \
  ghcr.io/nuthatch-org/nuthatch:5.3.2
```

The image ships the **same binary attached to the GitHub Release** rather than a separate from-source
build, so the two cannot drift. It runs as an unprivileged user (uid 10001), carries only
`ca-certificates` beyond the binary, and mounts the nest directory at `/nest` - the only writable
state.

The default command binds `0.0.0.0:8288` *inside* the container. Publish it to `127.0.0.1` on the host
as above and put a proxy in front, exactly as on bare metal. `docker stop` sends SIGTERM, which drains
and checkpoints cleanly.

Pin the version tag rather than `:latest` for anything you care about. The image is `linux/amd64`
only. From 4.12.0 an aarch64 Linux box has release binaries, default and graph, so run the binary
under systemd there rather than the image under emulation.

**GraphQL is not in any image.** The image carries the default binary, which has no `/graphql` route.
A nest that serves Graph-dialect GraphQL runs on the `nuthatch-graph-<target>` release download, under
systemd as above.

**Scaled mode needs the `-scaled` tag.** The default image is the embedded build and carries no
database driver. `worker` and `control` still appear in its `--help` (the CLI surface is shared), but
running either gives a refusal naming the feature flag rather than a mysterious failure.

## Put something in front of it

nuthatch is built to be **fronted**, not exposed raw. TLS, authentication, rate limiting and metering
are the operator's layer; nuthatch ships the *guards* and *signals* that make fronting it safe.

```caddy
# Caddyfile - TLS and auth in front of a localhost-bound nest
indexer.example.com {
    basic_auth {
        reader $2a$14$...        # caddy hash-password
    }
    reverse_proxy 127.0.0.1:8288
}
```

Two things worth deciding deliberately:

- **`/sql` is a real analytical surface**, which means a caller can ask an expensive question. It is
  guarded (30 s timeout, 50,000-row cap, 64 MiB result ceiling, 2 concurrent queries), and those
  guards are what make exposure survivable - but read [security](/docs/operate/security/) before you
  put it in front of anyone you do not trust.
- **`/_admin/` mutates state** - mounting and unmounting nests. It is open on localhost and requires
  `NUTHATCH_ADMIN_TOKEN` on every request off it. If you do not want remote admin at all, bind
  `127.0.0.1` and do not set the token.

`/health` and `/ready` are unauthenticated by design so a load balancer can probe them. `/ready`
answers *is this nest serving and making progress?*, and reports `stalled` when every endpoint in the
pool is refusing a window. It is not a catch-up check: a nest mid-backfill, hundreds of blocks behind,
is ready. If a caller must only see a nest near the tip, gate on `lag_blocks` as well.

## Back it up

The nest directory is the whole of it. Sealed segments are content-addressed and immutable, so they
are safe to copy **while the process is running**:

```sh
rsync -a /var/lib/nuthatch/mynest/ backup:/backups/mynest/
```

Restoring is putting the directory back and starting the binary. There is no schema to migrate and no
external state to reconcile - which is the reason the hot/cold split exists in the first place.

## Upgrading the binary

A binary swap. No data migration, no re-backfill: a newer release reads an older one's hot store and
sealed segments as they are. Proven in production across 0.3.0 → 0.6.0 → 0.6.2 → 1.0.0 on a box that
has been serving public traffic throughout.

```sh
systemctl stop nuthatch
install -m755 nuthatch /usr/local/bin/nuthatch
systemctl start nuthatch
```

Upgrading a *nest* - its schema, views or decode - is a different axis with its own zero-downtime
path. See [upgrades](/docs/operate/upgrades/).
