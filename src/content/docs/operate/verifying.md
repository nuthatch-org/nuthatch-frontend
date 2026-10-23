---
title: "Verifying a deployment"
description: An acceptance runbook that proves a deployment works, step by falsifiable step - and an honest table of what we have verified ourselves and what we have not.
order: 7
checked: 5.9.0 (2026-10-23)
---

Most projects tell you what they support. This tells you **how to prove it on your own hardware**, and
which claims we have and have not tested ourselves.

> **Still deciding whether to trust nuthatch at all?** This page is for proving a deployment works
> once you have adopted one. The step before it is
> [`docs/kicking-the-tyres.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/kicking-the-tyres.md),
> written from the opposite posture: *you are not trying to confirm the claims, you are trying to
> falsify them, and it tells you where we think you have the best chance.* It covers the cold walk
> against a contract we did not pick, correctness against a public subgraph, what it costs to keep
> running, a red-team pass on `/sql` naming both of our own past security patches and one open
> finding, and a section listing where we have already been wrong. We would rather you found the next
> one than a user did.

The full runbook lives in the repo at
[`docs/verification.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/verification.md).
Levels 0 - 4 are automated:

```sh
./scripts/verify.sh 0 1 2 3 4
```

## What we have verified

| level | verified by us? | how |
|---|---|---|
| **0** Artifact | yes | every release - checksums, the binary runs, `--version` matches the tag |
| **1** Single nest | yes | CI, plus a production box serving public traffic |
| **2** Correctness | yes | CI - deterministic fixtures, reorg property tests |
| **3** Runtime | yes | a live two-chain run and an 8-nest density run |
| **4** Guards | yes | CI, plus a live `/sql` adversary pass |
| **5** Scaled mode | yes, across real machines | three boxes on a private network, published artifacts |

Level 5 is where independent verification is worth the most, and where we have most recently been
wrong - see below.

Level 0 is one you can run on your own download in a line. Every release tarball, the
`nuthatch-graph-<target>` builds included since 4.11.0, carries a SHA-256 sidecar and a GitHub build
provenance attestation:

```sh
gh attestation verify nuthatch-graph-aarch64-apple-darwin.tar.gz --repo nuthatch-org/nuthatch
```

It exits `0` when the file was built by the release workflow in that repository, at a release tag.

## Level 5 is worth reading before you trust it

Until v0.9.3, **the writer pool did not write.** A worker registered, took a cursor lease, loaded
secrets and reported - and contained no indexing code at all.

Ten level-5 checks passed throughout. They were real checks and they genuinely passed: registration,
scheduling, lease fencing with a store-enforced fence, fleet-wide version pinning, write-only secrets.
**Not one of them asserted that a row appeared.**

That is the failure worth learning from - a suite that verifies the machinery *around* a thing reads
exactly like a suite that verifies the thing. The runbook now has a check that could not have passed
before the fix: `last_block` advancing in the shared store.

## What level 5 proves now

Measured on three Hetzner boxes on a private network, from published release artifacts - control plane
and store on one, writers on their own:

- workers registering and being scheduled from another machine
- a **real lease handover** under contention, with the store-enforced fence advancing
- a **10-minute clock jump** moving lease expiry rather than ownership
- **indexing into the shared store** - the check that could not have passed before 0.9.3
- **377 blocks indexed through a 90-second control-plane outage**

That last one is the design claim with a number attached: losing the control plane must stop
*rescheduling*, not *ingestion*. If it stopped ingestion, a database blip would be a fleet-wide outage.

**Not yet run on real machines:** the registry-pull check, which deletes a writer's nest entirely and
asserts it pulls one from a registry anyway.

## Running the fleet lab yourself

The distributed levels need more than one machine. `scripts/fleet-lab.sh` stands up a throwaway lab on
Hetzner Cloud, runs the runbook against the **published release artifacts**, and destroys it. It needs
a Hetzner Cloud project API token and the name of a key already in that project:

```sh
export HCLOUD_TOKEN=...
export HCLOUD_SSH_KEY="my-key"
```

`up multi` stands up three boxes and a private network. `partition` cuts a writer off the control
plane and asserts it keeps indexing, `skew` pushes a writer's clock forward and asserts the lease does
not move, `pull` deletes a writer's nest and asserts it pulls one from the registry, and `down`
destroys everything it created:

```sh
./scripts/fleet-lab.sh up multi
./scripts/fleet-lab.sh verify
./scripts/fleet-lab.sh partition
./scripts/fleet-lab.sh skew
./scripts/fleet-lab.sh pull
./scripts/fleet-lab.sh down
```

Hetzner bills hourly - three boxes are roughly €0.03/hr - which is only cheap if you destroy them, so
`down` is a first-class verb and every resource is tagged.

It installs the **published artifacts**, not a local build, so what gets verified is what you would
actually download.

## Please report either outcome

A level someone else ran is worth more than a level we assert, and passes are as useful as failures.
Useful to include: the level and step, expected versus actual, `nuthatch --version`, chain and
contract, embedded or scaled, and for level 5 how many writers and FE nodes.

Known-unverified items are tracked in
[`docs/prod-readiness.md`](https://github.com/nuthatch-org/nuthatch/blob/main/docs/prod-readiness.md);
anything you confirm can move with your evidence attached.
