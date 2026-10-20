---
title: "A payment processor asked for a deposit watcher. It shipped the same day"
date: "2026-10-15"
description: "Nuthatch 5.4.0 reads each block once for a whole set of custody addresses, a million of them as cheaply as one, and streams every deposit as a numbered feed with retractions when a reorg takes one back. How it was built in a day, what it was checked against, the fault a user's link found the next morning, and what it does not do yet."
author: "cargopete"
tags: ["nuthatch", "deposits", "payments", "release"]
draft: false
---

At 15:17 UTC on 14 October a payment processor asked in the Nuthatch Discord whether Nuthatch
could index thousands of addresses for incoming deposits. My honest answer was "not well today":
the address mode was built for one person's wallets and searches each address on its own. Half an
hour later the requirement was clearer. It was a deposit indexer for crypto payment processing,
tracking every custody address and **scaling to hundreds of thousands of them**, with the list
growing while it runs. Append-only would do.

Nuthatch 5.4.0 was tagged at 19:59 UTC with a deposit sweep that does that, and published at 22:22
once the release build had finished. This post is about how, and about the parts I checked rather
than assumed, because a deposit watcher that is wrong is worse than none at all.

## Reading the competition before writing a line

He had already found [fystack/multichain-indexer](https://github.com/fystack/multichain-indexer),
which watches deposits across 14 chains with a bloom filter, NATS JetStream and Redis. It is a
serious project, and I read it properly, at commit `03b0449`, before designing anything. What I
was looking for was the places where a deposit can go missing, since that is the only property
of a deposit watcher anyone cares about. There were more of them than I expected:

| fystack, on EVM chains | Nuthatch 5.4.1 |
|---|---|
| Bloom filter only, 1% false positives by default: deposits reported for addresses that are not yours | An exact set of addresses; no false positives |
| Publish errors ignored and the block still marked done; the whole stream capped at 10 KB | A block counts as swept only when every call for it succeeded |
| No retraction on a reorg; the orphaned deposit stays credited | Each delivered deposit a reorg takes back is retracted, once |
| Skips ahead to the head after a restart | Coverage is contiguous; a gap is refused, never skipped |
| ERC-20 only; ERC-721 reported as ERC-20 with amount 0; no ERC-1155 | ERC-20, ERC-721 with token id, ERC-1155 single and batch |
| Redis, NATS, a KV store and Postgres alongside it | One binary |
| **14 chains, including non-EVM ones** | **Measured on Ethereum mainnet only** |

The last row goes against me and stays in the table. fystack covers far more ground. Nuthatch
does EVM chains and nothing else, and so far I have measured the sweep only on mainnet.

## Read the block once, not the address a million times

Nuthatch already had address history, built for rotki last week, which discovers each address on
its own: for one ordinary wallet that is about 20 minutes and 7,324 RPC calls. That is fine for a
person's wallets and hopeless for 100,000 custody addresses, because the cost grows with every
address added.

The deposit sweep turns it round. **It reads every block once, and matches the block against the
whole watched set in memory.** One `eth_getBlockByNumber` for the transactions, one `eth_getLogs`
for every `Transfer`, `TransferSingle` and `TransferBatch` in the block with no address filter, and
receipts only for what matched. With `internal = true` it adds one `trace_block`, so value a smart
wallet or contract sends from inside a call is caught as well. The work per block is the same
whether the set holds one address or a million, which is the entire point.

Addresses join over the API, in bulk, and are live from the next block:

```bash
curl -X POST localhost:8288/api/watch \
  -H 'content-type: application/json' \
  -d '{"addresses": ["0x...", "0x..."]}'
```

The answer counts what it added and what is now watched: `{"added":2,"watched":100002}`.

Each address is covered from the block it joined. Nothing before that is claimed, so asking about
an earlier block gets `NUTHATCH_INCOMPLETE` rather than an empty answer that looks like "no
deposits".

## The feed is the record, and a webhook is only a nudge

Every transfer that brings value to any watched address becomes a numbered deposit in one feed:

```
GET /api?module=account&action=nuthatchDeposits&after=<seq>
```

The answer carries `sweptThrough`, the last block the feed is complete to. When a reorg takes back a
block that already produced a deposit, the feed gains a retraction naming that deposit's sequence
number, and the replacement arrives as a new deposit. A processor credits on a deposit and reverses
on a retraction, or sets `confirmations` and simply waits that many blocks before it sees anything.

With `webhook` set, the feed is POSTed in order. A batch is marked delivered only after a 2xx, so a
failed delivery is sent again and the consumer drops repeats by `seq`. The deposits live in the
store, not in a queue, which means a consumer that goes away for a week comes back and reads from
the last number it saw. Nothing is shed because a sink was down, which is the right behaviour for
alerts and entirely the wrong one for money.

## What it was checked against

**Etherscan, field by field.** About 8,100 rows across six mainnet addresses and three block
ranges: normal transactions, 3,768 ERC-20, 229 ERC-721 and 15 ERC-1155 transfers, plus 767 internal
transactions. Every field Nuthatch serves was compared, and every one was identical. That is not
every field Etherscan serves: a token row here leaves out the token's name, symbol and decimals and
the transaction's gas figures, so a processor that needs decimals reads them from the token itself.

**Reorgs, at random.** A property test drives the sweep through random reorg depths and requires
it to converge on the canonical chain every time, retractions included. It is a release gate.

**Failure, on purpose.** Failed block, log, receipt and trace calls were injected, and each one left
its window unswept and retried, rather than recorded with a hole in it.

**The tip, live.** Following mainnet with `confirmations = 2`, the webhook delivered exactly the four
deposits Etherscan lists for the blocks swept, no more and no fewer.

**Scale.** With a release build, one window took a median of 1.8 s for one address, 2.1 s for
100,000, and 2.0 s for a million, in 467 MB. The million-address figure was not the first one I
measured. The first run took 3.5 to 6 s a window, because every pass checked all million addresses
to see which had just joined. It now skips that when nobody has, which is why the number above is
the same as the one for a single address. A block arrives
every 12 s, so the sweep spends about a sixth of its time working.

**The published binary.** This morning I downloaded the 5.4.0 release, checked its hash, and ran
it at the mainnet tip with 100,002 addresses loaded in one call (it took 0.15 s).
For the next twelve minutes it followed the tip, and for the busiest address in the set, an
exchange hot wallet, it returned the same 656 rows as Etherscan, 7,542 fields identical. Every one of
the 424 entries in the feed reached the webhook.

## The caveat I had not checked

The processor's first question, later that morning, was whether it would run against anvil. It does: I
tried it, and an ETH transfer and an ERC-20 transfer to a watched address were in the feed a block
later. His second message was a link to
[trezor/blockbook#1225](https://github.com/trezor/blockbook/issues/1225), in which Blockbook reports
ETH transfers that never happened, because a `callcode` or `delegatecall` frame looks like a call
carrying value.

Nuthatch already ignored `delegatecall`. **It did not ignore `callcode`**, because Etherscan lists
those frames and the rows were built to match Etherscan. Checking that on anvil turned up something
plainer: a reverted 5 ETH transfer to a watched contract appeared in the feed as a 5 ETH deposit,
with the contract's balance still at 0. The row said `isError: 1`, as Etherscan's does, but a feed
called deposits should not need its reader to know that.

Matching Etherscan was the right rule for an address's history and the wrong one for a list of
money received. In 5.4.1 the feed carries only value that arrived: failed transactions, frames inside
a reverted call, `callcode` frames and zero transfers are still listed by `txlist` and its relatives,
and are no longer deposits. On the mainnet run above none of the 424 entries was of those kinds, so
the fault was rare in practice. It was still there, and it took a user's link to find it.

## What it does not do yet

- **Other chains are unmeasured.** The sweep runs on any EVM chain, but I have only timed it on
  mainnet. Base produces a block every 2 s, which leaves a sixth of the room mainnet has, and
  I have not timed `trace_block` there, so `internal = true` on Base is not something I would
  promise anyone today. Arbitrum has
  no `trace_block` at all and will need `debug_traceBlockByNumber` instead. Both are the next piece
  of work.
- **Backfill is the expensive direction.** Following the tip is cheap; sweeping history is three or
  so calls a block, which I estimate, not measure, at a day and a half per million blocks. The
  default is to start at the finalized head, and an address joining later is not given its history.
- **No token allowlist.** Every token transfer to a watched address is a deposit, including the spam
  tokens people airdrop to exchange addresses. The rows carry the token contract, so filtering is
  the consumer's call for now.
- **Non-EVM chains are out of scope**, and will stay out until EVM is airtight.

## Try it

Add a sweep to an address-history nest and start it:

```toml
[address_history]
addresses = []
poll_interval = "12s"

[address_history.sweep]
confirmations = 12
webhook = "https://processor.example/deposits"
```

Then load your addresses with `POST /api/watch` and read `nuthatchDeposits`, or wait for the
webhook.

To try it without an RPC provider at all, run it against [anvil](https://getfoundry.sh/anvil/).
This is the configuration I used to answer the processor's question:

```toml
[nest]
name = "anvil"
chain = "anvil"
chain_id = 31337
rpc_urls = ["http://127.0.0.1:8545"]

[address_history]
addresses = []
poll_interval = "2s"

[address_history.sweep]
confirmations = 0
```

```bash
anvil --block-time 2 &
nuthatch dev --dir ./anvil-nest &
curl -X POST localhost:8288/api/watch -H 'content-type: application/json' \
  -d '{"addresses": ["0x000000000000000000000000000000000000dEaD"]}'
cast send 0x000000000000000000000000000000000000dEaD --value 1ether \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
curl 'localhost:8288/api?module=account&action=nuthatchDeposits&after=0'
```

Two things about anvil. Its finalized block stays at 0, so `confirmations = 0` is needed or the sweep
never moves. And a restarted anvil is a new chain with the same id: the nest notices that its
finalized history no longer matches, stops, and says to remove its store, which is the right thing
to do. The [configuration reference](/docs/reference/config/) has the rest, and the
[5.4.0](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.4.0) and
[5.4.1](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.4.1) release notes list every
change. Use 5.4.1. If you run a processor and want help setting it up, the Discord is where I am.
