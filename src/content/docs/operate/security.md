---
title: "Security"
description: The advisories you need to know about, what the guards actually stop, and what to decide before you expose /sql.
order: 4
checked: 5.15.0 (2026-10-31)
---

## Upgrade first

Two released defects on `/sql`, and two in what a runtime will install from someone else's nest, all
fixed. If you expose `/sql` to anyone you do not fully trust, or mount nests other people wrote, be
on a current release before reading further.

> **v5.12.2 - a bundle reaching outside itself** (GHSA-mqw2-cc6q-mpw6). Unpacking a bundle accepted
> any tar entry type, so a bundle could carry an entry that resolved to a file elsewhere on the host;
> the integrity check then read it and the install copied it into the nest. On a runtime that mounts
> nests from other people, one nest could install another dataset's sealed segment this way and read
> it. Unpacking now admits only regular files and directories.

> **v5.12.1 - an offchain manifest naming another file** (GHSA-w9wm-2c89-4cxw). A nest's
> `offchain/manifest.json` travels inside its bundle, and a snapshot's file name was joined to
> `offchain/segments/` unchecked, so an absolute or `..` path made `/sql` read a Parquet file outside
> the nest. Every snapshot file must now be a plain `.parquet` name under `offchain/segments/`, and a
> symbolic link there is refused.

Both matter to an operator who mounts nests or bundles written by someone else. A self-hoster running
only their own nests was not exposed.

> **v0.9.3 - arbitrary file read.** DuckDB accepts a **quoted** function name, and the guard matched a
> forbidden name only when the next non-space character was `(`. So `SELECT * FROM "read_csv"('/etc/passwd')`
> passed both guards and executed. Confirmed against a live connection during a pre-1.0 adversary pass,
> returning the contents of `/etc/hosts`. **Every earlier release is affected.**

> **v0.6.2 - arbitrary file write.** Releases up to 0.6.1 accepted `;`-stacked statements. Since
> `COPY … TO` and `ATTACH` write to disk regardless of the in-memory connection, a stacked statement
> was a file-write primitive for anyone who could reach the endpoint.

All four have published advisories on the repository's Security tab. Each was fixed by a binary swap
with no data migration, so there is no reason to sit on any of them.

**Which releases get fixes.** Since 5.13.0 the latest minor receives security fixes, and so does the
previous minor for 30 days after the next ships: when 5.14.0 shipped on 2026-10-29, 5.13 kept
receiving them until 30 days after that. A backport carries the fix and nothing else. An operator who
hosts nuthatch for other people may ask for private advance notice of a security release; see
[`SECURITY.md`](https://github.com/nuthatch-org/nuthatch/blob/main/SECURITY.md).

**The two `/sql` defects are the same class of bug seen twice:** the guard was right about the shape it imagined, and the
shape had another spelling. That is what shaped the fix below.

## What guards `/sql`

Two controls with deliberately **different failure modes**, not one behind the other.

**A denylist** rejects the file-reading and environment-disclosing functions by name, scanning after
quotes are normalised away - so `"read_csv"(`, `read"_"csv(`, and anything else quoting can do to break
a name apart all collapse to the same match.

**An allowlist** (since v0.9.3) asks the engine's own parser what a statement references and refuses
anything unrecognised: a table function must be one of three, and a base table must be *named like an
identifier* - which is what catches a replacement scan, `FROM '/x.parquet'`, that the parse tree
otherwise reports as an ordinary table whose name happens to be a path.

The allowlist **fails open** if the parse is unavailable, which is why it does not replace the
denylist: a parse failure must not take down `/sql` while a control that has guarded this surface since
RFC-0008 is still in front of it.

> **Behind them, the engine registers only what nuthatch binds.** Each Burrmill session opens empty
> and registers the sealed segments and hot rows of the tables a statement uses. Until 4.1 the engine
> was DuckDB, whose `allowed_directories` did not enforce on the bundled build; a test pinned which
> control actually blocked a file read. An unmeasured defence-in-depth layer is worse than none,
> because it gets counted on.

## Resource guards

Denying a query is cheaper than an OOM that takes co-tenants with it:

| guard | default |
|---|---|
| query timeout | 30 s |
| row cap | 50,000 |
| result bytes | 64 MiB |
| concurrent analytical queries | 2 per chain gate (`[runtime] sql_permits` in a runtime) |
| query text length | 16 KiB |
| unsealed tip rows per query | 2,000,000, then `503` |
| unsealed tip row data per query | 64 MiB, then `503` |
| unsealed tip copies in flight, all queries on one chain gate | 128 MiB, then `503` |
| one computed value (a scalar function's result, `\|\|`, `string_agg`) | 16 MiB, then `out_of_memory` |
| source bytes a declared query may scan | 512 MiB, then `422` |

The tip bound **refuses rather than truncates** - a partial tip would silently change the answer to an
aggregate, and a wrong number is worse than an error. The `503` names `sealed_through` so a caller can
narrow to sealed data and get a correct answer immediately. The 64 MiB tip bound counts the stored rows
a query reads, not what it returns, so wide rows can meet it far below two million; it is separate from
the 64 MiB result cap. A declared query (`queries.toml`) is bounded before it runs by the bytes it
would read from segments and the tip together, and one over 512 MiB is refused with `422` and the
bound, never evaluated.

Since 5.13.0 a statement's computed values count against its memory budget too. The engine had not
counted scalar function results against a statement's pool, so one `/sql` statement could hold
several GB in values it built. Every scalar function is now bounded at 16 MiB a value, checked from
its arguments before allocating where an argument sets the size (`repeat`, `lpad`, `range` and their
relatives), and `||`, folded constants, `string_agg` and `range` or `generate_series` in `FROM` are
bounded the same way. A refusal reads as `out_of_memory`, as before.

Each of these is a ceiling. The process can be held lower by environment (`NUTHATCH_SQL_TIMEOUT_MS`,
`NUTHATCH_SQL_MAX_ROWS`, `NUTHATCH_SQL_MAX_RESULT_BYTES`, `NUTHATCH_SQL_MAX_HOT_ROWS`,
`NUTHATCH_SQL_MAX_HOT_BYTES`, `NUTHATCH_SQL_MAX_NAMED_SCAN_BYTES`, `NUTHATCH_SQL_MAX_QUEUED`), and in a
runtime a mount can lower them further for itself under `[mounts.limits]` (since 5.13.0); none can be
raised.

## Bounding what a mount will answer

The guards above are **node self-protection, not a security boundary**. They bound the damage one
query can do; they say nothing about *which* queries a nest is willing to answer. Since 2.0 that is a
per-mount decision, set in `mounts.toml`:

```toml
[[mounts]]
alias = "usdc"
nid = "9f2c…"
sql = "allowlist"          # "open" (default) | "deny" | "allowlist"

  [[mounts.queries]]
  name = "transfers_to"
  sql = "SELECT block_number, value FROM usdc__transfer WHERE \"to\" = {addr} ORDER BY block_number DESC LIMIT {n}"
  params = { addr = "address", n = "int" }
```

- **`open`** - arbitrary `/sql`, bounded only by the node guards. The default, and the right one for a
  local `nuthatch dev`: exploration is the point.
- **`deny`** - no SQL at all. `/sql` and `/explain` are refused; the typed routes (`/tables`,
  `/entity/{id}`, `/balances`, …) still serve.
- **`allowlist`** - only the declared queries answer, by name.

A nest whose author ships a `queries.toml` caps every mount of it: a mount may name fewer of those
queries or deny SQL, an allowlist wider than the author's is refused, and since 5.8.0 a mount left on
`open` answers exactly the author's queries, never free-form SQL.

**The client sends a name, never SQL.** `GET /usdc/q/transfers_to?addr=0x…&n=3` supplies typed
arguments; it never supplies a statement. Matching caller-supplied SQL against a regex or a
"is it a SELECT" check is the shape of every SQL-filter bypass ever written - this is deliberately not
that.

Parameters are `int` or `address` only. Both have a *total validating parse* into a form with no
escaping hazard, so rendering them is safe by construction rather than by careful escaping. `text` is
absent on purpose: free text needs escaping, escaping needs to be right in every dialect and context,
and "we escaped it carefully" is how this class of bug ships.

Queries are validated **at load, not at first call** - a nest facing the public fails to start rather
than serving a surface whose parameters turn out to be wrong the first time someone asks. Refusals name
what you *can* ask:

```json
{ "error": "this nest answers only its declared queries, not arbitrary SQL",
  "allowed_queries": ["transfers_to"],
  "hint": "call GET /q/{name} … ; GET /queries lists them with their parameters" }
```

Because this is **mount config, not manifest**, changing it leaves the nest's identity untouched and
re-indexes nothing - and two tenants can share one dataset while exposing different surfaces.

## Tenants who do not trust each other

By default every mount of one dataset shares its SQL session, engine memory pool and answer cache,
which is right when one operator owns every mount. For a runtime that hosts parties who do not trust
each other, 5.13.0 added two things (RFC-0073):

- **Fair share.** Each chain's SQL permits and the process's response bytes are divided by tenant
  label, so one tenant's burst cannot answer `503` to every other tenant on the chain. A tenant past
  its share is refused `429` `tenant_share`. See
  [Host nests for others](/docs/operate/hosting-nests/#9-shares-and-limits).
- **`[runtime] isolation = "strict"`.** Each tenant label gets its own SQL sessions, engine memory
  pools and memo entries on every SQL route, even when two tenants mount the same dataset. `/sql`, and
  every authored view it reaches, is held to an allow-list of functions, every one the engine
  registers except `version`, `arrow_metadata` and `arrow_field`, and a test fails the build when the
  engine registers a function the list does not name. Authored views must be `CREATE VIEW`. A
  `fuzz/sql` target runs in CI.

**The isolation guarantee is not claimed.** The threat model,
[`docs/security/shared-runtime.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/security/shared-runtime.md),
says what strict mode is meant to stop and what it does not defend: timing, shared CPU and permits,
and memory safety in the engine. It describes what the code does, and it is not a guarantee until an
independent review has run against it. A query on one tenant's mount that reaches another tenant's
data, sessions or files under strict mode is in scope for a security report.

## Exposure

nuthatch binds `127.0.0.1` by default and is built to be **fronted**. TLS, authentication and metering
are the operator's layer. The `Nuthatch-Cost` header a request can ask for (since 5.13.0) is a report
of what the request read and held, for a gateway to meter by if it chooses; nuthatch bills nothing.

- **`/_admin/`** mutates state (mounting and unmounting nests), and since 5.11.0 every request needs
  a token, on every bind. `NUTHATCH_ADMIN_TOKEN` is used when set. Without it, a localhost nest or
  runtime makes one on first start in `<dir>/.admin-token` (32 random bytes, owner-only, reused on
  later starts) and prints the admin URL with it in the startup log; off localhost the routes are
  not served. Nothing is admitted for looking local, because a reverse proxy makes every request
  look local. `--no-admin` removes the routes.
- **The scaled-mode control plane** *refuses to start* without `NUTHATCH_CONTROL_TOKEN`, on any bind -
  a refusal, not a warning. It decides what an entire fleet runs.
- **Token comparison is constant-time**, on both surfaces.
- **`/health` and `/ready`** stay unauthenticated so a load balancer can probe them. `/health`
  returns only `ok`. `/ready` deliberately reports operational state: the version, chain progress,
  lag, freshness and sealing. Weigh that before routing it to a public probe.
- **The hot-state feed** a follower reads, `GET /_admin/feed`, is behind the same admin token and
  absent with `--no-admin`. A follower takes the token from `NUTHATCH_ADMIN_TOKEN` (or, beside the
  writer, its `.admin-token` file), never from the command line.
- **The MCP bridge** can send a bearer token to a nest behind a gateway (since 5.13.0):
  `nuthatch mcp --url … --token-env NEST_TOKEN` names the variable that holds it, or
  `NUTHATCH_MCP_TOKEN` is read by default. The token never reaches output, and a response that echoes
  it is redacted before the model sees it.

## Running someone else's nest

A nest bundle is content-addressed and hash-verified on install: the manifest, every file's bytes, and
the decode registry regenerated from the inputs must all agree, or it is refused. That makes a bundle
*tamper-evident*, not *safe* - a valid bundle can still declare endpoints you would rather it did not.

So `nest load` **warns about every non-loopback outbound endpoint** a bundle declares - webhooks, alert
sinks, RPC URLs, and since 5.13.0 IPFS gateways and offchain sources, which it missed before - with
credentials redacted. Link-local and cloud-metadata addresses (`169.254.169.254`)
are logged at `error` rather than buried among them, because that is where an SSRF actually pays: on a
cloud host, instance credentials are served there. `nuthatch nest inspect <bundle> --json` prints the
same egress list, and what else the nest needs, without installing or running anything.

It warns and proceeds rather than refusing. Refusing is a policy decision that belongs to you.

In a fleet, **pin the `bundle_hash`**, not just the version. A pinned worker fetches by content address
and never consults the registry's mutable index, so re-tagging a version cannot change what your fleet
runs. Unpinned, your fleet is exactly as trustworthy as your registry.

## Secrets

**`nest bundle` packs `nuthatch.toml` verbatim.** It cannot redact anything without changing the nest's
identity, so since 3.13.3 it refuses a file that holds a webhook `secret`, or an RPC, webhook or alert
URL that looks keyed (userinfo, a key-named query parameter, or a long token in the path), and names
each one with the URL redacted. `--allow-secrets` bundles anyway. The check is a heuristic and will not
recognise every key, so keep credentials out of the file you bundle.

- **Embedded**: pass private endpoints at run time with `--rpc` and `--state-rpc` rather than writing
  them into `rpc_urls`. If a secret has to live in `nuthatch.toml` for a local nest, keep the
  directory `0700`, owned by the service user, and do not bundle that copy.
- **Scaled**: they live in the control plane and are injected per nest, per worker, scoped to the
  cursors that worker actually holds. The interface is **write-only** - you can list which keys exist
  and never read a value back. Rotating one changes no bundle hash, so it neither invalidates segment
  reuse nor forces a re-index.

## The full audit

A pre-1.0 adversary pass found one exploitable issue (the file read above) and six others. All seven
are closed, and the write-up records *how* - including finding 3, closed as **not ours to fix** rather
than fixed, because the belief attached to it was the actual problem.

Read it at
[`docs/security-audit-2026-07-31.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/security-audit-2026-07-31.md).

## Reporting something

Please report privately through the repository's Security tab rather than opening a public issue. See
[`SECURITY.md`](https://github.com/nuthatch-org/nuthatch/blob/main/SECURITY.md).
