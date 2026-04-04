import { create } from 'zustand';

export type ChatMessage =
  | {
      type: 'user';
      text: string;
      timestamp: string;
    }
  | {
      type: 'agent_step';
      step: number;
      action: string;
      params: Record<string, unknown>;
      outcome: string;
      reason: string | null;
      urlChanged: boolean;
      timestamp: string;
    }
  | {
      type: 'agent_status';
      status: 'started' | 'finished' | 'stopped' | 'error';
      message: string;
      timestamp: string;
    };

type ChatState = {
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  clear: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],

  addMessage: (msg) =>
    set((state) => ({
      messages: [...state.messages, msg],
    })),

  clear: () => set({ messages: [] }),
}));
