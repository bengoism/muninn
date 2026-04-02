const NESTED_IFRAME_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1"
    />
    <title>Muninn Nested Frame</title>
    <style>
      body {
        margin: 0;
        padding: 14px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        background: #ecfeff;
        color: #164e63;
      }

      button,
      input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        margin-top: 10px;
        border-radius: 10px;
        border: 1px solid #67e8f9;
        padding: 10px 12px;
        font-size: 14px;
      }

      button {
        border: 0;
        background: #06b6d4;
        color: #083344;
        font-weight: 800;
      }
    </style>
  </head>
  <body>
    <strong>Nested frame controls</strong>
    <button id="nested-button" type="button">Nested frame action</button>
    <input
      id="nested-phone"
      name="phone"
      autocomplete="tel"
      type="tel"
      value="+1 415 555 0199"
      placeholder="Nested phone"
    />
  </body>
</html>
`;

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

      .card {
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        background: rgba(255, 255, 255, 0.92);
        padding: 16px;
        box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
      }

      .field {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      button,
      input {
        border-radius: 10px;
        border: 1px solid rgba(14, 165, 233, 0.35);
        padding: 10px 12px;
        font-size: 14px;
      }

      button {
        border: 0;
        background: #0ea5e9;
        color: #082f49;
        font-weight: 800;
      }

      iframe {
        width: 100%;
        min-height: 150px;
        border: 1px solid rgba(125, 211, 252, 0.8);
        border-radius: 14px;
        margin-top: 16px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="card">
        <strong>Child frame content</strong>
        <div class="field">
          <button id="frame-button" type="button">Child frame action</button>
          <input
            id="frame-email"
            name="email"
            autocomplete="email"
            type="email"
            value="child@example.com"
            placeholder="Child email"
          />
        </div>
        <iframe
          title="Muninn Nested Frame"
          srcdoc="${escapeForHtmlAttribute(NESTED_IFRAME_HTML)}"
        ></iframe>
      </div>
    </div>
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
    <title>Muninn Observation Fixture</title>
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
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 18px 40px;
      }

      .layout {
        display: grid;
        gap: 18px;
      }

      .card {
        background: rgba(255, 255, 255, 0.88);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 20px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.1);
        padding: 20px;
        backdrop-filter: blur(12px);
      }

      h1,
      h2 {
        margin: 0 0 8px;
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
      a.button,
      input,
      textarea,
      select {
        border-radius: 12px;
        padding: 12px 14px;
        font-size: 15px;
        box-sizing: border-box;
      }

      button,
      a.button {
        border: 0;
        background: #0ea5e9;
        color: #082f49;
        font-weight: 800;
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

      .grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      label {
        display: grid;
        gap: 8px;
        font-size: 14px;
        color: #334155;
      }

      input,
      textarea,
      select {
        border: 1px solid rgba(148, 163, 184, 0.42);
        background: rgba(248, 250, 252, 0.92);
        color: #0f172a;
      }

      textarea {
        min-height: 96px;
        resize: vertical;
      }

      .shadow-host {
        min-height: 140px;
      }

      iframe {
        width: 100%;
        min-height: 280px;
        border: 1px solid rgba(148, 163, 184, 0.4);
        border-radius: 16px;
        background: #ffffff;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="layout">
        <section class="card">
          <h1>Browser Observation Fixture</h1>
          <p>
            This local page exercises viewport capture, quiescence, frame
            stitching, open shadow roots, and redaction-sensitive form inputs.
          </p>

          <div class="status">
            <span id="fixture-status">Status: booting</span>
            <span id="fixture-title">Title: Muninn Observation Fixture</span>
          </div>

          <div class="actions">
            <button id="title-button" type="button">Update title</button>
            <button id="throw-button" type="button" class="secondary">Throw sync error</button>
            <button id="reject-button" type="button" class="secondary">Reject async</button>
            <a id="hash-link" class="button" href="#fixture-hash">Trigger hashchange</a>
          </div>
        </section>

        <section class="card">
          <h2>Redaction Fields</h2>
          <div class="grid">
            <label>
              Full name
              <input id="full-name" name="full_name" type="text" value="Ada Lovelace" />
            </label>
            <label>
              Email
              <input
                id="email"
                name="email"
                autocomplete="email"
                type="email"
                value="ada@example.com"
              />
            </label>
            <label>
              Password
              <input
                id="password"
                name="password"
                autocomplete="current-password"
                type="password"
                value="super-secret-password"
              />
            </label>
            <label>
              Shipping address
              <textarea id="address" name="shipping_address">12 Analytical Engine Way</textarea>
            </label>
            <label>
              Destination
              <select id="destination" name="destination">
                <option>Paris</option>
                <option selected>Stockholm</option>
                <option>Tokyo</option>
              </select>
            </label>
            <label>
              Search query
              <input id="search" name="search" type="search" value="best bookstores nearby" />
            </label>
          </div>
        </section>

        <section class="card">
          <h2>Open Shadow Root</h2>
          <p>The action button and email field below live inside an open shadow root.</p>
          <div id="shadow-host" class="shadow-host"></div>
        </section>

        <section class="card">
          <h2>Iframes</h2>
          <p>The child frame below includes its own nested frame.</p>
          <iframe
            id="fixture-child-frame"
            title="Muninn Fixture Child Frame"
            srcdoc="${escapeForHtmlAttribute(IFRAME_HTML)}"
          ></iframe>
        </section>
      </div>
    </main>

    <script>
      const status = document.getElementById('fixture-status');
      const titleLabel = document.getElementById('fixture-title');
      const titleButton = document.getElementById('title-button');
      const throwButton = document.getElementById('throw-button');
      const rejectButton = document.getElementById('reject-button');
      const shadowHost = document.getElementById('shadow-host');

      function syncLabels(label) {
        if (status) {
          status.textContent = 'Status: ' + label;
        }

        if (titleLabel) {
          titleLabel.textContent = 'Title: ' + document.title;
        }
      }

      if (shadowHost && shadowHost.attachShadow) {
        const shadowRoot = shadowHost.attachShadow({ mode: 'open' });
        shadowRoot.innerHTML = \`
          <style>
            .shell {
              display: grid;
              gap: 10px;
              padding: 18px;
              border-radius: 16px;
              background: linear-gradient(135deg, rgba(14, 165, 233, 0.14), rgba(191, 219, 254, 0.55));
              border: 1px solid rgba(14, 165, 233, 0.2);
            }

            button,
            input {
              border-radius: 12px;
              padding: 12px 14px;
              font-size: 14px;
              box-sizing: border-box;
            }

            button {
              border: 0;
              background: #0284c7;
              color: #e0f2fe;
              font-weight: 800;
            }

            input {
              border: 1px solid rgba(14, 165, 233, 0.32);
              background: rgba(255, 255, 255, 0.92);
              color: #0f172a;
            }
          </style>
          <div class="shell">
            <button id="shadow-button" type="button">Shadow root action</button>
            <input
              id="shadow-email"
              name="shadow_email"
              autocomplete="email"
              type="email"
              value="shadow@example.com"
              placeholder="Shadow email"
            />
          </div>
        \`;

        const shadowButton = shadowRoot.getElementById('shadow-button');
        if (shadowButton) {
          shadowButton.addEventListener('click', () => {
            document.title = 'Muninn Observation Fixture Shadow Clicked';
            syncLabels('shadow-clicked');
          });
        }
      }

      if (titleButton) {
        titleButton.addEventListener('click', () => {
          document.title = 'Muninn Observation Fixture Updated';
          syncLabels('title-updated');
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

      setTimeout(() => {
        fetch('data:application/json,%7B%22fixture%22%3Atrue%7D')
          .then((response) => response.json())
          .then(() => {
            syncLabels('network-idle');
          });
      }, 180);

      setTimeout(() => {
        document.title = 'Muninn Observation Fixture Ready';
        syncLabels('ready');
      }, 420);
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
