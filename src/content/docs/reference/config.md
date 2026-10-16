---
title: "Configuration"
description: "nuthatch.toml and mounts.toml, field by field."
order: 2
checked: 5.7.0
---

Four files, all TOML. `nuthatch.toml` is written by `init` and yours to edit; `entities.toml` declares
maintained relations; `semantic.toml` is
covered in [The semantic layer](/docs/build/semantic/); `mounts.toml` mounts many nests. A nest
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

`since = "registration"` means a `--seal-direct` backfill won't fire history at your endpoint. See
[Webhooks](/docs/build/webhooks/).

### Contract calls and IPFS documents

`[[calls]]` pins an `eth_call` read to a block and needs an archive endpoint, given to `dev` with
`--state-rpc`. `[[ipfs]]` resolves documents a nest names and proves each against its CID; `dev --ipfs`
names the gateways. Both are covered field by field in
[Contract calls and IPFS documents](/docs/build/contract-calls/).

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

## `mounts.toml`

```toml
[runtime]
name = "my-runtime"
max_rss_mb = 2048             # optional per-cursor RAM ceiling (default 2048)
suspended = ["usdc"]          # runtime state: mounts suspended over the admin API (3.13.0)

[[chains]]
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://…"]

[[mounts]]
tenant = "default"            # optional; defaults to "default"
alias = "usdc"                # served at /usdc/ in a single-tenant runtime
nid = "<64-hex-nest-identity>"
sql = "allowlist"              # open | deny | allowlist
```

`[runtime]` and `[[chains]]` are authored: with no `[[mounts]]` at all they are a valid runtime that
starts empty and takes its nests over the admin API (3.13.0; without the admin API an empty runtime is
refused). `[[mounts]]` and `suspended` are runtime state: `nuthatch migrate` writes them from a pre-2.0
directory and a live runtime keeps them current after an admin mount, unmount, suspend or move. A
suspended mount keeps its record and data but is neither indexed nor served (it answers `503`) until
resumed. See [Run a runtime](/docs/operate/many-nests/)
for the full multichain shape and the named-query allowlist.

## A note on `nest.star`

An earlier Starlark front-end (`nest.star`, RFC-0018 §2) could *compute* a nest's config. It is
**retired**: author nests in plain `nuthatch.toml`. The loader still evaluates a legacy `nest.star`
hermetically for backward compatibility, but don't write new ones.
