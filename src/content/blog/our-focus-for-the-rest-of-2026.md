---
title: "What I am working on for the rest of 2026"
date: "2026-11-20"
description: "Nuthatch has no production users yet. For the rest of 2026 the job is getting the first few, by solving a real indexing problem on their own data and hosting their nest for free. Also on the list are feedback, a careful review of the core, and Burrmill."
author: "cargopete"
tags: ["nuthatch", "roadmap", "hosting", "burrmill", "rotki"]
draft: false
---

I do not have production users yet. There is one public dashboard that reads from a nest we run ourselves, and I do not count that. Nobody has found nuthatch, picked it, and put something they care about on it.

So the rest of 2026 is about getting the first few. This post says how I plan to do that, what I want back, and what else is on the list.

## Going to the problem

I am not going to send cold pitches. I look for projects that have written down an indexing problem in public, in an issue or a discussion. Then I index their contracts myself and show the result on their own data. If it does not work, I say that too.

I have done three of these so far. All three ran on my own machine against public RPCs.

[GoodDollar's data team](https://github.com/GoodDollar/data-team/issues/40) has a public issue about their onchain analytics, and part of it is the UBI scheme on XDC. I indexed that contract from its deployment block, 14.3 million blocks, and got 3,882,012 decoded events in 2 hours 22 minutes. Then I checked every one of the contract's 375 protocol days against its own claim count and claim amount, read at one block. All 375 matched.

Most of that time went on block headers. The run made about 2.45 million `eth_getBlockByNumber` calls and only 2,751 `eth_getLogs` calls, because nuthatch fetches a header for every block that holds a log. That is ours to fix, and it is [nuthatch#3065](https://github.com/nuthatch-org/nuthatch/issues/3065).

The second was a token streaming protocol on XDC. All its deployments, 24.3 million blocks, were caught up in about 12 minutes, with 535 events in 69 tables. I counted the logs of one contract version independently with `eth_getLogs`. That gave 417, and the nest had 417.

The third is [pharos-watch](https://github.com/TokenBrice/pharos-watch/issues/2048). They have a scan that replays every Transfer of a liquidity token from genesis, and it is parked at the moment while they wait for a better connection. I ran that job on two of their tokens, 16.45 million blocks on one public RPC. It took about seven and a half minutes and found 109,446 Transfer events.

The replayed supply of the first token matched `totalSupply()` exactly, with 1,272 holders. The second matched once I added the 1000 wei locked at the zero address, which is the minimum liquidity Uniswap V2 locks. I did not measure their current setup, so I have no before and after.

## Free hosted nests for the first users

The people I want first are the ones with a real use for it. I will host their nest for free.

It is for a team or a person with contracts on an EVM chain and a question about their data. If your current indexer is stuck, shut down or too expensive, that is the case I most want to see.

You get `https://nuthatch-indexer.com/nests/<name>`, with SQL at `/sql` and an MCP endpoint at `/mcp`. There is no key and no account, and it is read-only, so anyone with the URL can read it. Two exist today, `arc-usdc` and `base-usdc`. The nests for the three runs above are not hosted yet.

I am also building a showcase page for each nest. It has five questions someone at your company would ask, and copy-paste prompts for an agent that queries your nest. It is in review as [nuthatch#3058](https://github.com/nuthatch-org/nuthatch/pull/3058) and is not live yet.

The limits are the public-nest ones. A query gets 5,000 rows and 10 seconds. Each address gets 30 queries a minute, and each nest has a 2 GB memory ceiling. Only read routes are open, and there is no admin. It is a showcase, not a service with an uptime promise.

A hosted nest is the stock binary run the way you would run it, so the same nest on your machine seals the same bytes. Leaving costs nothing.

To ask, write on the [Nuthatch Discord](https://discord.gg/p9Xc45txWa), or open a GitHub issue that mentions nuthatch. Send the chain and the contract addresses, the start block if you know it, and the ABI if the contract is not verified. One line on what your app asks of the data helps too.

## What feedback I want

The most useful thing is a nest that did not work. Tell me the command, the chain and what you saw.

Next is a wrong answer. A wrong total over token amounts looks like a number, so I would rather hear about it from you than not at all.

After that, a first two minutes that lost you, and a chain or an RPC that nuthatch does not get along with. Slow counts as feedback too.

Send it to [GitHub issues](https://github.com/nuthatch-org/nuthatch/issues), to [Discussions](https://github.com/nuthatch-org/nuthatch/discussions) or to the Discord.

## A careful look at the core

I plan a review pass of the core, on its own, with nothing else being built beside it. The parts that matter most are the ones that feed stored state, which are ABI decoding, reorg handling, sealing and entity derivation. Each of them has to give the same answer when it is run again.

This will be my own review. It is not an outside audit, and I will not call it one.

## Burrmill

[Burrmill](https://github.com/nuthatch-org/burrmill) is the SQL engine inside nuthatch, built on DataFusion. It answers queries over sealed Parquet segments plus the live tip, in DuckDB's dialect, with exact integer arithmetic that refuses rather than wraps.

Its 0.1.0 landed in nuthatch on 20 November, in [#3059](https://github.com/nuthatch-org/nuthatch/pull/3059). It plans deep stacks of views more cheaply, plans small statements in one partition, and has two more functions reviewed for strict isolation. What I work on next is where its README says it loses, which is small statements and build time.

## Smaller things in progress

The MCP server is part of the binary, and nuthatch is listed on the Official MCP Registry as `io.github.nuthatch-org/nuthatch`. In Claude Code the plugin installs the skills and the server together.

```text
/plugin marketplace add nuthatch-org/nuthatch
/plugin install nuthatch@nuthatch
```

Cursor reads the same repository as a plugin. A version for Anthropic's plugin directory is being prepared.

For rotki, I have a pull request open, [rotki/rotki#13686](https://github.com/rotki/rotki/pull/13686), that adds a self-hosted nuthatch nest as an Ethereum indexer. It is in review. While that is in review, there is an unofficial fork, [rotki-nuthatch](https://github.com/nuthatch-org/rotki-nuthatch). It is a stopgap, and it goes away when rotki fixes the problem upstream, with nuthatch or anything else.

The next release is 5.24.0, and it has no date. Three open items are in flight, and none of them has a promise attached.

[nuthatch#3066](https://github.com/nuthatch-org/nuthatch/issues/3066) is parallel backfill for factory children, which fetch their logs one call at a time. [nuthatch#3065](https://github.com/nuthatch-org/nuthatch/issues/3065) is the block header problem from the GoodDollar run. [nuthatch#3070](https://github.com/nuthatch-org/nuthatch/pull/3070) sends a User-Agent, because Cloudflare-fronted RPCs answer 403 to a client that sends none.

## How you can help

Try it. These two commands index WETH and serve it locally.

```sh
nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth
nuthatch dev --backfill 300
```

If you have a contract and a question, ask for a hosted nest. And if something breaks, file an issue.
