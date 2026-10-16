---
title: "What it costs to run"
description: "RPC requests are the bill RAM doesn't show - what following tip costs per day, why block_timestamps is the reason, and the honest number for a nest nobody reads."
order: 6
checked: 5.6.3
---

[Metrics & footprint](/docs/operate/metrics/) covers RAM. This page covers a different bill: **RPC
requests**, which is what your provider actually charges for, and which does not stop after backfill
- a nest following tip keeps paying it for as long as it runs. Being your own indexer does not make
this cost disappear; it means you are the one who sees it.

## Per day, per block

Following tip costs requests on every poll, whether or not a block carried an event: a tip call,
and when a window commits, a reorg check, a checkpoint and a `finalized` probe. On a chain producing
345,600 blocks a day (Arbitrum's rate), a cursor polling every two seconds paid roughly one header per
block for as long as it ran. From 3.11 the default poll interval was the chain's block time, never
under 2 s; since 4.15.2 it is 5 minutes. An idle poll skips the reorg check.

## `block_timestamps` is the reason

A timestamp lives in the block header, not in the log `eth_getLogs` returns, so serving
[`block_timestamp`](/docs/reference/config/#block_timestamps) costs one extra `eth_getBlockByNumber`
per distinct block. That cost does not end when backfill does - a nest at tip pays it again on every
new block, indefinitely.

**Since 3.11, only on a node that does not say.** Current execution clients put `blockTimestamp` on
every log, and nuthatch now takes the timestamp from there, fetching a header only for a block whose
logs lack it. The same 20,000-block Sepolia backfill paid 4,444 `eth_getBlockByNumber` on 3.9.0 and
34 after, and sealed byte-identical segments.

Turning it off is only an option if nothing that reads your nest ever asks a time-series question.
It's an init-time choice, not a flag you can flip later: dropping the column afterward is a breaking
schema change and a full re-index. If you're unsure, keep it on - most nests turn out to need it once
someone builds a "last N days" view against them.

## Measured, not modelled

On our own reference deployment
([#750](https://github.com/nuthatch-org/nuthatch/issues/750), audited 2026-08-22): four nests, one
week, **~11.8M RPC requests** against **~100 HTTP requests actually served** - roughly **118,000 RPC
requests per HTTP request answered**, and if anything an understatement, since that ~100 excludes
only one nest's own audit-probe traffic and not the others'.

One of those four was explicitly labelled *temporary* and was stopped once the audit surfaced it: 2.8M
RPC requests over five days to hold three entities and 98 MB on disk. What remains running is **~9M
RPC requests a week** across the other three nests, and the audit's own conclusion about that
remainder is that none of it is waste - it is load established, not assumed, to be necessary. Both
Lodestar panels turned out to need the column, confirmed by reading the consuming app's own SQL
rather than assumed: one filters on `block_timestamp` for a "last seven days" view, the other uses it
as an entity's `createdAt`. The full per-nest table is in the
[operator docs](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md#what-a-nest-costs-at-tip).

The busiest of the three averaged **~549,000 requests a day** over the audit window, on a chain
producing about 345,600 blocks a day - the right order of magnitude for a header fetch per block plus
its log polling on top.

## The multiplier nobody had measured

Everything above is the **nominal** bill: what a nest asks for when the endpoint answers. On a
rate-limited endpoint it asks for considerably more, and the reason is a loop.

Measured 2026-08-23 with the [replay rig](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0039-the-recorded-tape.md),
which records every call a run makes so the request the code *asked for* can be compared with what
actually went over the wire. A 120-block USDC range, fixed 20-block window:

| | |
|---|---:|
| calls the indexer made | **12** |
| HTTP requests those became | **84** |
| amplification | **7x** |

Five of six timestamp batches came back `429` from the bundled public endpoints, and each was retried
up to four times across a three-endpoint pool.

**Being rate-limited makes a nest send more requests, which gets it rate-limited harder.** On a free
tier you are not paying the nominal figure above, you are paying some multiple of it - and the
multiple grows exactly when the endpoint is least willing to serve you.

Two practical consequences, neither of them a recommendation to change a default:

- **Measuring nuthatch through a rate-limited endpoint measures the endpoint.** The same rig found the
  network to be **99.3% of backfill wall clock**, so a throughput number taken on a free tier is a
  statement about your provider.
- **A paid endpoint can be cheaper than a free one**, because the retry loop above never starts. That
  is an uncomfortable thing to put on our own page and it appears to be true.

Tracked as [RFC-0040](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0040-the-freshness-dial.md),
which argues for letting an operator trade freshness for money rather than paying a production-sized
bill for a dashboard nobody reads hourly. It shipped in 3.5.0 as two `nuthatch dev` flags:
`--poll-interval <DURATION>` sets how long a caught-up cursor waits before asking for the tip again,
and `--finality-only` caps the cursor at the chain's finality boundary so nothing it indexes can be
reorged. `/ready` reports both in its `freshness` object. Since 4.15.2 an unset `--poll-interval` means 5
minutes, so a new row can take that long to appear; pass a shorter interval, such as `2s`, for a nest
whose readers need the tip closely.

## What that costs against a priced endpoint

None of the volume above was billed - most of those nests run against a free public endpoint. Pricing
the header-fetch load alone against a metered one, the same way
[`benchmarks.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/benchmarks.md#what-a-backfill-costs-against-a-metered-endpoint-2026-08-19)
prices a backfill:

```
cost/month ≈ blocks/day × CU(eth_getBlockByNumber) × days/month × $/CU
           ≈ 345,600     × 20                       × 30         × $0.00000045
           ≈ $93/month
```

`eth_getBlockByNumber` at 20 CU, and $0.45 per million CU for the first 300M CU/month, are Alchemy's
own published pay-as-you-go rates, checked 2026-08-22:
[compute unit costs](https://www.alchemy.com/docs/reference/compute-unit-costs),
[pricing](https://www.alchemy.com/pricing).

This is the header-fetch term only, for one chain at Arbitrum's block rate. It excludes `eth_getLogs`
polling and every other RPC method a nest calls, so it's a floor, not a full bill.

## The honest number

A nest sitting at tip, answering nobody, still costs on the order of **~$100/month** against a paid
provider. That figure is this computation, not a measurement - the reference deployment itself paid
nothing for it, because it runs against a free endpoint.

Measured against a paid endpoint on 2026-09-06 ([#1173](https://github.com/nuthatch-org/nuthatch/issues/1173)),
a nest at tip on Arbitrum spent about 9,900 CU a minute, roughly $185 a month, and the computation
above had the attribution wrong: headers are bought only for blocks that produced a kept row, and 95
of that day's 345,600 blocks did. The header per block was the poll loop's own. At
`--poll-interval 5m` the same nest spends on the order of a hundred CU a minute for the same rows.

This isn't a recommendation to turn `block_timestamps` off. It's a real, inherent cost of following
tip with timestamps on, and whether to pay it is a decision made against your own consumers, not a
default this page is telling you to change.
