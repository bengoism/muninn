import {
  BROWSER_BRIDGE_CHANNEL,
  BROWSER_BRIDGE_VERSION,
} from './protocol';

const TELEMETRY_HANDLER_NAME = 'muninnBrowserHostTelemetry';
const OBSERVATION_RUNTIME_KEY = '__MUNINN_OBSERVATION__';

export function buildBridgeBootstrapScript() {
  return `
(function () {
  const CHANNEL = ${JSON.stringify(BROWSER_BRIDGE_CHANNEL)};
  const VERSION = ${JSON.stringify(BROWSER_BRIDGE_VERSION)};
  const HANDLER_NAME = ${JSON.stringify(TELEMETRY_HANDLER_NAME)};
  const FRAME_KEY = '__MUNINN_FRAME_ID__';
  const NODE_ID_ATTR = 'data-ai-internal-id';
  const OBSERVATION_KEY = ${JSON.stringify(OBSERVATION_RUNTIME_KEY)};
  const FRAME_READY_MESSAGE_TYPE = 'muninn:frame-ready';
  const AX_SNAPSHOT_REQUEST_TYPE = 'muninn:collect-ax-snapshot';
  const REDACTION_PATTERN =
    /(pass(word)?|pwd|otp|verification|2fa|email|e-mail|phone|tel|mobile|address|street|zip|postal|city|state|card|credit|debit|cc-|cvc|cvv|security code|iban|routing|account|ssn|social security|birth|dob|name)/i;
  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'summary',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="combobox"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch (error) {
      return false;
    }
  }

  function getFrameId() {
    if (!window[FRAME_KEY]) {
      const prefix = isTopFrame() ? 'main' : 'frame';
      window[FRAME_KEY] =
        prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    return window[FRAME_KEY];
  }

  function normalizeString(value) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function round(value) {
    if (typeof value !== 'number' || !isFinite(value)) {
      return 0;
    }

    return Math.round(value * 100) / 100;
  }

  function normalizeDetail(detail) {
    if (detail === undefined || detail === null) {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(detail));
    } catch (error) {
      return {
        type: 'string',
        value: String(detail),
      };
    }
  }

  function serializeError(error, source, fallbackMessage) {
    const resolvedMessage =
      error && typeof error === 'object' && typeof error.message === 'string'
        ? error.message
        : fallbackMessage;

    return {
      source: source,
      name:
        error && typeof error === 'object' && typeof error.name === 'string'
          ? error.name
          : 'Error',
      message: resolvedMessage || 'Unknown telemetry error.',
      stack:
        error && typeof error === 'object' && typeof error.stack === 'string'
          ? error.stack
          : null,
    };
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function getFrame() {
    return {
      frameId: getFrameId(),
      url: String(window.location.href),
      title: typeof document.title === 'string' && document.title.length > 0 ? document.title : null,
      isTopFrame: isTopFrame(),
      readyState: typeof document.readyState === 'string' ? document.readyState : null,
    };
  }

  function post(kind, payload) {
    if (
      !window.webkit ||
      !window.webkit.messageHandlers ||
      !window.webkit.messageHandlers[HANDLER_NAME] ||
      typeof window.webkit.messageHandlers[HANDLER_NAME].postMessage !== 'function'
    ) {
      return;
    }

    window.webkit.messageHandlers[HANDLER_NAME].postMessage(
      JSON.stringify({
        channel: CHANNEL,
        kind: kind,
        timestamp: new Date().toISOString(),
        frame: getFrame(),
        payload: payload,
      })
    );
  }

  const existingRuntime =
    window[OBSERVATION_KEY] && typeof window[OBSERVATION_KEY] === 'object'
      ? window[OBSERVATION_KEY]
      : null;
  const runtime = existingRuntime || {};

  runtime.pendingRequestCount =
    typeof runtime.pendingRequestCount === 'number' && isFinite(runtime.pendingRequestCount)
      ? runtime.pendingRequestCount
      : 0;
  runtime.lastActivityAt =
    typeof runtime.lastActivityAt === 'string' ? runtime.lastActivityAt : nowIso();
  runtime.nodeSequence =
    typeof runtime.nodeSequence === 'number' && isFinite(runtime.nodeSequence)
      ? runtime.nodeSequence
      : 0;

  function emitObservationState(reason) {
    post('observation_state', {
      pendingRequestCount: runtime.pendingRequestCount,
      lastActivityAt: runtime.lastActivityAt,
      reason: reason,
    });
  }

  function markActivity(reason) {
    runtime.lastActivityAt = nowIso();
    emitObservationState(reason);
  }

  function incrementPending(reason) {
    runtime.pendingRequestCount += 1;
    markActivity(reason);
  }

  function decrementPending(reason) {
    runtime.pendingRequestCount = Math.max(0, runtime.pendingRequestCount - 1);
    markActivity(reason);
  }

  function emitPageEvent(event, detail) {
    post('page_event', {
      event: event,
      detail: normalizeDetail(detail),
    });
  }

  function getComputedStyleSafe(element) {
    try {
      return window.getComputedStyle(element);
    } catch (error) {
      return null;
    }
  }

  function isElementHidden(element, rect, style) {
    if (!style) {
      return true;
    }

    if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    if (style.display === 'none' || style.visibility === 'hidden') {
      return true;
    }

    if (rect.width <= 0 || rect.height <= 0) {
      return true;
    }

    return false;
  }

  function isElementVisible(element, rect, style) {
    if (isElementHidden(element, rect, style)) {
      return false;
    }

    if (
      rect.bottom < 0 ||
      rect.right < 0 ||
      rect.top > window.innerHeight ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    return true;
  }

  function getAssociatedLabelText(element) {
    if (!('labels' in element) || !element.labels) {
      return null;
    }

    const labels = [];

    for (let index = 0; index < element.labels.length; index += 1) {
      const label = element.labels.item(index);

      if (label) {
        const text = normalizeString(label.innerText || label.textContent || '');

        if (text) {
          labels.push(text);
        }
      }
    }

    return labels.length > 0 ? labels.join(' ') : null;
  }

  function getAriaLabelledByText(element) {
    const labelledBy = normalizeString(element.getAttribute('aria-labelledby'));

    if (!labelledBy) {
      return null;
    }

    const labels = labelledBy
      .split(/\\s+/)
      .map(function (id) {
        const label = document.getElementById(id);
        return label ? normalizeString(label.innerText || label.textContent || '') : null;
      })
      .filter(Boolean);

    return labels.length > 0 ? labels.join(' ') : null;
  }

  function getElementText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeString(element.value);
    }

    return normalizeString(
      typeof element.innerText === 'string' ? element.innerText : element.textContent || ''
    );
  }

  function isEditableElement(element) {
    return (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === ''
    );
  }

  function getElementRole(element) {
    const explicitRole = normalizeString(element.getAttribute('role'));

    if (explicitRole) {
      return explicitRole;
    }

    const tagName = element.tagName.toLowerCase();

    if (tagName === 'a' && element.getAttribute('href')) {
      return 'link';
    }

    if (tagName === 'button' || tagName === 'summary') {
      return 'button';
    }

    if (tagName === 'textarea') {
      return 'textbox';
    }

    if (tagName === 'select') {
      return 'combobox';
    }

    if (tagName === 'iframe' || tagName === 'frame') {
      return 'document';
    }

    if (tagName === 'input') {
      const type = normalizeString(element.getAttribute('type')) || 'text';

      if (type === 'checkbox' || type === 'radio') {
        return type;
      }

      if (type === 'search') {
        return 'searchbox';
      }

      return 'textbox';
    }

    if (element.getAttribute('contenteditable') === 'true') {
      return 'textbox';
    }

    return 'generic';
  }

  function getElementLabelCandidates(element) {
    return [
      normalizeString(element.getAttribute('aria-label')),
      getAriaLabelledByText(element),
      getAssociatedLabelText(element),
      normalizeString(element.getAttribute('alt')),
      normalizeString(element.getAttribute('title')),
      normalizeString(element.getAttribute('placeholder')),
    ].filter(Boolean);
  }

  function getElementLabel(element) {
    const labelCandidates = getElementLabelCandidates(element);

    if (labelCandidates.length > 0) {
      return labelCandidates.join(' ');
    }

    return isEditableElement(element) ? null : getElementText(element);
  }

  function getElementPlaceholder(element) {
    return normalizeString(element.getAttribute('placeholder'));
  }

  function getElementValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return normalizeString(element.value);
    }

    if (element instanceof HTMLSelectElement) {
      return normalizeString(element.value);
    }

    if (element.getAttribute('contenteditable') === 'true') {
      return getElementText(element);
    }

    return null;
  }

  function getRedactionReason(element, rawValue) {
    if (!rawValue) {
      return null;
    }

    const type = normalizeString(element.getAttribute('type'));

    if (type === 'password') {
      return 'password';
    }

    const fingerprint = [
      normalizeString(element.getAttribute('name')),
      normalizeString(element.getAttribute('id')),
      normalizeString(element.getAttribute('autocomplete')),
      normalizeString(element.getAttribute('inputmode')),
      type,
      ...getElementLabelCandidates(element),
    ]
      .filter(Boolean)
      .join(' ');

    return REDACTION_PATTERN.test(fingerprint) ? 'pii' : null;
  }

  function ensureNodeId(element) {
    const existingId = normalizeString(element.getAttribute(NODE_ID_ATTR));

    if (existingId) {
      return existingId;
    }

    runtime.nodeSequence += 1;
    const nodeId = 'ai-' + getFrameId() + '-' + runtime.nodeSequence.toString(36);
    element.setAttribute(NODE_ID_ATTR, nodeId);
    return nodeId;
  }

  function toBounds(rect) {
    return {
      x: round(rect.left),
      y: round(rect.top),
      width: round(rect.width),
      height: round(rect.height),
    };
  }

  function isInteractiveElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return element.matches(INTERACTIVE_SELECTOR);
  }

  function collectInteractiveElements(root, bucket, seen) {
    if (!root || !root.children) {
      return;
    }

    for (let index = 0; index < root.children.length; index += 1) {
      const child = root.children.item(index);

      if (!child || seen.has(child)) {
        continue;
      }

      seen.add(child);

      if (isInteractiveElement(child)) {
        bucket.push(child);
      }

      if (child.shadowRoot && child.shadowRoot.mode === 'open') {
        collectInteractiveElements(child.shadowRoot, bucket, seen);
      }

      collectInteractiveElements(child, bucket, seen);
    }
  }

  function serializeNode(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyleSafe(element);
    const rawValue = getElementValue(element);
    const redactionReason = getRedactionReason(element, rawValue);
    const label = getElementLabel(element);
    const text = getElementText(element);

    return {
      id: ensureNodeId(element),
      role: getElementRole(element),
      label: label,
      value: redactionReason ? null : rawValue,
      text: redactionReason ? null : text,
      placeholder: getElementPlaceholder(element),
      bounds: toBounds(rect),
      isVisible: isElementVisible(element, rect, style),
      isHidden: isElementHidden(element, rect, style),
      isEnabled:
        typeof element.disabled === 'boolean'
          ? !element.disabled
          : element.getAttribute('aria-disabled') !== 'true',
      frameId: getFrameId(),
      frameUrl: String(window.location.href),
      valueRedacted: redactionReason !== null,
      redactionReason: redactionReason,
    };
  }

  function findIframeForWindow(targetWindow) {
    const frames = document.querySelectorAll('iframe, frame');

    for (let index = 0; index < frames.length; index += 1) {
      const frameElement = frames.item(index);

      if (frameElement && frameElement.contentWindow === targetWindow) {
        return frameElement;
      }
    }

    return null;
  }

  function emitFrameLink(childFrameId, iframeElement) {
    if (!childFrameId || !iframeElement) {
      return;
    }

    const rect = iframeElement.getBoundingClientRect();
    const style = getComputedStyleSafe(iframeElement);

    post('frame_link', {
      childFrameId: childFrameId,
      parentFrameId: getFrameId(),
      bounds: toBounds(rect),
      isVisible: isElementVisible(iframeElement, rect, style),
    });
  }

  function postFrameReady() {
    if (isTopFrame()) {
      return;
    }

    try {
      window.parent.postMessage(
        {
          type: FRAME_READY_MESSAGE_TYPE,
          frameId: getFrameId(),
          url: String(window.location.href),
        },
        '*'
      );
    } catch (error) {
      post('script_error', serializeError(error, 'bridge', 'Unable to announce frame readiness.'));
    }
  }

  function collectAxSnapshotPayload() {
    const nodes = [];
    const seen = new Set();
    collectInteractiveElements(document.documentElement, nodes, seen);
    return nodes.map(serializeNode);
  }

  function sendAxSnapshot(requestId) {
    try {
      post('ax_snapshot', {
        requestId: requestId,
        nodes: collectAxSnapshotPayload(),
        observedAt: nowIso(),
      });
    } catch (error) {
      post('ax_snapshot_error', {
        requestId: requestId,
        message:
          error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message
            : 'AX snapshot generation failed.',
      });
    }
  }

  function rebroadcastAxSnapshotRequest(requestId) {
    const frames = document.querySelectorAll('iframe, frame');

    for (let index = 0; index < frames.length; index += 1) {
      const frameElement = frames.item(index);

      try {
        if (frameElement && frameElement.contentWindow) {
          frameElement.contentWindow.postMessage(
            {
              type: AX_SNAPSHOT_REQUEST_TYPE,
              requestId: requestId,
            },
            '*'
          );
        }
      } catch (error) {
        post(
          'script_error',
          serializeError(error, 'bridge', 'Unable to rebroadcast AX snapshot request.')
        );
      }
    }
  }

  runtime.requestAxSnapshot = function requestAxSnapshot(requestId) {
    markActivity('ax-snapshot-requested');
    postFrameReady();
    sendAxSnapshot(requestId);
    rebroadcastAxSnapshotRequest(requestId);

    return {
      dispatchedAt: nowIso(),
      dispatchedFrameCount: document.querySelectorAll('iframe, frame').length,
      frameId: getFrameId(),
      requestId: requestId,
    };
  };

  runtime.collectAxSnapshot = collectAxSnapshotPayload;
  runtime.markActivity = markActivity;
  window[OBSERVATION_KEY] = runtime;

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__muninnWrapped) {
      return;
    }

    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = function () {
      incrementPending('fetch-start');

      return originalFetch.apply(this, arguments).then(
        function (response) {
          decrementPending('fetch-end');
          return response;
        },
        function (error) {
          decrementPending('fetch-error');
          throw error;
        }
      );
    };

    wrappedFetch.__muninnWrapped = true;
    window.fetch = wrappedFetch;
  }

  function patchXmlHttpRequest() {
    if (!window.XMLHttpRequest || window.XMLHttpRequest.prototype.__muninnWrapped) {
      return;
    }

    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.send = function () {
      const request = this;
      let completed = false;
      incrementPending('xhr-start');

      const complete = function () {
        if (completed) {
          return;
        }

        completed = true;
        request.removeEventListener('loadend', complete);
        request.removeEventListener('error', complete);
        request.removeEventListener('abort', complete);
        request.removeEventListener('timeout', complete);
        decrementPending('xhr-end');
      };

      request.addEventListener('loadend', complete);
      request.addEventListener('error', complete);
      request.addEventListener('abort', complete);
      request.addEventListener('timeout', complete);

      try {
        return originalSend.apply(request, arguments);
      } catch (error) {
        complete();
        throw error;
      }
    };

    window.XMLHttpRequest.prototype.__muninnWrapped = true;
  }

  function patchSendBeacon() {
    if (!navigator.sendBeacon || navigator.sendBeacon.__muninnWrapped) {
      return;
    }

    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    const wrappedSendBeacon = function () {
      markActivity('sendBeacon');
      return originalSendBeacon.apply(this, arguments);
    };

    wrappedSendBeacon.__muninnWrapped = true;
    navigator.sendBeacon = wrappedSendBeacon;
  }

  function patchHistory() {
    if (!window.history || window.history.__muninnWrapped) {
      return;
    }

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function () {
      const response = originalPushState.apply(this, arguments);
      markActivity('pushState');
      return response;
    };

    window.history.replaceState = function () {
      const response = originalReplaceState.apply(this, arguments);
      markActivity('replaceState');
      return response;
    };

    window.history.__muninnWrapped = true;
  }

  window.addEventListener('error', function (event) {
    post(
      'script_error',
      serializeError(event.error, 'window_error', event.message || 'Unhandled window error.')
    );
  });

  window.addEventListener('unhandledrejection', function (event) {
    post(
      'script_error',
      serializeError(
        event.reason,
        'unhandledrejection',
        'Unhandled promise rejection.'
      )
    );
  });

  window.addEventListener('message', function (event) {
    const data = event.data;

    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === FRAME_READY_MESSAGE_TYPE && typeof data.frameId === 'string') {
      const iframeElement = findIframeForWindow(event.source);

      if (iframeElement) {
        emitFrameLink(data.frameId, iframeElement);
      }

      return;
    }

    if (data.type === AX_SNAPSHOT_REQUEST_TYPE && typeof data.requestId === 'string') {
      runtime.requestAxSnapshot(data.requestId);
    }
  });

  document.addEventListener('readystatechange', function () {
    markActivity('ready_state');
    emitPageEvent('ready_state', {
      readyState: document.readyState,
    });
  });

  window.addEventListener('load', function () {
    markActivity('load');
    postFrameReady();
    emitPageEvent('load', {
      title: document.title || null,
      url: window.location.href,
    });
  });

  window.addEventListener('pageshow', function () {
    markActivity('pageshow');
    emitPageEvent('pageshow', {
      url: window.location.href,
    });
  });

  window.addEventListener('hashchange', function () {
    markActivity('hashchange');
    emitPageEvent('hashchange', {
      url: window.location.href,
    });
  });

  window.addEventListener('popstate', function () {
    markActivity('popstate');
    emitPageEvent('popstate', {
      url: window.location.href,
    });
  });

  patchFetch();
  patchXmlHttpRequest();
  patchSendBeacon();
  patchHistory();
  postFrameReady();
  emitObservationState(existingRuntime ? 'runtime-reused' : 'bootstrap');
  emitPageEvent('bootstrap', {
    title: document.title || null,
    url: window.location.href,
  });

  post('bridge_ready', {
    bridgeVersion: VERSION,
    readyState: document.readyState,
    reused: Boolean(existingRuntime),
    userAgent: navigator.userAgent,
  });

  return true;
})();
`;
}

export function buildBridgeAfterContentScript() {
  return `
(function () {
  const runtime = window[${JSON.stringify(OBSERVATION_RUNTIME_KEY)}];

  if (!runtime || typeof runtime.markActivity !== 'function') {
    return true;
  }

  runtime.markActivity('post-content');
  if (typeof runtime.requestAxSnapshot === 'function') {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'muninn:frame-ready',
            frameId:
              window.__MUNINN_FRAME_ID__ ||
              'frame-' + Date.now().toString(36),
            url: String(window.location.href),
          },
          '*'
        );
      }
    } catch (error) {}
  }
  return true;
})();
`;
}
