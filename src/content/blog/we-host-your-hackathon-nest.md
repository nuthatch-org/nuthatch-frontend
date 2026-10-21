---
title: "We will host your hackathon nest. Free, the same day."
date: "2026-09-11"
description: "Retired: a standing offer to anyone building on a testnet against a deadline, and what it looked like this morning: four unverified contracts on Arc Testnet, two nests on our box, and a builder who was being rate-limited over thirty events."
author: "cargopete"
tags: ["nuthatch", "hackathon", "hosting", "the-graph", "arc", "sepolia"]
---

> **Retired 2026-09-29; Nightswatch no longer hosts nests.** The offer below is withdrawn, and the
> Arcaidia nests it describes were stopped that day. This post is kept as a record of what it was.

*If you are building at a hackathon and an indexing quota is between you and your demo, send us a
message. We will build the nest from your contracts, test it, and host it on our own box for the
duration, with no key, no quota and no bill. This post is what that meant in practice today, so you
know what you are asking for.*

---

## The ask, and the arithmetic behind it

At 12:29 a builder at ETHOnline asked The Graph's Discord for "a massively increased rate limit for
the next week". His app polled his Sepolia and Arc Testnet subgraphs seven times every five
seconds, six of them follow-ups whenever it spotted a trade to fill, and ran out of quota in under an
hour. The development query URL that serves an unpublished subgraph allows **3,000 queries a day**;
he needed about 120,000. Arc Testnet has no paid tier to buy, because the network does not support
it. No amount of asking nicely closes a factor of forty on an endpoint built for smoke tests.

## What he sent, and what we found

Four contract addresses on Arc Testnet with start blocks, at 13:32. None of the four was verified on
the explorer or on Sourcify, so there was no ABI to decode with. His repository was public, and it
carried the subgraph manifests for both chains and the three ABI files, so we took them from there;
he sent the same three files an hour later and they declared the same events, signature for
signature.

Then the explorer answered a question nobody had asked. Across all four contracts, over their whole
history, the chain held **thirty logs**. He was being rate-limited polling thirty events.

## What got built

Two nests, one per chain, because his intents are created on Sepolia and filled and settled on Arc.
Each has 33 tables, one per event in the ABIs, and six SQL views that reproduce his five GraphQL
entities and the pending-intents query his agent polls, by name: `intents`, `fills`, `settlements`,
`vault`, `protocol_state`, `pending_intents`. The vault view folds deposits, withdrawals, advances and
reimbursements with the same arithmetic as his mapping, and on Arc it reads a liquid balance of
100,004,000 base units: the deposit, plus one reimbursement, minus one advance, to the unit.

Every one of the twenty distinct event topics observed on Arc matched an event in his ABIs. The
Sepolia nest caught up its 21,000 blocks in three seconds. The Arc nest caught up its 500,000 in
about three minutes, once we stopped asking its public endpoint the wrong way.

## The part that fought back

Arc Testnet's two public RPC endpoints enforce a sliding quota that a cold start drains, and nuthatch
read the resulting 429s as "the range is too large", halved its window five times in fourteen
seconds and gave up. That is our bug, now
[#1297](https://github.com/nuthatch-org/nuthatch/issues/1297), and it is the kind of bug a
hackathon finds for you: public testnet endpoints are where the assumptions in an RPC client go to be
tested. dRPC's public Arc endpoint, which serves 5,120-block windows without complaint, and a
4,000-block window made it a non-event.

## What he got

Two URLs on our Helsinki box, each an HTTP API taking read-only SQL, with `Access-Control-Allow-Origin`
set so his front end can call them straight from the browser:

```
https://hackathon.89.167.109.4.sslip.io/arcaidia-arc/sql?q=SELECT * FROM pending_intents
https://hackathon.89.167.109.4.sslip.io/arcaidia-sepolia/sql?q=SELECT * FROM protocol_state
```

And a repository, [nuthatch-org/arcaidia-nest](https://github.com/nuthatch-org/arcaidia-nest),
with both configs, the views, and a README that shows each of his four subgraph queries as the SQL
that answers it, every example run against the live nests before it was written down. If our box
goes away, the nest does not: `nuthatch init --from` that repository and it runs on his laptop.

From his first message at 12:29 to both URLs answering at 14:12 was under two hours, forty minutes
of it after he sent the addresses, and most of that spent on the RPC and on reading his mappings so
the views would be right rather than merely present.

## Why we do this

It is not charity, or not only. A nest built for a stranger's contracts under a deadline is the most
honest test we have: it uses the importer, the unlisted-chain path, the doctor, the views, the
deploy, and the public RPCs of a chain we had never touched, in one afternoon, with someone waiting.
Today it found a real defect and two documentation lies. A week of our own testing would not have.

So the offer stands, and it is not limited to The Graph's hackathons. Testnet, mainnet, any EVM chain
with a public RPC. Send the addresses and the chain to the
[Nuthatch Discord](https://discord.gg/p9Xc45txWa). If your contracts are unverified, send the
ABIs too, or a link to the repo. We will tell you honestly if it will not work, and if it will, you
will have a URL the same day.
