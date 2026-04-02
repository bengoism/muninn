import {
  BROWSER_BRIDGE_CHANNEL,
  BROWSER_BRIDGE_VERSION,
} from './protocol';

const TELEMETRY_HANDLER_NAME = 'muninnBrowserHostTelemetry';

export function buildBridgeBootstrapScript() {
  return `
(function () {
  const CHANNEL = ${JSON.stringify(BROWSER_BRIDGE_CHANNEL)};
  const VERSION = ${JSON.stringify(BROWSER_BRIDGE_VERSION)};
  const HANDLER_NAME = ${JSON.stringify(TELEMETRY_HANDLER_NAME)};
  const FRAME_KEY = '__MUNINN_FRAME_ID__';

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

  function safeString(value) {
    return typeof value === 'string' ? value : null;
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

  function emitPageEvent(event, detail) {
    post('page_event', {
      event: event,
      detail: normalizeDetail(detail),
    });
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
  const HANDLER_NAME = ${JSON.stringify(TELEMETRY_HANDLER_NAME)};

  if (
    !window.webkit ||
    !window.webkit.messageHandlers ||
    !window.webkit.messageHandlers[HANDLER_NAME] ||
    typeof window.webkit.messageHandlers[HANDLER_NAME].postMessage !== 'function'
  ) {
    return true;
  }

  function isTopFrame() {
    try {
      return window.top === window.self;
    } catch (error) {
      return false;
    }
  }

  const message = {
    channel: ${JSON.stringify(BROWSER_BRIDGE_CHANNEL)},
    kind: 'page_event',
    timestamp: new Date().toISOString(),
    frame: {
      frameId: 'post-content-' + Date.now().toString(36),
      url: String(window.location.href),
      title: document.title || null,
      isTopFrame: isTopFrame(),
      readyState: document.readyState || null,
    },
    payload: {
      event: 'post_content_injected',
      detail: {
        title: document.title || null,
        url: window.location.href,
      },
    },
  };

  window.webkit.messageHandlers[HANDLER_NAME].postMessage(JSON.stringify(message));
  return true;
})();
`;
}
