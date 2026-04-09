import { useCallback, useEffect, useRef } from 'react';
import { AppState, Keyboard } from 'react-native';

import { runInference } from '../../../native/agent-runtime';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import { useChatStore } from '../../../state/chat-store';
import { useDebugStore } from '../../../state/debug-store';
import type {
  AgentActionRecord,
  AgentActionStatus,
  InferenceSuccess,
  ObservationResult,
  PlanningContextDebugRequest,
  SessionPlan,
  RuntimeMode,
  StopReason,
  ToolName,
} from '../../../types/agent';
import type { BrowserWebViewHandle } from '../components/BrowserWebView';
import type { ActionDebugTrace, ValidationSnapshotSummary } from '../debug/types';
import { TOOL_REGISTRY } from '../tools/registry';
import { executeTool } from '../tools/executor';
import { captureValidationSnapshot, classifyOutcome } from '../tools/validation';
import { getRetryDirective } from '../tools/retry-policy';
import { diagnoseStuckState } from '../tools/stuck-recovery';
import type {
  ActionOutcome,
  TargetReferenceState,
  ValidationSnapshot,
} from '../tools/types';
import {
  normalizeInvalidTargetRepairValidation,
  repairInvalidTargetAction,
} from './invalid-target-repair';
import {
  buildReducedInferenceRequest,
  canReduceInferenceRequest,
  downgradePlanningContextRequest,
  shouldRetryInferenceWithReducedContext,
  shouldRetryInferenceWithoutPlanningContext,
} from './inference-fallback';
import {
  hasRepeatedNoOpOnTarget,
  shouldBlockFinishSuccess,
  shouldGuardSearchboxTarget,
} from './planning-guards';
import {
  decidePlanningContextRequest,
  finalizePlanningContextRequest,
  toInferencePlanningContext,
} from './planning-context';
import { repairGenericClickTarget } from './semantic-target-repair';
import {
  analyzeTargetEntry,
  buildInferenceTargetSummary,
  getTargetSummaryEntry,
  isEditableTargetEntry,
} from './target-analysis';
import {
  addAvoidRef,
  applyPlanUpdateProposals,
  createSessionPlan,
  findActiveAvoidRef,
  reduceSessionPlan,
} from './planning';
import { DEFAULT_LOOP_CONFIG, type LoopConfig } from './types';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Structured logging — streams to Metro bundler terminal
// ---------------------------------------------------------------------------

function logStep(step: number, phase: string, data: Record<string, unknown>) {
  const tag = `[muninn:step-${step}:${phase}]`;
  console.log(tag, JSON.stringify(data, null, 0));
}

function logPlanEvent(
  step: number | null,
  data: Record<string, unknown>,
) {
  if (step === null) {
    console.log('[muninn:plan]', JSON.stringify(data, null, 0));
    return;
  }

  logStep(step, 'plan', data);
}

// ---------------------------------------------------------------------------
// Outcome → AgentActionStatus mapping
// ---------------------------------------------------------------------------

const OUTCOME_TO_STATUS: Record<ActionOutcome, AgentActionStatus> = {
  success: 'succeeded',
  no_op: 'no_op',
  partial_success: 'partial_success',
  blocked: 'blocked',
  stale_ref: 'stale_ref',
  unrecoverable: 'failed',
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentLoop(
  browserRef: React.RefObject<BrowserWebViewHandle | null>,
  runtimeMode: RuntimeMode,
  config?: Partial<LoopConfig>,
) {
  const mergedConfigRef = useRef({ ...DEFAULT_LOOP_CONFIG, ...config });
  mergedConfigRef.current = { ...DEFAULT_LOOP_CONFIG, ...config };
  const cancelledRef = useRef(false);
  const runningRef = useRef(false);

  const store = useAgentSessionStore;

  // Cancel on app background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' && runningRef.current) {
        cancelledRef.current = true;
      }
    });
    return () => subscription.remove();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const start = useCallback(
    async (goal: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      cancelledRef.current = false;

      const {
        resetSession,
        setGoal,
        setLoopState,
        setLastNativeResponse,
        setLastError,
        setStopReason,
        setPlan,
        setLastPlanningContextRequest,
        addActionRecord,
        incrementStep,
      } = store.getState();

      const chat = useChatStore.getState();
      const debugStore = useDebugStore.getState();

      resetSession();
      debugStore.clearSession();
      setGoal(goal);
      commitPlan(createSessionPlan(goal), 'session_start');
      Keyboard.dismiss();
      console.log('[muninn:start]', JSON.stringify({ goal, runtimeMode }));
      chat.addMessage({ type: 'user', text: goal, timestamp: new Date().toISOString() });
      chat.addMessage({ type: 'agent_status', status: 'started', message: 'Working on it...', timestamp: new Date().toISOString() });

      const loopStartedAt = Date.now();
      let consecutiveNoOps = 0;
      let reobservesSinceLastProgress = 0;
      let previousObservation: ObservationResult | null = null;
      let lastPlanningContextRequest: PlanningContextDebugRequest | null = null;
      let planningContextDisabledReason: string | null = null;

      function commitPlan(
        nextPlan: SessionPlan,
        source: string,
        step: number | null = null,
      ) {
        const previousPlan = store.getState().plan;
        emitPlanLogs(previousPlan, nextPlan, { source, step });
        setPlan(nextPlan);
      }

      function stopLoop(reason: StopReason, message: string) {
        console.log('[muninn:stop]', JSON.stringify({ reason, message }));
        chat.addMessage({ type: 'agent_status', status: 'stopped', message, timestamp: new Date().toISOString() });
        commitPlan(
          reduceSessionPlan(store.getState().plan, {
            type: 'session_finished',
            goal,
            stopReason: reason,
            timestamp: new Date().toISOString(),
          }),
          'session_finished',
        );
        setStopReason(reason);
        setLastError(message);
        setLoopState('failed');
      }

      try {
        while (
          store.getState().stepCount < mergedConfigRef.current.maxSteps &&
          (mergedConfigRef.current.maxDurationMs <= 0 || Date.now() - loopStartedAt < mergedConfigRef.current.maxDurationMs) &&
          !cancelledRef.current
        ) {
          // ---------------------------------------------------------------
          // 1. OBSERVE
          // ---------------------------------------------------------------
          setLoopState('observing');
          const browser = browserRef.current;
          if (!browser) {
            stopLoop('unrecoverable_error', 'Browser ref is not available.');
            break;
          }

          const stepNum = store.getState().stepCount + 1;
          const planningContextRequest = decidePlanningContextRequest({
            actionHistory: store.getState().actionHistory,
            currentUrl: useBrowserStore.getState().currentUrl,
            debugRawEnabled: useDebugStore.getState().captureRaw,
            plan: store.getState().plan,
            previousObservation,
            previousRequest: lastPlanningContextRequest,
            stepIndex: stepNum,
          });
          const effectivePlanningContextRequest = downgradePlanningContextRequest(
            planningContextRequest,
            planningContextDisabledReason,
          );
          if (
            planningContextRequest &&
            !effectivePlanningContextRequest &&
            planningContextDisabledReason
          ) {
            logStep(stepNum, 'planning_context', {
              requested: false,
              disabled: true,
              reason: planningContextDisabledReason,
              skippedReasons: planningContextRequest.reasons,
            });
          } else if (effectivePlanningContextRequest) {
            logStep(stepNum, 'planning_context', {
              requested: true,
              reasons: effectivePlanningContextRequest.reasons,
              source: effectivePlanningContextRequest.source,
              summary: effectivePlanningContextRequest.summary,
            });
          }

          let observation;
          try {
            observation = await browser.observe({
              includeFullPageScreenshot: effectivePlanningContextRequest !== null,
            });
          } catch (e) {
            stopLoop(
              'unrecoverable_error',
              e instanceof Error ? e.message : 'Observation failed.',
            );
            break;
          }
          if (cancelledRef.current) break;
          debugStore.setLastObservation(observation);
          previousObservation = observation;

          const finalizedPlanningContextRequest = finalizePlanningContextRequest(
            effectivePlanningContextRequest,
            observation,
          );
          if (finalizedPlanningContextRequest) {
            lastPlanningContextRequest = finalizedPlanningContextRequest;
            setLastPlanningContextRequest(finalizedPlanningContextRequest);
          }
          commitPlan(
            reduceSessionPlan(store.getState().plan, {
              type: 'observation',
              goal,
              observation,
              stepIndex: stepNum,
              timestamp: observation.observedAt,
              url: useBrowserStore.getState().currentUrl,
            }),
            'observation',
            stepNum,
          );
          const targetSummary = buildInferenceTargetSummary({
            goal,
            observation,
            plan: store.getState().plan,
          });
          logStep(stepNum, 'observe', {
            url: useBrowserStore.getState().currentUrl,
            axNodes: observation.axSnapshot.length,
            fullPageScreenshot: observation.fullPageScreenshot !== null,
            planningContext:
              finalizedPlanningContextRequest !== null
                ? {
                    reasons: finalizedPlanningContextRequest.reasons,
                    source: finalizedPlanningContextRequest.source,
                  }
                : null,
            refs: Object.keys(observation.debug.combinedRefMap).length,
            treeTextLen: observation.axTreeText.length,
            quiescence: observation.quiescence.satisfied,
            warnings: observation.warnings.length,
          });
          if (targetSummary) {
            logStep(stepNum, 'targets', {
              intent: targetSummary.intent,
              editable: targetSummary.editable.map((entry) => entry.id),
              exploratory: targetSummary.exploratory.map((entry) => entry.id),
              lowerPriority: targetSummary.lowerPriority.map((entry) => entry.id),
              preferred: targetSummary.preferred.map((entry) => entry.id),
            });
          }
          if (observation.axTreeText) {
            console.log(`[muninn:step-${stepNum}:tree]\n${observation.axTreeText}`);
          }

          // ---------------------------------------------------------------
          // 2. REASON
          // ---------------------------------------------------------------
          setLoopState('reasoning');
          const inferencePlanningContext = toInferencePlanningContext(
            finalizedPlanningContextRequest,
          );
          let inferenceRequest = {
            goal,
            planningContext: inferencePlanningContext,
            targetSummary,
            screenshotUri: observation.screenshot.uri,
            axSnapshot: observation.axSnapshot,
            axTreeText: observation.axTreeText,
            actionHistory: store.getState().actionHistory,
            sessionPlan: store.getState().plan,
            runtimeMode,
          };
          let inference = await runInference(inferenceRequest);
          if (
            shouldRetryInferenceWithoutPlanningContext(
              inference,
              inferencePlanningContext !== null,
            )
          ) {
            logStep(stepNum, 'planning_context_fallback', {
              code: inference.code,
              message: inference.message,
              retry: 'without_planning_context',
            });
            planningContextDisabledReason = `${inference.code}: ${inference.message}`;
            inferenceRequest = {
              ...inferenceRequest,
              planningContext: null,
            };
            inference = await runInference(inferenceRequest);
          }
          if (
            shouldRetryInferenceWithReducedContext(inference) &&
            canReduceInferenceRequest(inferenceRequest)
          ) {
            const reducedRequest = buildReducedInferenceRequest(inferenceRequest);
            logStep(stepNum, 'inference_fallback', {
              code: inference.code,
              message: inference.message,
              retry: 'reduced_context',
              actionHistoryFrom: inferenceRequest.actionHistory.length,
              actionHistoryTo: reducedRequest.actionHistory.length,
              planningContextDropped: inferenceRequest.planningContext !== null,
              targetSummaryDropped: inferenceRequest.targetSummary !== null,
              treeTextLenFrom: inferenceRequest.axTreeText.length,
              treeTextLenTo: reducedRequest.axTreeText.length,
            });
            inferenceRequest = reducedRequest;
            inference = await runInference(inferenceRequest);
          }
          if (cancelledRef.current) break;
          setLastNativeResponse(inference);

          if (!inference.ok) {
            logStep(stepNum, 'reason:fail', {
              code: inference.code,
              message: inference.message,
              details: inference.details,
            });
            stopLoop('unrecoverable_error', inference.message);
            break;
          }

          const { action, parameters, planUpdates } = inference as InferenceSuccess;
          logStep(stepNum, 'reason', { action, parameters });
          if (planUpdates && planUpdates.length > 0) {
            const proposalTimestamp = new Date().toISOString();
            const appliedPlanUpdates = applyPlanUpdateProposals({
              actionHistory: store.getState().actionHistory,
              goal,
              observation,
              plan: store.getState().plan,
              proposals: planUpdates,
              timestamp: proposalTimestamp,
              url: useBrowserStore.getState().currentUrl,
            });
            for (const decision of appliedPlanUpdates.decisions) {
              logPlanEvent(stepNum, {
                source: 'model_proposal',
                event: decision.accepted ? 'proposal_accepted' : 'proposal_rejected',
                proposal: decision.proposal,
                reason: decision.reason,
                createdItemId: decision.createdItemId,
              });
            }
            commitPlan(appliedPlanUpdates.plan, 'model_proposal', stepNum);
          }
          const definition = TOOL_REGISTRY[action as ToolName];

          // ---------------------------------------------------------------
          // 3. TERMINAL ACTION
          // ---------------------------------------------------------------
          if (definition?.terminal) {
            const urlNow = useBrowserStore.getState().currentUrl;
            if (
              action === 'finish' &&
              parameters.status === 'success'
            ) {
              const finishGuardReason = shouldBlockFinishSuccess({
                goal,
                message:
                  typeof parameters.message === 'string'
                    ? parameters.message
                    : null,
                observation,
                plan: store.getState().plan,
              });
              if (finishGuardReason) {
                logStep(stepNum, 'guard_finish', {
                  reason: finishGuardReason,
                  phase: store.getState().plan?.phase ?? null,
                  activeItemId: store.getState().plan?.activeItemId ?? null,
                });
                chat.addMessage({
                  type: 'agent_step',
                  step: stepNum,
                  action,
                  params: parameters,
                  outcome: 'blocked',
                  reason: finishGuardReason,
                  urlChanged: false,
                  timestamp: new Date().toISOString(),
                });
                addActionRecord(
                  toActionRecord(
                    action,
                    parameters,
                    'blocked',
                    finishGuardReason,
                    urlNow,
                    urlNow,
                  ),
                );
                consecutiveNoOps++;
                reobservesSinceLastProgress++;
                incrementStep();
                continue;
              }
            }
            const result = await executeTool(action, parameters, browser);
            addActionRecord(
              toActionRecord(action, parameters, result.ok ? 'succeeded' : 'failed', result.reason, urlNow, urlNow),
            );
            const terminalReason: StopReason =
              action === 'finish' ? 'goal_complete' : 'yielded_to_user';
            chat.addMessage({
              type: 'agent_status',
              status: 'finished',
              message: (parameters.message as string) ?? (action === 'finish' ? 'Done' : 'Needs your input'),
              timestamp: new Date().toISOString(),
            });
            commitPlan(
              reduceSessionPlan(store.getState().plan, {
                type: 'session_finished',
                goal,
                stopReason: terminalReason,
                timestamp: new Date().toISOString(),
              }),
              'terminal_action',
              stepNum,
            );
            setStopReason(terminalReason);
            setLoopState(action === 'finish' ? 'finished' : 'yielded');
            break;
          }

          // ---------------------------------------------------------------
          // 4. PRE-ACTION SNAPSHOT + ACT
          // ---------------------------------------------------------------
          setLoopState('acting');
          const preSnapshot = await captureValidationSnapshot(browser);

          let executableAction = action;
          let executableParameters = parameters;
          let executableTargetId =
            typeof executableParameters.id === 'string'
              ? executableParameters.id
              : null;
          let executableTargetState =
            executableTargetId !== null
              ? classifyTargetBeforeAction(executableTargetId, preSnapshot)
              : null;

          const invalidTargetRepair =
            executableTargetId &&
            (executableTargetState === 'unknown_ref' ||
              executableTargetState === 'stale_ref')
              ? repairInvalidTargetAction({
                  action,
                  observation,
                  params: parameters,
                  targetState: executableTargetState,
                })
              : null;

          const repairedInvalidTarget = invalidTargetRepair !== null;

          if (invalidTargetRepair) {
            executableAction = invalidTargetRepair.action;
            executableParameters = invalidTargetRepair.params;
            executableTargetId =
              typeof executableParameters.id === 'string'
                ? executableParameters.id
                : null;
            executableTargetState =
              executableTargetId !== null
                ? classifyTargetBeforeAction(executableTargetId, preSnapshot)
                : null;
            logStep(stepNum, 'repair', {
              from: {
                action,
                params: parameters,
                targetId: typeof parameters.id === 'string' ? parameters.id : null,
                targetState:
                  typeof parameters.id === 'string'
                    ? classifyTargetBeforeAction(parameters.id, preSnapshot)
                    : null,
              },
              reason: invalidTargetRepair.reason,
              score: invalidTargetRepair.score,
              to: {
                action: executableAction,
                candidateRef: invalidTargetRepair.candidateRef,
                params: executableParameters,
                targetState: executableTargetState,
              },
            });
          }

          const semanticClickRepair =
            executableTargetId &&
            executableAction === 'click' &&
            executableTargetState === 'known_ref'
              ? repairGenericClickTarget({
                  action: executableAction,
                  goal,
                  observation,
                  params: executableParameters,
                  plan: store.getState().plan,
                  targetState: executableTargetState,
                })
              : null;

          if (semanticClickRepair) {
            executableAction = semanticClickRepair.action;
            executableParameters = semanticClickRepair.params;
            executableTargetId = semanticClickRepair.candidateRef;
            executableTargetState = classifyTargetBeforeAction(
              executableTargetId,
              preSnapshot,
            );
            logStep(stepNum, 'repair_target', {
              from: {
                action,
                params: parameters,
                targetId: typeof parameters.id === 'string' ? parameters.id : null,
              },
              reason: semanticClickRepair.reason,
              score: semanticClickRepair.score,
              to: {
                action: executableAction,
                candidateRef: semanticClickRepair.candidateRef,
                params: executableParameters,
                targetState: executableTargetState,
              },
            });
          }

          const resolvedTargetSummaryEntry =
            executableTargetId !== null
              ? getTargetSummaryEntry(targetSummary, executableTargetId) ??
                analyzeTargetEntry(executableTargetId, {
                  goal,
                  observation,
                  plan: store.getState().plan,
                })
              : null;
          const requiresEditableTarget =
            executableAction === 'type' ||
            executableAction === 'fill' ||
            executableAction === 'select';

          if (
            executableTargetId &&
            requiresEditableTarget &&
            resolvedTargetSummaryEntry &&
            !isEditableTargetEntry(resolvedTargetSummaryEntry)
          ) {
            if (resolvedTargetSummaryEntry.capabilities.includes('click')) {
              logStep(stepNum, 'repair_target', {
                from: {
                  action: executableAction,
                  params: executableParameters,
                  targetId: executableTargetId,
                },
                reason:
                  'Non-editable targets must be activated with click before text entry.',
                to: {
                  action: 'click',
                  params: { id: executableTargetId },
                  targetId: executableTargetId,
                },
              });
              executableAction = 'click';
              executableParameters = { id: executableTargetId };
            } else {
              const reason = `Target ${executableTargetId} is not editable.`;
              logStep(stepNum, 'guard', {
                id: executableTargetId,
                reason: 'non_editable_text_target',
                detail: resolvedTargetSummaryEntry.priorityReason,
              });
              chat.addMessage({
                type: 'agent_step',
                step: stepNum,
                action: executableAction,
                params: executableParameters,
                outcome: 'blocked',
                reason,
                urlChanged: false,
                timestamp: new Date().toISOString(),
              });
              addActionRecord(
                toActionRecord(
                  executableAction,
                  executableParameters,
                  'blocked',
                  reason,
                  preSnapshot.url,
                  preSnapshot.url,
                ),
              );
              incrementStep();
              continue;
            }
          }

          if (
            executableTargetId &&
            (executableTargetState === 'stale_ref' ||
              executableTargetState === 'unknown_ref')
          ) {
            logStep(stepNum, 'skip', {
              id: executableTargetId,
              originalId:
                typeof parameters.id === 'string' ? parameters.id : null,
              reason: executableTargetState,
            });
            chat.addMessage({
              type: 'agent_step',
              step: stepNum,
              action: executableAction,
              params: executableParameters,
              outcome:
                executableTargetState === 'stale_ref' ? 'stale_ref' : 'failed',
              reason:
                executableTargetState === 'stale_ref'
                  ? 'Element gone, re-observing'
                  : 'Target ref was not present in the latest observation',
              urlChanged: false,
              timestamp: new Date().toISOString(),
            });
            continue;
          }

          const guardedTarget =
            executableTargetId !== null
              ? findActiveAvoidRef(
                  store.getState().plan,
                  executableTargetId,
                  stepNum,
                )
              : null;
          if (guardedTarget) {
            const reason = `Target ${executableTargetId} is on cooldown: ${guardedTarget.reason}`;
            logStep(stepNum, 'guard', {
              id: executableTargetId,
              reason: 'avoid_ref',
              detail: guardedTarget.reason,
              expiresAfterStep: guardedTarget.expiresAfterStep,
            });
            chat.addMessage({
              type: 'agent_step',
              step: stepNum,
              action: executableAction,
              params: executableParameters,
              outcome: 'blocked',
              reason,
              urlChanged: false,
              timestamp: new Date().toISOString(),
            });
            addActionRecord(
              toActionRecord(
                executableAction,
                executableParameters,
                'blocked',
                reason,
                preSnapshot.url,
                preSnapshot.url,
              ),
            );
            incrementStep();
            continue;
          }

          if (
            executableTargetId &&
            shouldGuardSearchboxTarget(
              store.getState().plan,
              preSnapshot,
              executableTargetId,
              executableAction,
            )
          ) {
            const timestamp = new Date().toISOString();
            const reason =
              'Search controls are deprioritized once results or detail views are visible.';
            const currentPlan = store.getState().plan;
            if (currentPlan) {
              commitPlan(
                addAvoidRef(
                  currentPlan,
                  executableTargetId,
                  reason,
                  stepNum,
                  timestamp,
                  2,
                ),
                'guard_searchbox',
                stepNum,
              );
            }
            logStep(stepNum, 'guard', {
              id: executableTargetId,
              reason: 'searchbox_deprioritized',
              detail: reason,
            });
            chat.addMessage({
              type: 'agent_step',
              step: stepNum,
              action: executableAction,
              params: executableParameters,
              outcome: 'blocked',
              reason,
              urlChanged: false,
              timestamp,
            });
            addActionRecord(
              toActionRecord(
                executableAction,
                executableParameters,
                'blocked',
                reason,
                preSnapshot.url,
                preSnapshot.url,
              ),
            );
            incrementStep();
            continue;
          }

          const effectiveAction = executableAction;
          const effectiveParameters = executableParameters;

          const toolResult = await executeTool(
            effectiveAction,
            effectiveParameters,
            browser,
            {
              captureRaw: useDebugStore.getState().captureRaw,
            },
          );
          if (cancelledRef.current) break;
          logStep(stepNum, 'act', {
            action: effectiveAction,
            targetState: toolResult.debug?.targetState ?? executableTargetState,
            params: effectiveParameters,
            resolver: toolResult.debug?.resolver ?? null,
          });

          // ---------------------------------------------------------------
          // 5. VALIDATE
          // ---------------------------------------------------------------
          setLoopState('validating');
          await delay(mergedConfigRef.current.postActionSettleMs);
          const postSnapshot = await captureValidationSnapshot(browser);
          let validation = classifyOutcome(
            effectiveAction,
            effectiveParameters,
            toolResult,
            preSnapshot,
            postSnapshot,
          );
          if (repairedInvalidTarget) {
            validation = normalizeInvalidTargetRepairValidation(validation);
          }

          logStep(stepNum, 'validate', {
            outcome: validation.outcome,
            reason: validation.reason,
            signals: validation.signals,
          });

          chat.addMessage({
            type: 'agent_step',
            step: stepNum,
            action: effectiveAction,
            params: effectiveParameters,
            outcome: validation.outcome,
            reason: validation.reason,
            urlChanged: validation.signals.urlChanged,
            timestamp: new Date().toISOString(),
          });

          // Record primary action.
          const primaryTimestamp = new Date().toISOString();
          addActionRecord(
            toActionRecord(
              effectiveAction,
              effectiveParameters,
              OUTCOME_TO_STATUS[validation.outcome],
              validation.reason,
              preSnapshot.url,
              postSnapshot.url,
            ),
          );

          let retryTrace: ActionDebugTrace['retry'] = null;
          let finalAction = effectiveAction;
          let finalParameters = effectiveParameters;
          let finalPreSnapshot = preSnapshot;
          let finalPostSnapshot = postSnapshot;

          // ---------------------------------------------------------------
          // 6. RETRY (single fallback attempt)
          // ---------------------------------------------------------------
          let finalOutcome = validation;
          const directive = repairedInvalidTarget
            ? { retry: false as const }
            : getRetryDirective(
                effectiveAction,
                effectiveParameters,
                validation,
                0,
                preSnapshot,
              );

          if (directive.retry) {
            logStep(stepNum, 'retry', {
              fallback: directive.fallbackAction,
              params: directive.fallbackParams,
            });
            setLoopState('retrying');
            const retryResult = await executeTool(
              directive.fallbackAction,
              directive.fallbackParams,
              browser,
              {
                captureRaw: useDebugStore.getState().captureRaw,
              },
            );
            if (cancelledRef.current) break;

            await delay(mergedConfigRef.current.postActionSettleMs);
            const retryPostSnapshot = await captureValidationSnapshot(browser);
            finalOutcome = classifyOutcome(
              directive.fallbackAction,
              directive.fallbackParams,
              retryResult,
              postSnapshot,
              retryPostSnapshot,
            );

            addActionRecord({
              action: directive.fallbackAction,
              parameters: directive.fallbackParams,
              status: OUTCOME_TO_STATUS[finalOutcome.outcome],
              reason: finalOutcome.reason,
              urlBefore: postSnapshot.url,
              urlAfter: retryPostSnapshot.url,
              timestamp: new Date().toISOString(),
              retryOf: primaryTimestamp,
              fallbackChain: [effectiveAction, directive.fallbackAction],
            });

            retryTrace = {
              action: directive.fallbackAction,
              executor: {
                debug: retryResult.debug ?? null,
                durationMs: retryResult.durationMs,
                ok: retryResult.ok,
                reason: retryResult.reason,
              },
              parameters: directive.fallbackParams,
              validation: {
                outcome: finalOutcome.outcome,
                reason: finalOutcome.reason,
                signals: finalOutcome.signals,
              },
            };
            finalAction = directive.fallbackAction;
            finalParameters = directive.fallbackParams;
            finalPreSnapshot = postSnapshot;
            finalPostSnapshot = retryPostSnapshot;
          }

          const actionPlanTimestamp = new Date().toISOString();
          let nextPlan = reduceSessionPlan(store.getState().plan, {
            type: 'action_validated',
            action: finalAction,
            goal,
            params: finalParameters,
            postSnapshot: finalPostSnapshot,
            preSnapshot: finalPreSnapshot,
            stepIndex: stepNum,
            timestamp: actionPlanTimestamp,
            validation: finalOutcome,
          });
          if (
            executableTargetId &&
            finalOutcome.outcome === 'no_op' &&
            hasRepeatedNoOpOnTarget(
              store.getState().actionHistory,
              effectiveAction,
              executableTargetId,
            )
          ) {
            nextPlan = addAvoidRef(
              nextPlan,
              executableTargetId,
              `Repeated ${effectiveAction} actions on ${executableTargetId} produced no visible change.`,
              stepNum,
              actionPlanTimestamp,
            );
          }
          commitPlan(nextPlan, 'action_validated', stepNum);

          debugStore.pushActionTrace({
            action: effectiveAction,
            executor: {
              debug: toolResult.debug ?? null,
              durationMs: toolResult.durationMs,
              ok: toolResult.ok,
              reason: toolResult.reason,
            },
            inferenceDiagnostics: inference.diagnostics,
            parameters: effectiveParameters,
            postSnapshot: summarizeSnapshot(postSnapshot),
            preSnapshot: summarizeSnapshot(preSnapshot),
            retry: retryTrace,
            step: stepNum,
            targetState:
              toolResult.debug?.targetState ?? executableTargetState ?? null,
            timestamp: new Date().toISOString(),
            validation: {
              outcome: validation.outcome,
              reason: validation.reason,
              signals: validation.signals,
            },
          });

          // ---------------------------------------------------------------
          // 7. STUCK-STATE CHECK
          // ---------------------------------------------------------------
          const diagnosis = diagnoseStuckState(
            store.getState().actionHistory,
            finalOutcome,
            consecutiveNoOps,
            reobservesSinceLastProgress,
            mergedConfigRef.current,
          );

          if (diagnosis.stuck) {
            logStep(stepNum, 'stuck', {
              recovery: diagnosis.recovery,
              reason: diagnosis.reason,
              consecutiveNoOps,
            });
            if (diagnosis.recovery === 'stop') {
              stopLoop(
                diagnosis.reason!,
                `Loop stuck: ${diagnosis.reason}. Stopping.`,
              );
              break;
            }
            if (diagnosis.recovery === 'go_back') {
              await executeTool('go_back', {}, browser, {
                captureRaw: useDebugStore.getState().captureRaw,
              });
              await delay(mergedConfigRef.current.postActionSettleMs);
            }
            // Both 'reobserve' and 'go_back' continue to next OBSERVE cycle.
            reobservesSinceLastProgress++;
            continue;
          }

          // ---------------------------------------------------------------
          // 8. UPDATE COUNTERS
          // ---------------------------------------------------------------
          if (
            finalOutcome.outcome === 'no_op' ||
            finalOutcome.outcome === 'blocked' ||
            finalOutcome.outcome === 'stale_ref'
          ) {
            consecutiveNoOps++;
          } else {
            consecutiveNoOps = 0;
            reobservesSinceLastProgress = 0;
          }

          incrementStep();
        }

        // Budget exceeded.
        const state = store.getState();
        if (
          !cancelledRef.current &&
          state.loopState !== 'finished' &&
          state.loopState !== 'yielded' &&
          state.loopState !== 'failed'
        ) {
          if (state.stepCount >= mergedConfigRef.current.maxSteps) {
            stopLoop(
              'step_budget_exhausted',
              `Step budget exhausted (${mergedConfigRef.current.maxSteps}).`,
            );
          } else if (
            mergedConfigRef.current.maxDurationMs > 0 &&
            Date.now() - loopStartedAt >=
            mergedConfigRef.current.maxDurationMs
          ) {
            stopLoop('time_budget_exhausted', 'Time budget exhausted.');
          }
        }

        if (cancelledRef.current) {
          commitPlan(
            reduceSessionPlan(store.getState().plan, {
              type: 'session_finished',
              goal,
              stopReason: 'user_cancelled',
              timestamp: new Date().toISOString(),
            }),
            'user_cancelled',
          );
          setStopReason('user_cancelled');
          setLoopState('idle');
          setLastError(null);
        }
      } catch (e) {
        commitPlan(
          reduceSessionPlan(store.getState().plan, {
            type: 'session_finished',
            goal,
            stopReason: 'unrecoverable_error',
            timestamp: new Date().toISOString(),
          }),
          'unrecoverable_error',
        );
        store.getState().setStopReason('unrecoverable_error');
        store.getState().setLoopState('failed');
        store.getState().setLastError(
          e instanceof Error ? e.message : 'Unexpected loop error.',
        );
      } finally {
        runningRef.current = false;
      }
    },
    [browserRef, runtimeMode, store],
  );

  const isRunning = useAgentSessionStore(
    (s) =>
      s.loopState !== 'idle' &&
      s.loopState !== 'finished' &&
      s.loopState !== 'yielded' &&
      s.loopState !== 'failed',
  );

  const currentStep = useAgentSessionStore((s) => s.stepCount);

  return { start, cancel, isRunning, currentStep };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toActionRecord(
  action: ToolName,
  parameters: Record<string, unknown>,
  status: AgentActionStatus,
  reason: string | null,
  urlBefore: string | null,
  urlAfter: string | null,
): AgentActionRecord {
  return {
    action,
    parameters,
    status,
    reason,
    urlBefore: urlBefore ?? null,
    urlAfter: urlAfter ?? null,
    timestamp: new Date().toISOString(),
  };
}

function summarizeSnapshot(
  snapshot: ValidationSnapshot,
): ValidationSnapshotSummary {
  return {
    activeShortRef: snapshot.activeShortRef,
    axNodeCount: snapshot.axNodeCount,
    focusedElementId: snapshot.focusedElementId,
    hasDialog: snapshot.hasDialog,
    isLoading: snapshot.isLoading,
    liveRefCount: snapshot.liveRefIds.size,
    scrollY: snapshot.scrollY,
    url: snapshot.url,
  };
}

function classifyTargetBeforeAction(
  targetId: string,
  snapshot: ValidationSnapshot,
): TargetReferenceState {
  if (snapshot.refToDomId.has(targetId)) {
    return 'known_ref';
  }

  if (snapshot.axNodeIds.has(targetId)) {
    return 'legacy_dom_id';
  }

  return /^ai-/.test(targetId) ? 'stale_ref' : 'unknown_ref';
}

function emitPlanLogs(
  previousPlan: SessionPlan | null,
  nextPlan: SessionPlan,
  context: { source: string; step: number | null },
) {
  if (!previousPlan) {
    logPlanEvent(context.step, {
      source: context.source,
      event: 'created',
      phase: nextPlan.phase,
      activeItemId: nextPlan.activeItemId,
      items: summarizePlanItems(nextPlan),
    });
    return;
  }

  if (previousPlan.phase !== nextPlan.phase) {
    logPlanEvent(context.step, {
      source: context.source,
      event: 'phase_changed',
      from: previousPlan.phase,
      to: nextPlan.phase,
    });
  }

  if (previousPlan.activeItemId !== nextPlan.activeItemId) {
    logPlanEvent(context.step, {
      source: context.source,
      event: 'active_item_changed',
      from: previousPlan.activeItemId,
      to: nextPlan.activeItemId,
    });
  }

  if (
    previousPlan.lastConfirmedProgress !== nextPlan.lastConfirmedProgress &&
    nextPlan.lastConfirmedProgress
  ) {
    logPlanEvent(context.step, {
      source: context.source,
      event: 'progress_confirmed',
      value: nextPlan.lastConfirmedProgress,
    });
  }

  const previousItems = new Map(
    previousPlan.items.map((item) => [item.id, item] as const),
  );
  for (const item of nextPlan.items) {
    const previousItem = previousItems.get(item.id);
    if (!previousItem) {
      logPlanEvent(context.step, {
        source: context.source,
        event: 'item_added',
        item: summarizePlanItem(item),
      });
      continue;
    }

    if (previousItem.status !== item.status) {
      logPlanEvent(context.step, {
        source: context.source,
        event: 'item_status_changed',
        id: item.id,
        text: item.text,
        from: previousItem.status,
        to: item.status,
        evidence: item.evidence,
      });
    } else if (previousItem.evidence !== item.evidence && item.evidence) {
      logPlanEvent(context.step, {
        source: context.source,
        event: 'item_evidence_updated',
        id: item.id,
        text: item.text,
        evidence: item.evidence,
      });
    }
  }

  const previousAvoidRefs = new Map(
    previousPlan.avoidRefs.map((entry) => [entry.ref, entry] as const),
  );
  for (const entry of nextPlan.avoidRefs) {
    const previousEntry = previousAvoidRefs.get(entry.ref);
    if (
      !previousEntry ||
      previousEntry.reason !== entry.reason ||
      previousEntry.expiresAfterStep !== entry.expiresAfterStep
    ) {
      logPlanEvent(context.step, {
        source: context.source,
        event: 'avoid_ref_added',
        ref: entry.ref,
        reason: entry.reason,
        expiresAfterStep: entry.expiresAfterStep,
      });
    }
  }

  for (const entry of previousPlan.avoidRefs) {
    if (!nextPlan.avoidRefs.some((candidate) => candidate.ref === entry.ref)) {
      logPlanEvent(context.step, {
        source: context.source,
        event: 'avoid_ref_expired',
        ref: entry.ref,
        reason: entry.reason,
      });
    }
  }
}

function summarizePlanItem(item: SessionPlan['items'][number]) {
  return {
    evidence: item.evidence,
    id: item.id,
    status: item.status,
    text: item.text,
  };
}

function summarizePlanItems(plan: SessionPlan) {
  return plan.items.map((item) => summarizePlanItem(item));
}
