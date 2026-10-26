---
title: "HTTP API"
description: "Every endpoint the served nest exposes."
order: 3
checked: 5.12.0 (2026-10-26)
---

Everything a running nest serves, on `--listen` (default `127.0.0.1:8288`). The data API is read-only:
the ingest thread is the only data writer. A runtime additionally has authenticated lifecycle mutation
routes for mounting, suspending, moving and unmounting nests. In a [runtime](/docs/operate/many-nests/), each nest's full
surface appears under its `/<name>/…` prefix, byte-identical to a solo nest.

## Status & introspection

- `GET /` - the index summary: contract(s), chain, rows indexed, last and sealed block.
- `GET /health` - liveness; returns `ok`.
- `GET /ready` - readiness: serving and making progress, not stalled. It is **not** "caught up"; check `lag_blocks` for that. `tip` and `lag_blocks` are `null` until the cursor first polls (since 5.11.0), never `0`, which would read as "at the tip".
- `GET /metrics` - Prometheus text. See [Metrics & footprint](/docs/operate/metrics/).
- `GET /nest` - the nest's identity: name, chain, content-addressed registry hash.
- `GET /shape` - which capabilities this nest can actually answer for (balances, flags, exposure,
  …). The MCP bridge reads it to advertise only live tools; it fails open if the probe fails.
- `GET /tables` - every decoded table with its columns, Solidity types, and topic0.
- `GET /schema` - the human/agent-readable data model, composed from the decode registry and
  [`semantic.toml`](/docs/build/semantic/).

## Data

- `GET /table/{name}?limit=N` - recent rows of one table, merged across the hot tip and sealed
  segments, newest first.
- `GET /entities` / `GET /entity/{id}` - entity point-reads from the hot store. Ids are formatted
  `{block:012}-{logindex:06}`.
- `GET /sql?q=…&max_rows=N` - read-only SQL over the live tip ∪ sealed history (SELECT/WITH only).
  Guarded: 30 s timeout, row cap (50,000 max; `max_rows` asks for less), 64 MiB result-byte cap, 2 concurrent.
  A query cut off by the timeout is answered with 504, one that spills more than the analytics spill
  cap to temporary storage (`NUTHATCH_ANALYTICS_MAX_TEMP_SIZE`, 2 GB by default) with 507, and a malformed one
  with 400. Results
  carry a **provenance stamp**: `as_of`, `sealed_through`, `source`, `nid` and `registry_hash`,
  so a figure can be cited against a fixed watermark. It does not list the segments read. See
  [The SQL surface](/docs/reference/sql/).
- `GET /explain?q=…` - validate a query **without executing it**: binds every table, column, and
  type and returns `{valid: true}` or an error with a fix hint. Cheaper than `/sql`; agents use it
  to check shape before spending a query.
- `GET /queries` - the mount's sanctioned query surface: `sql` (`open` | `deny` | `allowlist`),
  `free_form`, and each named query with its parameters and path. On an `open` mount this simply
  reports that free-form SQL is available.
- `GET /q/{name}?<params>` - run a **named, parameterised** query by name, passing its declared
  arguments as the query string. The caller never supplies SQL. Available on any mount that declares
  queries, and the *only* SQL route on an `sql = "allowlist"` mount - where `/sql` and `/explain` are
  refused with the list of names you may ask for instead. See
  [Bounding what a mount will answer](/docs/operate/security/#bounding-what-a-mount-will-answer).
- `GET /diff` *(since 5.9.0)* - what happened in a block, a range or a transaction, as `nuthatch diff`
  and the MCP `diff` tool tell it. Name the range with `block=N`, or `from=A&to=B`, or `tx=0x…`
  together with `block` (this route makes no RPC call to find a transaction's block). `flow=true`
  draws the token flow instead of the story; `top` caps the entries listed (default 10 for a story,
  25 for a flow; above 1,000 refused since 5.11.0); `final_only=true` refuses a range above `sealed_through` rather than labelling it
  provisional; `format` is `json` (default), `text`, `markdown`, and for a flow `dot` or `mermaid`. It runs under the same permit, 30 s budget and hot-tip bounds as
  `/sql` (`504` past the budget), and refuses rather than truncates past 2,000,000 flow rows or
  500,000 distinct edges. A mount bounded to named queries refuses it, since a diff reads every table.

## Derived & compliance

- `GET /derived` - the nest's declared incremental entities, and how current each one is.
- `GET /derived/{entity}` - the first page of a declared incremental entity, including its
  applied-through provenance.
- `GET /derived/{entity}/{key}` - a keyed point read from that maintained relation. The key follows
  the order declared in `entities.toml`. An entity is also a relation on `/sql`, so it can be joined
  with decoded tables.

- `GET /balances?limit=N` - top holder balances from the incrementally-maintained view (i128 base
  units as decimal strings).
- `GET /balance/{address}` - one address's derived balance.
- `GET /exposure/{address}` - direct counterparty exposure to the labeled set: inbound/outbound
  count and summed amount per label (RFC-0008).
- `GET /flags?kind=threshold|velocity` - compliance flags: single transfers over the configured
  amount, or addresses over the windowed-volume threshold.

- `GET /ipfs/gave-up` - the `[[ipfs]]` documents resolution gave up on, in block order. Each is
  absent from sealed history.

## Etherscan-shaped API

An [address-history nest](/docs/reference/config/#address-history-nests) (RFC-0063) serves a different,
smaller route set: `/api`, `/api/watch`, `/api/unwatch`, `/health`, `/ready` (with
`"mode": "address_history"`), `/metrics` and `/diff`. It has no `/sql`, `/tables` or admin UI. Its `/diff` takes the same permits and 30 s deadline as an event nest's `/sql` (since 5.11.0): `503` when every permit is held, `504` over the budget. An
event nest also answers `GET /api`, but only to say it has no `[address_history]`.

- `GET /api?module=…&action=…` or `POST /api` with a form body, for a call too long for a query
  string. A key given in both with different values is refused, and `chainId` is read as `chainid`.
  Answers use Etherscan's envelope, `{"status", "message", "result"}`. A range the nest cannot cover
  inside `request_deadline` answers `status "0"` with a result starting `NUTHATCH_INCOMPLETE:`, which
  a client can retry; a range before `start_block` says where history starts.
  - `module=account`: `txlist`, `txlistinternal` (also by `txhash`), `tokentx`, `tokennfttx`,
    `token1155tx`, `txsBeaconWithdrawal`, `getminedblocks`, with `address`, `startblock`,
    `endblock` and Etherscan's `page`, `offset` and `sort`; plus nuthatch's own `nuthatchProducedBlocks`,
    `nuthatchValidatorBlocks` and `nuthatchDeposits` (the sweep's deposit feed, paged by `after` and
    `offset`, up to 10,000). A `chainid` other than the nest's is refused.
  - `module=block&action=getblocknobytime`.
  - On a loopback bind only, `module=proxy` (`eth_blockNumber`, `eth_getBlockByNumber`,
    `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_call` and similar), `module=logs`
    `getLogs`, and account `balance`/`balancemulti` are forwarded to the nest's own RPC and stored
    nowhere. Off loopback the operator's RPC is not lent out, with two exceptions since 5.12.0:
    `eth_blockNumber` answers the nest's own finalized head, and `balance`/`balancemulti` are read
    when every address asked is watched.
- `GET /api/watch` lists the watched set. `POST /api/watch` and `POST /api/unwatch` take a JSON body
  of `{"address"}`, `{"validator"}` or, to add only, `{"addresses": [...]}`. They change what the nest
  asks its RPC for, so they answer `403` on any bind but loopback.

A directory of chain nests serves the same routes at one listener, choosing the chain by `chainid`;
it serves no `/diff`.

## GraphQL (the graph download only)

The GraphQL routes are registered only in a binary built with `--features graph`. Since 4.11.0 every
release attaches one, `nuthatch-graph-<target>.tar.gz`, beside the default download. The default
binary and the container image have no GraphQL route and answer these with 404.

- `POST /graphql`, `POST /subgraphs/id/{id}`, `POST /subgraphs/name/{name}` - a Graph-dialect query
  against the nest's `graph/schema.graphql`, which `port-emit` writes. The subgraph URL forms exist so
  a client needs only its host changed. Each entity collection is answered from the authored view of
  the same name.
- `GET /graph/status` - whether a historical read policy is configured, and fresh.

It is a partial read surface, not a subgraph replacement: every field either answers exactly or is
refused by name, and GraphQL refuses the whole query for one refused field. A collection the nest has
no view for answers `` `tokens` is not served by this nest: it has no `token` view ``, and an unknown
introspection field is refused by name. `__schema { queryType { fields } }` answers. An unsupplied
nullable variable is an absent argument, as graph-node reads it; a missing non-null one is refused.
See [Build a subgraph fallback](/docs/build/subgraph-fallback/).

## Admin & runtime

- `GET /_admin/` - the built-in dashboard; `GET /_admin/events` streams live activity (SSE).
  Both require a token on every bind (`401` without it): `NUTHATCH_ADMIN_TOKEN`, or on localhost
  without it the one the nest makes in `<dir>/.admin-token` (since 5.11.0). Off localhost without
  the variable they are not served. `--no-admin` removes them. See [Serving & the admin UI](/docs/operate/serving/).
- `GET /_admin/config` - the nest's authored files (`nuthatch.toml`, views and the rest) as they are
  on disk, with keys, secrets and URL paths redacted, and what the running process uses. Gated like
  the dashboard.
- `GET /_admin/storage` - the sealed catalogue per table: segment count, rows, bytes and block range;
  `?table=<name>` adds that table's segments, newest first. Gated like the dashboard.
- `GET /_admin/requests` *(since 5.10.0)* - the last 256 requests served, as
  `{last_seq, capacity, requests}`. Each record is a route template, status, time and size, plus the
  declared query or entity name where the route names one; never SQL text, a query string, a client
  address or a path value that is data. Gated like the dashboard.
- The **runtime lifecycle routes** below mutate runtime state: they follow the same token rule and
  disappear with `--no-admin`.
- `GET /nests` *(runtime only)* - the roster of mounted nests: name, chain, registry hash, table
  count, footprint, plus each nest's **live health** (`indexing` or `quarantined`, with the reason
  and the next re-admission attempt). The health half is merged per request, not cached at boot, so
  a quarantined nest reports what is true now.
- `GET /ready` *(runtime root)* - runtime-wide readiness, for a supervisor to poll. Each nest also
  answers its own `GET /<name>/ready`, so one sick nest is diagnosable without guessing.

## Runtime lifecycle (admin)

A runtime (`nuthatch dev --dir` over a `mounts.toml`) is driven by these routes. `<name>` is a mount's
route key: `usdc` for the default tenant, `acme/usdc` for any other, fixed for the life of the mount. The walkthrough is
[Host nests for others](/docs/operate/hosting-nests/).

| Route | Does | Answers |
|---|---|---|
| `POST /_admin/nests` `{"name", "nid"}` | Mount a NID under a name, as a job; fetched from `--registry` if not held | `202` and the job; `200` if already live with that NID; `409` for another NID |
| `POST /_admin/nests?wait=true` | The same, answering when finished | `200`, or `400` / `404` / `409` / `507` |
| `POST /_admin/nests?dry_run=true` | Price and check a mount, mounting nothing | `200` and a report with `refusal_status` |
| `GET /_admin/mounts` | Every mount the runtime knows, with its phase | `200` `{"mounts": [...]}` |
| `GET /metrics` | The runtime's Prometheus exposition, per-nest series labelled `{nest}` | `200`, even with nothing mounted |
| `GET /_admin/mounts/<name>` | One mount's job | `200`, or `404` |
| `POST /_admin/suspend/<name>` | Take a mount off its cursor, keep its data, answer `503` in its place | `200`; `404` if not mounted |
| `POST /_admin/resume/<name>` | Resume a suspended mount, as a job (`?wait=true` accepted) | `202`; `404` if not suspended |
| `POST /_admin/move/<name>` `{"nid"}` | Switch a live name to a new NID in one step, as a job (`?wait=true` accepted) | `202`; `400` for a malformed NID; `409` while a job for the name is running |
| `DELETE /_admin/nests/<name>` | Unmount (drain, then remove routes); `?reclaim=true` also frees the dataset | `200` `{"unmounted", "reclaim"?}` |
| `DELETE /_admin/datasets/<nid>` | Free a dataset unmounted earlier | `200` reclaimed, `409` kept, `404` absent |

A job is `{"name", "nid"?, "phase", "reason"?, "since_unixtime", "generation", "is_move"?}`.
`generation` counts claims on the name, so a forgotten worker cannot mount over a newer one;
`is_move: true` marks a move, so a restart resumes it as one. `phase` is one of `accepted`,
`fetching`, `joining`, `live`, `failed`, or `suspended` while paused. Reading a job never waits on a mount in progress; unfinished
jobs resume after a restart. Mount refusals: `400` malformed NID or a name boot would refuse, `404` NID not held and no
`--registry`, `409` name taken, chain not declared or its cursor dead, `507` over the cursor's RAM
ceiling. On the job route each ends the job `failed` with the same reason.

The normal operator upgrade path is [staging a successor and running `nuthatch migrate`](/docs/operate/upgrades/).
It classifies schema compatibility before changing a mount; it does not silently put a second public
version behind an undocumented route.
