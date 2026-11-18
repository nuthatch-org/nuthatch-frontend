---
title: Compliance pack
description: Optional labels, flags, exposure and alerts - a derive-only stage over decoded transfers.
order: 7
checked: 5.22.0 (2026-11-17)
---

Some nests need more than raw rows: flag transfers that cross a threshold, measure an address's
exposure to a labeled set, raise an alert when something fires. The **compliance pack** is an optional
stage over your decoded transfers - off by default, deterministic, and, like every optional
integration, it costs nothing when it isn't configured.

> Labels and lists are **local, content-addressed snapshots** you fetch and pin - nuthatch never
> reaches for a gated service mid-decode. That would break the
> [no-phone-home rule](/docs/concepts/determinism/).

> **Removed in 5.0.0.** Live sanctions screening went with the WASM transform layer: the `[screening]` table, `nuthatch
> screen`, `nuthatch audit replay` and the `screen_status` MCP tool. A `nuthatch.toml` that still
> declares `[screening]` is refused at load, with an error that names the table; delete it and the nest
> loads unchanged. `sanction_hit` rows a 4.x nest already sealed stay queryable from `/sql`.

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
  `eu-consolidated`, or your own via `--url`/`--file`) as a pinned, hashed address set. Since
  5.22.0 a label set is **not part of the nest**: `labels/` and `labels.manifest.json` count toward
  neither the [NID nor the data identity](/docs/concepts/nest-identity/), no sealed byte comes from
  them, `nest bundle` does not pack them and the mirror does not copy them. To delete a set, remove
  its `labels/<sha256>.json` and its entry in `labels.manifest.json`, then restart; every chain table
  and the NID stay as they were.
- **`[flags]`** - two built-in rules, not arbitrary SQL. `threshold` flags any single transfer at or
  above an amount; each match becomes a sealed, append-only **`threshold_flag`** annotation, on the tip path and, since
  5.11.0, under a `--seal-direct` backfill too (a dataset sealed directly before 5.11.0 has no flags for
  that history until re-indexed). `velocity`
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
threshold flags in a block range (since 5.18.0 it refuses a nest with no `[flags] threshold`, or a
dataset it cannot read, rather than report zero flags), and `nuthatch audit sealed` checks sealed history against a second
endpoint. Effectful notification (the alert POST) happens **after** sealing, never in the decode
path - the same rule as webhooks (see [Determinism](/docs/concepts/determinism/)).

## Delivery is durable

Alerts ride the same host-side [webhook](/docs/build/webhooks/) delivery engine: at-least-once, via a
durable outbox, with retries and backoff. A stalled sink never blocks indexing - it only backs up its own
queue (`nuthatch_alert_outbox_depth` in [/metrics](/docs/operate/metrics/)). Since 5.18.0 each sink
drains on its own, so one dead sink does not hold up deliveries to the others.

## Query the annotations

Flags are ordinary rows. Query the live counts over the HTTP API - `GET /flags?kind=threshold`
or `?kind=velocity` - or the full sealed history in SQL:

```sql
SELECT * FROM threshold_flag ORDER BY block_number DESC LIMIT 20;
```

Since 5.21.0 an authored view over the imported `labels` answers; before it, such a view failed to
define. And while the derived state rebuilt at start read a segment quarantined since, `/flags` and
`/exposure` carry `"derived_state_stale": true` until a restart rebuilds them from what remains.

## As of a block or a time

Since 5.22.0 a figure can be asked as it stood at a report date. `GET /at?time=<unix seconds>`
places a time against the nest's own stamped blocks, and `at_block` or `at_time` on `/sql` answers
over the rows at or below that block (see the [HTTP API](/docs/reference/http-api/#as-of-a-block-or-a-time)).
An as-of read binds the label set **as imported now**, so import a set as it stood at the date you
are asking about. An answer that read `labels` carries the set's `labels_sha256` in its provenance.

## Recipes for an issuer's own token

Four [recipes](/docs/build/recipes/) arrived in 5.22.0 for a FiatToken-style stablecoin, one whose
contract emits `Blacklisted`, `UnBlacklisted`, `Mint` and `Burn`:

- **`frozen`** - every address blacklisted now, with its balance and the block it was frozen at.
- **`outstanding`** - total supply less frozen balances and the balances of addresses labelled
  `treasury`, as an attestation counts it. It needs a label set, which may hold no `treasury` row:
  `recipe add outstanding` refuses a nest without one.
- **`mint_burn_daily`** - per UTC day, what zero-address transfers minted and burned, the `Mint` and
  `Burn` event amounts beside them, and supply at the day's end.
- **`fiat_threshold`** - transfers above a fiat amount at their UTC day's rate, from an
  [offchain](/docs/reference/cli/#offchain-data-rfc-0045) table of `day` and `rate` (currency per whole token), to
  recipients in none of the given label sets. Mints and burns are left out. A day with no rate, or
  two different ones, lists its transfers with `priced = false` rather than leaving them out.

```sh
nuthatch recipe add frozen
nuthatch labels import treasury.csv && nuthatch recipe add outstanding
nuthatch offchain drop eur.csv --table eur
nuthatch recipe add fiat_threshold --amount 1000 --rates eur --decimals 6 --unless-label vasp
```

Each is an ordinary view, so `at_time` on `/sql` gives supply and freezes at a report date. The
nuthatch repo's [`examples/mica-art22`](https://github.com/nuthatch-org/nuthatch/tree/v5.22.0/examples/mica-art22)
computes the four MiCA Art 22(1) figures over EURC with each deduction of the EBA's RTS as its own
view. It is a worked example, not regulatory advice.

## Evidence bundles

`nuthatch evidence make` (5.22.0) asks a running nest for one answer as of a sealed block and writes
a bundle: the chain, NID, registry hash, statement, block, rows, a hash of the rows in canonical
order, the label set's hash when the rows read `labels`, and a hash of the final segments they were
read from. `--key` signs it with a [pack key](#the-shape). `nuthatch evidence verify` asks a nest of
the same NID the same statement at the same block and says `match`, or names the field that
differs. [Verifying](/docs/operate/verifying/#an-answer-someone-else-can-check) has the walkthrough.

## Next

- [Webhooks](/docs/build/webhooks/) - the delivery engine alerts share
- [The semantic layer](/docs/build/semantic/) - describe what a flag means
- [nuthatch.toml](/docs/build/config/) - where the stage is configured
