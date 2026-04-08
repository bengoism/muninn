# Browser Agent Planning Evaluation

## Purpose

This document defines the first benchmark set and success metrics for the session planning layer.

The goal is to evaluate whether planning improves multi-step browser reliability, especially on flows where the agent previously looped on stale or already-satisfied controls.

## Primary Metrics

- Repeated identical action rate per session.
- Consecutive `no_op` streak length.
- Task completion rate.
- Median steps to task completion.
- Searchbox re-click count after results are already visible.
- Number of avoid-ref cooldowns added per session.

## Secondary Metrics

- Phase transition accuracy.
- Active todo accuracy.
- Number of sessions where plan logs explain the bad action.
- Number of retries that recover after a cooldown is added.

## Benchmark Flows

### Shopping Flow

Target:
- Amazon-style search -> results -> product detail.

Goal:
- `find a good deal on mens socks`

Expected plan progression:
- `initial` or `search`
- `form` while entering search text
- `results` once search results are visible
- `detail` once a product page opens

Expected todo progression:
- `todo-start` becomes `completed`
- `todo-results` becomes `in_progress`
- `todo-detail` becomes `in_progress` on product page

Failure signals to watch:
- repeated clicks on the searchbox after results load
- repeated `no_op` on the same product card
- plan stays in `form` or `search` after results are clearly visible

### Modal/Form Flow

Target:
- Google Flights-style origin/destination/date picker flow

Goal:
- `find a flight from stockholm to nyc in may`

Expected plan progression:
- `initial`
- `form` when picker or modal entry UI is active
- `results` after the flight search results page renders

Expected todo progression:
- active todo remains the current picker or form step until the modal closes or the page advances

Failure signals to watch:
- invalid direct typing into label text instead of a real ref
- losing form context after a full-screen picker opens
- repeated clicks on the same field after the picker is already active

## Manual Evaluation Procedure

For each benchmark flow:

1. Start from a fresh app session.
2. Record the goal and runtime mode.
3. Let the agent run without intervention until success, stop, or obvious loop.
4. Save the Metro log segment containing `plan`, `observe`, `reason`, `validate`, and `retry` events.
5. Record:
   - final stop reason
   - final phase
   - last active todo
   - total step count
   - repeated identical actions
   - maximum consecutive `no_op` streak
   - whether avoid-ref cooldowns were added

## Pass Criteria For The Current Planning Layer

- The shopping flow should not re-click the searchbox once the plan has moved to `results`, unless the query is intentionally being changed.
- The modal/form flow should remain in `form` while the picker is active and should not regress to `initial`.
- The plan logs should show at least one truthful phase transition and one truthful progress confirmation in both flows.
- At least one benchmark run should show an avoid-ref or guardrail event when the agent attempts to revisit a stale control.

## Notes

- These benchmarks are intended for regression tracking, not formal model comparison.
- The metrics should be collected before and after changes to planning, prompting, or observation heuristics.
- When a run still fails, the evaluation is useful if the logs make the failure mode easier to diagnose than before.
