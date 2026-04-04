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
    var el = document.querySelector('[data-ai-internal-id="' + elementId + '"]');
    if (!el) el = document.getElementById(elementId);
    return el;
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
