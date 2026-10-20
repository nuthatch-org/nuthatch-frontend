---
title: Compliance pack
description: Optional labels, flags, exposure and alerts - a derive-only stage over decoded transfers.
order: 7
checked: 5.8.1
---

Some nests need more than raw rows: flag transfers that cross a threshold, measure an address's
exposure to a labeled set, raise an alert when something fires. The **compliance pack** is an optional
stage over your decoded transfers - off by default, deterministic, and, like every optional
integration, it costs nothing when it isn't configured.

> Labels and lists are **local, content-addressed snapshots** you fetch and pin - nuthatch never
> reaches for a gated service mid-decode. That would break the
> [no-phone-home rule](/docs/concepts/determinism/).

:::note[Removed in 5.0.0]
Live sanctions screening went with the WASM transform layer: the `[screening]` table, `nuthatch
screen`, `nuthatch audit replay` and the `screen_status` MCP tool. A `nuthatch.toml` that still
declares `[screening]` is refused at load, with an error that names the table; delete it and the nest
loads unchanged. `sanction_hit` rows a 4.x nest already sealed stay queryable from `/sql`.
:::

## The shape

```toml
[flags]                              # singular table - two built-in rules
threshold = "1000000000000"          # flag any single transfer ≥ this (base units, decimal string)
velocity_amount = "5000000000000"    # flag an address whose windowed outbound volume ≥ this
velocity_window = 7200               # window in BLOCKS (≈24h at 12s blocks); default 7200

[[alerts]]
kinds = ["threshold_flag"]           # which annotation kinds to deliver
url = "https://your-service/alerts"
# format = "raw"                     # default; "discord" posts a Discord-shaped message
```

- **Labels** - content-addressed sets of tagged addresses, imported with `nuthatch labels import
  <file>` and listed with `labels list`. They feed the **exposure** view: an address's direct
  counterparty exposure to the labeled set, served at `/exposure/{addr}` and by the `exposure` MCP
  tool. `nuthatch lists fetch` still snapshots a published list (built-in `ofac-sdn`,
  `eu-consolidated`, or your own via `--url`/`--file`) as a pinned, hashed address set.
- **`[flags]`** - two built-in rules, not arbitrary SQL. `threshold` flags any single transfer at or
  above an amount; each match becomes a sealed, append-only **`threshold_flag`** annotation. `velocity`
  flags an address whose outbound volume over `velocity_window` **blocks** reaches `velocity_amount`;
  this one is a *live* windowed view (served at `/flags?kind=velocity`), not a sealed annotation - so it
  isn't deliverable via alerts. Amounts are base units as decimal strings; the window is a **block
  count**, not wall-clock - an honest approximation, since the chain has no clock.
- **`[[alerts]]`** - deliver annotations whose `kind` is in `kinds` to a `url`. The kinds are
  `threshold_flag`, which matches the emitted annotation exactly, and `entity_fault`, which fires
  when an [incremental entity](/docs/build/entities/) faults. `format` is `raw` (the default) or
  `discord`, for a Discord webhook URL.
- **The pack** - `nuthatch pack keygen`, then `pack build --key …`, signs a manifest of the decode
  registry hash, the flag thresholds and the alert sinks (ed25519). `keygen` writes the keypair
  owner-only, by default to `~/.nuthatch/nuthatch-key.json`, outside any nest. `pack verify --pubkey
  <hex|file>` checks one against the signer's public key you were given; the key inside the pack is
  never trusted, and an unsigned pack fails. Since 5.0.0 a manifest with `screening` or `components`
  entries is refused at `pack verify`.

## Determinism holds

Flags and exposure are deterministic derivations over decoded transfers - two numeric rules and a
labeled-set join, nothing that phones out mid-decode. They're re-executable: the same blocks and the
same label snapshot always produce the same annotations. `nuthatch audit report` summarises the
threshold flags in a block range, and `nuthatch audit sealed` checks sealed history against a second
endpoint. Effectful notification (the alert POST) happens **after** sealing, never in the decode
path - the same rule as webhooks (see [Determinism](/docs/concepts/determinism/)).

## Delivery is durable

Alerts ride the same host-side [webhook](/docs/build/webhooks/) delivery engine: at-least-once, via a
durable outbox, with retries and backoff. A stalled sink never blocks indexing - it only backs up its own
queue (`nuthatch_alert_outbox_depth` in [/metrics](/docs/operate/metrics/)).

## Query the annotations

Flags are ordinary rows. Query the live counts over the HTTP API - `GET /flags?kind=threshold`
or `?kind=velocity` - or the full sealed history in SQL:

```sql
SELECT * FROM threshold_flag ORDER BY block_number DESC LIMIT 20;
```

## Next

- [Webhooks](/docs/build/webhooks/) - the delivery engine alerts share
- [The semantic layer](/docs/build/semantic/) - describe what a flag means
- [nuthatch.toml](/docs/build/config/) - where the stage is configured
