/**
 * JavaScript to inject into the page for browser action execution.
 * Installs window.__MUNINN_ACTIONS__ with click, type, scroll, and
 * tapCoordinates helpers. Uses data-ai-internal-id attributes assigned
 * by the observation bridge.
 */
export const ACTIONS_INJECTION_SCRIPT = `
(function() {
  if (window.__MUNINN_ACTIONS__) return;

  function findById(elementId) {
    // Strategy 1: Short ref via ref map (e1, e2, etc.)
    var refMap = window.__MUNINN_REF_MAP__ || {};
    var entry = refMap[elementId];
    if (entry) {
      // 1a: Try data-ai-internal-id attribute (fast path)
      var el = document.querySelector('[data-ai-internal-id="' + entry.domId + '"]');
      if (el) return el;

      // 1b: Re-query by CSS selector + label match (survives React re-renders)
      try {
        var candidates = document.querySelectorAll(entry.selector);
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          var cLabel = '';
          var ariaLabel = c.getAttribute('aria-label');
          if (ariaLabel) { cLabel = ariaLabel; }
          else if (c.innerText) { cLabel = c.innerText.trim().substring(0, 100); }
          else if (c.textContent) { cLabel = c.textContent.trim().substring(0, 100); }

          if (entry.label && cLabel.indexOf(entry.label.substring(0, 30)) !== -1) {
            c.setAttribute('data-ai-internal-id', entry.domId);
            return c;
          }
        }
      } catch (e) {}

      // 1c: Try all interactive elements matching the role
      try {
        var role = entry.role;
        var roleSelector = '[role="' + role + '"]';
        if (role === 'textbox') roleSelector = 'input, textarea, [role="textbox"], [contenteditable]';
        else if (role === 'button') roleSelector = 'button, [role="button"]';
        else if (role === 'link') roleSelector = 'a[href], [role="link"]';
        else if (role === 'combobox') roleSelector = 'select, [role="combobox"]';

        var roleEls = document.querySelectorAll(roleSelector);
        for (var r = 0; r < roleEls.length; r++) {
          var re = roleEls[r];
          if (!re.getAttribute('data-ai-internal-id')) {
            var reLabel = re.getAttribute('aria-label') || re.getAttribute('placeholder') || '';
            if (entry.label && reLabel.indexOf(entry.label.substring(0, 20)) !== -1) {
              re.setAttribute('data-ai-internal-id', entry.domId);
              return re;
            }
          }
        }
      } catch (e) {}
    }

    // Strategy 2: Direct attribute lookup (legacy long IDs)
    var el = document.querySelector('[data-ai-internal-id="' + elementId + '"]');
    if (el) return el;

    // Strategy 3: Try as HTML id
    return document.getElementById(elementId);
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
    click: function(elementId) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      dispatchMouseEvents(el);
      return { ok: true, reason: null };
    },

    tapCoordinates: function(x, y) {
      var el = document.elementFromPoint(x, y);
      if (!el) return { ok: false, reason: 'No element at (' + x + ', ' + y + ')' };
      dispatchMouseEvents(el);
      return { ok: true, reason: null };
    },

    type: function(elementId, text) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
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
        // Fallback: simulate typing character by character via keyboard events.
        for (var i = 0; i < text.length; i++) {
          var ch = text[i];
          el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        }
        // Also try direct assignment as last resort.
        try { el.value = text; } catch (_) {}
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: null };
    },

    fill: function(elementId, text) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
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
      return { ok: true, reason: null };
    },

    select: function(elementId, value) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
      if (!(el instanceof HTMLSelectElement)) {
        // Fallback: click the element (e.g. custom dropdown/autocomplete item).
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        dispatchMouseEvents(el);
        return { ok: true, reason: 'Clicked non-select element as fallback' };
      }
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      // Try matching by value first, then by visible text.
      var found = false;
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === value || el.options[i].text === value) {
          el.selectedIndex = i;
          found = true;
          break;
        }
      }
      if (!found) {
        // Fuzzy match: case-insensitive contains.
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
        return { ok: false, reason: 'No matching option for: ' + value };
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, reason: null };
    },

    waitForCondition: function(condition, timeoutMs) {
      // Returns a promise that resolves when condition is met or timeout.
      // Conditions: 'idle' (default), 'url:pattern', 'selector:css', 'text:substring'
      timeoutMs = timeoutMs || 3000;
      condition = condition || 'idle';
      return new Promise(function(resolve) {
        var start = Date.now();
        function check() {
          if (Date.now() - start > timeoutMs) {
            return resolve({ ok: true, reason: 'timeout' });
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
            return resolve({ ok: true, reason: null });
          }
          setTimeout(check, 200);
        }
        check();
      });
    },

    hover: function(elementId) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mousemove', opts));
      return { ok: true, reason: null };
    },

    focus: function(elementId) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      return { ok: true, reason: null };
    },

    gettext: function(elementId) {
      var el = findById(elementId);
      if (!el) return { ok: false, reason: 'Element not found: ' + elementId };
      var text = '';
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        text = el.value || '';
      } else if (el instanceof HTMLSelectElement) {
        var opt = el.options[el.selectedIndex];
        text = opt ? opt.text : '';
      } else {
        text = (typeof el.innerText === 'string' ? el.innerText : el.textContent) || '';
      }
      text = text.trim();
      return { ok: true, reason: text || '(empty)' };
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
      return { ok: true, reason: null };
    },

    /** Lightweight post-action snapshot for validation (issue #7). */
    captureValidationState: function() {
      var ids = [];
      var bounds = {};
      var roles = {};
      var els = document.querySelectorAll('[data-ai-internal-id]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var id = el.getAttribute('data-ai-internal-id');
        if (!id) continue;
        ids.push(id);
        var rect = el.getBoundingClientRect();
        bounds[id] = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
        var role = el.getAttribute('role') || '';
        if (role) roles[id] = role;
      }
      var focused = document.activeElement;

      // Detect visible dialog/modal elements in the DOM.
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
        scrollY: window.scrollY,
        axNodeIds: ids,
        axNodeBounds: bounds,
        axNodeRoles: roles,
        focusedElementId: focused ? focused.getAttribute('data-ai-internal-id') : null,
        hasDialog: hasDialog
      };
    }
  };
})();
`;
