---
title: The nest registry
description: Publish and pull nests by name - a filesystem folder or an S3 bucket, with private nests, decoupled and never mandatory.
order: 9
checked: 5.14.0 (2026-10-30)
---

A nest is a content-addressed bundle (`nest bundle`). The **registry** gives that bundle a home to be
published to and pulled from *by name* or *by identity* - with private nests behind auth, backed by a plain directory or
any S3-compatible bucket.

> **Decoupled, and never mandatory.** The registry is not part of the nuthatch binary and is never
> required. A self-built bundle and `nest load <file|dir>` work forever with no registry in the loop.
> nuthatch *pulls*; it never *becomes* the registry, and it never *requires* one. This is a convenience
> for sharing - think crates.io or an OCI registry - not a dependency.

## Publish and pull

**1. Bundle a nest** into one portable, content-addressed file, `my-nest-<hash>.bundle`.

```sh
nuthatch nest bundle ./my-nest
```

**2. Publish it** to a registry under a name and version.

```sh
nuthatch nest publish my-nest-<hash>.bundle --registry <path|s3://bucket/prefix> --as horizon@1.2.0
```

**3. Pull and run it** anywhere - resolved by name, fetched, and **hash-verified** on install. The
check is against the hash the registry's index names for that version today: it proves the registry
served the bundle it named, not that the name still means the bundle you reviewed. To stop a retagged
version changing what you install, load by a NID you trust (below), which is refused unless the
bundle computes to it.

```sh
nuthatch nest load horizon@1.2.0 --registry <path|s3://bucket/prefix>
```

To see what a bundle is before you install it, `nuthatch nest inspect <bundle> --json` (since 5.13.0)
verifies it as `nest load` would and prints its NID, chain, contracts, entities, what it needs (cargo
features, archive or trace RPC) and every endpoint it would reach, with keyed URLs cut to scheme and
host. It runs nothing and touches no network.

## Address a nest by its identity

Every published bundle is also indexed by its **NID**, the identity its data is stored under
(`nuthatch nest nid --dir <nest>` prints it, and `nest publish` prints it too). A NID is all a host needs:

```sh
nuthatch nest load 9f2c… --registry <path|s3://bucket/prefix>
```

A name and a version are labels someone chose and can move; a NID is computed from the nest itself.
So the registry's NID index is checked rather than trusted: the pulled bundle must compute to the NID
asked for, or it is refused, naming both. Since 5.11.0 that NID is recomputed from the installed
files, not taken from the manifest, whose name and file order are only its own say-so. For the same reason a nest name shaped like a NID
(64 hex characters) is refused at publish, so a reference is never ambiguous.

A **runtime** started with `--registry` uses exactly this. A live mount naming a NID the runtime does not
hold fetches it by NID, verifies it and installs it at `data/<nid>/` before mounting, and a refused mount
removes it again. See [Host nests for others](/docs/operate/hosting-nests/).

```sh
nuthatch dev --dir my-runtime --registry s3://nests/prod
```

Since 5.13.0 such a runtime also publishes, inspects and prunes its registry over the admin API
(`POST /_admin/bundles`), so a host never has to run the binary to manage it; and a mount job that
fails says why in a `code`: `not_found` (no bundle under that NID), `access_denied` (an S3 `401` or
`403`, or no credential for a private bucket), or `verification_failed` (the bytes served are not that
nest). Prune never leaves a ref naming a missing blob, and skips blobs younger than 15 minutes in case
their publisher has not written its refs yet.

Layout, beside the name index:

```text
<root>/nids/<nid>                   # the hash of the bundle that computes to this NID
```

## Backends

**Filesystem (default).** A directory *is* a registry - zero extra dependencies, the self-hosted-first
default:

```text
<root>/blobs/<hash>.bundle          # immutable, content-addressed
<root>/index/<name>/<version>       # name@version → hash
<root>/index/<name>/latest          # the one movable pointer
```

**S3 / object store.** Any S3-compatible bucket (MinIO, S3, R2) - the fleet path. The released binary
and image carry it (the `object-store` feature is on by default); configure via the standard `AWS_*`
env (including `AWS_ENDPOINT` for self-hosted MinIO):

```sh
nuthatch nest publish my.bundle --registry s3://nests/prod --as horizon@1.2.0
```

Credentials come only from the environment, through the standard AWS chain: `AWS_*` variables
(static keys, web identity, container credentials), then instance metadata. They are never read from
`mounts.toml` or the command line, and named profiles (`AWS_PROFILE`) are not supported. Since 5.13.0
CI runs the S3 path against a private bucket (versitygw): publishing, mounting by NID over the admin
API, and each failure code above.

## Private nests

A private namespace is access-controlled by the store itself (bucket policy on S3, filesystem
permissions locally). nuthatch carries a configured credential and **fails loudly and early** - a
rejected or missing credential gives a clear _"this nest is private, or your registry credential was
rejected"_, never a silent empty result, and never mistaken for "not found".

> **Two kinds of credential - don't conflate them.** *Registry auth* fetches a private *bundle*. *Nest
> runtime secrets* - a private RPC URL, an enricher's API key - are a different thing: they belong
> outside the bundle, passed at run time. Bundling does not strip them for you: `nuthatch.toml` goes
> into the bundle verbatim, so `nest bundle` refuses one that visibly holds a credential (see
> [security](/docs/operate/security/)). Keep credentials out of the file before you bundle.

## See also

- [Upgrading a nest](/docs/operate/upgrades/) - how a new version of a published nest is rolled out
- [Run a runtime](/docs/operate/many-nests/) - mounting nests from a registry across a fleet
