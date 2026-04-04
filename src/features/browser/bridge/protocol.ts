import type {
  BrowserAxSnapshotErrorPayload,
  BrowserAxSnapshotNodePayload,
  BrowserAxSnapshotPayload,
  BrowserBridgeMessage,
  BrowserBridgeParseError,
  BrowserEvaluationErrorPayload,
  BrowserEvaluationErrorType,
  BrowserEvaluationResultPayload,
  BrowserFrameLinkPayload,
  BrowserFrameMetadata,
  BrowserObservationStatePayload,
  BrowserPageEventPayload,
  BrowserScriptErrorPayload,
} from '../types';

export const BROWSER_BRIDGE_CHANNEL = 'muninn-browser-bridge';
export const BROWSER_BRIDGE_VERSION = '2';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseBounds(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isNumber(value.x) ||
    !isNumber(value.y) ||
    !isNumber(value.width) ||
    !isNumber(value.height)
  ) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
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

function isObservationStatePayload(
  value: unknown
): value is BrowserObservationStatePayload {
  return (
    isRecord(value) &&
    isNumber(value.pendingRequestCount) &&
    isString(value.lastActivityAt) &&
    isString(value.reason)
  );
}

function isFrameLinkPayload(value: unknown): value is BrowserFrameLinkPayload {
  return (
    isRecord(value) &&
    isString(value.childFrameId) &&
    isString(value.parentFrameId) &&
    isBoolean(value.isVisible) &&
    parseBounds(value.bounds) !== null
  );
}

function isAxSnapshotNodePayload(
  value: unknown
): value is BrowserAxSnapshotNodePayload {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.role) &&
    (value.label === null || value.label === undefined || isString(value.label)) &&
    (value.value === null || value.value === undefined || isString(value.value)) &&
    (value.text === null || value.text === undefined || isString(value.text)) &&
    (value.placeholder === null ||
      value.placeholder === undefined ||
      isString(value.placeholder)) &&
    parseBounds(value.bounds) !== null &&
    isBoolean(value.isVisible) &&
    isBoolean(value.isHidden) &&
    isBoolean(value.isEnabled) &&
    (value.frameId === null || value.frameId === undefined || isString(value.frameId)) &&
    (value.frameUrl === null || value.frameUrl === undefined || isString(value.frameUrl)) &&
    isBoolean(value.valueRedacted) &&
    (value.redactionReason === null ||
      value.redactionReason === undefined ||
      isString(value.redactionReason))
  );
}

function isAxSnapshotPayload(value: unknown): value is BrowserAxSnapshotPayload {
  return (
    isRecord(value) &&
    isString(value.requestId) &&
    isString(value.observedAt) &&
    isArray(value.nodes) &&
    value.nodes.every((node) => isAxSnapshotNodePayload(node))
  );
}

function isAxSnapshotErrorPayload(
  value: unknown
): value is BrowserAxSnapshotErrorPayload {
  return isRecord(value) && isString(value.requestId) && isString(value.message);
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

  if (parsed.kind === 'observation_state') {
    if (!isObservationStatePayload(parsed.payload)) {
      return createParseError('Observation state payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'observation_state',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        lastActivityAt: parsed.payload.lastActivityAt,
        pendingRequestCount: parsed.payload.pendingRequestCount,
        reason: parsed.payload.reason,
      },
    };
  }

  if (parsed.kind === 'frame_link') {
    if (!isFrameLinkPayload(parsed.payload)) {
      return createParseError('Frame link payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'frame_link',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        childFrameId: parsed.payload.childFrameId,
        parentFrameId: parsed.payload.parentFrameId,
        bounds: parseBounds(parsed.payload.bounds) ?? {
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        },
        isVisible: parsed.payload.isVisible,
      },
    };
  }

  if (parsed.kind === 'ax_snapshot') {
    if (!isAxSnapshotPayload(parsed.payload)) {
      return createParseError('AX snapshot payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'ax_snapshot',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        requestId: parsed.payload.requestId,
        treeText: isString(parsed.payload.treeText) ? parsed.payload.treeText : '',
        observedAt: parsed.payload.observedAt,
        nodes: parsed.payload.nodes.map((node) => ({
          id: node.id,
          role: node.role,
          label: isString(node.label) ? node.label : null,
          value: isString(node.value) ? node.value : null,
          text: isString(node.text) ? node.text : null,
          placeholder: isString(node.placeholder) ? node.placeholder : null,
          bounds: parseBounds(node.bounds) ?? {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
          },
          isVisible: node.isVisible,
          isHidden: node.isHidden,
          isEnabled: node.isEnabled,
          frameId: isString(node.frameId) ? node.frameId : null,
          frameUrl: isString(node.frameUrl) ? node.frameUrl : null,
          valueRedacted: node.valueRedacted,
          redactionReason: isString(node.redactionReason)
            ? node.redactionReason
            : null,
        })),
      },
    };
  }

  if (parsed.kind === 'ax_snapshot_error') {
    if (!isAxSnapshotErrorPayload(parsed.payload)) {
      return createParseError('AX snapshot error payload is malformed.', raw);
    }

    return {
      channel: BROWSER_BRIDGE_CHANNEL,
      kind: 'ax_snapshot_error',
      timestamp: parsed.timestamp,
      frame,
      payload: {
        requestId: parsed.payload.requestId,
        message: parsed.payload.message,
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
