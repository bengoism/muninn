import { useCallback, useEffect, useRef } from 'react';
import { AppState, Keyboard } from 'react-native';

import { runInference } from '../../../native/agent-runtime';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import { useChatStore } from '../../../state/chat-store';
import type {
  AgentActionRecord,
  AgentActionStatus,
  InferenceSuccess,
  RuntimeMode,
  StopReason,
  ToolName,
} from '../../../types/agent';
import type { BrowserWebViewHandle } from '../components/BrowserWebView';
import { TOOL_REGISTRY } from '../tools/registry';
import { executeTool } from '../tools/executor';
import { captureValidationSnapshot, classifyOutcome } from '../tools/validation';
import { getRetryDirective } from '../tools/retry-policy';
import { diagnoseStuckState } from '../tools/stuck-recovery';
import type { ActionOutcome } from '../tools/types';
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
        addActionRecord,
        incrementStep,
      } = store.getState();

      const chat = useChatStore.getState();

      resetSession();
      setGoal(goal);
      Keyboard.dismiss();
      console.log('[muninn:start]', JSON.stringify({ goal, runtimeMode }));
      chat.addMessage({ type: 'user', text: goal, timestamp: new Date().toISOString() });
      chat.addMessage({ type: 'agent_status', status: 'started', message: 'Working on it...', timestamp: new Date().toISOString() });

      const loopStartedAt = Date.now();
      let consecutiveNoOps = 0;
      let reobservesSinceLastProgress = 0;

      function stopLoop(reason: StopReason, message: string) {
        console.log('[muninn:stop]', JSON.stringify({ reason, message }));
        chat.addMessage({ type: 'agent_status', status: 'stopped', message, timestamp: new Date().toISOString() });
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

          let observation;
          try {
            observation = await browser.observe();
          } catch (e) {
            stopLoop(
              'unrecoverable_error',
              e instanceof Error ? e.message : 'Observation failed.',
            );
            break;
          }
          if (cancelledRef.current) break;

          const stepNum = store.getState().stepCount + 1;
          logStep(stepNum, 'observe', {
            url: useBrowserStore.getState().currentUrl,
            axNodes: observation.axSnapshot.length,
            treeTextLen: observation.axTreeText.length,
            quiescence: observation.quiescence.satisfied,
            warnings: observation.warnings.length,
          });
          if (observation.axTreeText) {
            console.log(`[muninn:step-${stepNum}:tree]\n${observation.axTreeText}`);
          }

          // ---------------------------------------------------------------
          // 2. REASON
          // ---------------------------------------------------------------
          setLoopState('reasoning');
          const inference = await runInference({
            goal,
            screenshotUri: observation.screenshot.uri,
            axSnapshot: observation.axSnapshot,
            axTreeText: observation.axTreeText,
            actionHistory: store.getState().actionHistory,
            runtimeMode,
          });
          if (cancelledRef.current) break;
          setLastNativeResponse(inference);

          if (!inference.ok) {
            logStep(stepNum, 'reason:fail', { code: inference.code, message: inference.message });
            stopLoop('unrecoverable_error', inference.message);
            break;
          }

          const { action, parameters } = inference as InferenceSuccess;
          logStep(stepNum, 'reason', { action, parameters });
          const definition = TOOL_REGISTRY[action as ToolName];

          // ---------------------------------------------------------------
          // 3. TERMINAL ACTION
          // ---------------------------------------------------------------
          if (definition?.terminal) {
            const urlNow = useBrowserStore.getState().currentUrl;
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
            setStopReason(terminalReason);
            setLoopState(action === 'finish' ? 'finished' : 'yielded');
            break;
          }

          // ---------------------------------------------------------------
          // 4. PRE-ACTION SNAPSHOT + ACT
          // ---------------------------------------------------------------
          setLoopState('acting');
          const preSnapshot = await captureValidationSnapshot(browser);
          const toolResult = await executeTool(action, parameters, browser);
          if (cancelledRef.current) break;

          // ---------------------------------------------------------------
          // 5. VALIDATE
          // ---------------------------------------------------------------
          setLoopState('validating');
          await delay(mergedConfigRef.current.postActionSettleMs);
          const postSnapshot = await captureValidationSnapshot(browser);
          const validation = classifyOutcome(
            action,
            parameters,
            toolResult,
            preSnapshot,
            postSnapshot,
          );

          logStep(stepNum, 'validate', {
            outcome: validation.outcome,
            reason: validation.reason,
            signals: validation.signals,
          });

          chat.addMessage({
            type: 'agent_step',
            step: stepNum,
            action,
            params: parameters,
            outcome: validation.outcome,
            reason: validation.reason,
            urlChanged: validation.signals.urlChanged,
            timestamp: new Date().toISOString(),
          });

          // Record primary action.
          const primaryTimestamp = new Date().toISOString();
          addActionRecord(
            toActionRecord(
              action,
              parameters,
              OUTCOME_TO_STATUS[validation.outcome],
              validation.reason,
              preSnapshot.url,
              postSnapshot.url,
            ),
          );

          // ---------------------------------------------------------------
          // 6. RETRY (single fallback attempt)
          // ---------------------------------------------------------------
          let finalOutcome = validation;
          const directive = getRetryDirective(
            action,
            parameters,
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
              fallbackChain: [action, directive.fallbackAction],
            });
          }

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
              await executeTool('go_back', {}, browser);
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
          setStopReason('user_cancelled');
          setLoopState('idle');
          setLastError(null);
        }
      } catch (e) {
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
