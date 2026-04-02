import type {
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserEvaluationErrorPayload,
  BrowserEvaluationErrorType,
  BrowserEvaluationResultPayload,
  BrowserFrameMetadata,
  BrowserPageEventPayload,
  BrowserScriptErrorPayload,
} from '../types';

export const BROWSER_BRIDGE_CHANNEL = 'muninn-browser-bridge';
export const BROWSER_BRIDGE_VERSION = '1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function parseFrame(value: unknown): BrowserFrameMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isString(value.frameId) ||
    !isString(value.url) ||
    !isBoolean(value.isTopFrame)
  ) {
    return null;
  }

  return {
    frameId: value.frameId,
    url: value.url,
    title: isString(value.title) ? value.title : null,
    isTopFrame: value.isTopFrame,
    readyState: isString(value.readyState) ? value.readyState : null,
  };
}

function isPageEventPayload(value: unknown): value is BrowserPageEventPayload {
  return (
    isRecord(value) &&
    isString(value.event) &&
    (value.detail === null || value.detail === undefined || isRecord(value.detail))
  );
}

function isScriptErrorPayload(value: unknown): value is BrowserScriptErrorPayload {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isString(value.name) &&
    isString(value.message) &&
    (value.stack === null || value.stack === undefined || isString(value.stack))
  );
}

function isEvaluationResultPayload(
  value: unknown
): value is BrowserEvaluationResultPayload {
  return isRecord(value) && isString(value.requestId) && 'value' in value;
}

function isEvaluationErrorType(
  value: unknown
): value is BrowserEvaluationErrorType {
  return (
    value === 'native_unavailable' ||
    value === 'timeout' ||
    value === 'execution_error' ||
    value === 'serialization_error' ||
    value === 'navigation_changed' ||
    value === 'protocol_error'
  );
}

function isEvaluationErrorPayload(
  value: unknown
): value is BrowserEvaluationErrorPayload {
  return (
    isRecord(value) &&
    isString(value.requestId) &&
    isEvaluationErrorType(value.code) &&
    isString(value.message) &&
    'details' in value
  );
}

function createParseError(
  message: string,
  raw: string
): BrowserBridgeParseError {
  return {
    type: 'protocol_error',
    message,
    raw,
  };
}

export function parseBrowserBridgeMessage(
  raw: string
): BrowserBridgeMessage | BrowserBridgeParseError | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.channel !== BROWSER_BRIDGE_CHANNEL) {
    return null;
  }

  if (!isString(parsed.kind) || !isString(parsed.timestamp)) {
    return createParseError('Browser bridge message is missing envelope fields.', raw);
  }

  const frame = parseFrame(parsed.frame);

  if (!frame) {
    return createParseError('Browser bridge message is missing frame metadata.', raw);
  }

  if (parsed.kind === 'bridge_ready') {
    if (
      !isRecord(parsed.payload) ||
      !isString(parsed.payload.bridgeVersion) ||
      !isBoolean(parsed.payload.reused) ||
      !isString(parsed.payload.userAgent)
    ) {
      return createParseError('Bridge ready payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'bridge_ready',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        bridgeVersion: parsed.payload.bridgeVersion,
        readyState: isString(parsed.payload.readyState)
          ? parsed.payload.readyState
          : null,
        reused: parsed.payload.reused,
        userAgent: parsed.payload.userAgent,
      },
    };
  }

  if (parsed.kind === 'page_event') {
    if (!isPageEventPayload(parsed.payload)) {
      return createParseError('Page event payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'page_event',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        event: parsed.payload.event,
        detail: isRecord(parsed.payload.detail) ? parsed.payload.detail : null,
      },
    };
  }

  if (parsed.kind === 'script_error') {
    if (!isScriptErrorPayload(parsed.payload)) {
      return createParseError('Script error payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'script_error',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        source: parsed.payload.source,
        name: parsed.payload.name,
        message: parsed.payload.message,
        stack: isString(parsed.payload.stack) ? parsed.payload.stack : null,
      },
    };
  }

  if (parsed.kind === 'eval_result') {
    if (!isEvaluationResultPayload(parsed.payload)) {
      return createParseError('Evaluation result payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'eval_result',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        requestId: parsed.payload.requestId,
        value: parsed.payload.value,
      },
    };
  }

  if (parsed.kind === 'eval_error') {
    if (!isEvaluationErrorPayload(parsed.payload)) {
      return createParseError('Evaluation error payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'eval_error',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        requestId: parsed.payload.requestId,
        code: parsed.payload.code,
        message: parsed.payload.message,
        details: parsed.payload.details,
      },
    };
  }

  return createParseError(`Unsupported browser bridge message kind "${parsed.kind}".`, raw);
}
