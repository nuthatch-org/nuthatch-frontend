---
title: "I had never opened rotki. Now it reads my history from my own indexer"
date: "2026-10-14"
description: "One afternoon from not knowing what rotki was to rotki reading a wallet's full history from a local nuthatch nest, with no block explorer asked. Including the two defects my own wallet found, and what still leaves the machine."
author: "cargopete"
tags: ["nuthatch", "rotki", "self-hosting", "privacy"]
draft: false
---

*By this week I had written an integration between nuthatch and rotki, opened the pull request, and
signed the CLA. I had not, at any point, opened rotki. This is the afternoon I put that right, using
my own wallet, and wrote down everything that happened, including the parts that went wrong.*

---

## What rotki is, and why it has to ask a stranger

[rotki](https://rotki.com) is an open-source portfolio tracker and crypto accounting tool. It runs on
your machine, keeps its database encrypted on your disk, and turns your addresses and exchange
accounts into balances, decoded history and profit-and-loss reports. It is the privacy-minded
alternative to the hosted trackers, and it is quite good at it.

It has one awkward dependency. To learn an account's history it asks a block explorer: Etherscan,
Blockscout or Routescan, for every transaction, transfer and withdrawal of every address you track.
**The explorer therefore learns every address you own**, which is an odd thing for a privacy tool to
have to do. It also became an expensive thing to do this year. Etherscan's free API now refuses Base,
Optimism, BSC and Gnosis outright ("Free API access is not supported for this chain"), and rotki's own
issue tracker has been finding out what that does to its users.

A nuthatch nest in address-history mode answers the same questions locally. It watches only the
accounts it is given, reads the chain over your own RPC, and serves the answers at `/api` in the
shapes rotki already reads. The rotki side is
[rotki/rotki#13342](https://github.com/rotki/rotki/pull/13342), which is awaiting review as I write.

## Getting rotki running took five minutes, one of them on Node versions

I ran rotki from the pull request's branch, because the integration is not in a released version yet.
rotki pins Python to 3.14 and Node to `>=24 <25`. My Mac has Node 26, and rotki's preinstall check
said so in red. `brew install node@24` installs alongside without replacing the default, and after
that it was uneventful: `uv sync` installed 152 Python packages in a fifth of a second, `pnpm install`
took 18.7 s, and `pnpm dev:web` compiled rotki's Rust supervisor in 28.7 s and had the interface up on
`localhost:8080` about 40 seconds later. It downloads an Electron binary even in web mode, which I
mention only because it is the kind of thing one notices.

I created a local user, pointed rotki's Nuthatch setting at the nest, and set Ethereum's indexer
order to Nuthatch alone. Etherscan was not a fallback. It was not in the list.

## The first sync failed, and it was my clone's fault

rotki asks for history from block 0. My nest's history starts at block 25,000,000, and it says so: `NUTHATCH_INCOMPLETE: history starts at block 25000000`.
The integration is meant to retry from the block the nest names. It did not, and the sync failed.

The reason was mundane. My local rotki checkout was 42 commits behind the pull request, and the
version I was running predated the retry. On the pull request's actual head, rotki tried block 0, was
told where history starts, asked again from 25,000,000, and got its answer, for transactions, internal
transactions and token transfers alike. **The integration was fine; my copy of it was 42 commits behind.**

## My own wallet found two defects in a release I had called ready

Before rotki ever asked it anything, I indexed my wallet with the released nuthatch 5.3.1, and it was
about to take twelve hours.

A backfill works in windows, and the window is sized so that a request arriving mid-backfill never
waits long: a quarter of the 8 s request deadline. Over a hosted RPC, each window's checks cost about
2.3 s whatever its size, so every window ran long, the pacer kept halving, and it settled on its floor
of 64 blocks per 2.3 s. For a wallet with 1.19 million blocks of history, that is roughly twelve hours.
Every test had passed, because the one that covered this ran with a 20 s deadline, under which a 2 s
window looks perfectly healthy.

The second was quieter. Once the account was covered, the nest started reading every block body,
about a million of them, to look for staking withdrawals and produced blocks. rotki only ever asks for
those about a tracked validator's withdrawal address. My wallet has never staked anything.

**nuthatch 5.3.2 fixes both.** The pacer now separates a window's fixed cost from its per-block cost
and lets windows grow past it, never beyond the request deadline. Block bodies are read only for an
account somebody has asked about. On the default deadline the same wallet now backfills in about 20
minutes and 7,324 RPC calls, and the index it leaves behind is 2.5 MB.

## Nine transactions, nineteen events, and nothing asked of Etherscan

I checked the nest against Etherscan first, hash by hash, block by block, value by value: 8 normal
transactions, 4 token transfers and 1 internal transaction, identical on both. (The same comparison
for vitalik.eth over blocks 18 to 20 million matched exactly, field by field, which is the larger test
and the one the integration was built against.)

Then rotki took over. It pulled the history from the nest in 11 s and decoded 9 transactions into 19
events, swaps and approvals among them, each with its gas. Its log shows 9 indexer queries, all of them to `127.0.0.1:8394`, and **no request to Etherscan
at all**. It is genuinely boring, which is the highest compliment one can pay a data source.

## What still leaves the machine

I would like to say it was all local. It was not, and the log says so.

rotki talks to Ethereum nodes as well as to indexers, for receipts and balances, and by default it
uses a rota of public ones. During this one sync it contacted about ten of them, among them 0xrpc,
nodies, publicnode, drpc, sentio, blockpi, blockrazor and pocket, and Stake DAO's API besides. The nest
replaces the block explorer. It does not replace rotki's node connections, and those providers see
your addresses in the requests they serve.

The honest claim today is narrower than the headline I wanted: **no block explorer learns your
addresses.** Getting to "nothing leaves the machine" means pointing rotki at your own node as well,
which rotki supports.

Two other limits. The integration covers Ethereum mainnet only. Base, where rotki's users lost the
most, needs a different discovery path, because hosted Base RPCs cap trace queries at 100 blocks and
re-execute them; that is the next piece of design. And none of this is in a released rotki yet.

## Try it

The setup lives at [nuthatch-indexer.com/rotki](/rotki): one `nuthatch.toml` naming your account, your
RPC and where history starts, then `nuthatch dev`. Use nuthatch 5.3.2 or later. To use it from rotki
before the pull request is merged, run rotki from that branch, as above, with Node 24 to hand.
