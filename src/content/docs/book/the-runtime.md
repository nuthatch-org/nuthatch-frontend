---
title: "8. The runtime"
description: "Mounts, tenants, one cursor per chain, the nest lifecycle, and how the same model extends to scaled mode."
order: 9
---

A nest is a portable description plus its dataset. A runtime is the process that makes one or more
such datasets live. This is where Nuthatch separates the questions people often tie together by
habit: what a package is, what an operator calls it, who has mounted it, which chain is followed,
and what query surface is exposed.

The runtime reads `mounts.toml`. A mount records an alias, tenant, NID and SQL access policy. The
alias is the route a caller sees. The tenant is an opaque operator label. The NID selects the
identity-keyed dataset. Because those are separate, two tenants can mount one NID and share its
data while exposing different aliases or named-query allowlists.

This is multi-tenancy in the useful, modest sense: multiple independently named datasets in one
runtime. It is not an identity service, quota system or billing platform. Those require knowing
who the caller is, and the runtime does not. Put a gateway in front when the deployment needs that
policy. The node protects its own memory and query capacity regardless of who is asking, and since
5.13.0 divides that capacity between tenant labels by the shares an operator sets, still without
knowing who any of them is.

## One cursor per chain

Within one chain, a runtime uses a shared cursor. The cursor sees the chain once, obtains the union
of relevant logs and routes each log to the mounted nests that need it. This reduces duplicate RPC
polling and means that finality and reorg detection have one coherent boundary. Each dataset still
has isolated hot storage, package files and query context.

The rule is per chain. A multichain runtime owns a separate cursor for each chain because chains do
not share a head, a finality rule or a failure mode. The runtime groups mounts by chain before
spawning the cursor work. It does not make a multi-chain deployment magically one ordered stream.

The effect is worth being precise about. A runaway factory or failed decoder should quarantine the
affected nest rather than corrupt its neighbour's data. A dead cursor must not hide behind healthy
HTTP routes. And an operator needs metrics that distinguish a process-level number from per-nest
and per-chain health.

## Capacity is a physical constraint

Nuthatch has a default 2 GB resident-set budget per active-chain cursor, `max_rss_mb` in
`mounts.toml`. It estimates the impact of a mount before accepting it, at boot and again for every
live mount, and refuses one that would push its cursor over. The actual footprint is exposed as
`nuthatch_rss_bytes`, which is the whole process rather than one cursor, so a two-chain runtime
reads it against the sum of its two budgets. The number is not a marketing density claim. A runtime
with two chains has two cursors and therefore two separately bounded workloads. A high-rate nest can
still be expensive even if it has very few neighbours.

Since 4.10.0 the budget is also something the process can be held to rather than hoped about. The
query engine counts the memory a scan holds against a pool the operator sizes, and startup adds that
pool to an ingestion reservation and a runtime headroom and refuses the configuration if the sum does
not fit the wall, naming the term that counted and the largest value that would. The two new terms
are measured, not guessed: the reservation is the high-water mark of the process indexing with no
queries, and the headroom is the most the process has held outside the pool under the real query
set. On the nest that forced the work, a copy of kittiwake's QoS nest under its production queries,
those came out at 372 MiB and up to 931 MiB, so the budget is written as a 704 MB pool, a 384 MB
reservation and 960 MB of headroom, 2,048 in all; four runs under that budget inside a 2 GB cgroup
peaked between 1,316 and 1,349 MiB. Before the engine counted scan memory the same nest peaked at
1,746 MiB, which is the difference between a budget and a wish.

The shared cursor pays for chain polling once. It does not make storage, decode work or analytical
queries free. The runtime keeps those costs visible so density does not become a pleasant-sounding
route to an out-of-memory kill.

Sharing the fetch used to mean sharing the pace. Until 5.14 the cursor ran each nest's window in
turn, so the slowest nest on a chain set every neighbour's tip lag, and a nest re-admitted after a
fault pulled the cursor back so its siblings fetched again. Since 5.14.0 a runtime's cursor is split
in two. Extraction still fetches each range once, with the union filter, and still decides each
reorg once; but it appends windows to a bounded buffer, and each nest is a task of its own reading
that buffer from its own position. A slow nest delays itself until it falls behind the buffer, and then
fetches for itself by its own filter until it catches up, without moving extraction back. The chain
still has one cursor, one finality view and one reorg authority. What the buffer holds is charged to
the cursor's budget like anything else, so the change buys independence, not free memory.

## The runtime owns the lifecycle

A runtime that could only be changed by editing a file and restarting would make every change as wide
as a fault: restarting to add one nest stops all the others. So the set of mounts is changed while the
process runs, through an admin API, and since 3.13.0 the runtime does the whole of it. A caller hands it
a NID and a name. The runtime fetches the bundle from a registry if it does not hold it, checks that the
bundle's own manifest computes to that NID, installs it, lets it catch up and then serves it. Nothing
outside the process has to unpack, verify or arrange anything.

A mount that fetches and backfills can take far longer than a caller will hold an HTTP request open, so
it is a job rather than a call. The job moves through accepted, fetching, seeding when it was asked
to fill from a mirror, joining and then live or failed (or reads suspended while an operator has
paused it). Every job short of live, and every
failed one, is written to `mount-jobs.json` beside `mounts.toml`, so a restart in the middle picks
it up again instead of forgetting it; a live job needs no record of its own, because `mounts.toml`
is that record. The job list is kept beside the runtime's lock rather than behind it: asking how a
mount is going must never wait for the mount it is asking about.

Joining is the delicate step. A nest spliced in far behind must not drag its neighbours back through
history, so the newcomer catches up on its own, beside the cursor, and joins at a window boundary once
it is level. The first nest on a chain has no
neighbours to spare, so it starts that chain's cursor exactly as boot would. The last nest to leave does
not stop the cursor; an empty cursor idles, because the next mount onto that chain should find it there.

Pausing is a different thing from leaving. A suspended mount comes off its cursor and gives up its store,
but keeps its data, its record and its name, and its routes answer that it is suspended rather than that
it has vanished. Resuming is an ordinary mount of the recorded identity, which catches up from where it
stopped.

Changing a name's version is where a naive design shows a gap. A new version of a nest is a new NID, so
the name has to be repointed, and a reader must see the old nest and then the new one with no error in
between. The runtime mounts the new identity under a staging name and lets it catch up. It then takes the
old nest off the cursor, tells the cursor to know the staged nest by the real name, and swaps the whole
composition of routes in one step. Until that swap a reader is served by the old nest's stored data;
after it, by the new. The swap is a single atomic replacement of the routing table, so there is no
moment at which the name is served by neither.

## When one process is not enough

Scaled mode moves the hot store into Postgres and puts a control plane beside it. The control plane
holds what the fleet should run and which workers exist; it does not hold ownership. Ownership is
a lease kept in the chain's own hot-store schema, next to the data it protects, and a worker claims
it and fences its writes with a monotonically increasing value. A worker may only write while it
holds the current fence. If it dies, another worker can take the lease and continue, and since
4.11.0 a worker that finds its lease taken stops that cursor's nests on the same tick. The fence
prevents a late former owner from writing as though nothing happened, which is the small but
crucial detail separating failover from two machines cheerfully scribbling over the same state.
None of this is in the default binary: scaled mode is a separate build, `--features
postgres-store`, published as the `nuthatch-scaled` Linux tarball, because the embedded binary
carries no database driver and that is non-negotiable.

The data model remains recognisable: mounts identify datasets, cursors follow chains, hot data is
reversible and sealed data is durable. Scaled mode changes who is allowed to perform the cursor
work, not what the chain data means.

For configuration and practical commands, see [run many nests](/docs/operate/many-nests/),
[host nests for others](/docs/operate/hosting-nests/) and [scaled mode](/docs/operate/scaled/). The final chapter is about operating the whole arrangement
without taking a green health endpoint as proof of truth.
