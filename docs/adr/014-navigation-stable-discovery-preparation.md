# ADR-014: Navigation-stable Discovery preparation and explicit agent effort

## Status

Accepted — 2026-07-22. Builds on ADR-012's autonomous typed bundles and
ADR-013's Discovery UX/model reasoning controls.

## Context

`DiscoveryPanes` previously owned the bundle-preparation fetch and its
`AbortController`. Unmounting the pane while navigating to another DiscoUI
workspace aborted the HTTP connection, which propagated into agent-api and
canceled the active model run. Returning to the workspace reset the local
bundle list and repeated unfinished work.

Preparation also showed one indefinite "Preparing reusable bundles" message.
The compact source-transport work made source hydration fast, but a first visit
still needs one model turn per missing unique codehash (jointly producing all
active research kinds), bounded by `AGENT_MAX_CONCURRENCY`. No progress was
visible until an entire model turn completed.

Finally, global settings named the second model "Incident reporting", while the
product surface is now Discovery, and reasoning effort was not selectable.
Bundle generation used the same model as the final Discovery verdict even
though these are distinct Analyze and Discover phases.

## Decision

1. Bundle preparation is owned by an application-level, project-keyed job
   registry rather than a mounted panel. Panel unmount only removes its state
   subscription; the fetch continues for the lifetime of the SPA. Returning to
   the workspace reattaches to the same accumulated bundles and progress.
2. Preparation jobs are keyed by project, active research kinds, Analyze model,
   and Analyze effort. Explicit retry starts a new pass after the prior pass has
   finished; it does not cancel an active pass.
3. agent-api streams per-codehash preparation progress (resolved, cached,
   analyzing, completed). The pane shows completed/total counts and queue state.
4. Global agent settings are named **Analyze** and **Discover**. Analyze drives
   autonomous bundle generation, code/value analysis, and value enrichment.
   Discover drives the single-context Discovery verdict and follow-up chat.
5. Each phase has an independently persisted effort selector: default, off,
   minimal, low, medium, high, or extra high. The harness clamps unsupported
   levels to model capability. Discover retains `low` as its migrated default;
   Analyze inherits the pi setting unless selected explicitly.
6. A runtime contract that Discovery explicitly marks `Unverified` is not sent
   through the verified-source analysis path. agent-api stores a deterministic
   typed bundle that identifies it as opaque and requires the final verdict to
   ground any behavioral claim in trace or on-chain evidence. This makes the
   unsupported input durable instead of retrying a source endpoint that cannot
   succeed.
7. Bundle selection is an input step, not permanent verdict chrome. The initial
   action is **Discover**. A completed verdict hides the bundle list and exposes
   **Reassess**; Reassess only reopens selection and changes the action back to
   Discover. The following Discover action performs the new turn.
8. Discovery streams the pi session's authoritative context usage after every
   completed interaction. The used token count and context window are persisted
   with the durable session and replace the preflight bundle estimate once
   available. Reasoning and tool traffic are therefore reflected after the
   provider completes the turn.
9. The Analyze phase has one consistent read-only on-chain capability. Manual
   Analyze code/value runs enable the same bounded `cast` tool already used by
   autonomous bundle analysis, and their task prompts explicitly describe it.
   The existing allowlist, timeout, output cap, and no-shell constraints remain
   unchanged.

The final Discovery verdict remains one model context. Context overflow remains
user-controlled through bundle deselection; this decision does not add
hierarchical verdict aggregation.

## Consequences

- Navigating between workspaces no longer wastes an in-flight model turn or
  makes a returning pane appear to start over.
- Multiple workspace preparations may coexist, but the existing process-wide
  scheduler still caps model pressure.
- Progress makes model latency distinguishable from source loading, cache
  resolution, and scheduler queueing.
- The registry survives DiscoUI route/workspace changes, not a full browser
  reload. Completed bundles remain durable in Postgres as before.
- Unverified contracts remain visible to the final single-context verdict, but
  their bundles clearly carry less evidence than verified-source bundles.
- The context meter is an estimate before the first interaction and provider-
  backed session usage after each completed verdict or follow-up.
