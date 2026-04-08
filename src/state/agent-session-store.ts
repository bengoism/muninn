import { create } from 'zustand';

import { DEFAULT_AGENT_GOAL } from '../config/runtime';
import type {
  AgentActionRecord,
  InferenceResponse,
  LoopState,
  PlanningContextDebugRequest,
  SessionPlan,
  StopReason,
} from '../types/agent';

const MAX_ACTION_HISTORY = 10;

type AgentSessionState = {
  goal: string;
  loopState: LoopState;
  lastNativeResponse: InferenceResponse | null;
  lastError: string | null;
  stopReason: StopReason | null;
  actionHistory: AgentActionRecord[];
  plan: SessionPlan | null;
  lastPlanningContextRequest: PlanningContextDebugRequest | null;
  stepCount: number;
  sessionId: string | null;

  setGoal: (goal: string) => void;
  setLoopState: (loopState: LoopState) => void;
  setLastNativeResponse: (response: InferenceResponse | null) => void;
  setLastError: (error: string | null) => void;
  setStopReason: (reason: StopReason | null) => void;
  setPlan: (plan: SessionPlan | null) => void;
  setLastPlanningContextRequest: (
    request: PlanningContextDebugRequest | null
  ) => void;
  addActionRecord: (record: AgentActionRecord) => void;
  incrementStep: () => void;
  resetSession: () => void;
};

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  goal: DEFAULT_AGENT_GOAL,
  loopState: 'idle',
  lastNativeResponse: null,
  lastError: null,
  stopReason: null,
  actionHistory: [],
  plan: null,
  lastPlanningContextRequest: null,
  stepCount: 0,
  sessionId: null,

  setGoal: (goal) => set({ goal }),
  setLoopState: (loopState) => set({ loopState }),
  setLastNativeResponse: (lastNativeResponse) => set({ lastNativeResponse }),
  setLastError: (lastError) => set({ lastError }),
  setStopReason: (stopReason) => set({ stopReason }),
  setPlan: (plan) => set({ plan }),
  setLastPlanningContextRequest: (lastPlanningContextRequest) =>
    set({ lastPlanningContextRequest }),

  addActionRecord: (record) =>
    set((state) => ({
      actionHistory: [...state.actionHistory, record].slice(-MAX_ACTION_HISTORY),
    })),

  incrementStep: () =>
    set((state) => ({ stepCount: state.stepCount + 1 })),

  resetSession: () =>
    set({
      loopState: 'idle',
      lastNativeResponse: null,
      lastError: null,
      stopReason: null,
      actionHistory: [],
      plan: null,
      lastPlanningContextRequest: null,
      stepCount: 0,
      sessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    }),
}));
