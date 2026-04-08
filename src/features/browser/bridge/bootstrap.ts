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

  function limitString(value, maxLength) {
    if (typeof value !== 'string') {
      return null;
    }

    if (value.length <= maxLength) {
      return value;
    }

    return value.slice(0, maxLength) + '...';
  }

  function buildNetworkRequestId(prefix) {
    runtime.networkSequence += 1;
    return prefix + '-' + getFrameId() + '-' + runtime.networkSequence.toString(36);
  }

  function serializeConsoleArg(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }

    if (
      typeof Element !== 'undefined' &&
      value instanceof Element
    ) {
      return {
        type: 'element',
        tagName: value.tagName ? value.tagName.toLowerCase() : null,
        id: normalizeString(value.getAttribute('id')),
        role: normalizeString(value.getAttribute('role')),
        text: limitString(
          normalizeString(value.innerText || value.textContent || ''),
          160
        ),
      };
    }

    if (value instanceof Error) {
      return {
        type: 'error',
        name: value.name || 'Error',
        message: value.message || 'Unknown error.',
        stack: limitString(value.stack || '', 500),
      };
    }

    try {
      return {
        type: Array.isArray(value) ? 'array' : 'object',
        value: limitString(JSON.stringify(value), 400),
      };
    } catch (error) {
      return {
        type: 'string',
        value: limitString(String(value), 400),
      };
    }
  }

  function emitConsoleMessage(level, args) {
    post('console_message', {
      level: level,
      args: args.map(serializeConsoleArg),
    });
  }

  function emitNetworkSummary(summary) {
    post('network_summary', summary);
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
  runtime.networkSequence =
    typeof runtime.networkSequence === 'number' && isFinite(runtime.networkSequence)
      ? runtime.networkSequence
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

      if (isInteractiveElement(child) || isCursorInteractive(child)) {
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

  var LANDMARK_TAGS = {
    NAV: 'navigation', MAIN: 'main', HEADER: 'header', FOOTER: 'footer',
    ASIDE: 'complementary', SECTION: 'region', ARTICLE: 'article',
    FORM: 'form', DIALOG: 'dialog',
  };

  var HEADING_TAGS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

  var SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'PATH', 'CIRCLE',
    'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'ELLIPSE', 'G', 'DEFS', 'USE',
    'CLIPPATH', 'MASK', 'SYMBOL', 'LINEARGRADIENT', 'RADIALGRADIENT',
  ]);

  var NATIVE_INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY',
  ]);

  var TREE_MAX_CHARS = 4000;
  var TREE_TEXT_MAX_CHARS = 120;

  // Short ref system: e1, e2, e3... reset per snapshot.
  // refMap stored on window for executor to resolve.
  var snapshotRefCounter = 0;
  var snapshotRefMap = {};

  function assignShortRef(element) {
    snapshotRefCounter++;
    var shortRef = 'e' + snapshotRefCounter;
    var domId = ensureNodeId(element);
    var role = getElementRole(element);
    var label = getElementLabel(element);

    // Build a CSS selector for fallback lookup.
    var tag = element.tagName.toLowerCase();
    var roleAttr = element.getAttribute('role');
    var selector = roleAttr ? tag + '[role="' + roleAttr + '"]' : tag;

    snapshotRefMap[shortRef] = {
      domId: domId,
      role: role,
      label: label || '',
      selector: selector,
    };

    return shortRef;
  }

  function resetSnapshotRefs() {
    snapshotRefCounter = 0;
    snapshotRefMap = {};
  }

  function isCursorInteractive(element) {
    if (NATIVE_INTERACTIVE_TAGS.has(element.tagName)) return false;
    if (element.matches(INTERACTIVE_SELECTOR)) return false;
    if (element.getAttribute('onclick')) return true;
    var tabIdx = element.getAttribute('tabindex');
    if (tabIdx !== null && tabIdx !== '-1') return true;
    var style = getComputedStyleSafe(element);
    if (style && style.cursor === 'pointer') {
      // Avoid false positives: only if the element itself sets pointer,
      // not inherited from a parent that's already interactive.
      var parent = element.parentElement;
      if (parent) {
        var parentStyle = getComputedStyleSafe(parent);
        if (parentStyle && parentStyle.cursor === 'pointer' && parent.matches(INTERACTIVE_SELECTOR)) {
          return false;
        }
      }
      return true;
    }
    return false;
  }

  function isTreeNodeHidden(element) {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    var style = getComputedStyleSafe(element);

    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return true;
    }

    return false;
  }

  function buildAxTree() {
    var lines = [];
    var charCount = 0;
    var truncated = false;

    function emit(depth, line) {
      if (truncated) return;
      var indented = '';
      for (var i = 0; i < depth; i++) indented += '  ';
      indented += '- ' + line;
      charCount += indented.length + 1;
      if (charCount > TREE_MAX_CHARS) {
        truncated = true;
        lines.push(indented.substring(0, indented.length - (charCount - TREE_MAX_CHARS)));
        lines.push('... (truncated)');
        return;
      }
      lines.push(indented);
    }

    function walkText(node, depth) {
      if (truncated) return;
      var text = node.nodeValue;
      if (!text) return;
      text = text.replace(/\\s+/g, ' ').trim();
      if (text.length === 0) return;
      if (text.length > TREE_TEXT_MAX_CHARS) {
        text = text.substring(0, TREE_TEXT_MAX_CHARS) + '...';
      }
      emit(depth, 'text "' + text + '"');
    }

    function walk(node, depth) {
      if (truncated) return;
      if (!node) return;

      if (node.nodeType === 3) {
        walkText(node, depth);
        return;
      }

      if (node.nodeType !== 1) return;

      var element = node;
      var tagName = element.tagName;

      if (SKIP_TAGS.has(tagName)) return;
      if (isTreeNodeHidden(element)) return;

      var isInteractive = element.matches(INTERACTIVE_SELECTOR);
      var landmarkRole = LANDMARK_TAGS[tagName] || null;
      var headingLevel = HEADING_TAGS[tagName] || 0;
      var isListContainer = tagName === 'UL' || tagName === 'OL';
      var isListItem = tagName === 'LI';
      var isStructural = landmarkRole || headingLevel || isListContainer || isListItem;

      var isCursorClickable = !isInteractive && isCursorInteractive(element);

      if (isInteractive || isCursorClickable) {
        var role = isInteractive ? getElementRole(element) : 'generic';
        var label = getElementLabel(element);
        var value = isInteractive ? getElementValue(element) : null;
        var placeholder = isInteractive ? getElementPlaceholder(element) : null;
        var shortRef = assignShortRef(element);

        var desc = role;
        if (label) desc += ' "' + label + '"';
        desc += ' [ref=' + shortRef + ']';
        if (isCursorClickable) {
          var hints = [];
          if (element.getAttribute('onclick')) hints.push('onclick');
          var cs = getComputedStyleSafe(element);
          if (cs && cs.cursor === 'pointer') hints.push('cursor:pointer');
          if (element.getAttribute('tabindex')) hints.push('tabindex');
          desc += ' clickable' + (hints.length ? ' [' + hints.join(', ') + ']' : '');
        }
        if (headingLevel) desc += ' [level=' + headingLevel + ']';
        if (value !== null && value !== label) desc += ': "' + (value.length > 80 ? value.substring(0, 80) + '...' : value) + '"';
        if (placeholder) desc += ' (placeholder: "' + placeholder + '")';

        if (element.type === 'checkbox' || element.type === 'radio') {
          desc += element.checked ? ' [checked=true]' : ' [checked=false]';
        }
        if (element.disabled) desc += ' [disabled]';

        var expanded = element.getAttribute('aria-expanded');
        if (expanded !== null) desc += ' [expanded=' + expanded + ']';
        var selected = element.getAttribute('aria-selected');
        if (selected === 'true') desc += ' [selected]';
        var ariaChecked = element.getAttribute('aria-checked');
        if (ariaChecked !== null && element.type !== 'checkbox' && element.type !== 'radio') {
          desc += ' [checked=' + ariaChecked + ']';
        }

        emit(depth, desc);
        return;
      }

      if (headingLevel) {
        var headingText = normalizeString(
          typeof element.innerText === 'string' ? element.innerText : element.textContent || ''
        );
        if (headingText) {
          if (headingText.length > TREE_TEXT_MAX_CHARS) {
            headingText = headingText.substring(0, TREE_TEXT_MAX_CHARS) + '...';
          }
          var hRef = assignShortRef(element);
          emit(depth, 'heading "' + headingText + '" [level=' + headingLevel + ', ref=' + hRef + ']');
        }
        return;
      }

      if (tagName === 'IMG') {
        var alt = normalizeString(element.getAttribute('alt'));
        if (alt) {
          if (alt.length > TREE_TEXT_MAX_CHARS) {
            alt = alt.substring(0, TREE_TEXT_MAX_CHARS) + '...';
          }
          emit(depth, 'image "' + alt + '"');
        }
        return;
      }

      var emitContainer = false;
      if (landmarkRole) {
        var regionLabel = normalizeString(element.getAttribute('aria-label'));
        emit(depth, landmarkRole + (regionLabel ? ' "' + regionLabel + '"' : ''));
        emitContainer = true;
      } else if (isListContainer) {
        emit(depth, tagName === 'OL' ? 'list (ordered)' : 'list');
        emitContainer = true;
      } else if (isListItem) {
        emit(depth, 'listitem');
        emitContainer = true;
      }

      var childDepth = emitContainer ? depth + 1 : depth;
      var children = element.childNodes;
      for (var i = 0; i < children.length; i++) {
        walk(children[i], childDepth);
      }

      if (element.shadowRoot && element.shadowRoot.mode === 'open') {
        var shadowChildren = element.shadowRoot.childNodes;
        for (var j = 0; j < shadowChildren.length; j++) {
          walk(shadowChildren[j], childDepth);
        }
      }
    }

    // Prioritize <main> content: walk it first so it gets budget priority.
    var mainEl = document.querySelector('main, [role="main"]');
    if (mainEl) {
      emit(0, 'main');
      var mainChildren = mainEl.childNodes;
      for (var m = 0; m < mainChildren.length; m++) {
        walk(mainChildren[m], 1);
      }
      // Walk remaining body children, skipping main.
      var bodyChildren = document.body.childNodes;
      for (var b = 0; b < bodyChildren.length; b++) {
        var child = bodyChildren[b];
        if (child === mainEl) continue;
        walk(child, 0);
      }
    } else {
      walk(document.body, 0);
    }
    return lines.join('\\n');
  }

  function collectAxSnapshotPayload() {
    var nodes = [];
    var seen = new Set();
    collectInteractiveElements(document.documentElement, nodes, seen);

    // Reset short refs and build tree (assigns refs during walk).
    resetSnapshotRefs();
    var treeText = buildAxTree();

    // Store ref map on window for executor to resolve.
    window.__MUNINN_REF_MAP__ = snapshotRefMap;

    return {
      nodes: nodes.map(serializeNode),
      treeText: treeText,
      refMap: snapshotRefMap,
    };
  }

  function sendAxSnapshot(requestId) {
    try {
      var payload = collectAxSnapshotPayload();
      post('ax_snapshot', {
        requestId: requestId,
        nodes: payload.nodes,
        treeText: payload.treeText,
        refMap: payload.refMap,
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

  runtime.refreshNodeIds = function refreshNodeIds() {
    // Re-scan interactive elements and re-assign data-ai-internal-id
    // to elements that lost their attribute due to React/SPA re-renders.
    var refMap = window.__MUNINN_REF_MAP__ || {};
    for (var ref in refMap) {
      var entry = refMap[ref];
      var existing = document.querySelector('[data-ai-internal-id="' + entry.domId + '"]');
      if (existing) continue;

      // Try to find by selector + label
      try {
        var candidates = document.querySelectorAll(entry.selector);
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.getAttribute('data-ai-internal-id')) continue;
          var cLabel = getElementLabel(c);
          if (cLabel && entry.label && cLabel.indexOf(entry.label.substring(0, 30)) !== -1) {
            c.setAttribute(NODE_ID_ATTR, entry.domId);
            break;
          }
        }
      } catch (e) {}
    }
  };

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
      const input = arguments[0];
      const init = arguments[1];
      const requestId = buildNetworkRequestId('fetch');
      const startedAt = Date.now();
      const method =
        (init && typeof init.method === 'string' && init.method) ||
        (input && typeof input === 'object' && typeof input.method === 'string' && input.method) ||
        'GET';
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && typeof input.url === 'string'
            ? input.url
            : String(input);

      incrementPending('fetch-start');
      emitNetworkSummary({
        durationMs: null,
        error: null,
        method: method,
        phase: 'started',
        requestId: requestId,
        statusCode: null,
        transport: 'fetch',
        url: url,
      });

      return originalFetch.apply(this, arguments).then(
        function (response) {
          decrementPending('fetch-end');
          emitNetworkSummary({
            durationMs: Date.now() - startedAt,
            error: null,
            method: method,
            phase: 'completed',
            requestId: requestId,
            statusCode: response && typeof response.status === 'number' ? response.status : null,
            transport: 'fetch',
            url: url,
          });
          return response;
        },
        function (error) {
          decrementPending('fetch-error');
          emitNetworkSummary({
            durationMs: Date.now() - startedAt,
            error:
              error && typeof error === 'object' && typeof error.message === 'string'
                ? error.message
                : 'Fetch failed.',
            method: method,
            phase: 'failed',
            requestId: requestId,
            statusCode: null,
            transport: 'fetch',
            url: url,
          });
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

    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__muninnMethod = typeof method === 'string' ? method : 'GET';
      this.__muninnUrl = typeof url === 'string' ? url : String(url);
      return originalOpen.apply(this, arguments);
    };

    window.XMLHttpRequest.prototype.send = function () {
      const request = this;
      let completed = false;
      const requestId = buildNetworkRequestId('xhr');
      const startedAt = Date.now();
      const method =
        typeof request.__muninnMethod === 'string' ? request.__muninnMethod : 'GET';
      const url =
        typeof request.__muninnUrl === 'string'
          ? request.__muninnUrl
          : window.location.href;
      incrementPending('xhr-start');
      emitNetworkSummary({
        durationMs: null,
        error: null,
        method: method,
        phase: 'started',
        requestId: requestId,
        statusCode: null,
        transport: 'xhr',
        url: url,
      });

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
        emitNetworkSummary({
          durationMs: Date.now() - startedAt,
          error: null,
          method: method,
          phase: 'completed',
          requestId: requestId,
          statusCode: typeof request.status === 'number' ? request.status : null,
          transport: 'xhr',
          url: url,
        });
      };

      const fail = function (message) {
        if (completed) {
          return;
        }

        completed = true;
        request.removeEventListener('loadend', complete);
        request.removeEventListener('error', onError);
        request.removeEventListener('abort', onAbort);
        request.removeEventListener('timeout', onTimeout);
        decrementPending('xhr-end');
        emitNetworkSummary({
          durationMs: Date.now() - startedAt,
          error: message,
          method: method,
          phase: 'failed',
          requestId: requestId,
          statusCode: typeof request.status === 'number' ? request.status : null,
          transport: 'xhr',
          url: url,
        });
      };

      const onError = function () {
        fail('XHR error.');
      };

      const onAbort = function () {
        fail('XHR aborted.');
      };

      const onTimeout = function () {
        fail('XHR timed out.');
      };

      request.addEventListener('loadend', complete);
      request.addEventListener('error', onError);
      request.addEventListener('abort', onAbort);
      request.addEventListener('timeout', onTimeout);

      try {
        return originalSend.apply(request, arguments);
      } catch (error) {
        fail(
          error && typeof error === 'object' && typeof error.message === 'string'
            ? error.message
            : 'XHR send failed.'
        );
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
    const wrappedSendBeacon = function (url) {
      markActivity('sendBeacon');
      emitNetworkSummary({
        durationMs: null,
        error: null,
        method: 'POST',
        phase: 'send_beacon',
        requestId: buildNetworkRequestId('beacon'),
        statusCode: null,
        transport: 'beacon',
        url: typeof url === 'string' ? url : String(url),
      });
      return originalSendBeacon.apply(this, arguments);
    };

    wrappedSendBeacon.__muninnWrapped = true;
    navigator.sendBeacon = wrappedSendBeacon;
  }

  function patchConsole() {
    if (!window.console || window.console.__muninnWrapped) {
      return;
    }

    ['log', 'warn', 'error', 'info', 'debug'].forEach(function (level) {
      if (typeof window.console[level] !== 'function') {
        return;
      }

      const original = window.console[level].bind(window.console);
      window.console[level] = function () {
        try {
          emitConsoleMessage(level, Array.prototype.slice.call(arguments));
        } catch (error) {}
        return original.apply(this, arguments);
      };
    });

    window.console.__muninnWrapped = true;
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
  patchConsole();
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
