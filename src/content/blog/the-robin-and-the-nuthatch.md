---
title: "The robin keeps the books, the nuthatch keeps the cache"
date: "2026-10-15"
description: "rotki's mascot is a robin on an abacus and nuthatch is named after a bird that hides food and comes back for it. Why the two fit, what has been measured so far, and what is not done yet."
author: "cargopete"
tags: ["nuthatch", "rotki", "self-hosting", "privacy"]
draft: false
---

rotki's logo is a robin perched on an abacus. The name is short for *Rotkehlchen*, German for the
European robin, literally "little red throat". Nuthatch is named after a different small European
garden bird, one that wedges nuts into bark, hacks them open, and hides the surplus in crevices to
come back for later. I did not choose either name with the other in mind. Having spent a week
putting the two pieces of software together, I am now fairly sure that **they want the same thing
from the world, and each is missing the half the other has.**

That is a claim that sounds like a press release, so the rest of this post is the evidence for it,
followed by the part where it falls short.

## A robin that keeps its own books

rotki describes itself as "a privacy-focused portfolio manager, accounting, and analytics tool". It
runs on your machine, keeps its database encrypted locally, and is open source under the AGPL. The
abacus in the logo is apt: most of what rotki does is careful bookkeeping, turning a wallet's
transactions into decoded events, cost basis and tax reports.

Robins are famously territorial about their own patch of garden, and rotki is territorial about your
data in the same spirit. Everything it can compute locally, it does.

## The one stranger rotki still has to ask

There is one thing it cannot compute locally: an account's history. An Ethereum node can tell you an
account's balance, but not the list of transactions that touched it, so rotki asks a block explorer,
usually Etherscan, for every transaction, internal transaction and token transfer of every account
you track. **The explorer therefore learns your complete set of addresses, tied together by one API
key.** For a privacy tool, that is the awkward guest at an otherwise well-kept feeder.

On several chains it is also a paid guest: there rotki users are asked to buy an explorer key before
their history arrives at all.

## A nuthatch hides what it finds and goes back for it

Indexing is, more or less, what the bird does: find the thing once, put it somewhere you control,
and fetch it again on demand. A rotki-mode nest watches the accounts you give it, reads the chain
over your own RPC, keeps the history in a local store, and serves it at `/api` in the shapes
Etherscan uses. rotki already speaks that dialect, so the integration is small:
[rotki#13375](https://github.com/rotki/rotki/pull/13375) adds the nest as an indexer built on
rotki's existing Etherscan-shaped client, and every answer the nest cannot give falls through to the
next indexer in the user's order.

Since 5.5.0 a nest serves history on Optimism, Base, Arbitrum, Polygon, BNB Chain and Gnosis without
any explorer key, and since 5.6.0, released today, one `nuthatch dev` serves several chains at one
address. rotki takes exactly one nest address, so that was the piece it needed. rotki registers your
accounts with the nest itself, on each chain whose indexer order names it.

The nest is light, too. An ordinary wallet with 1.19 million blocks of history took about 20 minutes
to backfill over a hosted RPC on 2026-10-14, with 7,324 RPC calls and a 2.5 MB index.

## Both birds refuse to guess

The deeper reason they fit is that both pieces of software treat a missing answer as worse than a
slow one. rotki's accounting is only as good as the history under it: a transaction it never saw is
a hole in someone's tax report that nobody notices. A nest that has not yet covered the range it is
asked about answers `NUTHATCH_INCOMPLETE` and names the block it is covered through, rather than
returning an empty list that would look exactly like an account with no activity.

This happened tonight, unplanned. My Ethereum nest was 94 blocks behind the head because its trace
provider kept timing out. rotki asked, the nest refused, rotki recorded that the sync would be
retried, and a few minutes later it was. Nothing was quietly missing in between. It is entirely
unremarkable behaviour, which is what one wants from anything that ends up near a tax return.

## What has been measured so far

Every figure below is rotki's or Etherscan-shaped output compared field by field against a source
nuthatch does not control.

| Chain | What was compared | Result | How much to trust it |
|---|---|---|---|
| Ethereum | vitalik.eth, blocks 18M to 20M, against Etherscan | `txlist` 2,318 transactions, `tokentx` 3,334, identical | High |
| Ethereum | My wallet from genesis, rotki with the nest alone against rotki with Etherscan, 2026-10-15 | 19 of 19 events over 9 transactions, every field identical | High, but a small wallet |
| Gnosis | rotki with the nest alone against Blockscout and Etherscan | 82 of 82 events | High |
| Optimism | Three accounts against Blockscout | 1,411 of 1,411 transactions on the largest | High |
| Arbitrum | Against Blockscout | 594 of 594 | High |
| Base | Against my own earlier spike, 905 transactions | Identical | Medium: the reference is mine |
| Polygon, BNB Chain | One account each, books checked to the wei | Nothing to compare against | Low |

The last two rows are the honest ones. Without a free reference there is nothing independent to
check against, so all I can say is that the balances add up.

## Not quite a match made in heaven, yet

The robin has not yet agreed to share the feeder. My first pull request to rotki was larger than
anyone wanted to review, and Lefteris, rotki's founder, declined it and asked instead for
a general way to add an indexer. That design is
[rotki#13372](https://github.com/rotki/rotki/issues/13372), and #13375 is the small first step,
awaiting review. **Until it merges, you have to run rotki from that branch.**

Beyond that:

- #13375 covers transactions, internal transactions and token transfers only. The nest already
  serves withdrawals, produced blocks and MEV, but rotki does not ask it for them yet.
- Off Ethereum, a contract account or an EIP-7702 delegated account cannot be proved from balances,
  so the nest answers unsupported from the block it gained code and rotki asks its next indexer.
- An incoming transaction that moves no value is not listed, though Etherscan lists it. It changes
  nothing in rotki's books, but it is a difference.
- The RPC you point the nest at still sees which addresses are being asked about, as it already does
  when rotki reads balances. Only your own node makes that nobody's business.
- A backfill from genesis takes hours rather than minutes, and needs a trace-capable RPC.

## Try it

The [rotki page](/rotki) has the config, the commands and the settings, and
[my earlier post](/blog/running-rotki-on-my-own-indexer/) is the first afternoon I spent with rotki,
mistakes included. If you run rotki and pay for an explorer key on Base or Gnosis, I would
particularly like to hear how the nest does on your accounts.
