import { create } from 'zustand';

import { DEFAULT_BROWSER_URL } from '../config/runtime';

type BrowserState = {
  currentUrl: string;
  isLoading: boolean;
  setCurrentUrl: (url: string) => void;
  setIsLoading: (isLoading: boolean) => void;
};

export const useBrowserStore = create<BrowserState>((set) => ({
  currentUrl: DEFAULT_BROWSER_URL,
  isLoading: true,
  setCurrentUrl: (currentUrl) => set({ currentUrl }),
  setIsLoading: (isLoading) => set({ isLoading }),
}));
