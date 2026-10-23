---
title: "Nuthatch: the book"
description: "A guided tour of how Nuthatch turns chain logs into durable, queryable data."
order: 1
checked: 5.11.0
---

This is the long-form companion to the Nuthatch documentation. The reference manual tells you
which command and setting to use. This book explains why the machine is shaped as it is, what
invariants it protects, and what each boundary buys you when something goes wrong at three in the
morning.

It describes Nuthatch 5.11.0, checked against the source on 2026-10-23. It is deliberately grounded in the running
implementation, not a design sketch for a future product: each mechanism a chapter narrates was read
against the function that implements it, and the worked examples in the first two appendices were
re-run on the 4.11.0 release binary. They were replayed again on a 5.9.0 build on 2026-10-23 and
reached the same outcomes at that day's block heights; the figures printed are the dated ones each
appendix gives. Where the system has a limitation, it is named. A system that is honest about its edge is more
useful than one that claims to be a universal solvent.

## How to read it

Read the chapters in order if you are learning the architecture. If you already operate a nest,
start with [the cursor](/docs/book/the-cursor/) and [data that survives a restart](/docs/book/storage-and-sealing/).
If you are deciding whether to port a subgraph, begin with [the data problem](/docs/book/the-data-problem/)
and then use the practical [subgraph fallback guide](/docs/build/subgraph-fallback/).

Each chapter links outward to the corresponding reference material. The book gives the reasoning;
the manual gives you the precise TOML, route and command spelling.

## Contents

1. [The data problem](/docs/book/the-data-problem/) - what a nest is for, and what it is not.
2. [The authored nest](/docs/book/the-authored-nest/) - making a small, reproducible description of
   chain data.
3. [The cursor](/docs/book/the-cursor/) - following a chain without confusing a temporary tip for
   history.
4. [Storage and sealing](/docs/book/storage-and-sealing/) - hot data, cold data, finality and SQL.
5. [Reading the index](/docs/book/reading-the-index/) - tables, views, entities, APIs and the boundary of
   event-derived truth.
6. [Maintaining an answer](/docs/book/maintaining-an-answer/) - when an aggregate belongs in the
   indexing path, and what it costs.
7. [Identity, upgrades and reuse](/docs/book/identity-upgrades-and-reuse/) - why package identity
   and data identity are separate things.
8. [The runtime](/docs/book/the-runtime/) - many nests, tenants, cursors and scaled workers.
9. [Operating a truthful index](/docs/book/operating-a-truthful-index/) - verification, security,
   failure isolation and the questions worth asking before trusting a number.

The appendices slow the camera down over three mechanisms which are easy to describe quickly and
quite another matter to implement correctly:

10. [One log, end to end](/docs/book/one-log-end-to-end/) - from an RPC response to a durable query
   result.
11. [A reorganisation, walked through](/docs/book/a-reorganisation-walked-through/) - rollback at
   the hot boundary, and why a finality violation halts rather than guesses.
12. [A lease handover, walked through](/docs/book/a-lease-handover-walked-through/) - the fencing
   rule that makes two scaled workers safe. Scaled mode is a separate Linux build, so this one is
   read against the code and dated rather than re-run.

The chapters are intended to stand up to a close read. The [RFC archive](/docs/contributing/rfcs/)
and [implementation internals](/docs/contributing/internals/) remain the primary material for
contributors who want every last moving part.
