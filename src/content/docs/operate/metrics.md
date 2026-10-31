---
title: "Metrics & footprint"
description: "Prometheus /metrics and the ≤2 GB-per-cursor footprint budget."
order: 5
checked: 5.15.0 (2026-10-31)
---

Every running nest exposes Prometheus text at `GET /metrics`. Gauges are set to the latest value;
counters only ever increase - standard scrape targets, no exporter sidecar needed.

## The series

Process-level gauges:

| Series | Meaning |
|---|---|
| `nuthatch_tip_height` | The chain head as last seen from RPC. |
| `nuthatch_last_block` | The last block fully indexed into the hot store. |
| `nuthatch_tip_lag_blocks` | The gap between the two - your "are we keeping up" number. |
| `nuthatch_sealed_through` | The highest block sealed to Parquet (trails finality, by design). |
| `nuthatch_rss_bytes` | The process's resident set - watch it against the budget. |
| `nuthatch_hot_store_bytes` | Bytes of every nest's hot store (redb) on disk, summed. |
| `nuthatch_sealed_segments_bytes` | Bytes of sealed Parquet segments on disk, each segment store counted once - the disk the runtime's history actually uses. |
| `nuthatch_last_poll_unixtime` | When the tip was last polled (a frozen value means a stalled poller). |
| `nuthatch_alert_outbox_depth` | Undelivered webhook/alert rows in the durable outbox. |

Process-level counters:

| Series | Meaning |
|---|---|
| `nuthatch_rows_decoded_total` | Event rows decoded into the hot store. |
| `nuthatch_logs_undecoded_total` | Logs a declared event claimed that did not decode against its ABI (since 5.13.0). |
| `nuthatch_rows_sealed_total` | Rows sealed into Parquet segments. |
| `nuthatch_reorgs_total` | Reorg detections (the hot store rolled back and converged). |
| `nuthatch_http_requests_total` | Every served request - the operator's billing/usage signal. |
| `nuthatch_sql_queries_total` | Analytical queries served. |
| `nuthatch_sql_rejections_total` | Queries refused by the guards. The unlabelled series is the total; the `reason` label splits it into `busy`, `too_large`, `invalid`, `bounded`, `admission`, `timeout`, `out_of_memory` and, since 5.13.0, `tenant_share` (a runtime tenant at its own share, answered `429`). |
| `nuthatch_sql_admission_wait_seconds{tenant}` | Since 5.14.0, a histogram of how long each `/sql` admission waited for a permit, zero waits included, for at most 256 tenant labels; the rest share `tenant="other"`. |
| `nuthatch_sql_memo_hits_total`, `nuthatch_sql_memo_misses_total` | `/sql` answers served from the answer cache, and those computed. Since 4.11.0 the cache keys on the rows and segments a statement reads, so a repeated statement over unchanged data is a hit even while the cursor polls. |
| `nuthatch_rpc_requests_total` | Outbound HTTP POSTs to RPC endpoints, one per request or batch, retries included. Not a method count. |
| `nuthatch_rpc_methods_total{method}` | Individual JSON-RPC calls by method: a batch of 200 `eth_getBlockByNumber` counts 200 here. Multiply by a provider's per-method CU schedule to estimate a bill; see [costs](/docs/operate/costs/). |

Per RPC endpoint, labelled `endpoint` by host and port, never a full URL (which can carry a key):
`nuthatch_rpc_endpoint_requests_total`, `nuthatch_rpc_endpoint_failures_total`,
`nuthatch_rpc_endpoint_retries_total` (failover retries onto that endpoint), and the
`nuthatch_rpc_request_duration_seconds` histogram. An endpoint appears once it has been called.

With [many nests in one runtime](/docs/operate/many-nests/), the height and poll gauges above
(`nuthatch_tip_height`, `nuthatch_last_block`, `nuthatch_last_poll_unixtime`) are solo-runtime only
and do not describe any one nest; alert on the labelled per-nest series instead: `nuthatch_nest_last_block`,
`nuthatch_nest_sealed_through`, `nuthatch_nest_rows_decoded_total`,
`nuthatch_nest_rows_sealed_total`, and `nuthatch_nest_reorgs_total`.

Serving per nest, since 5.13.0, labelled by the mount a request arrived through, so two aliases of
one dataset are counted apart and the sum over mounts equals the unlabelled total:
`nuthatch_nest_http_requests_total`, `nuthatch_nest_sql_queries_total`,
`nuthatch_nest_sql_rejections_total{nest,reason}`, and `nuthatch_nest_sql_duration_seconds`, a
histogram from 1 ms to 30 s of each request that ran an analytical query, admission wait included. A
mount's series go when it is unmounted.

Decoding per nest, since 5.13.0: `nuthatch_nest_logs_undecoded_total{nest,contract,topic0}` counts
logs whose topic0 a declared event claims and whose topics or data did not decode against its ABI,
by contract alias or template name. Past 256 pairs a nest counts the rest under
`contract="other",topic0="other"`. A proxy upgrade that changed an event is what this usually looks
like: the nest indexes less and stays ready, and `/ready`'s `undecoded` names the pair.

Storage per nest, since 3.13.0: `nuthatch_nest_hot_store_bytes` is that nest's own hot store, and
`nuthatch_nest_sealed_segments_bytes` the sealed segments its manifest names. Segments are
content-addressed and shared, so a segment two datasets both contain counts under both nests and the sum
over nests can exceed the disk used; the unlabelled `nuthatch_sealed_segments_bytes` counts each store
once. Before 3.13.0 that total counted a runtime's shared store once per nest. A mount sharing another's
dataset has no storage series of its own. This is what a host meters by; see
[Host nests for others](/docs/operate/hosting-nests/).

Health series (RFC-0026), which is where you look when *part* of a runtime is unwell:

| Series | Meaning |
|---|---|
| `nuthatch_nest_health{nest,chain}` | `1` while the nest is indexing, `0` while it is quarantined. |
| `nuthatch_nest_quarantine_total{nest}` | Times this nest has been quarantined since start - a flapping nest shows up here before anyone notices. |
| `nuthatch_cursor_live{chain}` | `1` while the chain's cursor is running, `0` once it has died. |

How each nest on a chain advances, since 5.14.0 (see [Run many nests](/docs/operate/many-nests/#how-a-chains-nests-advance)):

| Series | Meaning |
|---|---|
| `nuthatch_nest_window_seconds{nest}` | A histogram, 1 ms to 30 s, of each window's wall time from its start to its commit or refusal. |
| `nuthatch_nest_window_overruns_total{nest}` | Windows abandoned before their commit for outrunning `window_deadline_ms`. |
| `nuthatch_nest_behind_extraction_blocks{nest}` | Blocks between the nest's position and its cursor's extraction; 0 on the shared cursor. |
| `nuthatch_nest_extraction_wait_seconds_total{nest}` | Time the nest has waited on extraction with no window to process. At the tip that is most of the time; while it climbs with `behind_extraction_blocks` at 0, extraction is the bottleneck. |
| `nuthatch_cursor_buffer_bytes{chain}`, `nuthatch_cursor_buffer_spilled_bytes{chain}` | What the cursor's window buffer holds in memory, bounded by `window_buffer_mb`, and in its scratch directory. |
| `nuthatch_snapshot_retained_bytes{nest}` | Bytes older versions of a nest's state hold beside the latest because a request still in flight pinned them. Each request answers from the snapshot it took at its start, so a long `/sql` keeps what it read alive until it ends; 0 when no request holds an old version. |

Each declared authored incremental entity adds seven gauges, labelled by nest and entity:
`nuthatch_entity_applied_through`, `nuthatch_entity_current`, `nuthatch_entity_rows`,
`nuthatch_entity_faulted`, `nuthatch_entity_unavailable`, `nuthatch_entity_seconds_since_progress`,
and `nuthatch_entity_state_bytes`. Page on `faulted`; investigate a `current` gauge that stays
zero or a progress age that keeps climbing. This is the difference between a maintained answer that is
fresh and one that merely happens to have a table-shaped name.

A nest that declares [maintained views](/docs/book/maintaining-an-answer/) adds series labelled by
`nest` and `view`; a nest without `maintained.toml` has none:

| Series | Meaning |
|---|---|
| `nuthatch_maintained_hits_total` | Requests answered from a stored copy. |
| `nuthatch_maintained_fallbacks_total` | Requests that found no copy at their inputs and evaluated the definition. |
| `nuthatch_maintained_builds_total`, `nuthatch_maintained_build_failures_total` | Copies written, and builds that failed; `/ready` names the last error. |
| `nuthatch_maintained_last_build_milliseconds` | How long the last successful build took. |
| `nuthatch_maintained_copies`, `nuthatch_maintained_copy_bytes` | Copies on disk, current plus retained, and their bytes. |

A fallback count climbing beside the hits means requests are arriving before the copy for their
inputs is built.

Since 5.10.0: `nuthatch_nest_last_reorg_depth_blocks{nest}` and
`nuthatch_nest_last_reorg_unixtime{nest}`, absent until a nest has reorged, which `nuthatch watch`
reads.

A nest started with `--publish-target` adds the mirror's series, labelled by nest:

| Series | Meaning |
|---|---|
| `nuthatch_publish_lag_blocks` | Blocks spanned by final local segments the mirror does not hold, summed over tables. `0` means every sealed segment is published. |
| `nuthatch_publish_sealed_through` | The highest block the published catalogue covers. |
| `nuthatch_publish_pending_segments` | Segments the current pass has still to upload. |
| `nuthatch_publish_bytes_total`, `nuthatch_publish_errors_total` | Bytes uploaded, and passes that failed, since start. |
| `nuthatch_publish_dead_letter` | `1` once the same object has failed repeatedly; clears on the next success. |

Alert on `nuthatch_publish_lag_blocks` staying above zero. Before 4.11.0 it was the seal watermark
less the mirror's highest block, which read millions on a quiet nest whose mirror was complete.

A runtime with [followers](/docs/operate/hosting-nests/#read-replicas-and-upgrades-without-an-outage)
(since 5.13.0) adds, since 5.14.0, on the writer, `nuthatch_feed_visibility_seconds{dataset,kind}`, a histogram of
the time from a commit to a follower being able to answer from it, on the writer's clock, with `kind`
`tip` or `seal` (figures taken on 5.14.0 overstate it, most for a writer with several mounts; 5.14.1
corrects the measurement); `nuthatch_feed_delta_bytes{encoding}`, `nuthatch_feed_encode_seconds{encoding}` and
`nuthatch_feed_connection_queue_bytes{conn}`. A follower serves its own
`nuthatch_follower_apply_seconds`, `nuthatch_follower_seal_wait_seconds` and, on another host,
`nuthatch_follower_mirror_{files,bytes,refused,missing}_total`.

## The footprint budget

The budget is a non-negotiable, CI-enforced: **≤2 GB RAM per active-chain cursor** - one chain's
tip-following plus serving, whether that cursor hosts one nest or twelve. A single-chain runtime is
one cursor (≤2 GB total, shared across its nests); a multichain runtime's total is the sum of its
cursors. Density is RAM-bounded, not free: a runtime refuses to mount a nest whose projected
footprint would blow the ceiling (`max_rss_mb`, default 2048).

That 2 GB is the budget nuthatch's own design must fit at the default ceiling, and CI holds it there.
Since 5.13.0 an operator may give a cursor a higher `max_rss_mb`, up to 1 TiB, in `mounts.toml` or
live with `PUT /_admin/runtime`; nothing in nuthatch requires it, the answer says `"above_default":
true`, and nothing measures a cursor above 2 GB for you, so size it from `rss_bytes` in `GET /nests`
on your own workload. Since 5.14.0 each runtime cursor's admission also counts its window buffer,
`window_buffer_mb` (64 MiB at the default ceiling). On the runner that enforces the dense footprint
gate, 20 nests on one cursor peaked at 414 to 427 MB over seven runs with the buffered cursor, against
a 602 MB ceiling.

Inside the budget, the analytical path is separately bounded. Every session over one dataset shares
one memory pool, and two mounts of the same dataset share it too. `NUTHATCH_BURRMILL_MEMORY_LIMIT`
sets the pool, falling back to `NUTHATCH_ANALYTICS_MEMORY_LIMIT` when unset, and a startup check
refuses a split that would breach the cursor budget. Separately, each cursor's concurrency gate
bounds how many queries run at once: two permits by default, set by `[runtime] sql_permits` in a
runtime (since 5.14.0, live, and held to the memory split rather than to 16) or
`NUTHATCH_SQL_MAX_CONCURRENCY`. Under `isolation = "strict"` each permit is its own pool. If you're
tight, lower concurrency rather than raising the pool.

## A small, useful alert set

These are deliberately symptoms rather than a pager for every counter. Pick the lag threshold for
the chain and the service promise you make to readers. The examples assume Prometheus has a
`job="nuthatch"` label.

```yaml
groups:
  - name: nuthatch
    rules:
      - alert: NuthatchCursorStalled
        # Three poll intervals, as /ready counts a stall: 900 s at the default 5-minute poll.
        # Scale it down for a nest run with a shorter --poll-interval.
        expr: time() - nuthatch_last_poll_unixtime{job="nuthatch"} > 900
        for: 5m
        labels: { severity: page }
        annotations:
          summary: "Nuthatch has not polled its chain for fifteen minutes"

      - alert: NuthatchFallingBehind
        expr: nuthatch_tip_lag_blocks{job="nuthatch"} > 50
        for: 15m
        labels: { severity: ticket }
        annotations:
          summary: "Nuthatch remains more than 50 blocks behind the tip"

      - alert: NuthatchNestQuarantined
        expr: nuthatch_nest_health{job="nuthatch"} == 0
        for: 2m
        labels: { severity: page }
        annotations:
          summary: "A mounted nest is quarantined"

      - alert: NuthatchLogsNotDecoding
        # A contract's ABI no longer fits what it emits, usually a proxy upgrade (5.13.0 and later).
        expr: increase(nuthatch_nest_logs_undecoded_total{job="nuthatch"}[1h]) > 0
        labels: { severity: ticket }
        annotations:
          summary: "A nest is counting logs that do not decode"

      - alert: NuthatchNearMemoryBudget
        expr: nuthatch_rss_bytes{job="nuthatch"} > 1800 * 1024 * 1024
        for: 10m
        labels: { severity: ticket }
        annotations:
          summary: "Nuthatch is within 248 MB of its default cursor budget"
```

The memory number is intentionally below the default 2 GB ceiling. It gives you time to reduce
query concurrency or investigate a mount before the runtime has to refuse more work. In a
multichain runtime, alert per `nuthatch_cursor_live{chain}` and per-nest health too; the aggregate
RSS cannot identify which chain has become expensive. See
[Troubleshooting](/docs/operate/troubleshooting/) for the corresponding diagnosis paths.
