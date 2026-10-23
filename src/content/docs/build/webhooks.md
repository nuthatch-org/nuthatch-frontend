---
title: Webhooks
description: POST sealed rows to a URL - an optional delivery stage, past finality, at-least-once. The deposit sweep's webhook is separate, and carries retractions.
order: 8
checked: 5.11.0 (2026-10-23)
---

A webhook pushes rows out to a URL as they're indexed - feed a downstream service, a queue, a Slack
channel. It's an optional stage: configure one and rows flow; configure none and the nest is a plain
indexer. Unconfigured, it **warns and skips** rather than failing.

## The shape

```toml
[[webhooks]]
name = "large-transfers"
table = "usdc__transfer"          # rows from this table
where = "value_dec > 1000000"      # optional SQL predicate - note the key is `where`, not `when`
url = "https://your-service/hooks/usdc"
# batch_max = 100                  # optional rows-per-POST cap (default 50)
# finality = "sealed"              # "sealed" (default, and the only mode today); "tip" is planned
# since = "registration"           # "registration" (default) | "genesis" | a block number, quoted: "26091000"
# secret = "…"                     # optional HMAC-SHA256 secret → X-Nuthatch-Signature header
```

Repeat `[[webhooks]]` for each destination. A webhook can carry a `where` predicate so you deliver only
the rows you care about. Setting a `secret` signs each POST with an `X-Nuthatch-Signature: sha256=<hex>`
header, so your receiver can verify it came from this nest.

A webhook that cannot work refuses the nest at start (since 5.11.0): a `table` or `where` that does
not bind against the nest's schema, or a `since` that is not one of the three forms. The error names
the webhook and the field. Before 5.11.0 such a webhook was accepted and never fired.

## Delivered past finality

Webhooks fire on **sealed** rows - past finality, when history is immutable. That's deliberate: a row
delivered before finality could be un-emitted by a reorg, forcing you to chase it with a retraction on the
consumer side. By firing only past finality, nuthatch delivers rows that will never roll back.

> The tradeoff is latency: a webhook trails the tip by the chain's finality distance. If you need
> tip-latency reads, poll the [live HTTP surface](/docs/operate/serving/) or the
> [MCP](/docs/ai/mcp/) tools instead. Those see the hot store; webhooks are for durable downstream
> delivery. The MCP has no subscriptions.

## At-least-once, host-owned

Delivery is at-least-once with host-managed retries and backoff - the host owns orchestration and state.
Make your consumer **idempotent**: key on `(tx_hash,
log_index)` (or `_seq`) and a redelivery is a no-op. On restart, delivery resumes from the last
acknowledged seal, so a crash mid-batch doesn't drop rows.

## Not in the decode path

The POST is an effect, so it lives **after** sealing, never inside decode or entity derivation. A slow or
failing endpoint can't stall or corrupt indexing - it only backs up its own delivery queue. Webhooks
fill at most half the outbox, so compliance alerts keep room; when that half is full a webhook holds
its cursor and resumes from it, rather than dropping deliveries (since 5.11.0). This is the
same purity rule that governs enrichers and alerts (see [Determinism](/docs/concepts/determinism/)).

## The deposit sweep's webhook is a different one

Everything above is about `[[webhooks]]`, which deliver table rows past finality. An address-history
nest with a deposit sweep (RFC-0064, since 5.4.0) has its own `webhook` key under
`[address_history.sweep]`, and that one works differently: it POSTs the **deposits feed**, the same
numbered entries `GET /api?module=account&action=nuthatchDeposits&after=<seq>` returns, oldest first.

```toml
[address_history.sweep]
confirmations = 12                               # optional: sweep this many blocks under the head
webhook = "https://processor.example/deposits"   # optional: POST the deposits feed here
```

Without `confirmations` the sweep stops at the finalized head, and nothing it delivers is ever taken
back. With `confirmations` set it runs above finality, so a reorg can take back a deposit that was
already sent. The feed then gains a retraction, `{"event": "retraction", "retracts": <seq>, ...}`, and
the webhook delivers it like any other entry, followed by the replacement as a new deposit. Credit on a
deposit and reverse on its retraction, or raise `confirmations` until reorgs that deep do not happen
on your chain.

Delivery is at-least-once: a batch is marked delivered only after a 2xx, so drop repeats by `seq`. The
feed is the record and the webhook only pushes it, so a consumer can always read from its last `seq`
instead.

## Next

- [Compliance pack](/docs/build/compliance/) - alerts ride this delivery path
- [Serving](/docs/operate/serving/) - the tip-latency alternative
- [Determinism](/docs/concepts/determinism/) - why effects sit outside the core
