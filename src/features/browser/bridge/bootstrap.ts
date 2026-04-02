import {
  BROWSER_BRIDGE_CHANNEL,
  BROWSER_BRIDGE_VERSION,
} from './protocol';

const BRIDGE_GLOBAL_KEY = '__MUNINN_BRIDGE__';

export function buildBridgeBootstrapScript() {
  return `
(function () {
  const CHANNEL = ${JSON.stringify(BROWSER_BRIDGE_CHANNEL)};
  const VERSION = ${JSON.stringify(BROWSER_BRIDGE_VERSION)};
  const BRIDGE_KEY = ${JSON.stringify(BRIDGE_GLOBAL_KEY)};
  const FRAME_KEY = '__MUNINN_FRAME_ID__';

  function getFrameId() {
    if (!window[FRAME_KEY]) {
      const prefix = isTopFrame() ? 'main' : 'frame';
      window[FRAME_KEY] =
        prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    return window[FRAME_KEY];
  }

  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch (error) {
      return false;
    }
  }

  function safeString(value) {
    return typeof value === 'string' ? value : null;
  }

  function serializeValue(value) {
    if (value === undefined) {
      return { type: 'undefined' };
    }

    if (value === null) {
      return null;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (value instanceof Error) {
      return {
        type: 'error',
        name: value.name,
        message: value.message,
        stack: safeString(value.stack),
      };
    }

    if (typeof value === 'function') {
      return {
        type: 'function',
        name: safeString(value.name),
      };
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return {
        type: 'string',
        value: String(value),
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
      message: resolvedMessage || 'Unknown bridge error.',
      stack:
        error && typeof error === 'object' && typeof error.stack === 'string'
          ? error.stack
          : null,
    };
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

  function post(kind, payload) {
    if (
      !window.ReactNativeWebView ||
      typeof window.ReactNativeWebView.postMessage !== 'function'
    ) {
      return;
    }

    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        channel: CHANNEL,
        kind: kind,
        timestamp: new Date().toISOString(),
        frame: getFrame(),
        payload: payload,
      })
    );
  }

  function emitPageEvent(event, detail) {
    post('page_event', {
      event: event,
      detail: normalizeDetail(detail),
    });
  }

  const existingBridge = window[BRIDGE_KEY];

  if (existingBridge && existingBridge.version === VERSION) {
    emitPageEvent('bridge_reused', {
      url: window.location.href,
    });

    post('bridge_ready', {
      bridgeVersion: VERSION,
      readyState: document.readyState,
      reused: true,
      userAgent: navigator.userAgent,
    });

    return true;
  }

  const bridge = {
    version: VERSION,
    emitPageEvent: emitPageEvent,
    runEval: function (requestId, source) {
      Promise.resolve()
        .then(function () {
          return (0, eval)(source);
        })
        .then(function (value) {
          post('eval_result', {
            requestId: requestId,
            value: serializeValue(value),
          });
        })
        .catch(function (error) {
          post('eval_error', {
            requestId: requestId,
            code: 'execution_error',
            message:
              error && typeof error === 'object' && typeof error.message === 'string'
                ? error.message
                : 'JavaScript evaluation failed.',
            details: serializeError(error, 'bridge', 'JavaScript evaluation failed.'),
          });
        });
    },
  };

  window[BRIDGE_KEY] = bridge;

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

  document.addEventListener('readystatechange', function () {
    emitPageEvent('ready_state', {
      readyState: document.readyState,
    });
  });

  window.addEventListener('load', function () {
    emitPageEvent('load', {
      title: document.title || null,
      url: window.location.href,
    });
  });

  window.addEventListener('pageshow', function () {
    emitPageEvent('pageshow', {
      url: window.location.href,
    });
  });

  window.addEventListener('hashchange', function () {
    emitPageEvent('hashchange', {
      url: window.location.href,
    });
  });

  window.addEventListener('popstate', function () {
    emitPageEvent('popstate', {
      url: window.location.href,
    });
  });

  emitPageEvent('bootstrap', {
    title: document.title || null,
    url: window.location.href,
  });

  post('bridge_ready', {
    bridgeVersion: VERSION,
    readyState: document.readyState,
    reused: false,
    userAgent: navigator.userAgent,
  });

  return true;
})();
`;
}

export function buildBridgeAfterContentScript() {
  return `
(function () {
  const bridge = window[${JSON.stringify(BRIDGE_GLOBAL_KEY)}];

  if (bridge && typeof bridge.emitPageEvent === 'function') {
    bridge.emitPageEvent('post_content_injected', {
      title: document.title || null,
      url: window.location.href,
    });
  }

  return true;
})();
`;
}

export function buildBridgeEvaluationScript(requestId: string, source: string) {
  return `
(function () {
  const bridge = window[${JSON.stringify(BRIDGE_GLOBAL_KEY)}];

  if (!bridge || typeof bridge.runEval !== 'function') {
    if (
      window.ReactNativeWebView &&
      typeof window.ReactNativeWebView.postMessage === 'function'
    ) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          channel: ${JSON.stringify(BROWSER_BRIDGE_CHANNEL)},
          kind: 'eval_error',
          timestamp: new Date().toISOString(),
          frame: {
            frameId: 'bridge-unavailable',
            url: String(window.location.href),
            title: document.title || null,
            isTopFrame: true,
            readyState: document.readyState || null,
          },
          payload: {
            requestId: ${JSON.stringify(requestId)},
            code: 'bridge_unavailable',
            message: 'Muninn bridge is not ready on the page.',
            details: null,
          },
        })
      );
    }

    return true;
  }

  bridge.runEval(${JSON.stringify(requestId)}, ${JSON.stringify(source)});
  return true;
})();
`;
}
