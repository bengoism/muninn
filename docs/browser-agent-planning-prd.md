# PRD: Browser Agent Session Planning and Todo State

## Summary

Muninn's browser agent currently relies on the latest observation, a viewport screenshot, the accessibility tree, and a short tail of recent actions to choose the next step. This is enough for simple flows, but it breaks down once a task spans multiple screens or requires the agent to remember what has already been accomplished.

The clearest failure mode today is looping on the wrong control after progress has already been made. A concrete example is Amazon search results: after successfully searching for `mens socks`, the agent keeps clicking the already-filled search box instead of opening a product result. The issue is not only model capability. It is also that the runtime does not maintain a compact, explicit notion of plan state.

This PRD proposes a session-scoped planning layer built around a small todo list plus lightweight derived browser state. The plan is visible to the agent on every step, visible to the user in debug surfaces, and updated primarily by the runtime based on evidence. The model may propose updates later, but the runtime remains the source of truth.

## Problem

Current behavior has three related weaknesses:

- The agent sees a raw action history, but not an explicit summary of progress.
- The agent does not know which subgoal is active.
- The agent is free to revisit stale controls that already failed or are no longer relevant.

This causes:

- repeated `no_op` loops on prominent elements
- poor recovery after navigation or modal transitions
- weak continuity across multi-step tasks
- low debuggability because the agent's internal progress is implicit

## Goals

- Give the agent a compact, durable representation of task progress across steps.
- Improve action selection on multi-step browser tasks by making the active subgoal explicit.
- Reduce repeated interactions with stale or already-satisfied controls.
- Make plan state inspectable in debug UI and logs.
- Keep the planning abstraction generic enough to work across search, booking, shopping, form filling, and account flows.

## Non-Goals

- Build a full autonomous planner with arbitrary graph search.
- Let the model maintain an unconstrained free-form scratchpad.
- Replace observation, validation, or retry logic.
- Ship long-term memory across sessions.
- Solve every browser failure mode through planning alone.

## Users

- End users who want the agent to complete multi-step browser tasks more reliably.
- Developers debugging agent behavior who need to understand why a step was chosen.
- Researchers iterating on prompts, observation quality, and action recovery.

## Key Use Cases

- Search flow: search for a product, inspect results, open a result, compare price and shipping.
- Modal flow: click a field, retarget a full-screen editor or modal input, continue the task.
- Booking flow: select origin, destination, date, review options, choose one result.
- Form flow: move field by field without re-entering already-complete inputs.
- Recovery flow: avoid repeated no-op clicks on the same stale target and move to the next plausible step.

## Proposal

Introduce a session-scoped planning layer with two parts:

1. A generic todo list for task progress.
2. A small derived state summary for current browser context.

The todo list tracks what the agent is trying to accomplish. The derived state tracks where in the flow the browser appears to be and which controls should be temporarily avoided.

The runtime owns plan truth. It updates plan state from evidence such as URL changes, successful actions, DOM or AX deltas, validation outcomes, and page structure. The model reads this plan every step. In a later phase, the model may propose plan updates, but those proposals are validated by the runtime before they are committed.

## Why This Shape

A generic todo list is the right abstraction for a browser agent because it is:

- simple enough for small local models to follow
- expressive enough for most multi-step browser work
- easy to render in debug UI
- easy to validate against observable evidence

This mirrors how several coding-agent systems handle planning:

- todo state is short-lived and session-scoped
- there is usually one active item at a time
- planning is lightweight rather than fully symbolic
- completion is ideally backed by evidence, not only model assertion

## Product Requirements

### R1. Session Plan State

The runtime must maintain a session plan object for each agent run.

The plan must be reset at the start of a new run.

The plan must persist across steps within the same run.

### R2. Todo List

The plan must include a bounded todo list.

Initial target:

- minimum 1 item
- maximum 5 items
- exactly 1 active item at a time when work is in progress

Each item must include:

- stable `id`
- concise `text`
- `status`
- `source`
- optional `evidence`
- timestamps for creation and last update

Supported statuses:

- `pending`
- `in_progress`
- `completed`
- `blocked`
- `dropped`

Supported sources:

- `system`
- `model`

### R3. Derived State Summary

The plan must include compact runtime-derived state:

- `phase`
- `lastConfirmedProgress`
- `avoidRefs`
- optional `notes` for user-visible debugging

Initial phase set:

- `initial`
- `search`
- `results`
- `detail`
- `form`
- `checkout`
- `blocked`
- `done`

`avoidRefs` must support expiry after a small number of steps.

### R4. Read On Every Step

The agent must receive the current plan on every reasoning step.

The prompt must instruct the agent to:

- read the current plan first
- choose the next action that advances the active todo
- avoid refs currently on cooldown unless there is clear new evidence

### R5. Runtime-Owned Updates

In V1, the runtime is the only authority that mutates plan state.

The runtime must update the plan from observable evidence, including:

- navigation changes
- validation outcomes
- successful text entry
- visible result lists
- product or detail-page signals
- modal or dialog emergence
- repeated `no_op` actions

### R6. Debug Visibility

The latest plan state must be visible in the debug UI.

The debug surface must show:

- current phase
- active todo
- full todo list
- avoided refs and expiry
- latest evidence that changed the plan

### R7. Logging

Plan updates must be logged to Metro in structured form.

At minimum, logs must cover:

- initial plan creation
- plan transitions
- todo status updates
- ref cooldown additions and expiry

### R8. Safe Boundaries

Planning must not make unsupported claims about page state.

A todo must only move to `completed` when the runtime has evidence consistent with success.

The runtime must prefer reopening or blocking an item over falsely completing it.

## Example Plan State

### Amazon Search Results Example

```json
{
  "phase": "results",
  "activeItemId": "todo-open-result",
  "lastConfirmedProgress": "Search for 'mens socks' completed and results page loaded.",
  "items": [
    {
      "id": "todo-search",
      "text": "Search for mens socks",
      "status": "completed",
      "source": "system",
      "evidence": "Searchbox value updated and results URL loaded."
    },
    {
      "id": "todo-open-result",
      "text": "Open one promising product result",
      "status": "in_progress",
      "source": "system"
    },
    {
      "id": "todo-inspect-offer",
      "text": "Inspect price and shipping details",
      "status": "pending",
      "source": "system"
    }
  ],
  "avoidRefs": [
    {
      "ref": "e6",
      "reason": "Repeated clicks on searchbox produced no visible change.",
      "expiresAfterStep": 11
    }
  ]
}
```

### Google Flights Modal Example

```json
{
  "phase": "form",
  "activeItemId": "todo-set-origin",
  "lastConfirmedProgress": "Origin picker opened after field activation.",
  "items": [
    {
      "id": "todo-set-origin",
      "text": "Set origin airport",
      "status": "in_progress",
      "source": "system"
    },
    {
      "id": "todo-set-destination",
      "text": "Set destination airport",
      "status": "pending",
      "source": "system"
    },
    {
      "id": "todo-set-dates",
      "text": "Set travel month to May",
      "status": "pending",
      "source": "system"
    }
  ],
  "avoidRefs": []
}
```

## User Experience

### Agent Behavior

The agent should feel less reactive and more deliberate.

Expected improvements:

- fewer loops on already-satisfied controls
- clearer progression across search, results, and detail pages
- better retargeting after UI transitions
- more predictable recovery after failure

### Debug UI

Add a planning section to the existing debugging screen with:

- current phase
- active todo item
- list of all todos with statuses
- list of cooled-down refs
- latest plan evidence

This should help answer:

- What does the agent think it is trying to do?
- What does it believe is already done?
- Why is it avoiding or revisiting a given control?

## Functional Design

### Data Model

Suggested TypeScript shape:

```ts
type PlanPhase =
  | 'initial'
  | 'search'
  | 'results'
  | 'detail'
  | 'form'
  | 'checkout'
  | 'blocked'
  | 'done';

type PlanItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'dropped';

type PlanItemSource = 'system' | 'model';

type PlanItem = {
  id: string;
  text: string;
  status: PlanItemStatus;
  source: PlanItemSource;
  evidence?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AvoidRef = {
  ref: string;
  reason: string;
  expiresAfterStep: number;
};

type SessionPlan = {
  phase: PlanPhase;
  activeItemId: string | null;
  lastConfirmedProgress: string | null;
  items: PlanItem[];
  avoidRefs: AvoidRef[];
  notes: string[];
  updatedAt: string;
};
```

### Runtime Update Rules

The runtime should derive and update plan state through deterministic reducers.

Examples:

- If the search query was typed successfully and the page navigated to a results URL, mark the search todo as `completed`.
- If a results heading or list of candidate items is visible, set phase to `results`.
- If a product detail page title, buy box, or product-specific metadata appears, set phase to `detail`.
- If a field click opens a modal or full-screen editor, keep the relevant todo `in_progress` and update phase to `form`.
- If the same ref produces repeated `no_op`, add that ref to `avoidRefs` for a short expiry window.
- If navigation invalidates prior assumptions, move affected todos back to `pending` or `blocked`.

### Prompt Integration

The prompt should include the plan near the top, before action instructions.

Recommended format:

```text
Current phase: results
Active todo: Open one promising product result
Completed: Search for mens socks
Pending: Inspect price and shipping details
Avoid for now: e6 because repeated clicks had no effect
Last confirmed progress: Search results page loaded
```

The prompt should also tell the agent:

- always read the plan before selecting the next action
- prefer actions that advance the active todo
- avoid cooled-down refs unless new evidence appears
- if the active todo appears complete, choose the next action that confirms or advances the next todo

### Model-Writable Planning

V1 should be read-only from the model's perspective.

V2 may allow the model to propose plan mutations such as:

- `add_item`
- `set_active_item`
- `complete_item`
- `reopen_item`
- `drop_item`
- `set_phase`

These proposals should not be applied blindly. The runtime should validate them against current observation and action outcomes.

## Rollout Plan

### Phase 1: Runtime-Owned Plan

Scope:

- add plan state to session store
- derive plan state from observation and validation
- add ref cooldown support
- include plan summary in prompt
- show plan in debug UI

Success criteria:

- lower rate of repeated identical `no_op` actions
- fewer loops on stale inputs such as Amazon searchbox `e6`
- improved completion on simple multi-step flows

### Phase 2: Model Plan Proposals

Scope:

- allow model to propose limited plan updates
- validate proposals before commit
- log accepted and rejected proposals

Success criteria:

- improved handling of tasks that require optional branches
- better adaptability on novel sites without hand-authored rules

### Phase 3: Planning-Aware Context Expansion

Scope:

- conditionally send full-page screenshot or other richer planning artifacts
- only on navigation, repeated failure, or plan ambiguity

Success criteria:

- better planning on result-heavy or multi-pane pages
- no major latency regression on simple tasks

## Metrics

Primary metrics:

- repeated-identical-action rate per session
- consecutive-`no_op` streak length
- task completion rate on benchmark flows
- average steps to completion

Secondary metrics:

- number of ref cooldowns added per session
- rate of successful recovery after cooldown
- debug sessions where plan state explains a bad action

Qualitative checks:

- does the plan read like a truthful summary of progress?
- can a developer understand a bad step by reading the plan?
- does the active todo match what a human would do next?

## Risks

### Risk: Plan Drift

The plan may claim progress that did not actually happen.

Mitigation:

- runtime-owned truth in V1
- evidence-backed completion
- prefer `blocked` or `pending` over false `completed`

### Risk: Overfitting To Specific Flows

If the reducer only understands shopping or flights, it will not generalize.

Mitigation:

- keep todos generic
- keep phase taxonomy small
- use weak heuristics tied to common browser patterns, not site-specific IDs

### Risk: Prompt Bloat

Too much plan detail may crowd out page context.

Mitigation:

- limit to 3-5 todos
- summarize only current phase, active todo, completed items, and avoids
- keep full debug detail outside model context

### Risk: More Logic, More Complexity

A planning layer can become a second source of bugs.

Mitigation:

- start with deterministic reducers
- instrument every mutation
- keep state transitions easy to inspect and test

## Open Questions

- Should todo templates be seeded from the user goal at session start, or created lazily from observed progress?
- Should the runtime support multiple active todos, or keep exactly one active item at all times?
- How long should ref cooldowns last by default?
- Should full-page screenshots be attached to inference only when the plan is ambiguous or also after every navigation?
- When model-authored todo items are introduced, what evidence threshold should be required for completion?

## Recommendation

Build V1 as a runtime-owned, evidence-backed session todo list plus derived phase state.

Do not start with free-form model-authored planning.

This gives Muninn the benefits of explicit task progress without creating a second hallucination surface. It also fits the current architecture well: observation, validation, retry, and debug tooling already provide the evidence needed to keep the plan honest.
