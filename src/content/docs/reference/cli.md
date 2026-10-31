---
title: "CLI guide"
description: "The everyday Nuthatch commands, with the generated full reference linked below."
order: 1
checked: 5.15.0 (2026-10-31)
---

The whole product is meant to be two commands - `init` and `dev` - and everything else serves them.
The **authoritative, machine-generated full reference** (every subcommand and flag, rendered from clap's
own metadata and drift-gated in CI) ships in the repo as
[`skills/nuthatch-builder/cli-reference.md`](https://github.com/nuthatch-org/nuthatch/blob/main/skills/nuthatch-builder/cli-reference.md).
If a flag isn't there, it doesn't exist. This page is the guided tour: use it to understand the
workflow, then use the generated reference when you need the exact spelling of an option.

Almost every command that operates on a nest takes `--dir` (default `.`). The exception is
`nest bundle`, which takes the directory as a positional argument: `nuthatch nest bundle <dir>`.

## The two commands

- **`nuthatch init <address>…`** - scaffold a nest from one or more contract addresses: resolve
  each ABI (Sourcify → Blockscout → Etherscan), detect the deployment block, and write the project. Omit
  `--chain` - init probes the known chains for the contract's bytecode and picks the one it lives
  on. `--alias` names the contracts (default: the contract name from the ABI, else `c0, c1, …`);
  `--rpc` uses your own endpoints; paired with a `--chain` name nuthatch does not ship, it scaffolds
  any other EVM chain, reading the chain id from the endpoint. `--abi` supplies a local ABI (the escape
  hatch for a proxy), `--explorer` names a Blockscout instance to resolve from, `--start-block` skips
  the deploy-block probe, and `--no-timestamps` drops `block_timestamp` for good.
  `--from <git-url|dir>` initialises from a published nest instead of addresses (nothing is
  resolved - ABIs are vendored, so it's cloned, copied, and validated); `--from-subgraph <cid|url>`
  scaffolds from a subgraph manifest. `init` refuses a directory that already holds a nest (grow it
  with `add`, or pass a new `--dir`), and refuses a flag its mode would ignore, such as `--chain` with
  `--from`.
- **`nuthatch dev`** - run it: backfill, follow the tip, serve the API. `--listen` (default
  `127.0.0.1:8288`), `--rpc` runtime overrides, `--backfill N` (recent-history mode),
  `--seal-direct` (backfill finalized history straight to Parquet, bypassing the hot store),
  `--concurrency` (concurrent window fetches; 8-16 against your own node), `--window` (override the
  `getLogs` block-window - large for sparse contracts), `--no-admin`. Also `--rpc-fallback`
  (endpoints asked only while every other one is failing), `--poll-interval` (default five
  minutes, or the chain's block time if longer; `--poll-interval 12s` follows mainnet's tip closely,
  at the cost of more RPC calls), `--finality-only` (never index the unfinalised tip), `--cors`, and
  `--state-rpc` (archive endpoints for declared `[[calls]]`).

## Everyday companions

- **`nuthatch add <address>…`** - grow an existing nest with another contract; no re-init.
- **`nuthatch sql [query]`** - query the live tip ∪ sealed history; prints a table. No query opens
  a REPL (`.tables`, `.schema <t>`, history). `--json` emits NDJSON for piping to `jq`.
- **`nuthatch schema`** - regenerate the derived artifacts (`schema.json`, `llms.txt`, the
  `semantic.toml` footguns) after hand-editing `nuthatch.toml`.
- **`nuthatch mcp`** - serve MCP over stdio, bridging to a running `dev` (`--url`).
  `--print-config` prints a copy-paste client config instead. `--token-env <VAR>` (since 5.13.0)
  names an environment variable whose value is sent as a bearer token on every request, for a nest
  behind a gateway; `NUTHATCH_MCP_TOKEN` is read when it is not given. See [MCP](/docs/ai/mcp/).
- **`nuthatch check [name]`** - run the nest's invariant/parity checks (`checks/*.sql`) against
  recorded expected results; `--update` records current results as the fixtures.
- **`nuthatch doctor`** - probe an RPC endpoint before trusting a backfill to it: widest `eth_getLogs`
  range, batch limit, archive depth, and the largest safe `--window`. `--catalogue` checks the sealed
  segment catalogue instead.
- **`nuthatch serve`** - serve a nest without indexing it; `--hot-store` reads a Postgres hot store in
  a scaled-mode build. Since 5.13.0, `--runtime <dir> --follow <writer-url>` is a follower: it serves
  every mount of a runtime read-only from the sealed segments in that directory and the writer's
  hot-state feed, never opening redb. Since 5.14.0, `--follow` with `--mirror`, `--registry`,
  `--cache` and `--max-rss-mb` runs one on another host, taking segments from the writer's mirror and
  each nest from the registry. Its admin token comes from `NUTHATCH_ADMIN_TOKEN` (or, beside the
  writer, the runtime's `.admin-token`), never the command line. See
  [Host nests for others](/docs/operate/hosting-nests/#read-replicas-and-upgrades-without-an-outage).
- **`nuthatch diff --from A --to B`** - what happened in a block range, told in fixed sentences from
  the rows the nest already holds (RFC-0071, since 5.9.0). `--block` or `--tx` narrows it to one block
  or transaction; `--since-last` runs on from the previous diff. `--flow` draws the token flow
  instead. `--format` is `text`, `markdown` or `json` (and `dot`/`mermaid` for `--flow`); `--top` caps
  each list, up to 1,000 (above that it is refused, since 5.11.0). A range above the sealed boundary
  is labelled provisional, and `--final-only` refuses
  it. Read-only; it reads the store directly, or asks a running `dev` at `--url`.
- **`nuthatch count`** - the opt-in head count (RFC-0054). With no action it prints where things
  stand; `on`, `off`, `payload` (print what would be sent) and `forget`. Off until you say yes.
- **`nuthatch watch`** - *since 5.10.0.* A read-only
  terminal view of a running nest (RFC-0069): tip, seal, memory against budget, RPC endpoints.
  `--url` names a solo `dev` or a runtime's root, `--ssh <host>` forwards to a nest bound to loopback
  there, `--dir` names the nest whose `.admin-token` to present to a loopback `--url` when
  `NUTHATCH_ADMIN_TOKEN` is unset, and `--nest` reads a target from `~/.config/nuthatch/watch.toml`.
  Piped, it prints lines
  instead of a screen. `--record <file>` and `--replay <file>` save and redraw a session.

`entities.toml` needs no special command: `dev` loads and maintains it. A nest declaring an entity
must use the normal ingest path; `dev --seal-direct` is refused because direct sealing bypasses the
entity circuit.

## Derive-first reads (RFC-0023)

- **`nuthatch recipe list`** / **`recipe add <name>`** - add a derived view that computes a read
  (e.g. `total_supply`) from indexed events instead of an `eth_call`. No archive node,
  deterministic, free.
- **`nuthatch metadata fetch`** - fetch and cache a token's immutable `decimals`/`symbol`/`name`
  once; remembered in `metadata.json`.

## Packaging & lifecycle (RFC-0012, 0019, 0020)

- **`nuthatch nest bundle`** - package a nest's authored inputs into one portable,
  content-addressed `.bundle`; prints the content address. `--as-dir` writes an inspectable
  directory instead.
- **`nuthatch nest load <bundle|url|dir>`** - verify a bundle (manifest format, every file's hash,
  and that the regenerated decode registry matches) and install it as a runnable nest. `--expect`
  asserts the hash; `--registry` resolves a `name[@version]` reference instead, or a NID, whose
  bundle must compute to that NID.
- **`nuthatch nest publish <bundle> --registry <store>`** - publish under `name@version`, advancing
  `latest`, and index it by NID; prints the hash and the NID.
- **`nuthatch nest inspect <bundle|dir>`** - *since 5.13.0.* Describe a bundle, an unpacked bundle or
  a nest directory without running it, reading only local files: its NID, data identity, chain,
  contracts, templates, factories and entities, the cargo features and RPC kinds it needs, and every
  endpoint it would reach, with keyed URLs cut to scheme and host. A bundle is verified as `nest load`
  verifies it. `--json` prints the versioned form (`"schema": "nuthatch.nest-inspect/1"`).
- **`nuthatch nest rename-alias <old> <new>`** - re-key a contract alias in `nuthatch.toml`, the ABI
  file and `semantic.toml`.
- **`nuthatch seed --from <mirror>`** - fill a nest that has not indexed from a published mirror (a
  path, `s3://bucket/prefix` or a public `https://` address) instead of backfilling over RPC. The
  mirror must carry a seed snapshot, which a running nest's `dev --publish-target` writes, or
  `publish sync` on a stopped one; segments alone are refused. Seed into the same authored nest that
  was published: an edited one is a different dataset.
- **`nuthatch nest nid --dir <nest>`** - print the NID the nest's data is stored under (`data/<nid>/`), without
  running it.
- **`nuthatch publish sync|status|verify --target <prefix>`** - mirror sealed segments to a
  directory or `s3://bucket/prefix`; `dev --publish-target` does it as they seal.
  **`nuthatch publish finalise`** lists each table's provisional tail on a stopped nest; `--yes` marks
  them final so the mirror can carry them. It rewrites no file.
- **`nuthatch migrate --dir <dir>`** - move a pre-2.0 directory to identity-keyed datasets, and apply
  a staged nest upgrade. Classifies the change and **refuses a breaking one by name**
  (`--allow-breaking` to accept). Moves data and never re-indexes; `--dry-run` prints the plan.
- **`nuthatch prune --dir <dir>`** - reclaim datasets and shared segments nothing mounts any more.
  Lists by default; `--yes` deletes, and refuses while a runtime holds the directory
  (`runtime.lock`).

- **`nuthatch dev`** - run many nests behind one listener; `--fail-fast` exits on the first
  fault instead of quarantining it (RFC-0026); `--registry <store>` lets a live mount fetch a NID the
  runtime does not hold, and `--max-bundle-mb` (since 5.13.0) caps the bundles `POST /_admin/bundles`
  accepts, 64 MiB by default. `--ipfs` and `--state-rpc` reach every nest it runs; `--state-rpc` is
  refused when the runtime declares more than one chain. See [Run a runtime](/docs/operate/many-nests/) and
  [Host nests for others](/docs/operate/hosting-nests/).

## Offchain data (RFC-0045)

- **`nuthatch offchain drop <file> --table <name>`** - seal a local CSV, JSON array or Parquet file as
  an immutable snapshot under `offchain__<name>`.
- **`nuthatch offchain pull <url> --table <name> --format json`** - fetch a JSON-array feed once and
  seal it the same way; schedule it on the host. An authored entity can read `offchain__<name>`.

## Scaled mode (RFC-0022)

- **`nuthatch control`** / **`nuthatch worker`** - the control plane and a writer worker. `control` refuses to
  start without `NUTHATCH_CONTROL_TOKEN`. Both need the scaled build (`--features postgres-store`, or
  the `-scaled` release artifacts). See
  [Scaled mode](/docs/operate/scaled/).

## The compliance pack (RFC-0008)

- **`nuthatch labels import|list`** - labeled address sets as content-addressed snapshots.
- **`nuthatch lists fetch|list`** - sanctions/watch lists as pinned address snapshots (`ofac-sdn`,
  `eu-consolidated` have default URLs; any other name takes `--url` or `--file`).
- **`nuthatch pack keygen|build|verify`** - the signed compliance-pack manifest (ed25519). `keygen`
  writes its secret owner-only, by default under `~/.nuthatch`; `verify` needs `--pubkey`, the
  signer's public key as 64 hex characters or a file holding them.
- **`nuthatch audit report`** - summarise the threshold flags over a range (`--json`).
- **`nuthatch audit sealed --rpc <url>`** - re-fetch a sample of sealed ranges from a second endpoint
  and compare them row by row; `dev --audit-rpc` does the same in the background.

## Measurement

- **`nuthatch bench backfill --from N --to N`** - events/sec, wall-clock, peak RSS over a pinned
  range (`--runs 3`; the report is the median). `--seal-direct` measures the direct-to-Parquet
  path. A nest declaring `[[calls]]` also needs `--state-rpc`; both benchmark arms resolve the calls,
  and the command refuses to under-measure them when the endpoint is absent. State RPC URLs are
  redacted in output because they often contain credentials.
- **`nuthatch bench query`** - the read path: entity point-read p50/p99 and the `/sql` hot∪cold
  scan cost. Run offline against an already-indexed nest (stop `dev` first).
