---
title: "9. Operating a truthful index"
description: "Verification, health, security and the habits that keep an index honest in production."
order: 10
---

An indexer can be available and wrong. It can answer HTTP requests while following the wrong chain,
serve a stale cursor, decode against an unsuitable ABI, or retain a view whose meaning nobody has
checked since the first enthusiastic afternoon. Availability matters. It is not the whole
definition of health.

Nuthatch is designed to make its claims checkable. The remaining work is operational discipline:
choose what to verify, give failures a route to a human, and avoid calling a system healthy merely
because it remains capable of returning JSON.

## Verify the inputs and the result

Start with the nest package. Inspect the contract addresses, deployment ranges, vendored ABIs and
event selections. Rebuild the generated schema and decode registry from those inputs. Confirm the
NID when loading or deploying a bundle. This establishes that the machine is indexing the package
you intended, rather than an equally well-formatted stranger.

Then verify a result against the chain at a fixed watermark. A useful check has a known block range,
a concrete expected answer and a way to replay the SQL. For an event-derived view, compare its rows
with the events and, where appropriate, with an independent chain query. For an application
fallback, exercise the exact named query and response shape the application will use. A test that
only proves that an endpoint returned 200 has the emotional comfort of a fire alarm with its
batteries removed.

Nuthatch's own releases are held to the same rule, and the way they are is worth copying. Since
4.1.1 reached a production nest and refused its dashboard's join-heavy views within minutes, with
every CI gate green, a release candidate is served over a copy of that nest, under the budget the
nest runs on, and sent the 74 statements its consumers actually issue. Each answer is compared with
the last release's by digest, not only by status, because 4.3.0 once passed every statement and
served `NULL` for a column that had been populated the day before. A refusal, an error, an
out-of-memory or a time past a stated bound turns the candidate red, and red stops the roll to
production. The script is `scripts/release-gate.sh` in the repository, and the query set lives with
the consumer that sends it. The habit generalises: gate on the answers your readers depend on, at
the budget they are served under, and compare them with what was served yesterday.

A nest seeded from someone else's mirror deserves one more question. The seed checks every file
against the hash the catalogue names, and refuses a catalogue that overlaps itself or carries a
provisional segment, so what arrived is what was published. Whether what was published is true to
the chain is not something a hash can say. Spot-check a seeded range against an independent RPC
before the nest serves anything a reader will act on.

### Verify the endpoint, and then verify it again later

The package is not the only input. The RPC endpoint is one too, and it is the one that changes
without telling you.

`nuthatch doctor --rpc <url>` asks an endpoint three questions before a backfill trusts it: the
widest `eth_getLogs` range it will serve, the largest JSON-RPC batch it accepts, and whether it has
archive depth. Each of those limits otherwise surfaces mid-backfill as a retry loop that looks
exactly like slowness, which is the worst way to learn it. Run it as `nuthatch doctor --dir <nest>`,
without `--rpc`, and it probes the nest's own endpoints filtered to every address the nest declares,
rather than an empty filter or the first contract in the file. With an explicit `--rpc` and no
`--address`, doctor samples the endpoint for its busiest address and re-probes with that, so the
figure it recommends reflects a result-count limit as well as a range limit; pass `--address` when
you would rather it probed with yours.

It prints two window figures, and they mean different things. `up to N blocks` is what the endpoint
served. `recommend --window M` is what to set: half the measured limit from an address-filtered
probe. Only when doctor could find no address to probe with does it fall back to a range-only
figure, capped at 320 and labelled as such, because a probe without an address cannot see the
result-count limit a real nest meets. Read the recommendation as a starting point that holds, and
re-probe with `--address` for a figure that reflects both limits.

The part worth building a habit around is the second probe. Nuthatch ships measured endpoints for
its built-in chains, and one of them was measured on a Tuesday and had silently lost archive depth by
the Wednesday - a from-deployment backfill could no longer use it at all, while the recorded figure
in the source still said otherwise. **A recorded measurement is a snapshot presented as a property.**
Nothing about an endpoint's past behaviour is a promise, including ours, so probe before a long
backfill rather than trusting a number somebody wrote down once.

## Observe the pipeline, not just the server

Metrics make the stages visible. For a single nest, `nuthatch_tip_lag_blocks` tells you whether the
cursor keeps up and `nuthatch_last_poll_unixtime` reveals a poller that has frozen. A runtime hosting
several datasets reports per nest instead: `nuthatch_nest_tip_lag_blocks{nest="…"}`, with each nest's
poll time and stall state on its own `/<name>/ready`. Per-nest health tells you whether a
part of a shared runtime has been quarantined. `nuthatch_cursor_live` identifies the chain cursor
that has died even if another chain in the same process remains busy. RSS and query rejection
counters show whether the node is protecting itself as intended.

Alert on sustained lag, a stalled poller, quarantined nests and approaching memory limits. Treat
the first three as a service issue and the last as an opportunity to reduce query concurrency or
reconsider the mounting budget before the machine makes the decision rather more abruptly. The
[metrics guide](/docs/operate/metrics/) contains runnable Prometheus examples.

For a person rather than an alert, 5.10.0 adds `nuthatch watch --url http://127.0.0.1:8288`, a
terminal view of a running nest or runtime: the tip, the seal, memory against its budget and the RPC
endpoints, with one panel per cursor when pointed at a runtime. It reads `/ready`, `/`, `/metrics` and `/nests` and nothing else, so
it can change nothing, and where a figure has no source it says `NO SIGNAL` rather than drawing a
zero. Piped, it writes one line per nest per interval. It is something to look at, not something to
page on; alerting stays with Prometheus.

## Secure the separate surfaces

The data API is read-only, but a runtime may also expose administrative routes that mount or remove
nests, on the same port. The binary refuses to mount them off loopback unless `NUTHATCH_ADMIN_TOKEN`
is set, and once it is set checks it on every admin request, localhost included. Without a token, a
localhost runtime answers only requests addressed to loopback, so one behind a proxy refuses them
until a token is set. `--no-admin` leaves them out entirely.
Do not undo that care by putting a token-bearing port on the public internet and then feel
surprised when somebody experiments with it. Restrict the port, use a gateway where public access is
needed, and keep database credentials and RPC URLs in deployment configuration rather than the nest
package.

SQL needs its own care. General SQL is powerful enough to consume resources even when it cannot
write. Use named queries or an allowlist for public services. Keep the node's built-in timeout,
concurrency and result bounds on. Per-caller rates and quotas require authenticated identity, so
place them at the gateway. Calling a local concurrency semaphore a rate limiter would be a category
error with a pleasingly dangerous outcome.

One outbound call is worth knowing about before it surprises anyone. The binary makes no network
call about its operator by default, but an interactive `nuthatch init` that succeeds asks once
whether it may send a head count: one small JSON object per nest created, with no identifier and no
addresses. Nothing is sent until somebody answers yes. `nuthatch count payload` prints exactly what
would be sent, `nuthatch count off` withdraws the answer, and `NUTHATCH_NO_COUNT` (or `CI`) silences
both the question and a stored yes on an unattended machine.

## Recover without inventing history

When something fails, first establish which layer is unhealthy: RPC reachability, cursor progress,
one dataset's decoder, storage, query load or the gateway in front. The runtime is built so a
quarantined nest, a lease handover and a failed query are observable conditions rather than silent
reasons to return old data forever.

Do not repair a suspected data error by editing sealed rows or retroactively decoding history under
a new ABI. Preserve the evidence, identify the package and range involved, build the corrected
dataset under its own identity and migrate consumers deliberately. The cost of this restraint is
small compared with explaining an untraceable historical rewrite later.

That is Nuthatch's central ethic. It is not merely a fast way of turning logs into tables. It is a
way of retaining a clear chain of custody from authored definition to chain event to query result.
Once that chain of custody exists, a team can operate its own critical data path without asking a
remote endpoint to be both available and believed.

Use [production operation](/docs/operate/production/), [security](/docs/operate/security/) and
[verification](/docs/operate/verifying/) as the practical checklist alongside this chapter.
