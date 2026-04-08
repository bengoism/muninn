import type { ToolName } from '../../../types/agent';
import type { BrowserWebViewHandle } from '../components/BrowserWebView';
import { ACTIONS_INJECTION_SCRIPT } from './actions';
import { TOOL_REGISTRY, validateToolParams } from './registry';
import type {
  TargetReferenceState,
  ToolExecutionDebug,
  ToolResult,
} from './types';

function escapeJS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export async function ensureActionsInjected(
  browser: BrowserWebViewHandle
): Promise<void> {
  const check = await browser.evaluateJavaScript<string>(
    'typeof window.__MUNINN_ACTIONS__'
  );
  if (check.ok && check.value === 'object') return;
  await browser.evaluateJavaScript(ACTIONS_INJECTION_SCRIPT);
}

async function setDebugOptions(
  browser: BrowserWebViewHandle,
  captureRaw: boolean
): Promise<void> {
  await browser.evaluateJavaScript(
    `window.__MUNINN_ACTIONS__.setDebugOptions({ captureRaw: ${
      captureRaw ? 'true' : 'false'
    } })`
  );
}

async function classifyTargetReference(
  browser: BrowserWebViewHandle,
  elementId: string
): Promise<TargetReferenceState | null> {
  const result = await browser.evaluateJavaScript<TargetReferenceState>(
    `(() => {
      var refMap = window.__MUNINN_REF_MAP__ || {};
      if (refMap["${escapeJS(elementId)}"]) {
        return "known_ref";
      }
      if (document.querySelector('[data-ai-internal-id="${escapeJS(elementId)}"]')) {
        return "legacy_dom_id";
      }
      return /^ai-/.test("${escapeJS(elementId)}") ? "stale_ref" : "unknown_ref";
    })()`
  );

  return result.ok ? result.value : null;
}

function mergeDebug(
  debug: ToolExecutionDebug | null | undefined,
  jsCall: string | null,
  action: ToolName,
  params: Record<string, unknown>,
  targetState: TargetReferenceState | null
): ToolExecutionDebug | null {
  if (!debug && !jsCall && targetState === null) {
    return null;
  }

  return {
    jsCall: jsCall ?? debug?.jsCall ?? null,
    matchedElement: debug?.matchedElement ?? null,
    requestedAction: debug?.requestedAction ?? action,
    requestedParams: debug?.requestedParams ?? params,
    resolver: debug?.resolver ?? null,
    targetState: targetState ?? debug?.targetState ?? null,
  };
}

export async function probeLocator(
  browser: BrowserWebViewHandle,
  elementId: string,
  captureRaw = false,
) {
  await ensureActionsInjected(browser);
  await setDebugOptions(browser, captureRaw);

  const result = await browser.evaluateJavaScript<{
    debug?: ToolExecutionDebug | null;
    ok: boolean;
    reason: string | null;
  }>(`window.__MUNINN_ACTIONS__.resolveOnly("${escapeJS(elementId)}")`);

  if (!result.ok) {
    return {
      debug: null,
      ok: false,
      reason: result.message ?? 'Locator probe failed.',
      targetId: elementId,
      timestamp: new Date().toISOString(),
    };
  }

  const actionResult = result.value;
  return {
    debug: mergeDebug(
      actionResult?.debug ?? null,
      null,
      'focus',
      { id: elementId },
      actionResult?.debug?.targetState ?? null,
    ),
    ok: actionResult?.ok ?? false,
    reason:
      actionResult?.ok ?? false
        ? null
        : formatError('focus', { id: elementId }, actionResult?.reason ?? null),
    targetId: elementId,
    timestamp: new Date().toISOString(),
  };
}

export async function executeTool(
  action: ToolName,
  params: Record<string, unknown>,
  browser: BrowserWebViewHandle,
  options?: {
    captureRaw?: boolean;
  },
): Promise<ToolResult> {
  const startedAt = Date.now();

  const validation = validateToolParams(action, params);
  if (!validation.valid) {
    return {
      ok: false,
      action,
      reason: validation.reason,
      durationMs: Date.now() - startedAt,
    };
  }

  const definition = TOOL_REGISTRY[action];

  // Terminal actions don't interact with the browser.
  if (definition.terminal) {
    const reason =
      action === 'finish'
        ? (params.message as string) ?? null
        : (params.reason as string) ?? null;
    return { ok: true, action, reason, durationMs: Date.now() - startedAt };
  }

  // Non-browser actions.
  if (!definition.requiresBrowser) {
    await new Promise((r) => setTimeout(r, 1000));
    return { ok: true, action, reason: null, durationMs: Date.now() - startedAt };
  }

  // go_back uses the native navigation API.
  if (action === 'go_back') {
    browser.goBack();
    return { ok: true, action, reason: null, durationMs: Date.now() - startedAt };
  }

  // Browser actions need injected JS helpers.
  await ensureActionsInjected(browser);
  await setDebugOptions(browser, options?.captureRaw === true);

  let targetState: TargetReferenceState | null = null;

  // Refresh element IDs before acting — re-assigns data-ai-internal-id
  // to elements that may have been re-rendered by React/SPA frameworks.
  if (typeof params.id === 'string') {
    targetState = await classifyTargetReference(browser, params.id);
    await browser.evaluateJavaScript(`
      (function() {
        var refMap = window.__MUNINN_REF_MAP__ || {};
        var entry = refMap["${escapeJS(String(params.id))}"];
        if (!entry) return;
        var existing = document.querySelector('[data-ai-internal-id="' + entry.domId + '"]');
        if (existing) return;
        // Element lost its ID — find it by observation bridge's own logic
        if (window.__MUNINN_OBSERVATION__ && window.__MUNINN_OBSERVATION__.refreshNodeIds) {
          window.__MUNINN_OBSERVATION__.refreshNodeIds();
        }
      })()
    `);
  }

  let jsCall: string;
  switch (action) {
    case 'click':
      jsCall = `window.__MUNINN_ACTIONS__.click("${escapeJS(String(params.id))}")`;
      break;
    case 'tap_coordinates':
      jsCall = `window.__MUNINN_ACTIONS__.tapCoordinates(${Number(params.x)}, ${Number(params.y)})`;
      break;
    case 'type':
      jsCall = `window.__MUNINN_ACTIONS__.type("${escapeJS(String(params.id))}", "${escapeJS(String(params.text))}")`;
      break;
    case 'fill':
      jsCall = `window.__MUNINN_ACTIONS__.fill("${escapeJS(String(params.id))}", "${escapeJS(String(params.text))}")`;
      break;
    case 'select':
      jsCall = `window.__MUNINN_ACTIONS__.select("${escapeJS(String(params.id))}", "${escapeJS(String(params.value))}")`;
      break;
    case 'gettext':
      jsCall = `window.__MUNINN_ACTIONS__.gettext("${escapeJS(String(params.id))}")`;
      break;
    case 'hover':
      jsCall = `window.__MUNINN_ACTIONS__.hover("${escapeJS(String(params.id))}")`;
      break;
    case 'focus':
      jsCall = `window.__MUNINN_ACTIONS__.focus("${escapeJS(String(params.id))}")`;
      break;
    case 'eval': {
      // Direct JS evaluation — no injection needed.
      const evalResult = await browser.evaluateJavaScript<unknown>(String(params.code));
      return {
        ok: evalResult.ok,
        action,
        reason: evalResult.ok ? String(evalResult.value ?? 'undefined') : (evalResult.message ?? 'eval failed'),
        durationMs: Date.now() - startedAt,
      };
    }
    case 'wait':
      jsCall = `window.__MUNINN_ACTIONS__.waitForCondition("${escapeJS(String(params.condition ?? 'idle'))}", ${Number(params.timeout ?? 3000)})`;
      break;
    case 'scroll':
      jsCall = `window.__MUNINN_ACTIONS__.scroll("${escapeJS(String(params.direction))}", "${escapeJS(String(params.amount))}")`;
      break;
    default:
      return {
        ok: false,
        action,
        reason: `No executor for action: ${action}`,
        durationMs: Date.now() - startedAt,
      };
  }

  const result = await browser.evaluateJavaScript<{
    debug?: ToolExecutionDebug | null;
    ok: boolean;
    reason: string | null;
  }>(jsCall);

  if (!result.ok) {
    return {
      ok: false,
      action,
      debug: mergeDebug(null, jsCall, action, params, targetState),
      reason: result.message ?? 'JavaScript evaluation failed',
      durationMs: Date.now() - startedAt,
    };
  }

  const actionResult = result.value;
  const rawReason = actionResult?.reason ?? null;
  const debug = mergeDebug(
    actionResult?.debug ?? null,
    jsCall,
    action,
    params,
    targetState,
  );

  return {
    ok: actionResult?.ok ?? false,
    action,
    debug,
    reason: actionResult?.ok ? rawReason : formatError(action, params, rawReason),
    durationMs: Date.now() - startedAt,
  };
}

function formatError(
  action: ToolName,
  params: Record<string, unknown>,
  rawError: string | null,
): string {
  const msg = rawError ?? 'Unknown error';
  if (msg.includes('Unknown ref')) {
    return `${msg}. The model likely chose an ID that was not present in the latest observation.`;
  }
  if (msg.includes('Element not found')) {
    return `${msg}. The element may have been removed or the page changed. Try re-observing.`;
  }
  if (msg.includes('not a <select>')) {
    return `${msg}. Use click instead for custom dropdowns.`;
  }
  if (msg.includes('No element at')) {
    return `${msg}. Try clicking by ref ID instead of coordinates.`;
  }
  if (msg.includes('No matching option')) {
    return `${msg}. Check the available options and try a different value.`;
  }
  return msg;
}
