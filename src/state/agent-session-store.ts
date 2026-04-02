import { create } from 'zustand';

import { DEFAULT_AGENT_GOAL } from '../config/runtime';
import type { InferenceResponse, LoopState } from '../types/agent';

type AgentSessionState = {
  goal: string;
  loopState: LoopState;
  lastNativeResponse: InferenceResponse | null;
  lastError: string | null;
  setGoal: (goal: string) => void;
  setLoopState: (loopState: LoopState) => void;
  setLastNativeResponse: (response: InferenceResponse | null) => void;
  setLastError: (error: string | null) => void;
};

export const useAgentSessionStore = create<AgentSessionState>((set) => ({
  goal: DEFAULT_AGENT_GOAL,
  loopState: 'idle',
  lastNativeResponse: null,
  lastError: null,
  setGoal: (goal) => set({ goal }),
  setLoopState: (loopState) => set({ loopState }),
  setLastNativeResponse: (lastNativeResponse) => set({ lastNativeResponse }),
  setLastError: (lastError) => set({ lastError }),
}));
