/**
 * PiBridge SSH Terminal Frontend Module
 *
 * Provides window.initTerminal(pibridge, containerId, credentials) which:
 *   1. Dynamically loads xterm.js + xterm-addon-fit CSS/JS from node_modules.
 *   2. Builds a toolbar with connection status, IP address, and Disconnect button.
 *   3. Creates an xterm Terminal, auto-fits it, and wires input/output to the
 *      pibridge IPC bridge (terminal-start, terminal-send, terminal-resize,
 *      terminal-close, and the terminal-data listener).
 *
 * Credentials format: { ip, username, password }
 * CSS classes are prefixed with `term-` to avoid collisions.
 */

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Track loaded resources so we only inject them once
  // -----------------------------------------------------------------------
  let xtermLoaded = false;
  let loadPromise = null;

  /**
   * Dynamically load a CSS file by appending a <link> element to <head>.
   * Returns a Promise that resolves when the stylesheet is loaded.
   */
  function loadCSS(href) {
    return new Promise((resolve, reject) => {
      // Avoid duplicates
      if (document.querySelector(`link[href="${href}"]`)) {
        resolve();
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => {
        console.log(`[TerminalView] CSS loaded: ${href}`);
        resolve();
      };
      link.onerror = () => {
        console.error(`[TerminalView] Failed to load CSS: ${href}`);
        reject(new Error(`Failed to load CSS: ${href}`));
      };
      document.head.appendChild(link);
    });
  }

  /**
   * Dynamically load a JS file by appending a <script> element to <head>.
   * Returns a Promise that resolves when the script is loaded.
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Avoid duplicates
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => {
        console.log(`[TerminalView] Script loaded: ${src}`);
        resolve();
      };
      script.onerror = () => {
        console.error(`[TerminalView] Failed to load script: ${src}`);
        reject(new Error(`Failed to load script: ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Ensure xterm.js + fit addon CSS/JS are loaded exactly once.
   * After this resolves, `window.Terminal` and `window.FitAddon` should be available.
   */
  function ensureXtermLoaded() {
    if (xtermLoaded) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      console.log('[TerminalView] Loading xterm.js dependencies...');

      // Load CSS first
      await loadCSS('node_modules/xterm/css/xterm.css');

      // Load xterm core JS
      await loadScript('node_modules/xterm/lib/xterm.js');

      // Load fit addon JS (depends on xterm being loaded first)
      await loadScript('node_modules/xterm-addon-fit/lib/xterm-addon-fit.js');

      xtermLoaded = true;
      console.log('[TerminalView] xterm.js dependencies loaded successfully.');
    })();

    return loadPromise;
  }

  // -----------------------------------------------------------------------
  // Inline styles for the terminal toolbar (injected once)
  // -----------------------------------------------------------------------
  let stylesInjected = false;

  function injectTerminalStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.textContent = `
      /* Terminal wrapper fills its container */
      .term-wrapper {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        background: #1e1e2e;
        border-radius: 8px;
        overflow: hidden;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      /* Toolbar strip */
      .term-toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: rgba(30, 30, 46, 0.95);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        flex-shrink: 0;
        min-height: 38px;
      }

      .term-status-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.3s ease;
      }

      .term-status-dot.connected {
        background: #a6e3a1;
        box-shadow: 0 0 6px rgba(166, 227, 161, 0.6);
      }

      .term-status-dot.disconnected {
        background: #f38ba8;
        box-shadow: 0 0 6px rgba(243, 139, 168, 0.4);
      }

      .term-status-dot.connecting {
        background: #f9e2af;
        box-shadow: 0 0 6px rgba(249, 226, 175, 0.4);
        animation: term-pulse 1.2s infinite ease-in-out;
      }

      @keyframes term-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .term-ip-label {
        color: #cdd6f4;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.3px;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .term-ip-label span.term-session-tag {
        color: #6c7086;
        font-size: 11px;
        font-weight: 400;
        margin-left: 8px;
      }

      .term-disconnect-btn {
        padding: 4px 14px;
        font-size: 12px;
        font-weight: 600;
        color: #f38ba8;
        background: rgba(243, 139, 168, 0.08);
        border: 1px solid rgba(243, 139, 168, 0.25);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
      }

      .term-disconnect-btn:hover {
        background: rgba(243, 139, 168, 0.18);
        border-color: rgba(243, 139, 168, 0.5);
        color: #f5c2e7;
      }

      .term-disconnect-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      /* Terminal body (xterm container) */
      .term-body {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        padding: 4px;
      }

      /* Override xterm viewport to remove unnecessary scrollbar styling conflicts */
      .term-body .xterm {
        height: 100%;
      }
      .term-body .xterm-viewport {
        overflow-y: auto !important;
      }
    `;
    document.head.appendChild(style);
    console.log('[TerminalView] Terminal styles injected.');
  }

  // -----------------------------------------------------------------------
  // Global listener registry: only one `onTerminalData` listener at a time
  // -----------------------------------------------------------------------
  const sessionCallbacks = new Map();   // sessionId → function(dataString)
  let globalListenerRegistered = false;

  function registerGlobalDataListener(pibridge) {
    if (globalListenerRegistered) return;
    globalListenerRegistered = true;

    if (typeof pibridge.onTerminalData === 'function') {
      pibridge.onTerminalData((payload) => {
        if (payload && payload.sessionId) {
          const cb = sessionCallbacks.get(payload.sessionId);
          if (cb) {
            cb(payload.data);
          }
        }
      });
      console.log('[TerminalView] Global terminal-data listener registered.');
    } else {
      console.warn('[TerminalView] pibridge.onTerminalData is not available. Terminal output will not be received.');
    }
  }

  // -----------------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------------

  /**
   * Initialize an interactive SSH terminal inside the given container.
   *
   * @param {Object} pibridge      – The contextBridge-exposed API object (window.pibridge)
   * @param {string} containerId   – DOM element ID where the terminal should be rendered
   * @param {Object} credentials   – { ip: string, username: string, password: string }
   */
  async function initTerminal(pibridge, containerId, credentials) {
    console.log(`[TerminalView] initTerminal called for container="${containerId}", ip="${credentials.ip}"`);

    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[TerminalView] Container element not found: #${containerId}`);
      return null;
    }

    // Inject custom CSS
    injectTerminalStyles();

    // Load xterm.js dependencies
    await ensureXtermLoaded();

    // Register the global data listener (once)
    registerGlobalDataListener(pibridge);

    // ---- Build DOM structure ----
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'term-wrapper';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'term-toolbar';

    const statusDot = document.createElement('div');
    statusDot.className = 'term-status-dot connecting';

    const ipLabel = document.createElement('div');
    ipLabel.className = 'term-ip-label';
    ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag">connecting…</span>`;

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'term-disconnect-btn';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.disabled = true;

    toolbar.appendChild(statusDot);
    toolbar.appendChild(ipLabel);
    toolbar.appendChild(disconnectBtn);

    // Terminal body
    const termBody = document.createElement('div');
    termBody.className = 'term-body';

    wrapper.appendChild(toolbar);
    wrapper.appendChild(termBody);
    container.appendChild(wrapper);

    // ---- Create xterm Terminal instance ----
    const TerminalClass = window.Terminal;
    if (!TerminalClass) {
      console.error('[TerminalView] window.Terminal is not defined. xterm.js may have failed to load.');
      ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag" style="color:#f38ba8;">xterm.js failed to load</span>`;
      statusDot.className = 'term-status-dot disconnected';
      return null;
    }

    const term = new TerminalClass({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: 'rgba(137, 180, 250, 0.3)',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      }
    });

    // Load FitAddon
    let fitAddon = null;
    const FitAddonModule = window.FitAddon;
    const FitAddonClass = FitAddonModule ? (FitAddonModule.FitAddon || FitAddonModule) : null;

    if (FitAddonClass) {
      fitAddon = new FitAddonClass();
      term.loadAddon(fitAddon);
      console.log('[TerminalView] FitAddon loaded.');
    } else {
      console.warn('[TerminalView] FitAddon not available. Terminal will not auto-fit.');
    }

    // Open terminal in the body container
    term.open(termBody);
    console.log('[TerminalView] Terminal opened in DOM.');

    // Initial fit
    function fitTerminal() {
      if (fitAddon && termBody.clientWidth > 0 && termBody.clientHeight > 0) {
        try {
          fitAddon.fit();
        } catch (e) {
          console.warn('[TerminalView] FitAddon.fit() error:', e.message);
        }
      }
    }

    // Fit after a brief paint delay
    requestAnimationFrame(() => {
      fitTerminal();
    });

    // ---- Session state ----
    let sessionId = null;
    let isConnected = false;
    let isDestroyed = false;

    // ---- Start the SSH session via IPC ----
    try {
      const result = await pibridge.terminalStart({
        ip: credentials.ip,
        username: credentials.username,
        password: credentials.password
      });

      if (result && result.success) {
        sessionId = result.sessionId;
        isConnected = true;

        statusDot.className = 'term-status-dot connected';
        ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag">${sessionId}</span>`;
        disconnectBtn.disabled = false;
        console.log(`[TerminalView] Session started: ${sessionId}`);

        // Register the data callback for this session
        sessionCallbacks.set(sessionId, (dataStr) => {
          if (!isDestroyed) {
            term.write(dataStr);
          }
        });

      } else {
        const errMsg = (result && result.error) || 'Unknown error';
        statusDot.className = 'term-status-dot disconnected';
        ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag" style="color:#f38ba8;">Failed: ${errMsg}</span>`;
        term.write(`\r\n\x1b[1;31m*** Connection Failed: ${errMsg} ***\x1b[0m\r\n`);
        console.error(`[TerminalView] terminal-start failed:`, errMsg);
        return null;
      }
    } catch (err) {
      statusDot.className = 'term-status-dot disconnected';
      ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag" style="color:#f38ba8;">Error</span>`;
      term.write(`\r\n\x1b[1;31m*** Connection Error: ${err.message} ***\x1b[0m\r\n`);
      console.error(`[TerminalView] terminal-start exception:`, err);
      return null;
    }

    // ---- Wire user input → backend ----
    term.onData((data) => {
      if (isConnected && sessionId && !isDestroyed) {
        pibridge.terminalSend({ sessionId, input: data });
      }
    });

    // ---- Wire resize events → backend ----
    term.onResize((size) => {
      if (isConnected && sessionId && !isDestroyed) {
        console.log(`[TerminalView] Resize event: ${size.cols}x${size.rows}`);
        pibridge.terminalResize({ sessionId, cols: size.cols, rows: size.rows });
      }
    });

    // ---- ResizeObserver for container dimension changes ----
    let resizeTimeout = null;
    let resizeObserver = null;

    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          if (!isDestroyed) fitTerminal();
        }, 80);
      });
      resizeObserver.observe(termBody);
    }

    // ---- Disconnect button ----
    function disconnect() {
      if (isDestroyed) return;
      isDestroyed = true;
      isConnected = false;

      console.log(`[TerminalView] Disconnecting session ${sessionId}`);

      // Unregister session callback
      if (sessionId) {
        sessionCallbacks.delete(sessionId);
        pibridge.terminalClose({ sessionId }).catch((e) => {
          console.warn('[TerminalView] Error calling terminalClose:', e.message);
        });
      }

      // Update UI
      statusDot.className = 'term-status-dot disconnected';
      ipLabel.innerHTML = `${credentials.ip} <span class="term-session-tag">disconnected</span>`;
      disconnectBtn.disabled = true;

      // Cleanup
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }

      // Dispose the xterm instance
      try {
        term.dispose();
      } catch (e) {
        console.warn('[TerminalView] Error disposing terminal:', e.message);
      }
    }

    disconnectBtn.addEventListener('click', disconnect);

    // ---- Focus the terminal so user can start typing immediately ----
    term.focus();

    // ---- Return a handle object for external control ----
    return {
      sessionId,
      term,
      fitAddon,
      fit: fitTerminal,
      disconnect,
      get isConnected() { return isConnected; }
    };
  }

  // Expose globally
  window.initTerminal = initTerminal;

  console.log('[TerminalView] window.initTerminal registered.');
})();
