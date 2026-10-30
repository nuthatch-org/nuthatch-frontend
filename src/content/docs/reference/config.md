---
title: "Configuration"
description: "nuthatch.toml, the optional nest files and mounts.toml, field by field."
order: 2
checked: 5.14.0 (2026-10-30)
---

All TOML. `nuthatch.toml` is written by `init` and yours to edit; it is the only one a nest needs. The
optional ones: `entities.toml` declares incremental relations, `maintained.toml` keeps stored copies of
chosen views, `queries.toml` caps the named queries any mount may serve, and `semantic.toml` is covered
in [The semantic layer](/docs/build/semantic/). `mounts.toml` belongs to a runtime rather than a nest,
and mounts many nests. A nest
declaring a `schema_version` newer than the binary understands is rejected on load - the guard that
makes `init --from` and `nest load` safe.

## `nuthatch.toml`

```toml
[nest]
name = "usdc"                 # nest name (also the runtime mount name)
chain = "mainnet"             # mainnet | arbitrum-one | base | bsc | polygon | gnosis | optimism | monad | robinhood
chain_id = 1
rpc_urls = ["https://…"]      # round-robin, with failover
schema_version = 1            # managed by nuthatch
block_timestamps = true       # default; set at init, not editable afterwards - see below
```

The top-level `[nest]` table identifies this authored nest. Contracts follow in one or more
`[[contracts]]` entries:

```toml
[[contracts]]
alias = "usdc"                # table prefix → usdc__transfer, usdc__approval, …
address = "0xA0b8…eB48"
start_block = 6082465          # optional; deployment block (init detects it)
abi = "abis/usdc.json"        # vendored ABI path, relative to the nest dir
events = ["Transfer"]         # optional allowlist; omit to decode every ABI event
```

An alias becomes part of table and segment file names, so it must match `[A-Za-z0-9_-]`; since 5.8.0
any other alias, or template `name`, refuses to load.

### `block_timestamps`

Whether every row carries `block_timestamp`. On by default, and the most consequential decision
`init` makes on your behalf.

Timestamps cost a block-header round trip per block - around **85% of backfill wall clock** - for a
column many nests never query. A nest that will never ask a time-series question can drop it:

```sh
nuthatch init 0xAddr --no-timestamps
```

**It is an init-time choice, deliberately not a flag you can flip.** Changing it later removes a
column that consumers may be reading, which RFC-0020 classifies as *breaking*, and it means a full
re-index. Blocks give you ordering; only timestamps give you time. If you are unsure, keep them - 
the default is on for a reason.

When an endpoint returns only part of a timestamp batch, Nuthatch divides the range and retries.
Since 2.7.0 the top-level halves run concurrently rather than descending serially, which reduces the
retry storms observed on very long backfills. It does not remove the underlying header cost.

Flipping the value in `nuthatch.toml` by hand is refused at startup rather than honoured silently,
because a store written one way cannot be read the other.

The per-contract `events` allowlist is how a nest indexing e.g. GraphToken keeps only `Transfer`
instead of millions of irrelevant rows. A name the ABI doesn't define is a config error, caught at
registry build.

### Any other EVM chain

Ethereum mainnet, Arbitrum One, Base, BSC, Polygon, Gnosis, Optimism, Monad and Robinhood Chain are
**built in** - keyless public endpoints, a tuned `eth_getLogs` window and chain-appropriate finality.
`init` probes all nine by bytecode when you omit `--chain`. Public endpoints are measured, not
assumed - and a measurement is a snapshot, not a property, so run `nuthatch doctor --rpc <url>`
before trusting a long backfill to any of them.

**Any other EVM chain works too** - World Chain, Base Sepolia, your own devnet. Name it and say where
it lives, and `init` reads the chain id from the endpoint:

```sh
nuthatch init 0xADDR --chain world-chain --rpc https://your-endpoint.example
```

If Sourcify has no ABI for the contract, pass `--explorer <blockscout-root>` or `--abi <file>`. Writing
`nuthatch.toml` by hand works just as well:

```toml
[nest]
name = "my-nest"
chain = "world-chain"        # any label you like - not looked up for an unlisted chain
chain_id = 480               # MUST match what your endpoints report; verified at startup
rpc_urls = ["https://your-endpoint.example"]
schema_version = 1

[[contracts]]
alias = "router"
address = "0x…"
start_block = 1234567        # no bytecode probing here, so supply it yourself
abi = "abis/router.json"     # vendor the ABI by hand
events = ["Swapped"]
```

Then `nuthatch dev --dir .` as usual - decode, sealing, `/sql`, views, MCP, runtimes, and bundles are
all chain-agnostic downstream. Two caveats worth knowing:

1. **You inherit default finality and window.** An unlisted chain gets depth-64 finality and a
   20-block `eth_getLogs` window, because nuthatch has no per-chain policy for it. Depth-64 is an
   Ethereum-L1-shaped assumption; if your chain finalises differently, the conservative direction is
   *deeper*. The 20-block window will make a long backfill crawl - raise it with `--window` (a
   sparse contract can often take 50000) up to your provider's range cap.
2. **`chain_id` is enforced.** Every endpoint in `rpc_urls` is checked against it at startup and a
   mismatch is refused - get it wrong and nuthatch tells you immediately rather than three days into
   a backfill.

### Factories (RFC-0009)

```toml
[[templates]]
name = "pool"                 # shared table prefix for all discovered children
abi = "abis/pool.json"
filter = "topic0"             # optional: force the topic0-only backfill strategy
events = ["Swap"]             # optional: which of the ABI's events to decode (default: all)

[[factories]]
watch = "factory"             # the *alias* of the watched contract (or a template, for nesting)
event = "PoolCreated"         # the announcing event
child_param = "pool"          # the event param holding the child's address
template = "pool"             # which [[templates]] the child uses
start = 12369621              # optional: ignore discoveries before this block
```

All children of one template share tables (`{template}__{event}`), distinguished by the implicit
`address` column. `filter = "topic0"` is a strategy override for templates known to have many
children; omit it and logs are asked for by factory and child addresses until the template has 500
children, then by topic0. Since 4.11.0 that holds from the first backfill window and at the tip, and
an endpoint that refuses a topic0-only fetch keeps the cursor on addresses. See
[Factories](/docs/build/factories/).

`events` chooses **what is decoded**, where `filter` chooses **how the range is fetched** - two
different questions that are easy to confuse. Without it the vendored ABI is the only filter, so a full
`UniswapV2Pair` ABI decodes Swap, Sync, Mint, Burn, Transfer *and* Approval when the nest wanted Swap:
not wrong, but a different workload, and nothing said so. An absent or empty list still decodes
everything, so existing nests are unaffected. A name the ABI does not define is a config error, caught
when the nest loads rather than surfacing as an empty table after the backfill.

`--from-subgraph` fills this in for you: a subgraph declares `eventHandlers` per template, so an
imported nest decodes what the subgraph decoded rather than a superset of it.

### Flags, alerts (RFC-0008)

```toml
[flags]                           # amounts are token BASE UNITS as decimal strings (i128)
threshold = "1000000000000"       # flag any single transfer ≥ this
velocity_amount = "5000000000000" # flag an address whose windowed outbound volume ≥ this
velocity_window = 7200            # window in BLOCKS (default 7200 ≈ 24h of 12s mainnet blocks)

[[alerts]]                        # route annotations to webhook sinks
kinds = ["threshold_flag"]
url = "https://…"
format = "raw"                    # optional: "raw" (default) | "discord"
```

Both are opt-in: absent means no flags, no alerts, zero cost. A `[screening]` table is refused at
load since 5.0.0, which removed live screening; delete it. Alert delivery is
at-least-once via a durable outbox; a stalled sink never blocks indexing. Note `velocity_window` is
a **block count**, not wall-clock - an honest approximation, since the chain has no clock.

### Webhooks (RFC-0010)

```toml
[[webhooks]]
name = "large-transfers"
table = "usdc__transfer"
where = "value_dec > 1000000"     # optional SQL predicate (note the key is `where`)
url = "https://…"
batch_max = 100                   # optional rows-per-POST cap
finality = "sealed"               # "sealed" (default, and the only mode today); "tip" is refused
since = "registration"            # "registration" (default) | "genesis" | a block number, quoted: "26091000"
secret = "…"                      # optional; adds X-Nuthatch-Signature: sha256=<hex> (HMAC)
```

`since = "registration"` means a `--seal-direct` backfill won't fire history at your endpoint. A
`table` or `where` that does not bind, or any other `since`, refuses the nest at start, by field. See
[Webhooks](/docs/build/webhooks/).

### Contract calls and IPFS documents

`[[calls]]` pins an `eth_call` read to a block and needs an archive endpoint, given to `dev` with
`--state-rpc`. `[[ipfs]]` resolves documents a nest names and proves each against its CID; `dev --ipfs`
names the gateways. The guide is
[Contract calls and IPFS documents](/docs/build/contract-calls/); the keys are these.

| `[[calls]]` key | Meaning |
|---|---|
| `name` | Result table name |
| `contract` | Fixed address to call; or `contract_column = "{col}"` to take it from the source row |
| `calldata` | Hex calldata with selector, for a sampled call with fixed arguments |
| `every` | Sample every N blocks (default 1000) |
| `start` | First block to sample from (default: the nest's own start) |
| `on` | Row-driven: the event table whose rows fire the call |
| `on_any` | Row-driven across several tables (not with `on`); needs `schema_version = 3` |
| `signature`, `args` | Row-driven: the ABI signature, and positional arguments where `{column}` reads the source row |
| `canonical` | `true` pins by block hash with `requireCanonical` (EIP-1898) and never falls back to the block number; needs `schema_version = 3` |

| `[[ipfs]]` key | Meaning |
|---|---|
| `name` | Table for the resolved documents |
| `on`, `cid_column` | The table whose rows carry CIDs, and the column holding them |
| `cid_json_path` | The column holds JSON naming the CID under this top-level key |
| `json_match` | Resolve only JSON objects whose string fields equal these values; the rest are declined, not counted as failures |
| `[ipfs.rows]` | `table`, `max_rows`, `keep_content` (default `true`) and `columns = [{ name, type }]`, with `type` one of `string`, `number`, `u64`, `i64`, `bool`, `address`: each proven document exploded into typed rows |

### `[extract]`

Extraction beyond events, off by default.

```toml
[extract]
blocks = true            # one row per block, header fields; ordinary RPC
top_level_calls = true   # transactions sent directly to this nest's contracts, calldata decoded
# l1_blocks = true       # Arbitrum-family: l1_block_number per log-bearing block; not beside blocks
# traces = true          # internal calls; needs a colocated node
# state = true           # storage writes; needs a colocated node
# contracts = ["router"] # scope traces/state to these aliases
# selectors = ["0x…"]    # scope traces to these 4-byte selectors
# unbounded = true       # accept unscoped traces/state anyway
```

`blocks`, `l1_blocks` and `top_level_calls` come from ordinary RPC and run today. `traces` and `state`
have decode and schema but no source: a nest that enables either is refused at startup, after the
scope check, rather than served empty tables. Unscoped `traces` or `state` is refused as unbounded
unless `unbounded = true` is typed.

## Address-history nests

A nest may declare `[address_history]` and no `[[contracts]]` (RFC-0063). It indexes no contract: it
follows watched accounts and serves their history Etherscan-shaped at `/api`, with its own `/ready`
and `/metrics` (see [HTTP API](/docs/reference/http-api/#etherscan-shaped-api)). Declaring both is
refused. It runs alone under `nuthatch dev`, not in a runtime, and refuses the event-indexing flags
(`--backfill`, `--seal-direct`, `--window`, `--state-rpc`, `--ipfs` and the rest). `--trace-rpc`
names a trace-capable endpoint for internal transactions; without it the nest's own RPCs are used.

```toml
[nest]
name = "my-accounts"
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]
schema_version = 1

[address_history]
addresses = ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045"]
```

| Key | Meaning |
|---|---|
| `addresses` | Accounts to watch. May be empty: a client registers its own through `/api/watch`. A mixed-case address must pass its EIP-55 checksum |
| `start_block`, `end_block` | History bounds; a request before `start_block` is refused as incomplete |
| `poll_interval` | How often the head is read (default `5m`; `dev --poll-interval` overrides) |
| `request_deadline` | The longest a request for uncovered history may wait (default `8s`) |
| `mev_relays` | `true` asks the MEV-Boost relays' public API about blocks a watched address produced or was paid for. Off by default: the relays see this machine's IP |
| `validators` | Validator indices whose proposed blocks to prove, Ethereum mainnet only |
| `beacon_url` | A beacon node API, for proposer data the mirror has not published. Off unless named |
| `[address_history.mirror]` | `url`, `chain_id`, `from_block`, optional `to_block`, and `cache_mb` (at least 64): verified block partitions downloaded rather than read block by block |
| `[address_history.sweep]` | Read every block once for the whole watched set (RFC-0064): `from_block` (default: the finalized head at first run), `internal` (trace for internal transfers), `confirmations` (sweep this far under the head instead of to finality; a reorg retracts), `webhook` (POST the deposit feed, at least once, oldest first) |

A directory whose subdirectories are address-history nests, one per chain, runs with `nuthatch dev
--dir <that directory>`: each keeps its own cursor and one listener serves `/api`, choosing the chain
by `chainid`. It serves no `/diff`.

## `entities.toml`

`entities.toml` is optional. It declares an [authored incremental entity](/docs/build/entities/): a
keyed relation whose SQL is maintained while blocks arrive. The SQL is a separate file containing one
`SELECT`; it is not a `CREATE VIEW` statement.

```toml
[[entities]]
name = "indexer_rewards"
sql = "entities/indexer_rewards.sql"
key = ["indexer"]
max_rows = 100000
```

`name` is the relation name served on `/sql`. `key` lists unique output columns in point-read order.
`max_rows` is required and positive. It is the resource bound Nuthatch admits, not merely an estimate:
crossing it faults the entity and quarantines the nest. The entity SQL subset is deliberately smaller
than the SQL `/sql` accepts, so use an authored view for a query it refuses.

Adding this file to a nest with history makes the next normal start seed the relation from local sealed
segments and the hot tail. It does not re-index from RPC. Do not start an entity-bearing nest with
`--seal-direct`: 3.0.0 refuses that combination rather than serving an empty maintained relation.

## `maintained.toml`

Optional (RFC-0062, since 4.14.0). It names authored views to answer from a stored copy of their own
request-time evaluation.

```toml
recent = 4          # older copies kept per view besides the current one (default 4)

[[view]]
name = "daily_volume"
```

A copy is keyed by a hash of every input the view reads: the binary, the authored files, the sealed
segments and hot rows of the tables it reaches, and their schema. It is served only at exactly those
inputs, so it is never stale; anything else answers from the definition as usual. Copies are rebuilt
after a commit or seal reaches the tip, off the commit path, and live in the dataset under
`maintained/<view>/`; a view no longer declared loses its copies. The file is
authored, so it is in the NID, but outside the data identity: adding it re-indexes nothing.

Each `name` must be an authored view in `views/*.sql`, named in lowercase letters, digits and `_`. A
view is refused at load, by name, when it or anything it reads calls a volatile function, or reads
`labels`, an offchain snapshot view, a factory `__children` view or an incremental entity, since a
copy's identity does not cover those yet. See
[Maintaining an answer](/docs/book/maintaining-an-answer/).

## `queries.toml`

Optional. The author's ceiling on named queries (RFC-0034 §3): every mount of the nest may serve
these or fewer, never more, and a mount left on `sql = "open"` serves exactly these rather than
free-form SQL. A mount's own queries are declared the same way under `[[mounts.queries]]`.

```toml
[[queries]]
name = "transfers_to"
sql = "SELECT * FROM usdc__transfer WHERE \"to\" = {addr} ORDER BY block_number DESC LIMIT {n}"
params = { addr = "address", n = "int" }
```

Parameter types are `int` and `address` only. Every `{placeholder}` must be declared and every
declaration used, checked at load. A mount query whose name is not in the ceiling, or whose statement
differs from the author's, is refused. See
[Bounding what a mount will answer](/docs/operate/security/#bounding-what-a-mount-will-answer).

## `mounts.toml`

```toml
[runtime]
name = "my-runtime"
max_rss_mb = 2048             # optional per-cursor RAM ceiling (default 2048)
sql_permits = 2               # optional: SQL permits on each cursor's gate (5.14.0)
isolation = "shared"          # optional: "strict" separates tenants (5.13.0)
suspended = ["usdc"]          # runtime state: mounts suspended over the admin API (3.13.0)

[runtime.publish]             # optional: the runtime's mirror, and where "seed" reads (5.13.0)
target = "s3://nests/mirror"
followers = false             # true also publishes for followers on other hosts (5.14.0)

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[tenants.acme]                # optional: a tenant label's share (5.13.0)
weight = 2
max_permits = 1
max_response_mib = 32

[[mounts]]
tenant = "default"            # optional; defaults to "default"
alias = "usdc"                # served at /usdc/ in a single-tenant runtime
nid = "<64-hex-nest-identity>"
sql = "allowlist"              # open | deny | allowlist

[mounts.limits]               # optional: lower this mount's query guards (5.13.0)
statement_timeout_ms = 5000
max_rows = 1000
```

`[runtime]` and `[[chains]]` are authored: with no `[[mounts]]` at all they are a valid runtime that
starts empty and takes its nests over the admin API (3.13.0; without the admin API an empty runtime is
refused). `[[mounts]]` and `suspended` are runtime state: `nuthatch migrate` writes them from a pre-2.0
directory and a live runtime keeps them current after an admin mount, unmount, suspend or move. A
suspended mount keeps its record and data but is neither indexed nor served (it answers `503`) until
resumed. A `nid` is written in lower case: since 5.8.0 an upper-case one refuses to load, because on
Linux it names a different directory under `data/`. See [Run a runtime](/docs/operate/many-nests/)
for the full multichain shape and the named-query allowlist.

The rest is operator configuration, and the admin API also writes it, before each change takes
effect, so what runs is what the next start runs:

- **`max_rss_mb`** is each chain cursor's RAM ceiling. 2048 is the default and the budget nuthatch is
  gated for; since 5.13.0 it may be set higher, up to 1 TiB, as the operator's choice. `PUT
  /_admin/runtime` changes it live.
- **`sql_permits`** (5.14.0) is how many analytical statements each cursor's gate runs at once. Absent,
  `NUTHATCH_SQL_MAX_CONCURRENCY` sets it, and absent too it is 2. It is held to the cursor's memory
  split rather than a fixed ceiling, and `PUT /_admin/runtime` changes it live.
- **`isolation`** (5.13.0) is `shared` (the default) or `strict`, which gives each tenant label its
  own SQL sessions, engine pools and memo, and holds `/sql` to a function allow-list. Its isolation
  guarantee is not claimed until an independent review has run; see
  [Security](/docs/operate/security/#tenants-who-do-not-trust-each-other).
- **`default_tenant`** names the tenant a mount belongs to when it names none, `"default"` if absent.
- **`[runtime.publish]`** (5.13.0) mirrors every dataset whose mounts name no `[mounts.publish]` of
  their own, and is where a mount with `"seed": true` reads from. It takes `target`, `interval`
  (default `60s`) and `parallelism`, and since 5.14.0 `followers`, off by default, which also publishes
  provisional tails, offchain snapshots and a marker for followers on other hosts, and deletes the
  tails a fold replaced. A mount's own `[mounts.publish]` takes the same keys.
- **`[[chains]]`** may also carry `finality_depth` and `log_window` (5.13.0), for a chain the
  built-in registry does not know. `POST /_admin/chains` adds one live (5.13.0).
- **`[tenants.<tenant>]`** (5.13.0) is a tenant label's `weight` (1 to 1000, default 1),
  `max_permits` on any one gate and `max_response_mib` in flight. `PUT /_admin/tenants/<tenant>`
  writes it.
- **`[mounts.limits]`** (5.13.0) lowers this mount's query guards: `statement_timeout_ms`,
  `max_rows`, `max_result_bytes`, `max_hot_rows`, `max_hot_bytes`, `max_named_scan_bytes`,
  `analytics_memory_bytes`, `max_queued`, and since 5.14.0 `window_deadline_ms`, how long one window
  of indexing may take before it is abandoned and retried. A value above the process's own is refused
  over the API, never clamped; one the process has since been lowered past is held to the process
  value at boot, with a warning. It sits outside the NID, so changing it re-indexes nothing. `PATCH
  /_admin/mounts/<name>` writes it.

See [Host nests for others](/docs/operate/hosting-nests/#9-shares-and-limits) for how each behaves.

## A note on `nest.star`

An earlier Starlark front-end (`nest.star`, RFC-0018 §2) could *compute* a nest's config. It is
**retired**: author nests in plain `nuthatch.toml`. The loader still evaluates a legacy `nest.star`
hermetically for backward compatibility, but don't write new ones.
