import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { runInference } from '../../../native/agent-runtime';
import { useAgentSessionStore } from '../../../state/agent-session-store';
import { useBrowserStore } from '../../../state/browser-store';
import type {
  AgentActionRecord,
  InferenceSuccess,
  RuntimeMode,
  ToolName,
} from '../../../types/agent';
import type { BrowserWebViewHandle } from '../components/BrowserWebView';
import { TOOL_REGISTRY } from '../tools/registry';
import { executeTool } from '../tools/executor';
import { DEFAULT_LOOP_CONFIG, type LoopConfig } from './types';

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function useAgentLoop(
  browserRef: React.RefObject<BrowserWebViewHandle | null>,
  runtimeMode: RuntimeMode,
  config?: Partial<LoopConfig>
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
        addActionRecord,
        incrementStep,
      } = store.getState();

      resetSession();
      setGoal(goal);

      const loopStartedAt = Date.now();
      let consecutiveNoOps = 0;

      try {
        while (
          store.getState().stepCount < mergedConfigRef.current.maxSteps &&
          Date.now() - loopStartedAt < mergedConfigRef.current.maxDurationMs &&
          !cancelledRef.current
        ) {
          // 1. OBSERVE
          setLoopState('observing');
          const browser = browserRef.current;
          if (!browser) {
            setLoopState('failed');
            setLastError('Browser ref is not available.');
            break;
          }

          let observation;
          try {
            observation = await browser.observe();
          } catch (e) {
            setLoopState('failed');
            setLastError(
              e instanceof Error ? e.message : 'Observation failed.'
            );
            break;
          }
          if (cancelledRef.current) break;

          // 2. REASON
          setLoopState('reasoning');
          const inference = await runInference({
            goal,
            screenshotUri: observation.screenshot.uri,
            axSnapshot: observation.axSnapshot,
            actionHistory: store.getState().actionHistory,
            runtimeMode,
          });
          if (cancelledRef.current) break;
          setLastNativeResponse(inference);

          if (!inference.ok) {
            setLoopState('failed');
            setLastError(inference.message);
            break;
          }

          const { action, parameters } = inference as InferenceSuccess;
          const definition = TOOL_REGISTRY[action as ToolName];

          // 3. TERMINAL ACTION
          if (definition?.terminal) {
            const urlNow = useBrowserStore.getState().currentUrl;
            const result = await executeTool(action, parameters, browser);
            addActionRecord(
              toActionRecord(action, parameters, result.ok, result.reason, urlNow, urlNow)
            );
            setLoopState(action === 'finish' ? 'finished' : 'yielded');
            break;
          }

          // 4. ACT
          setLoopState('acting');
          const urlBefore = useBrowserStore.getState().currentUrl;
          const toolResult = await executeTool(action, parameters, browser);
          if (cancelledRef.current) break;

          // 5. VALIDATE
          setLoopState('validating');
          await delay(mergedConfigRef.current.postActionSettleMs);
          const urlAfter = useBrowserStore.getState().currentUrl;

          addActionRecord(
            toActionRecord(
              action,
              parameters,
              toolResult.ok,
              toolResult.reason,
              urlBefore,
              urlAfter
            )
          );

          if (!toolResult.ok) {
            consecutiveNoOps++;
          } else {
            consecutiveNoOps = 0;
          }

          if (consecutiveNoOps >= mergedConfigRef.current.maxConsecutiveNoOps) {
            setLoopState('failed');
            setLastError(
              `${consecutiveNoOps} consecutive failed actions. Stopping.`
            );
            break;
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
            setLoopState('failed');
            setLastError(`Step budget exhausted (${mergedConfigRef.current.maxSteps}).`);
          } else if (Date.now() - loopStartedAt >= mergedConfigRef.current.maxDurationMs) {
            setLoopState('failed');
            setLastError('Time budget exhausted.');
          }
        }

        if (cancelledRef.current) {
          setLoopState('idle');
          setLastError(null);
        }
      } catch (e) {
        store.getState().setLoopState('failed');
        store.getState().setLastError(
          e instanceof Error ? e.message : 'Unexpected loop error.'
        );
      } finally {
        runningRef.current = false;
      }
    },
    [browserRef, runtimeMode, store]
  );

  const isRunning = useAgentSessionStore(
    (s) => s.loopState !== 'idle' && s.loopState !== 'finished' && s.loopState !== 'yielded' && s.loopState !== 'failed'
  );

  const currentStep = useAgentSessionStore((s) => s.stepCount);

  return { start, cancel, isRunning, currentStep };
}

function toActionRecord(
  action: ToolName,
  parameters: Record<string, unknown>,
  ok: boolean,
  reason: string | null,
  urlBefore: string | null,
  urlAfter: string | null
): AgentActionRecord {
  return {
    action,
    parameters,
    status: ok ? 'succeeded' : 'failed',
    reason,
    urlBefore: urlBefore ?? null,
    urlAfter: urlAfter ?? null,
    timestamp: new Date().toISOString(),
  };
}
