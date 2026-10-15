---
title: Contract calls and IPFS documents
description: Pin a contract read to a block, or resolve and verify an IPFS document, without giving up determinism.
order: 9
checked: 5.4.1
---

Two things a subgraph could do and a nest could not, until v2.6.0. Both are opt-in: a nest that
declares neither behaves exactly as it did before.

Reach for these **after** [recipes](/docs/build/recipes/). Deriving a value from events you already
indexed costs nothing and needs no archive node. These are for the reads that are genuinely not
derivable.

## `[[calls]]` - contract state, pinned

```toml
[[calls]]
name = "grt_total_supply"
contract = "0x9623063377AD1B27544C965cCd7342f7EA7e88C7"
calldata = "0x18160ddd"
every = 100000
```

That samples `totalSupply()` every 100,000 blocks into a `grt_total_supply` table. Needs
`--state-rpc` pointed at an **archive** node, because a read at an old block is a state query and a
pruned node cannot answer it.

Calls can also be built from the row that triggered them, which is the shape a subgraph writes as
`contract.balanceOf(event.params.user)`. The row-driven form names the source table with `on` instead
of `every`, the ABI signature to encode, and the row's columns as arguments:

```toml
[[calls]]
name = "recipient_balance"
on = "usdc__transfer"
contract = "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48"   # or contract_column = "{pool}" for a factory child
signature = "balanceOf(address)"
args = ["{to}"]
```

### Why this is still deterministic

The objection to a subgraph's `eth_call` is not that it calls. It is that the call is *unpinned and
unaddressed*: it happens at whatever block the handler reached, the result is stored as a bare
number, and nothing records what question produced it. Re-run the index a year later against a
different provider and you may get a different answer, with nothing in the output to say which run
was right.

Here the block is fixed, so the answer is fixed. The result is content-addressed on
`(chain_id, block, contract, calldata)`. Two operators running the same nest against different
archive providers get the same bytes - or one of them has a provider that is lying, and the
disagreement is visible rather than silent.

### The cost, before you turn it on

Pinned reads resolve inside the indexing window. Since 2.7.0, all three `--seal-direct` paths resolve
them too, so a calls nest can use direct sealing without omitting its calls table. The sealed segment
contains the same declared inputs as the streaming path.

The cost depends on sampling density and the state endpoint. A controlled near-tip comparison found
about **7%** overhead for the calls nest; an earlier 454-million-block field run with roughly 2,725
pinned reads was about 5.5 times slower. Those workloads were about 300 times apart in read density,
so neither figure is a universal multiplier. Measure the nest you mean to run. In 2.7.0 the calls
path also reuses the block hash already returned by the batched header fetch, removing a second round
trip at each sampled block.

`nuthatch bench backfill` resolves declared calls in both the hot-store and seal-direct arms. Supply
the same archive endpoint with `--state-rpc`; the benchmark refuses a calls nest without it rather
than quietly measuring a workload with the calls missing. The endpoint is redacted in benchmark
output because archive URLs commonly contain API keys.

## `[[ipfs]]` - documents, verified

```toml
[[ipfs]]
name = "subgraph_metadata"
on = "gns__subgraph_metadata_updated"
cid_column = "subgraphMetadata"
```

Every fetched body is re-hashed and checked against the CID it claims to be. A gateway serving the
wrong document yields **no row**, rather than a plausible one.

The CID is taken from whatever shape the contract stored:

- a bare CID
- an `ipfs://` URI
- a path gateway URL, `https://host/ipfs/<cid>`
- a subdomain gateway URL, `https://<cid>.ipfs.host/`
- a Kubo API URL, `.../api/v0/cat?arg=<cid>`
- a raw 32-byte digest, which is what a `bytes32` column holds

**The host is discarded.** That string came out of a log, so honouring the host it names would let
whoever emitted the event choose what your indexer connects to. Only the content address survives,
and it is fetched through the gateways *you* configured.

The `bytes32` form is worth knowing about: The Graph's own GNS stores subgraph metadata that way,
because 32 bytes is what a sha2-256 digest actually is and the `Qm...` text is merely one encoding of
it. A CIDv0 is `base58btc(0x12 0x20 || digest)`, so the digest is re-framed rather than re-hashed.

### Gateways are not part of the nest

Configure them with `--ipfs`, never in `nuthatch.toml`:

```sh
nuthatch dev --ipfs http://127.0.0.1:5001/api/v0/cat?arg=
```

A gateway is an access path, not part of what a nest *is*, and two operators resolving the same CID
through different gateways must get the same bytes. So it must not enter the nest's content address.
Point it at your own node if you want no third party in the path at all; omit it and public gateways
are tried in order.
