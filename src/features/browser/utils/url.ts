import { DEFAULT_BROWSER_URL } from '../../../config/runtime';
import {
  BRIDGE_FIXTURE_BASE_URL,
  BRIDGE_FIXTURE_URL,
  buildBridgeFixtureHtml,
} from '../fixtures/bridge-fixture';

type BrowserSource =
  | {
      uri: string;
    }
  | {
      html: string;
      baseUrl?: string;
    };

export function normalizeBrowserUrl(input: string) {
  const trimmed = input.trim();

  if (!trimmed) {
    return DEFAULT_BROWSER_URL;
  }

  if (trimmed.toLowerCase() === BRIDGE_FIXTURE_URL) {
    return BRIDGE_FIXTURE_URL;
  }

  if (/^[a-z][a-z0-9+\-.]*:/i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

export function isBridgeFixtureUrl(url: string) {
  return url.trim().toLowerCase() === BRIDGE_FIXTURE_URL;
}

export function resolveBrowserSource(url: string): BrowserSource {
  if (isBridgeFixtureUrl(url)) {
    return {
      html: buildBridgeFixtureHtml(),
      baseUrl: BRIDGE_FIXTURE_BASE_URL,
    };
  }

  return {
    uri: normalizeBrowserUrl(url),
  };
}
