---
title: "A nest in your browser"
date: "2026-10-17"
description: "Burrmill, nuthatch's query engine, now runs as WebAssembly in a browser tab. It answers SQL over a live nest's published segments, checks every byte against its content address, and needs no server for the query. What it does today, what it measured, and what it is not yet."
author: "cargopete"
tags: ["nuthatch", "burrmill", "webassembly", "mirror"]
draft: false
---

> **Updated 2026-10-18.** All three slices listed under "What this is not, yet" are built, and the tab can now index a contract from scratch. The section [Added 18 October](#added-18-october-an-indexer-you-build-in-the-tab) says what changed. The rest is kept as written.

Open [nuthatch-indexer.com/play](/play/) and a chart of the ETH/USD price since 1 January draws itself. The page holds no copy of the data, and no server ran the query. Your browser fetched 12 Parquet files from the public mirror, checked each one against the SHA-256 it is named by, and ran the SQL itself. On a cold visit that took 558 ms. On the next visit it fetches nothing.

**The query engine is the one nuthatch runs on a server, compiled to WebAssembly.** It is not a JavaScript lookalike written for the demo. Burrmill, the DataFusion engine that replaced DuckDB in 4.1, builds for `wasm32-unknown-unknown`. It binds a nest the way the binary does, one table at a time and only when a statement reaches it. Every view in this post gives the same rows in a tab as it does natively. We checked that to the byte, and later in the post we explain why that check alone was not enough.

## The nest it reads is real, and still indexing

The demo is a new nest, [defi-pulse-nest](https://github.com/nuthatch-org/defi-pulse-nest), built for this. It follows six Ethereum mainnet contracts from block 24,136,053, the first block of 2026: USDC mints and burns, USDT issues and redeems, Aave v3 liquidations, Lido's stake and withdrawal queue, and Chainlink's ETH/USD feed. Nine authored views sit on top. As of this morning that is 1.53 million sealed rows in 1,181 segments, about 125 MB.

It runs on our own hardware as an ordinary nest. As it seals segments past finality it publishes them to the [mirror](/mirror), the public R2 bucket that `nuthatch seed` already starts new nodes from. The tab reads that bucket. Nothing was built server-side for the browser, apart from a Cloudflare Worker that adds a CORS header.

Some of what it already shows:

- USDC on mainnet has minted **$177.9 billion** this year, across 819,544 events, and burned $181.5 billion. It runs at about $5 billion a week in each direction.
- USDT on mainnet issued $3.0 billion this year in **3** events and redeemed $17.25 billion in 7. Tether does most of its business elsewhere, and the chart says so without comment.
- Aave v3's worst day was 5 February: 1,873 liquidations repaying $114 million of debt. 31 January and 5 June come next.

## Why the browser has to check every byte

A public bucket is a convenience, not an authority. Anyone who controls it, or anything in front of it, could hand a browser a different file. So the tab never trusts a segment it has not checked. Segments are content-addressed: each file is named by the SHA-256 of its bytes. The worker hashes every download and refuses one that does not match its name, with an error that says so.

Checked bytes are only as good as their source, though. The hash proves the file is the one the manifest names, not that the manifest is honest about the chain. The page says as much, and the [RFC](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0065-the-nest-in-a-tab.md) plans the rest: two independent RPCs that must agree before the tab seals anything itself, then a light client.

Checked segments go into the origin-private file system, so a second visit costs nothing. We measured that with the browser's own resource timing, not the page's counters. A second visit that ran all nine views requested `manifest.json`, `schema.json` and the WebAssembly module, which came from the HTTP cache. It requested no segments.

## What it costs, including where we lose

The module is 53.7 MB of WebAssembly, 6.96 MB at maximum brotli. Our host compresses it on the fly, at a lower level, so a first visit downloads **10.5 MB**. That is a real cost, and it is the first thing we would like to shrink: SQL dialects and function families we never call are still linked in.

We measured every view in Chrome against DuckDB-Wasm. Both read the same segments from the same bucket, on the same page. "Cold" means a fresh engine with nothing kept, for both:

| View | Rows | Burrmill cold / warm | DuckDB-Wasm cold / warm |
|---|---:|---:|---:|
| stablecoin_supply_events | 1,366,665 | 17.3 s / 2.2 s | **16.0 s** / 12.4 s |
| stablecoin_daily_issuance | 290 | 12.3 s / 0.58 s | 14.2 s / 10.3 s |
| largest_supply_moves_7d | 25 | 15.1 s / 0.25 s | 15.4 s / 11.1 s |
| lido_daily_flows | 287 | 2.15 s / 0.13 s | 2.53 s / 1.98 s |
| aave_assets | 32 | 3 ms / 2 ms | 39 ms / 3 ms |
| eth_usd_hourly, aave_liquidations, aave_liquidations_daily | | answered | not run |

**DuckDB is faster cold on the largest view, by 1.3 s.** It makes range requests and reads only the columns it needs. Burrmill fetches each segment whole, because a hash can only be checked over the whole file. Warm, the order reverses: Burrmill reads its checked copies from disk, and DuckDB-Wasm, as we configured it, goes back to the network.

Three views did not run in DuckDB at all. They use `first_value(... ORDER BY ...)` as an aggregate, which DuckDB spells `first`. We ran the views unchanged rather than translate them, so this is a dialect gap, not a speed result. Where both engines answered, they gave identical rows, with one exception: one total differed in its last few digits, which is floating-point addition done in a different order. One more thing in DuckDB's favour, so it is not lost: its timings stop at Arrow, while ours include turning every row into JSON.

## The check that passed, and the answer that was still wrong

Our first gate for this work compared the tab with native Burrmill over the same files. It passed on all nine views, and we recorded it as passed. Then we drew the charts, and the ETH/USD line stopped on 25 September.

The mirror was incomplete. A table's last segment waits until it holds 1,000 rows before it is sealed and published. On a busy nest, the quiet tables fall far behind. Aave liquidations had reached the mirror only up to June. ETH/USD stopped in September. Lido's `WithdrawalsFinalized` table had never been published at all. So the withdrawal-queue view, in the browser and natively alike, reported **28,372** pending requests. The live nest said 148. Both engines agreed because both read the same gap.

We published the waiting segments by hand. Now we also check the tab against the live nest itself, and the two agree wherever the comparison is fair: 6,897 ETH/USD hours and 9,618 liquidations, row for row. The withdrawal queue reads 131 to the live nest's 148. The difference is the few requests filed since the last seal. The lag itself is a nuthatch bug now, [#2084](https://github.com/nuthatch-org/nuthatch/issues/2084). The lesson was cheap and we will pay it once: two copies of a reader that agree with each other prove nothing about the data they share.

## Charts without a charting library

Raw rows are a poor way to meet a dataset, so each answer is drawn. The page picks the chart from the shape of the result, without a list of views. A time column with numbers becomes a line, and a daily view becomes columns. A million events become weekly totals stacked by sign, mint above the axis and burn below it. A single row becomes a few large figures. It is about 250 lines of SVG code with no dependency. Its loudest view, the one with 1.37 million rows, is reduced inside the worker, so the page never parses a million rows at once.

## What this is not, yet

This is a query engine running over data a server indexed. It is not an indexer in your tab. That is the next part of the work, in slices, and none of them is built:

1. **The live tail.** Fetch the blocks after the last sealed one from an RPC, decode them in WebAssembly, and answer over sealed and fresh rows together. The 1,000-row wait stops mattering in a tab once this exists.
2. **Sealing in the tab,** below finality and only when two independent RPCs agree on the block. Each sealed segment must hash to the same address as the one on the mirror.
3. **A light client in the same worker,** so a finalized block is verified, not merely reported.

When the third works, a browser tab will follow a chain, decode it, seal it and answer SQL over it, and every claim it makes will be checkable. We will write that post when it is true. A search on 16 October found nothing else doing all of it in WebAssembly. We are not claiming to be first, because one search proves nothing about the rest of the internet.

## Added 18 October: an indexer you build in the tab

The tab now follows the chain past the mirror, seals what two RPCs agree is final, and checks the head with a light client. Then it went one step further. The [nest builder](/play/build/) takes a contract address, scaffolds the nest `nuthatch init` would, with init's own code compiled to WebAssembly, and indexes it in the tab from its deploy block. On Ethereum, Base or Arbitrum.

**Every segment the tab sealed hashed to the one `nuthatch dev` sealed from the same nest.** On a four-day-old Base pair that was 34 of 34, over 93,904 logs. On a token deployed the day before, 13 of 13, in 13.7 seconds. The download is an ordinary nest directory, and `nuthatch dev` reports the same identity for it that the page showed.

What it is not: a light client over the backfill. A block is sealed when two RPCs agree on it, which is agreement and not proof, and the page says so. Public RPCs are also the limit on how far back it can go. Two of the four we tried serve under three days of Ethereum logs without a key, and on Base the best keyless second allows 50 blocks a query.

## Try it

- [nuthatch-indexer.com/play](/play/). Pick a view in the sidebar, or write your own SQL against any of the nest's ten tables. The address bar keeps the query, so a link reruns it.
- [The nest builder](/play/build/). Paste a contract address, edit its views, press Index it.
- The page loads several nests from the mirror. DeFi Pulse is the default. The Graph network nests are there too.
- The source: [burrmill-wasm](https://github.com/nuthatch-org/burrmill-wasm), [burrmill](https://github.com/nuthatch-org/burrmill), and the nest's own [views](https://github.com/nuthatch-org/defi-pulse-nest/tree/main/views).
