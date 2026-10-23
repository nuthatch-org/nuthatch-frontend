---
title: "Hosted nests: the same binary, run by us"
date: "2026-09-24"
description: "Retired: platform.nuthatch-indexer.com runs the stock nuthatch binary for people who would rather not. Sign in with GitHub or a wallet, point it at a repo or paste an ABI, and get a SQL endpoint with CORS open. Here is how to use it, what it costs, and what it does not do yet."
author: "cargopete"
tags: ["nuthatch", "hosting", "platform", "usdc"]
draft: false
---

> **Retired 2026-09-29; Nightswatch no longer hosts nests.** The service this post describes has
> closed. This post is kept as a record of what it was. Since October 2026 hosting is offered again,
> without billing or accounts: see [Nest-backed subgraphs](/subgraphs).

> **Updated, 2026-09-24, later still.** There are now three plans, Free, Builder at 29 USDC and Pro
> at 79 USDC, in place of Free and a $20 Paid, priced by how often a nest checks for new blocks;
> [the plans section](#three-plans-priced-by-freshness) says why. The platform runs nuthatch 3.11,
> which cut what a nest spends on RPC by more than half. Earlier the same evening we tightened the
> limits against abuse: every account has a request and deploy budget across all its nests,
> deploying on Free needs a linked GitHub account, and new nests wait for a person to approve them
> before they start indexing. We also corrected two sentences that said every version gets its own
> container: an unchanged redeploy reuses the running one. The figures below are the current ones.

Two weeks ago we [offered to host hackathon nests by hand](/blog/we-host-your-hackathon-nest), free
and the same day. People took us up on it, and running other people's nests by hand turned out to be
exactly as sustainable as it sounds. So we built the thing we kept doing manually. **As of today,
[platform.nuthatch-indexer.com](https://platform.nuthatch-indexer.com) runs nuthatch for you: sign
in, give it a repository or a contract address, and you get a live SQL endpoint.**

It is not a different product. It runs the published image, `ghcr.io/nuthatch-org/nuthatch:3.11.0`,
unmodified. Everything it adds, sign-in, plans, payments, lives in a separate private repository and
none of it enters the nuthatch tree. Delete the platform and a self-hoster loses nothing; that is a
rule we set before we wrote a line of it, and the binary you download is the one we run.

## What you get, and what it is made of

Each changed version of a nest is its own container: `nuthatch dev` over its own directory, capped at 2 GB
of memory with no swap and 2 CPUs, all Linux capabilities dropped, and its admin surface turned off.
Containers cannot see each other, and they cannot reach our network: a firewall on their bridge
drops anything bound for a private or tailnet address, which we checked against a positive control
rather than assumed. One nest's runaway factory or bad record stays in its own box.

What you query is the ordinary nuthatch HTTP surface, behind our proxy:

- `/sql?q=` for SQL over your decoded tables and your `views/`
- `/tables`, `/ready` and the rest of the read routes
- open CORS, so a browser dashboard can call it directly

A control plane probes every nest's `/ready` every 30 seconds and pages us after three minutes down.
Separately, a probe on another machine watches the platform from outside, because a monitor that
lives on the box it monitors is the one that stays quiet when the box dies. We rebooted the host on
24 September to test exactly that: the public URL answered again in 99 seconds, every nest came back
on its own, and the outside probe reported both the outage and the recovery.

## From sign-in to a live endpoint

**Sign in.** GitHub (public profile only, no scopes) or a browser wallet. A wallet signs a
[Sign-In with Ethereum](https://eips.ethereum.org/EIPS/eip-4361) message: no transaction, no gas.
You can link both to one account later, from the Account page.

**Deploy from a repository.** Any public repo laid out like a nuthatch project works: one directory
with a `nuthatch.toml`, an `abis/` folder, and optionally `views/`. A repo that indexes several chains
keeps one config per chain, and you pick which one this nest uses:

```text
arcaidia-nest/
  nuthatch.toml            # Arc Testnet
  nuthatch.sepolia.toml    # Sepolia
  abis/
  views/
```

Name the nest, paste the repository URL, choose the branch, directory and config, and press Deploy.
A person at our end approves each new nest before it starts indexing, usually within a day; the
nest's page says so while it waits.

The platform clones it, runs `nuthatch schema` and `nuthatch nest nid` in a throwaway container with
no network, and starts it.

**Or deploy from contracts.** No repository needed: pick a chain, name up to three contracts, and
give each an address, a start block and an ABI. The ABI can be pasted JSON or a Hardhat or Foundry
artifact. If one contract creates others, name it as the factory and every child it emits is
indexed from its own creation block.

**Query it.** Your endpoint is `https://platform.nuthatch-indexer.com/q/<your login>/<nest>/`:

```bash
E=https://platform.nuthatch-indexer.com/q/cargopete/arcaidia-sepolia

curl -s "$E/ready"
curl -s "$E/tables"
curl -s -G "$E/sql" --data-urlencode "q=select count(*) from intents"
```

`/ready` answers with `last_block`, `tip` and `ready`, and `/tables` with every decoded table and its
columns.

How fast a nest is ready depends on the chain and its RPC far more than on us. The Arcaidia nest on
Sepolia, backfilling on our keyed RPC, went from block 11,688,303 to the tip in 42 seconds, 161,739
events, on 24 September. The same contracts on Arc Testnet's public RPCs managed roughly 51,000
blocks a minute, which is why we pay for RPC on the chains we list.

## A URL that does not move when you redeploy

Every deploy is a new version; a changed one gets its own container. Your endpoint follows the current version, and
the previous one keeps serving until you retire it, so a redeploy never breaks a reader mid-query.
Each version also has a pinned URL, `/q/<login>/<nest>@v2/`, for a client that must not move.

Redeploying unchanged inputs does not start a second copy: a nest's identity is its content address,
and an identical one reuses the running container. Retire a version when nothing reads it. Delete a
nest when you are done with it; that removes every container and all indexed data, and gives the
slot back.

If a deploy fails, the nest page says why in words: `Repository not found`, or
`./nuthatch.mainnet.toml is not in the repository`. We would rather you read the error than wonder.

## Three plans, priced by freshness

| | Free | Builder | Pro |
|---|---|---|---|
| Price, per 30 days | nothing | 29 USDC | 79 USDC |
| Nests | 1 | 3 | 3 |
| Checks for new blocks | every 60 seconds | every 60 seconds | every 12 seconds |
| Backfill | up to 5 million blocks behind the tip | up to 50 million | up to 50 million |
| Endpoint | 10 requests/s, bursts of 100 | 50 requests/s, bursts of 500 | 100 requests/s, bursts of 1,000 |
| Per account, all nests | 20 requests/s, 10 deploys an hour | 100 requests/s, 20 deploys an hour | 200 requests/s, 20 deploys an hour |
| Chains | Sepolia and Arc Testnet, on public RPCs first; or any chain we do not list, with your own RPC | adds Ethereum, Base and Arbitrum One on our RPC | the same |
| People | | email support | email support; views and subgraph ports priced separately |

**Why freshness is what you pay for.** We measured it. A nest following the tip on nuthatch 3.11
costs about the same on Base, Arc and Sepolia: each check for new blocks is one request for the tip,
one for the logs and a few block headers, whether one block arrived or twenty. So a month of RPC at
a check every 12 seconds costs us about $15 a nest, and at every 60 seconds about $3, on any chain.
Backfill is now close to free, because recent nodes put the block timestamp on every log and nuthatch
no longer fetches a header per block. Every plan is priced so that its busiest possible use still
covers what it costs us, and a test in our code fails if a change to the limits ever breaks that.

A dashboard that refreshes every minute cannot tell a 60-second nest from a 12-second one. Pick Pro
when something reads your data within seconds of a block.

The rate limits are not decorative. We measured them on 24 September: of 150 simultaneous requests at
a free nest, 103 were served and 47 got `429`; of 1,500 at a nest with Pro's limits, 1,133 were
served. Burst, then refill, as the table says.

**Payment is in USDC on Ethereum, Base or Arbitrum, and never automatic.** There is no card and no
subscription. On the Billing page you choose a plan and a chain and get an amount such as
`29.005051 USDC` and an address. The odd cents are how the payment is known to be yours; a watcher
reads the chain and extends your plan by 30 days once the transfer has enough confirmations. Pay more
and it still counts, provided it is clear whose invoice it pays. Nothing is ever charged
automatically, because crypto cannot pull from a wallet and we would not want it to.

When a plan ends you drop back to Free. Your oldest nest keeps running; any beyond Free's one are
suspended, with their data kept, and start again as soon as you pay.

We tested this with real money, which is the only kind of test a billing system believes. The first
payment, 21 USDC on Arbitrum against a 20.005051 invoice, was flagged as not matching, because the
watcher only knew exact amounts. It now accepts an overpayment when the invoice is unambiguous, and
anything it cannot place is listed for a human rather than guessed at.

## What it does not do yet

- **It runs on one machine of ours.** It is not replicated and not in a data centre. We watch it from
  outside and it recovers on its own, but there is no SLA and no second region. If your dashboard
  cannot tolerate a few minutes of downtime, run nuthatch yourself.
- **Public repositories only.** Private repos, and redeploying on every push, both need a GitHub App.
  Today redeploy is a button.
- **SQL, not GraphQL.** Nests serve nuthatch's SQL surface. The GraphQL compatibility layer is a
  partial read surface and we do not offer it as a subgraph replacement here.
- **Your own chain means your own RPC.** A chain we do not list works on Free if you supply an RPC
  URL, and it has to be a public address; we refuse anything that resolves to a private network.
- **Nests that fetch every block need your own RPC.** A nest that extracts every block header,
  every top-level call, or makes a contract call per event pays for data per block or per event
  rather than per check, which no flat price covers. We refuse those on our RPC; on a chain we do not
  list, with your own RPC, they run.
- **We do not email you.** Alerts reach us, not you, for now. Poll `/ready` if you need to know.

## Leaving costs you nothing

The nest you deploy here is an ordinary nuthatch project, and the binary is the same one we publish.
To take it home:

```bash
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
git clone <your repo> && cd <your repo>
nuthatch dev
```

Same tables, same SQL, same endpoint shape, on your own machine. Nothing here is designed to make
that harder, which is the point of running the stock binary.

[Sign in and deploy a nest](https://platform.nuthatch-indexer.com). If something breaks, tell us;
the first few users are the ones who find the edges.
