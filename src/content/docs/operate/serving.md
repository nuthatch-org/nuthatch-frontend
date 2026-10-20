---
title: "Serving & the admin UI"
description: "The HTTP API, entity point-reads, /sql, and the built-in admin UI."
order: 1
checked: 5.8.0
---

`nuthatch dev` *is* the serve command: it backfills, follows the tip, and serves the HTTP API on
`127.0.0.1:8288` (change with `--listen`). There is no separate server to deploy - a nest that's
indexing is a nest that's serving.

## The surface

Three kinds of read, one process:

- **Point-reads** - `/entity/{id}`, `/balance/{address}`: sub-millisecond lookups against the redb
  hot store.
- **Analytical SQL** - `/sql?q=…`: read-only SQL on Burrmill over the live tip ∪ sealed history.
  Every event is a table named `{alias}__{event}`. See [The SQL surface](/docs/reference/sql/).
- **Introspection** - `/`, `/tables`, `/schema`, `/nest`, `/metrics`: what this nest is, what it
  holds, and how it's doing.

The full route list is in the [HTTP API reference](/docs/reference/http-api/).

## The guards

`/sql` is guarded so a bad query can't take the node down - these are self-protection, not knobs to
raise:

- **30-second timeout** per query. A runaway is interrupted, not left to spin, and answered `504`.
- **50,000-row cap** per result (requests can ask for less via `max_rows`; the MCP bridge asks for
  much less so an agent's context isn't flooded).
- **64 MiB result-byte cap** per query. A row cap bounds count, not width - a wide-cell `SELECT` would
  otherwise materialise unbounded Rust-side (outside the engine's memory limit); this keeps a query inside
  the footprint budget. Hitting it flags the result truncated, same as the row cap.
- **2 concurrent analytical queries.** A third waits up to 250 ms for a permit, then gets a `503` -
  retry, don't remove the gate.
- **2,000,000 unsealed rows** scanned per query. Every `/sql` call parses the whole unsealed tip into
  memory, so on a deep-finality chain with a busy contract this is the largest RAM risk the process
  carries - and in a runtime it is a co-tenant's problem too, because the budget is per cursor. Past the
  ceiling the query is refused with a `503` naming the reason, rather than the box falling over. It is
  generous on purpose: a nest at tip on a normal chain is nowhere near it, so you should only ever meet
  this guard when something is genuinely wrong. Note it is a **refusal, not a downgrade** - an
  over-budget tip is never silently answered from sealed data alone, which would return a different
  number without saying so.
- **SELECT/WITH only.** The query surface is read-only by construction; the ingest thread is the
  only writer.

The engine runs each session under a memory limit (`NUTHATCH_ANALYTICS_MEMORY_LIMIT`, 512 MB by default)
and a bounded thread count (`NUTHATCH_ANALYTICS_THREADS`, 2), so the analytical path stays inside the
[footprint budget](/docs/operate/metrics/).
A statement that needs more memory than its session has is refused with an out-of-memory error, not
spilled: since 4.1 a hash join or final aggregate cannot spill to disk, though a sort can (4.3.0).

## Repeated statements

A statement that repeats is answered from an answer cache when nothing it reads has changed, and the
response says so with `"cached": true`. It is not a TTL cache and never serves a stale answer: the key
is the statement and its row cap, the sealed segments it is served, the hot rows, each maintained
entity's watermark and the nest's authored files. Since 4.11.0 the key follows the segments and rows a
statement reads rather than every cursor poll, so a quiet nest at the tip answers a repeat from the
cache, while a busy one computes again once a new row lands. A statement that calls a volatile
function such as `now()` or `random()`, and a degraded answer, are never remembered. The cache is
process-local, cleared by a restart, and bounded at 64 MiB (`NUTHATCH_SQL_MEMO_BYTES`; `0` turns it
off).

Every result also carries `provenance`: `as_of` (the head the answer is current to), `sealed_through`,
the `registry_hash` it was decoded under, the `nid` of the dataset that answered, and `source`.
`source` is `hot+sealed` normally. When the hot store would not scan and the answer came from sealed
segments alone, `tip_unavailable` is `true` and, since 4.11.0, `source` says `sealed` too.

## When cold data is damaged (2.2.0)

A sealed segment can go bad on disk in a way that survives a footer check - the file still binds, and
the failure only arrives when the data region is read. Before 2.2.0 that took the whole query down
with an unhelpful `Invalid Error: don't know what type:` and named nothing.

Now the damaged segment reduces its own table, the rest of the data is served, and the response says
so. Two fields on every `/sql` result:

- `degraded` - true when this nest could not serve complete cold data
- `degraded_tables` - the table names affected

`nuthatch sql` prints a warning line for the same condition, and the MCP server carries the same
notice, so an agent querying your nest is told as plainly as a human is.

The important detail is what the caveat is *about*. It states a fact about the **nest**, not about the
rows this particular query returned - so it still appears when your query happened to miss the damaged
range. A warning you can dodge by asking a slightly different question would be worse than none,
because the query that misses the gap is exactly the one whose number you would trust.

This is the same principle as the unsealed-row ceiling above: never quietly return a different number.
The difference is that a reduced table is recoverable and worth serving, so here nuthatch answers *and*
tells you, rather than refusing.

## Exposure

**The API has no authentication.** Bound to localhost (the default) that's the point. Bound off
localhost, `dev` logs a loud warning: the guards bound *how much* a query can cost, but *who* may
query is your gateway's job. Put a reverse proxy with auth in front before exposing a nest publicly.

Shutdown is graceful: on SIGTERM/SIGINT axum drains in-flight requests, the ingest task checkpoints
its progress, and a restart resumes cleanly.

## The admin UI

Every nest serves a built-in, read-only dashboard at `/_admin/` - a single self-contained page
embedded in the binary. It talks only to the same-origin API and loads **no external resources**:
no CDN, no fonts, no analytics. Live activity streams over server-sent events from
`/_admin/events`.

Access follows the exposure rule:

- **With `NUTHATCH_ADMIN_TOKEN` set**, every request must present it as `?token=…` or
  `Authorization: Bearer …`, on every bind, localhost included. The comparison is constant-time, so
  the token can't be recovered through a timing side-channel.
- **On localhost without a token** the page answers only requests addressed to loopback: a
  loopback `Host`, and a loopback `Origin` if one is sent. Behind a proxy that forwards a public
  `Host` it answers `401` until a token is set.
- **Off localhost without a token** the routes self-disable with a log line.
- `--no-admin` removes the routes entirely, for hosted deployments fronting their own dashboard.

With [many nests in one runtime](/docs/operate/many-nests/), each mount's UI lives under its prefix: `/<alias>/_admin/`.
