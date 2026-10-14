---
title: "Install"
description: "Install the nuthatch binary - curl | sh, cargo install, or a prebuilt release."
order: 2
checked: 5.3.2
---

nuthatch is **one binary**. No Postgres, no Docker, no IPFS, no account - install it and
you're done.

## The one-liner

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

The script detects your platform, downloads the matching release binary, verifies its checksum, and
installs `nuthatch` to `~/.local/bin` (override with `NUTHATCH_INSTALL_DIR`). It's short and
[readable on GitHub](https://github.com/nuthatch-org/nuthatch-frontend/blob/main/public/install.sh) -
audit it first if `curl | sh` makes you itch.

Prebuilt binaries cover **macOS (Apple Silicon)**, **Linux x86_64** and, from 4.12.0, **Linux arm64**.
Intel Mac is deliberately not built. Each release carries `nuthatch-aarch64-apple-darwin.tar.gz`,
`nuthatch-x86_64-unknown-linux-gnu.tar.gz`, `nuthatch-aarch64-unknown-linux-gnu.tar.gz` (from 4.12.0)
and, for [scaled mode](/docs/operate/scaled/), `nuthatch-scaled-x86_64-unknown-linux-gnu.tar.gz`, each
with a `.sha256` beside it. On a platform with no prebuilt binary, or on Linux arm64 while the latest
release has none, the installer stops and prints the source-build command below rather than install
something that will not run. From 5.0.0 the release binaries are built with fat LTO (the `dist`
profile), which makes them smaller than a `cargo install` build from the same tag. Measured on macOS
before the WASM layer was removed, fat LTO took the binary from 158.9 MB to 106.7 MB.

The Linux binaries are dynamically linked and need **glibc 2.35 or newer**, measured off the published
artifact with `objdump -T`: from 4.1.0 the x86_64 binary references `hypot` at `GLIBC_2.35`, and the
arm64 binary, built natively on Ubuntu 22.04, references nothing newer. It links `libc`, `libm`
and `libgcc` and no C++ runtime; releases before 4.1 embedded DuckDB, needed only glibc 2.34, and also
needed libstdc++ from GCC 11. Debian 12 and Ubuntu 22.04 clear it. RHEL 9 and Amazon Linux 2023 ship
glibc 2.34 and ran 4.0.x; from 4.1.0 they need the source build.

Every artifact since 3.0 also has a GitHub build-provenance attestation, which establishes the producing
repository and workflow rather than merely the integrity of bytes in transit:

```sh
gh attestation verify nuthatch-x86_64-unknown-linux-gnu.tar.gz --repo nuthatch-org/nuthatch
```

The `--repo` constraint matters. Without it, an attestation from any repository may be accepted.

## The graph build

The default binary has no GraphQL route: `POST /graphql` answers 404. From 4.11.0 every release also
carries `nuthatch-graph-<target>.tar.gz`, built with `--features graph` and attested like the others,
for `aarch64-apple-darwin` and `x86_64-unknown-linux-gnu`, and for `aarch64-unknown-linux-gnu` from
4.12.0. It serves a nest's Graph-dialect GraphQL at `/graphql` and `/subgraphs/id/<deployment>`, and has
every command the default binary has. The installer does not fetch it:

```sh
gh release download --repo nuthatch-org/nuthatch -p 'nuthatch-graph-aarch64-apple-darwin.tar.gz*'
shasum -a 256 -c nuthatch-graph-aarch64-apple-darwin.tar.gz.sha256
tar -xzf nuthatch-graph-aarch64-apple-darwin.tar.gz    # one binary, named nuthatch
```

A nest answers GraphQL only once it carries a `graph/schema.graphql`, which `nuthatch port-emit`
writes; until then the route says so. What it answers is a partial read surface, exact for a
subgraph's event-shaped fields and a refusal by name for the rest, not a drop-in replacement for a
subgraph: see [Subgraph fallback](/docs/build/subgraph-fallback/).

## Container image

```sh
docker run --rm ghcr.io/nuthatch-org/nuthatch:5.3.2 --version
```

`:latest` follows the newest release; pin the version for anything you care about. `linux/amd64`
only for now, and no image carries the graph build: on an arm64 Linux host, or to serve GraphQL, use a
binary. The image carries the **same binary attached to the GitHub Release**, so the two cannot
drift. Scaled mode needs the `-scaled` tag (`5.3.2-scaled`): the default image is the embedded build
and carries no database driver. See [Deploy it](/docs/operate/deploy/) for running it properly.

## From source

Only needed on a platform we do not publish a binary for. **The toolchain pin is required, not
advisory:**

```sh
rustup toolchain install 1.95.0
cargo +1.95.0 install --git https://github.com/nuthatch-org/nuthatch nuthatch
```

`rust-toolchain.toml` pins 1.95.0 because `dbsp` hits a next-trait-solver ICE on 1.97 - and **that
file does not apply to `cargo install --git`**, which builds in a temporary directory of its own. So
the pin cannot protect this path and you have to ask for it. Without `+1.95.0`, a 1.97 default
toolchain fails after a full dependency build with `error: could not compile dbsp` and installs
nothing.

This page previously said a plain `cargo install` on recent stable worked. It does not, and has not
since rustc 1.97 - see [#534](https://github.com/nuthatch-org/nuthatch/issues/534).

## Verify

```sh
nuthatch --version
```

Then take the two-minute path: [Quickstart](/docs/start/quickstart/) - from a contract address to a
live, queryable API.

```sh
nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth   # WETH - chain auto-detected
nuthatch dev --backfill 300
```

`--backfill 300` starts 300 blocks behind the tip, so there are rows within seconds. Without it `dev`
backfills from the contract's deployment block, which for a contract with a long history wants your
own archive-capable RPC.

Nothing phones home unasked: no telemetry by default, no API token, no gated data service. The one
opt-in is a [head count](/count) after `init`, off until you say yes. AI features are BYO-key or
local models and degrade gracefully offline.
