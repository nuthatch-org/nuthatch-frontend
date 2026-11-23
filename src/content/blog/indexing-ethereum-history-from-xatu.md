---
title: "Most of an indexer's RPC bill is timestamps. Xatu's Parquet removes the rest."
date: "2026-11-22"
description: "Where the RPC calls of a backfill actually go, a null-timestamp mode that removes the biggest line, and an opt-in Ethereum history source that reads old logs from ethPandaOps' public Parquet. With measured numbers for USDC."
author: "cargopete"
tags: ["nuthatch", "xatu", "parquet", "rpc", "backfill", "ethereum", "timestamps"]
---

*The Xatu source described here is merged to main ([#3087](https://github.com/nuthatch-org/nuthatch/pull/3087)) and ships in the next release. The null-timestamp mode ships in v5.24.0.*

We went looking for a way to stop hammering RPC providers during backfills, expecting the answer to
be about `eth_getLogs`. It mostly wasn't.

The Xatu idea isn't ours. [leani](https://leani.dev), a lean Ethereum indexing node by [materkel](https://x.com/materkel) ([repo](https://github.com/smart-byte/leani)), showed that Xatu's public Parquet history can replace most of the RPC calls in a backfill. We rebuilt the same idea on Nuthatch's existing source trait. Thanks to Chris at GraphOps for pointing us at it.

## The bill is headers

The numbers below are from a GoodDollar nest on XDC: 14.3 million blocks, 3.88 million events,
indexed with block timestamps on.

| method | calls |
|---|---|
| `eth_getBlockByNumber` | 2,446,441 |
| `eth_getLogs` | 2,751 |
| `eth_blockNumber` | 14 |

Of 2,449,210 calls, 2,446,441 were block-header lookups. Every one of them was there to stamp a row
with a time. The logs were nearly free by comparison.

XDC's public RPC does not put `blockTimestamp` on its logs, so each block holding a matching log
costs a header call. Providers that do stamp logs (Alchemy mainnet does) cost nothing here, which is
why you only notice this on some chains.

## The null-timestamp mode

If your nest never asks a time-series question, there is a cheaper option than paying for the
column: keep it, and leave it `null`.

```sh
nuthatch init --null-timestamps
```

`block_timestamp` stays on every table and is `null` on every row, so the schema doesn't change shape.
No header is fetched to stamp a row. Join on `block_number` when you need time. It is an init-time
choice and nothing fills the nulls in later, because sealed segments are immutable. The details are
in the [operator notes](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md).

This works on every chain. It does not help if you do want the times.

## The other option: someone already has the data

ethPandaOps publish their Xatu dataset as public Parquet over HTTPS: logs, and a block file per
1,000 blocks that includes timestamps. No account, no key. For Ethereum mainnet after the Merge,
that is exactly the two things a backfill pays an RPC for.

So we wrote an opt-in source for it:

```sh
nuthatch dev --history-source xatu
```

It is off unless you name it, and mainnet only. A few properties we cared about:

- It wraps the normal RPC source rather than being a second indexer. Decode, sealing and serving see
  the same logs and timestamps.
- The dataset trails the chain head by 9 to 13 hours (measured 2026-11-22). The RPC serves the tail.
  Requests are split at 1,000-block file boundaries, so there is no gap and no duplicate.
- Each file is checked before use: one row per block, a parent-hash chain where the file carries one,
  and the RPC's hash for the file's last block must match. That is about one RPC call per 1,000
  blocks. Any failure falls back to the RPC for that range, with a log line.
- Tests run against small recorded mainnet fixtures and assert the logs and timestamps are identical,
  field for field, to the recorded `eth_getLogs` and header answers.

What it can't check: that every log in a block is present. The dataset has no receipts root. Compare
a few `eth_getLogs` answers if you need proof for a range you care about.

## Measured

USDC on Ethereum mainnet, backfilled the way the indexer's windows do it, once through Alchemy alone
and once through the dataset with Alchemy behind it, on 2026-11-22. A digest over every log and its
timestamp was identical in both runs.

| blocks | source | wall time | RPC requests | logs |
|---|---|---|---|---|
| 5,000 | RPC only | 56.1 s | 488 | 483,027 |
| 5,000 | Xatu + RPC | 26.1 s | 5 | 483,027 |
| 50,000 | RPC only | 441.1 s | 4,176 | 4,161,008 |
| 50,000 | Xatu + RPC | 267.2 s | 83 | 4,161,008 |

The 50,000-block run downloaded 1,899 MB. The remaining RPC requests are the hash checks.

Caveats, all of which cut in the RPC's favour or are unmeasured: it was one stream in a debug build,
and the real indexer fans windows out concurrently, which speeds up the RPC-only side more than the
other. Alchemy stamps logs, so the RPC-only run never paid for headers; on a provider that doesn't,
the saving is bigger, and we haven't run that case. Read the request counts as the result and the wall
times as "no slower".

## When to use which

- Dense contract, mainnet, backfilling old history: the Xatu source.
- Any chain, don't need times: null timestamps.
- A sparse contract on a cheap provider: neither. The Parquet files are tens of MB per 1,000 blocks
  however few logs you want.

XDC, HyperEVM, Monad and Arc have no public dataset we could find, so on those chains null timestamps
is the only lever today.

The PR is [nuthatch-org/nuthatch#3087](https://github.com/nuthatch-org/nuthatch/pull/3087) and the code is at
[github.com/nuthatch-org/nuthatch](https://github.com/nuthatch-org/nuthatch).
