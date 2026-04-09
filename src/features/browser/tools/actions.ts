/**
 * JavaScript to inject into the page for browser action execution.
 * Installs window.__MUNINN_ACTIONS__ with click, type, scroll, and
 * tapCoordinates helpers. Uses data-ai-internal-id attributes assigned
 * by the observation bridge and returns structured locator traces.
 */
export const ACTIONS_INJECTION_SCRIPT = `
(function() {
  if (window.__MUNINN_ACTIONS__) return;

  var NODE_ID_ATTR = 'data-ai-internal-id';

  function normalizeString(value) {
    if (typeof value !== 'string') {
      return null;
    }

    var trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function limitString(value, maxLength) {
    var normalized = normalizeString(value);
    if (!normalized) {
      return null;
    }

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return normalized.slice(0, maxLength) + '...';
  }

  function roleSelectorFor(role) {
    if (role === 'textbox') {
      return 'input, textarea, [role="textbox"], [contenteditable], [contenteditable="true"]';
    }
    if (role === 'button') {
      return 'button, [role="button"]';
    }
    if (role === 'link') {
      return 'a[href], [role="link"]';
    }
    if (role === 'combobox') {
      return 'select, [role="combobox"]';
    }
    return role ? '[role="' + role + '"]' : '*';
  }

  function getElementRole(element) {
    if (!element) {
      return null;
    }

    var explicitRole = normalizeString(element.getAttribute('role'));
    if (explicitRole) {
      return explicitRole;
    }

    var tagName = element.tagName ? element.tagName.toLowerCase() : '';
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
    if (tagName === 'input') {
      var type = normalizeString(element.getAttribute('type')) || 'text';
      if (type === 'checkbox' || type === 'radio') {
        return type;
      }
      if (
        type === 'submit' ||
        type === 'button' ||
        type === 'reset' ||
        type === 'image'
      ) {
        return 'button';
      }
      if (type === 'search') {
        return 'searchbox';
      }
      return 'textbox';
    }
    if (
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === ''
    ) {
      return 'textbox';
    }
    return 'generic';
  }

  function getElementPlaceholder(element) {
    if (!element) {
      return null;
    }

    return normalizeString(element.getAttribute('placeholder'));
  }

  function getElementHref(element) {
    if (!element) {
      return null;
    }

    if (element instanceof HTMLAnchorElement && typeof element.href === 'string') {
      return normalizeString(element.href);
    }

    return normalizeString(element.getAttribute('href'));
  }

  function getElementLabel(element) {
    if (!element) {
      return null;
    }

    return (
      normalizeString(element.getAttribute('aria-label')) ||
      normalizeString(element.getAttribute('placeholder')) ||
      normalizeString(element.getAttribute('title')) ||
      limitString(
        typeof element.innerText === 'string'
          ? element.innerText
          : element.textContent || '',
        160
      )
    );
  }

  function getElementText(element) {
    if (!element) {
      return null;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return limitString(element.value || '', 160);
    }

    return limitString(
      typeof element.innerText === 'string'
        ? element.innerText
        : element.textContent || '',
      160
    );
  }

  function summarizeElement(element, selectorHint, captureRaw) {
    if (!element) {
      return null;
    }

    return {
      domId: normalizeString(element.getAttribute(NODE_ID_ATTR)),
      href: captureRaw ? getElementHref(element) : null,
      htmlId: normalizeString(element.getAttribute('id')),
      label: captureRaw ? getElementLabel(element) : null,
      role: getElementRole(element),
      selector: selectorHint || null,
      tagName: element.tagName ? element.tagName.toLowerCase() : null,
      text: captureRaw ? getElementText(element) : null,
    };
  }

  function summarizeCandidates(nodeList, selectorHint, captureRaw, limit) {
    var summaries = [];
    var size = Math.min(nodeList.length, limit);
    for (var i = 0; i < size; i++) {
      summaries.push(summarizeElement(nodeList[i], selectorHint, captureRaw));
    }
    return summaries;
  }

  function matchesLabel(expectedLabel, actualLabel, sliceLength) {
    if (!expectedLabel || !actualLabel) {
      return false;
    }

    return actualLabel
      .toLowerCase()
      .indexOf(expectedLabel.substring(0, sliceLength).toLowerCase()) !== -1;
  }

  function inferTargetKind(elementId) {
    if (/^e\\d+$/.test(elementId)) {
      return 'short_ref';
    }
    if (/^ai-/.test(elementId)) {
      return 'dom_id';
    }
    return 'unknown';
  }

  function getCaptureRaw() {
    return Boolean(
      window.__MUNINN_ACTIONS__ &&
        window.__MUNINN_ACTIONS__.debugOptions &&
        window.__MUNINN_ACTIONS__.debugOptions.captureRaw
    );
  }

  function entryTargetType(entry) {
    if (!entry) {
      return 'generic';
    }

    if (entry.targetType) {
      return entry.targetType;
    }

    return entry.role === 'generic' ? 'generic' : 'semantic';
  }

  function entryMatchesElement(entry, element) {
    if (!entry || !element) {
      return true;
    }

    var targetType = entryTargetType(entry);
    var score = 0;
    var currentRole = getElementRole(element);
    var currentTag = element.tagName ? element.tagName.toLowerCase() : null;
    var currentLabel = getElementLabel(element);
    var currentText = getElementText(element);
    var currentPlaceholder = getElementPlaceholder(element);
    var currentHref = getElementHref(element);

    if (entry.role && currentRole === entry.role) {
      score += 3;
    } else if (entry.role && entry.role !== 'generic') {
      score -= 4;
    }

    if (entry.tagName && currentTag === entry.tagName) {
      score += 2;
    } else if (entry.tagName && currentTag) {
      score -= 2;
    }

    if (entry.label) {
      if (matchesLabel(entry.label, currentLabel, 30)) {
        score += 3;
      } else if (targetType === 'semantic') {
        score -= 2;
      }
    }

    if (entry.text) {
      if (
        matchesLabel(entry.text, currentText, 20) ||
        matchesLabel(currentText, entry.text, 20)
      ) {
        score += 2;
      } else if (targetType === 'semantic') {
        score -= 1;
      }
    }

    if (entry.placeholder) {
      if (currentPlaceholder === entry.placeholder) {
        score += 1;
      } else if (targetType === 'semantic') {
        score -= 1;
      }
    }

    if (entry.href) {
      if (
        currentHref &&
        (currentHref.indexOf(entry.href) !== -1 || entry.href.indexOf(currentHref) !== -1)
      ) {
        score += 3;
      } else {
        score -= 3;
      }
    }

    if (targetType === 'generic') {
      return score >= -1;
    }

    return score >= 1;
  }

  function resolveElement(elementId) {
    var refMap = window.__MUNINN_REF_MAP__ || {};
    var entry = refMap[elementId] || null;
    var targetKind = inferTargetKind(elementId);
    var attempts = [];
    var captureRaw = getCaptureRaw();
    var matchedElement = null;

    function pushAttempt(strategy, candidates, matched, reason, selectorHint) {
      var matchedCandidate = matched
        ? summarizeElement(matched, selectorHint || null, captureRaw)
        : null;

      attempts.push({
        candidateCount: candidates ? candidates.length : 0,
        candidates: candidates
          ? summarizeCandidates(candidates, selectorHint || null, captureRaw, 5)
          : [],
        matched: Boolean(matched),
        matchedCandidate: matchedCandidate,
        reason: reason || null,
        strategy: strategy,
      });
    }

    if (entry) {
      var attrMatch = document.querySelector(
        '[' + NODE_ID_ATTR + '="' + entry.domId + '"]'
      );
      if (attrMatch && entryMatchesElement(entry, attrMatch)) {
        matchedElement = attrMatch;
        pushAttempt('ref.dom_id', [attrMatch], attrMatch, null, entry.selector || null);
      } else if (attrMatch) {
        pushAttempt(
          'ref.dom_id',
          [attrMatch],
          null,
          'Live node no longer matches the observed role, label, or link target.',
          entry.selector || null
        );
      } else {
        pushAttempt('ref.dom_id', [], null, 'No live node with the stored DOM id.', null);
      }

      if (!matchedElement) {
        try {
          var selectorCandidates = document.querySelectorAll(entry.selector);
          var selectorWinner = null;
          for (var i = 0; i < selectorCandidates.length; i++) {
            var selectorCandidate = selectorCandidates[i];
            var selectorLabel = getElementLabel(selectorCandidate);
            if (
              (entry.label && matchesLabel(entry.label, selectorLabel, 30)) ||
              (!entry.label && selectorCandidates.length === 1)
            ) {
              if (entryMatchesElement(entry, selectorCandidate)) {
                selectorWinner = selectorCandidate;
                selectorWinner.setAttribute(NODE_ID_ATTR, entry.domId);
                break;
              }
            }
          }
          if (selectorWinner) {
            matchedElement = selectorWinner;
            pushAttempt(
              'ref.selector_label',
              selectorCandidates,
              selectorWinner,
              null,
              entry.selector || null
            );
          } else {
            pushAttempt(
              'ref.selector_label',
              selectorCandidates,
              null,
              entry.label
                ? 'Selector candidates did not match the observed label.'
                : 'Selector candidates were ambiguous.',
              entry.selector || null
            );
          }
        } catch (error) {
          pushAttempt(
            'ref.selector_label',
            [],
            null,
            error && typeof error.message === 'string'
              ? error.message
              : 'Selector lookup failed.',
            entry.selector || null
          );
        }
      }

      if (!matchedElement) {
        try {
          var roleSelector = roleSelectorFor(entry.role);
          var roleCandidates = document.querySelectorAll(roleSelector);
          var roleWinner = null;
          for (var r = 0; r < roleCandidates.length; r++) {
            var roleCandidate = roleCandidates[r];
            var roleLabel = getElementLabel(roleCandidate);
            if (
              (entry.label && matchesLabel(entry.label, roleLabel, 20)) ||
              (!entry.label && roleCandidates.length === 1)
            ) {
              if (entryMatchesElement(entry, roleCandidate)) {
                roleWinner = roleCandidate;
                if (!roleWinner.getAttribute(NODE_ID_ATTR)) {
                  roleWinner.setAttribute(NODE_ID_ATTR, entry.domId);
                }
                break;
              }
            }
          }
          if (roleWinner) {
            matchedElement = roleWinner;
            pushAttempt('ref.role_label', roleCandidates, roleWinner, null, roleSelector);
          } else {
            pushAttempt(
              'ref.role_label',
              roleCandidates,
              null,
              entry.label
                ? 'Role candidates did not match the observed label.'
                : 'Role candidates were ambiguous.',
              roleSelector
            );
          }
        } catch (error) {
          pushAttempt(
            'ref.role_label',
            [],
            null,
            error && typeof error.message === 'string'
              ? error.message
              : 'Role lookup failed.',
            null
          );
        }
      }
    }

    if (!matchedElement) {
      var legacyMatch = document.querySelector(
        '[' + NODE_ID_ATTR + '="' + elementId + '"]'
      );
      if (legacyMatch) {
        matchedElement = legacyMatch;
        pushAttempt('legacy.dom_id', [legacyMatch], legacyMatch, null, null);
      } else {
        pushAttempt('legacy.dom_id', [], null, 'No element matched the direct DOM id.', null);
      }
    }

    if (!matchedElement) {
      var htmlIdMatch = document.getElementById(elementId);
      if (htmlIdMatch) {
        matchedElement = htmlIdMatch;
        pushAttempt('legacy.html_id', [htmlIdMatch], htmlIdMatch, null, null);
      } else {
        pushAttempt('legacy.html_id', [], null, 'No element matched the HTML id.', null);
      }
    }

    var targetState;
    if (matchedElement && entry) {
      targetState = 'known_ref';
    } else if (matchedElement) {
      targetState = 'legacy_dom_id';
    } else if (entry) {
      targetState = 'stale_ref';
    } else if (targetKind === 'dom_id') {
      targetState = 'stale_ref';
    } else {
      targetState = 'unknown_ref';
    }

    return {
      debug: {
        attempts: attempts,
        matchedCandidate: summarizeElement(
          matchedElement,
          entry ? entry.selector || null : null,
          captureRaw
        ),
        refEntry: entry
          ? {
              domId: entry.domId,
              href: captureRaw ? entry.href || null : null,
              hasSemanticDescendants: Boolean(entry.hasSemanticDescendants),
              label: captureRaw ? entry.label || '' : '',
              landmark: entry.landmark || null,
              ancestorLandmarks: entry.ancestorLandmarks || [],
              containerId: entry.containerId || null,
              containerKind: entry.containerKind || null,
              placeholder: captureRaw ? entry.placeholder || null : null,
              role: entry.role,
              selector: entry.selector,
              snapshotId: entry.snapshotId || null,
              tagName: entry.tagName || null,
              targetType: entry.targetType || null,
              text: captureRaw ? entry.text || '' : '',
            }
          : null,
        targetId: elementId,
        targetKind: targetKind,
        targetState: targetState,
      },
      element: matchedElement,
      reason:
        targetState === 'unknown_ref'
          ? 'Unknown ref: ' + elementId
          : 'Element not found: ' + elementId,
    };
  }

  function buildActionDebug(action, params, resolution) {
    return {
      jsCall: null,
      matchedElement: resolution.debug.matchedCandidate,
      requestedAction: action,
      requestedParams: params,
      resolver: resolution.debug,
      targetState: resolution.debug.targetState,
    };
  }

  function buildActionFailure(action, params, resolution, reason) {
    return {
      ok: false,
      reason: reason || resolution.reason,
      debug: buildActionDebug(action, params, resolution),
    };
  }

  function buildActionSuccess(action, params, resolution, reason) {
    return {
      ok: true,
      reason: reason || null,
      debug: buildActionDebug(action, params, resolution),
    };
  }

  function dispatchMouseEvents(el) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  window.__MUNINN_ACTIONS__ = {
    debugOptions: {
      captureRaw: false,
    },

    setDebugOptions: function(options) {
      this.debugOptions = {
        captureRaw: Boolean(options && options.captureRaw),
      };
      return this.debugOptions;
    },

    resolveOnly: function(elementId) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) {
        return buildActionFailure('resolve_only', { id: elementId }, resolution, resolution.reason);
      }
      return buildActionSuccess('resolve_only', { id: elementId }, resolution, null);
    },

    getDebugState: function() {
      var refMap = window.__MUNINN_REF_MAP__ || {};
      var knownRefIds = Object.keys(refMap);
      var liveRefIds = [];
      for (var i = 0; i < knownRefIds.length; i++) {
        var refId = knownRefIds[i];
        var refEntry = refMap[refId];
        if (!refEntry || !refEntry.domId) continue;
        if (document.querySelector('[' + NODE_ID_ATTR + '="' + refEntry.domId + '"]')) {
          liveRefIds.push(refId);
        }
      }

      return {
        activeElementTag:
          document.activeElement && document.activeElement.tagName
            ? document.activeElement.tagName.toLowerCase()
            : null,
        knownRefCount: knownRefIds.length,
        knownRefIds: knownRefIds.slice(0, 50),
        liveRefCount: liveRefIds.length,
        liveRefIds: liveRefIds.slice(0, 50),
        readyState: document.readyState,
        url: window.location.href,
      };
    },

    click: function(elementId) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('click', { id: elementId }, resolution, resolution.reason);
      resolution.element.scrollIntoView({ block: 'center', behavior: 'instant' });
      dispatchMouseEvents(resolution.element);
      return buildActionSuccess('click', { id: elementId }, resolution, null);
    },

    tapCoordinates: function(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) {
        return {
          ok: false,
          reason: 'No element at (' + x + ', ' + y + ')',
          debug: {
            jsCall: null,
            matchedElement: null,
            requestedAction: 'tap_coordinates',
            requestedParams: { x: x, y: y },
            resolver: null,
            targetState: null,
          },
        };
      }
      dispatchMouseEvents(el);
      return {
        ok: true,
        reason: null,
        debug: {
          jsCall: null,
          matchedElement: summarizeElement(el, null, getCaptureRaw()),
          requestedAction: 'tap_coordinates',
          requestedParams: { x: x, y: y },
          resolver: null,
          targetState: null,
        },
      };
    },

    type: function(elementId, text) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('type', { id: elementId, text: text }, resolution, resolution.reason);
      var el = resolution.element;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      dispatchMouseEvents(el);
      el.focus();
      try {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          var nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(el).constructor.prototype, 'value'
          );
          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(el, text);
          } else {
            el.value = text;
          }
        } else if ('value' in el) {
          el.value = text;
        } else {
          el.textContent = text;
        }
      } catch (e) {
        for (var i = 0; i < text.length; i++) {
          var ch = text[i];
          el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        }
        try { el.value = text; } catch (_) {}
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return buildActionSuccess('type', { id: elementId, text: text }, resolution, null);
    },

    fill: function(elementId, text) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('fill', { id: elementId, text: text }, resolution, resolution.reason);
      var el = resolution.element;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      dispatchMouseEvents(el);
      el.focus();
      try {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          var nativeSetter = Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(el).constructor.prototype, 'value'
          );
          if (nativeSetter && nativeSetter.set) {
            nativeSetter.set.call(el, text);
          } else {
            el.value = text;
          }
        } else if ('value' in el) {
          el.value = text;
        } else {
          el.textContent = text;
        }
      } catch (e) {
        try { el.value = text; } catch (_) {}
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return buildActionSuccess('fill', { id: elementId, text: text }, resolution, null);
    },

    select: function(elementId, value) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('select', { id: elementId, value: value }, resolution, resolution.reason);
      var el = resolution.element;
      if (!(el instanceof HTMLSelectElement)) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        dispatchMouseEvents(el);
        return buildActionSuccess(
          'select',
          { id: elementId, value: value },
          resolution,
          'Clicked non-select element as fallback'
        );
      }
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      var found = false;
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === value || el.options[i].text === value) {
          el.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        var lower = value.toLowerCase();
        for (var j = 0; j < el.options.length; j++) {
          if (el.options[j].text.toLowerCase().indexOf(lower) !== -1) {
            el.selectedIndex = j;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        return buildActionFailure(
          'select',
          { id: elementId, value: value },
          resolution,
          'No matching option for: ' + value
        );
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return buildActionSuccess('select', { id: elementId, value: value }, resolution, null);
    },

    waitForCondition: function(condition, timeoutMs) {
      timeoutMs = timeoutMs || 3000;
      condition = condition || 'idle';
      return new Promise(function(resolve) {
        var start = Date.now();
        function check() {
          if (Date.now() - start > timeoutMs) {
            return resolve({
              ok: true,
              reason: 'timeout',
              debug: {
                jsCall: null,
                matchedElement: null,
                requestedAction: 'wait',
                requestedParams: { condition: condition, timeout: timeoutMs },
                resolver: null,
                targetState: null,
              },
            });
          }
          var met = false;
          if (condition === 'idle') {
            met = document.readyState === 'complete';
          } else if (condition.indexOf('url:') === 0) {
            met = window.location.href.indexOf(condition.substring(4)) !== -1;
          } else if (condition.indexOf('selector:') === 0) {
            met = document.querySelector(condition.substring(9)) !== null;
          } else if (condition.indexOf('text:') === 0) {
            met = (document.body.innerText || '').indexOf(condition.substring(5)) !== -1;
          } else {
            met = true;
          }
          if (met) {
            return resolve({
              ok: true,
              reason: null,
              debug: {
                jsCall: null,
                matchedElement: null,
                requestedAction: 'wait',
                requestedParams: { condition: condition, timeout: timeoutMs },
                resolver: null,
                targetState: null,
              },
            });
          }
          setTimeout(check, 200);
        }
        check();
      });
    },

    hover: function(elementId) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('hover', { id: elementId }, resolution, resolution.reason);
      var el = resolution.element;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      return buildActionSuccess('hover', { id: elementId }, resolution, null);
    },

    focus: function(elementId) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('focus', { id: elementId }, resolution, resolution.reason);
      resolution.element.scrollIntoView({ block: 'center', behavior: 'instant' });
      resolution.element.focus();
      return buildActionSuccess('focus', { id: elementId }, resolution, null);
    },

    gettext: function(elementId) {
      var resolution = resolveElement(elementId);
      if (!resolution.element) return buildActionFailure('gettext', { id: elementId }, resolution, resolution.reason);
      var el = resolution.element;
      var text = '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        text = el.value || '';
      } else if (el instanceof HTMLSelectElement) {
        var opt = el.options[el.selectedIndex];
        text = opt ? opt.text : '';
      } else {
        text = (typeof el.innerText === 'string' ? el.innerText : el.textContent) || '';
      }
      return buildActionSuccess('gettext', { id: elementId }, resolution, text.trim() || '(empty)');
    },

    scroll: function(direction, amount) {
      var distances = {
        page: 600, half: 300, small: 100
      };
      var px = distances[amount] || 300;
      var dx = 0, dy = 0;
      if (direction === 'down') dy = px;
      else if (direction === 'up') dy = -px;
      else if (direction === 'right') dx = px;
      else if (direction === 'left') dx = -px;
      window.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      return {
        ok: true,
        reason: null,
        debug: {
          jsCall: null,
          matchedElement: null,
          requestedAction: 'scroll',
          requestedParams: { direction: direction, amount: amount },
          resolver: null,
          targetState: null,
        },
      };
    },

    captureValidationState: function() {
      var ids = [];
      var bounds = {};
      var roles = {};
      var refMap = window.__MUNINN_REF_MAP__ || {};
      var knownRefIds = Object.keys(refMap);
      var liveRefIds = [];
      var refToDomId = {};
      var els = document.querySelectorAll('[' + NODE_ID_ATTR + ']');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var id = el.getAttribute(NODE_ID_ATTR);
        if (!id) continue;
        ids.push(id);
        var rect = el.getBoundingClientRect();
        bounds[id] = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        var role = getElementRole(el) || '';
        if (role) roles[id] = role;
      }
      for (var j = 0; j < knownRefIds.length; j++) {
        var refId = knownRefIds[j];
        var entry = refMap[refId];
        if (!entry || !entry.domId) continue;
        refToDomId[refId] = entry.domId;
        if (document.querySelector('[' + NODE_ID_ATTR + '="' + entry.domId + '"]')) {
          liveRefIds.push(refId);
        }
      }

      var focused = document.activeElement;
      var focusedElementId = focused ? focused.getAttribute(NODE_ID_ATTR) : null;
      var activeShortRef = null;
      if (focusedElementId) {
        for (var k = 0; k < knownRefIds.length; k++) {
          var knownRefId = knownRefIds[k];
          if (refMap[knownRefId] && refMap[knownRefId].domId === focusedElementId) {
            activeShortRef = knownRefId;
            break;
          }
        }
      }

      var hasDialog = false;
      var dialogEls = document.querySelectorAll(
        'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
      );
      for (var d = 0; d < dialogEls.length; d++) {
        var de = dialogEls[d];
        var dr = de.getBoundingClientRect();
        if (dr.width > 0 && dr.height > 0) {
          hasDialog = true;
          break;
        }
      }

      return {
        activeShortRef: activeShortRef,
        axNodeBounds: bounds,
        axNodeIds: ids,
        axNodeRoles: roles,
        focusedElementId: focusedElementId,
        hasDialog: hasDialog,
        knownRefIds: knownRefIds,
        liveRefIds: liveRefIds,
        refToDomId: refToDomId,
        scrollY: window.scrollY,
      };
    }
  };
})();
`;
