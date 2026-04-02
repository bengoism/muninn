const IFRAME_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1"
    />
    <title>Muninn Fixture Child Frame</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }

      .frame {
        padding: 16px;
      }

      button {
        border: 0;
        border-radius: 10px;
        background: #0ea5e9;
        color: #082f49;
        font-weight: 700;
        padding: 10px 14px;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <p>Child frame content</p>
      <button id="frame-button" type="button">Click child frame button</button>
    </div>
    <script>
      function post(kind, payload) {
        const target = window.top && window.top.ReactNativeWebView;

        if (!target || typeof target.postMessage !== 'function') {
          return;
        }

        target.postMessage(
          JSON.stringify({
            channel: 'muninn-browser-bridge',
            kind,
            timestamp: new Date().toISOString(),
            frame: {
              frameId: 'fixture-child-frame',
              url: String(window.location.href),
              title: document.title || null,
              isTopFrame: false,
              readyState: document.readyState || null,
            },
            payload,
          })
        );
      }

      const button = document.getElementById('frame-button');
      if (button) {
        button.addEventListener('click', () => {
          document.body.setAttribute('data-frame-clicked', 'true');
          document.title = 'Child Frame Clicked';
          post('page_event', {
            event: 'load',
            detail: {
              source: 'fixture-child-frame',
              action: 'button_click',
            },
          });
        });
      }

      post('bridge_ready', {
        bridgeVersion: 'fixture-child',
        readyState: document.readyState || null,
        reused: false,
        userAgent: navigator.userAgent,
      });
    </script>
  </body>
</html>
`;

export const BRIDGE_FIXTURE_URL = 'fixture://bridge';
export const BRIDGE_FIXTURE_BASE_URL = 'https://fixture.muninn.local/';

export function buildBridgeFixtureHtml() {
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1"
    />
    <title>Muninn Bridge Fixture</title>
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top right, rgba(14, 165, 233, 0.18), transparent 28%),
          linear-gradient(180deg, #e2e8f0 0%, #f8fafc 48%, #e5eef7 100%);
        color: #0f172a;
      }

      main {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px 18px 40px;
      }

      .card {
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 20px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.1);
        padding: 20px;
        backdrop-filter: blur(12px);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
      }

      p {
        margin: 0 0 16px;
        line-height: 1.5;
      }

      .actions {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-bottom: 18px;
      }

      button,
      a.button {
        border: 0;
        border-radius: 12px;
        background: #0ea5e9;
        color: #082f49;
        font-size: 15px;
        font-weight: 800;
        padding: 12px 14px;
        text-decoration: none;
        text-align: center;
      }

      .secondary {
        background: #dbeafe;
        color: #1e3a8a;
      }

      .status {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 14px;
        color: #334155;
        margin-bottom: 18px;
      }

      iframe {
        width: 100%;
        min-height: 140px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 16px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <h1>Browser Bridge Fixture</h1>
        <p>
          This local fixture exercises navigation state, injected scripts, iframe
          bootstrapping, and script error reporting without relying on a remote site.
        </p>

        <div class="status">
          <span id="fixture-status">Status: booting</span>
          <span id="fixture-title">Title: Muninn Bridge Fixture</span>
        </div>

        <div class="actions">
          <button id="title-button" type="button">Update title</button>
          <button id="throw-button" type="button" class="secondary">Throw sync error</button>
          <button id="reject-button" type="button" class="secondary">Reject async</button>
          <a id="hash-link" class="button" href="#fixture-hash">Trigger hashchange</a>
        </div>

        <iframe
          title="Muninn Fixture Child Frame"
          srcdoc="${escapeForHtmlAttribute(IFRAME_HTML)}"
        ></iframe>
      </div>
    </main>

    <script>
      const status = document.getElementById('fixture-status');
      const titleLabel = document.getElementById('fixture-title');
      const titleButton = document.getElementById('title-button');
      const throwButton = document.getElementById('throw-button');
      const rejectButton = document.getElementById('reject-button');
      const childFrame = document.querySelector('iframe');

      function postChildFrameBridgeReady() {
        if (
          !window.ReactNativeWebView ||
          typeof window.ReactNativeWebView.postMessage !== 'function' ||
          !childFrame
        ) {
          return;
        }

        const frameWindow = childFrame.contentWindow;
        const frameDocument = childFrame.contentDocument;

        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            channel: 'muninn-browser-bridge',
            kind: 'bridge_ready',
            timestamp: new Date().toISOString(),
            frame: {
              frameId: 'fixture-child-frame',
              url: frameWindow ? String(frameWindow.location.href) : 'about:blank',
              title: frameDocument && frameDocument.title ? frameDocument.title : null,
              isTopFrame: false,
              readyState:
                frameDocument && typeof frameDocument.readyState === 'string'
                  ? frameDocument.readyState
                  : null,
            },
            payload: {
              bridgeVersion: 'fixture-parent-proxy',
              readyState:
                frameDocument && typeof frameDocument.readyState === 'string'
                  ? frameDocument.readyState
                  : null,
              reused: false,
              userAgent: navigator.userAgent,
            },
          })
        );
      }

      function syncLabels() {
        if (status) {
          status.textContent = 'Status: ready';
        }

        if (titleLabel) {
          titleLabel.textContent = 'Title: ' + document.title;
        }
      }

      if (titleButton) {
        titleButton.addEventListener('click', () => {
          document.title = 'Muninn Fixture Updated';
          syncLabels();
        });
      }

      if (throwButton) {
        throwButton.addEventListener('click', () => {
          throw new Error('Muninn fixture sync error');
        });
      }

      if (rejectButton) {
        rejectButton.addEventListener('click', () => {
          Promise.reject(new Error('Muninn fixture async rejection'));
        });
      }

      if (childFrame) {
        childFrame.addEventListener('load', postChildFrameBridgeReady);
      }

      setTimeout(postChildFrameBridgeReady, 700);

      setTimeout(() => {
        document.title = 'Muninn Fixture Ready';
        syncLabels();
      }, 350);
    </script>
  </body>
</html>
`;
}

function escapeForHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
