// ─────────────────────────────────────────────────────────────
// PiBridge — Embedded VNC Desktop Viewer Frontend Module
// ─────────────────────────────────────────────────────────────
// Initialised via: window.initVnc(pibridge, containerId, credentials)
// Scoped CSS styles are injected dynamically.
// Class names are prefixed with `vnc-` to avoid conflicts.

(function () {
  'use strict';

  // ── Inject scoped styles ──────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .vnc-root {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 16px;
      animation: fadeIn 0.3s ease;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .vnc-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(22, 22, 38, 0.4);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 10px 16px;
      border-radius: var(--radius-sm, 8px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      flex-shrink: 0;
    }

    .vnc-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
      transition: background-color 0.3s, box-shadow 0.3s;
    }
    .vnc-status-dot.connected {
      background: #10b981;
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
    }
    .vnc-status-dot.connecting {
      background: #f59e0b;
      box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
      animation: vnc-pulse 1.2s infinite ease-in-out;
    }

    @keyframes vnc-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .vnc-ip-display {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary, #f3f4f6);
      flex: 1;
    }

    .vnc-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      padding: 8px 14px;
      color: var(--text-secondary, #9ca3af);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .vnc-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary, #f3f4f6);
    }
    .vnc-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .vnc-btn-connect {
      background: linear-gradient(135deg, var(--accent-purple, #a855f7), var(--accent-blue, #3b82f6));
      color: #fff;
      border: none;
    }
    .vnc-btn-connect:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(168, 85, 247, 0.25);
      transform: translateY(-1px);
    }

    .vnc-btn-disconnect {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.25);
    }
    .vnc-btn-disconnect:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.18);
      color: #f87171;
    }

    .vnc-viewport {
      flex: 1;
      background: #06060e;
      border-radius: var(--radius-md, 12px);
      overflow: hidden;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .vnc-canvas-wrapper {
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .vnc-canvas {
      display: block;
      background: #000;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      aspect-ratio: 4/3;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
      cursor: crosshair;
    }

    /* Message banner overlaid on canvas */
    .vnc-status-banner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(12, 12, 22, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 20px 30px;
      border-radius: var(--radius-md, 12px);
      text-align: center;
      max-width: 80%;
      z-index: 5;
      pointer-events: none;
      animation: fadeIn 0.3s ease;
    }
    .vnc-status-banner-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    .vnc-status-banner-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary, #f3f4f6);
      margin-bottom: 4px;
    }
    .vnc-status-banner-desc {
      font-size: 12px;
      color: var(--text-muted, #6b7280);
    }
  `;
  document.head.appendChild(styleEl);

  // ── Helper: Toast (shared UI notifier) ────────────────────
  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) { console.log('[VNC Toast]', type, message); return; }

    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Global active tab state hook ──────────────────────────
  let globalActiveTab = 'vnc';

  // ═════════════════════════════════════════════════════════════
  // Main Initialisation
  // ═════════════════════════════════════════════════════════════
  window.initVnc = async function initVnc(pibridge, containerId, credentials) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[VNC] Container element not found:', containerId);
      return;
    }

    console.log('[VNC] Initializing embedded VNC viewer on:', credentials.ip);

    // Load Settings to detect Demo Mode
    let settings = { demoMode: false };
    try {
      settings = await pibridge.getSettings();
    } catch (e) {
      console.warn('[VNC] Could not fetch settings, defaulting to Real Mode:', e);
    }
    const isDemo = settings.demoMode;

    // Build DOM structure
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'vnc-root';
    root.innerHTML = `
      <div class="vnc-toolbar">
        <div class="vnc-status-dot"></div>
        <div class="vnc-ip-display">${credentials.ip} ${isDemo ? '<span style="color:var(--accent-purple); font-weight:600; font-size:11px; margin-left:8px;">[Demo Mode]</span>' : ''}</div>
        <button class="vnc-btn vnc-btn-connect">🖥️ Connect Desktop</button>
        <button class="vnc-btn vnc-btn-disconnect" disabled>🛑 Disconnect</button>
        <button class="vnc-btn vnc-btn-fullscreen">↕️ Fullscreen</button>
      </div>
      <div class="vnc-viewport">
        <div class="vnc-canvas-wrapper">
          <canvas class="vnc-canvas" width="1024" height="768"></canvas>
          <div class="vnc-status-banner">
            <div class="vnc-status-banner-icon">🖥️</div>
            <div class="vnc-status-banner-title">Embedded VNC Viewer</div>
            <div class="vnc-status-banner-desc">Ready to establish connection. Click "Connect Desktop" above.</div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(root);

    // DOM Elements
    const statusDot = root.querySelector('.vnc-status-dot');
    const btnConnect = root.querySelector('.vnc-btn-connect');
    const btnDisconnect = root.querySelector('.vnc-btn-disconnect');
    const btnFullscreen = root.querySelector('.vnc-btn-fullscreen');
    const canvas = root.querySelector('.vnc-canvas');
    const ctx = canvas.getContext('2d');
    const statusBanner = root.querySelector('.vnc-status-banner');
    const bannerIcon = root.querySelector('.vnc-status-banner-icon');
    const bannerTitle = root.querySelector('.vnc-status-banner-title');
    const bannerDesc = root.querySelector('.vnc-status-banner-desc');
    const viewport = root.querySelector('.vnc-viewport');

    // Connection variables
    let ws = null;
    let rfbState = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED
    let rfbBuffer = [];
    let rfbPort = null;
    let updateInterval = null; // Canvas redrawing timer for Demo Mode or clock ticks

    // ── Mouse coordinates on canvas ─────────────────────────
    let mousePos = { x: 0, y: 0 };
    let currentButtons = 0;

    // ── Demo Mode Desktop Simulation States ──────────────────
    let demoClockTime = '';
    const demoWindows = [
      {
        id: 'terminal',
        x: 220,
        y: 120,
        w: 580,
        h: 360,
        title: 'pi@raspberrypi: ~ (SSH)',
        minimized: false,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        output: [
          'pi@raspberrypi:~ $ neofetch',
          '       `,.',
          '     ,` -..`      pi@raspberrypi',
          '    /   .   \\     --------------',
          '   |    .    |    OS: Raspberry Pi OS (64-bit)',
          '   \\    `    /    Kernel: 6.1.21-v8+',
          '    `.. , ..`     Uptime: 2 days, 4 hours',
          '                  CPU: BCM2711 (RPi 4)',
          '                  Memory: 1042MiB / 7924MiB',
          '',
          'pi@raspberrypi:~ $ uptime',
          ' 19:27:02 up 14 days,  2:35,  1 user,  load average: 0.12, 0.08, 0.05',
          'pi@raspberrypi:~ $ _'
        ]
      }
    ];

    const demoIcons = [
      { id: 'trash', name: 'Trash', symbol: '🗑️', x: 50, y: 60 },
      { id: 'files', name: 'Files (SFTP)', symbol: '📂', x: 50, y: 150, tab: 'sftp' },
      { id: 'terminal', name: 'SSH Console', symbol: '💻', x: 50, y: 240, tab: 'terminal' },
      { id: 'store', name: 'App Store', symbol: '📦', x: 50, y: 330, tab: 'installer' },
      { id: 'backup', name: 'SD Backup', symbol: '💾', x: 50, y: 420, tab: 'backup' }
    ];

    // Status Banner updates
    function setBanner(icon, title, desc, visible = true) {
      if (visible) {
        statusBanner.style.display = 'block';
        bannerIcon.textContent = icon;
        bannerTitle.textContent = title;
        bannerDesc.textContent = desc;
      } else {
        statusBanner.style.display = 'none';
      }
    }

    // Set connection status dot class
    function setStatus(state) {
      rfbState = state;
      statusDot.className = 'vnc-status-dot';
      if (state === 'CONNECTED') {
        statusDot.classList.add('connected');
      } else if (state === 'CONNECTING') {
        statusDot.classList.add('connecting');
      }
    }

    // Canvas scaling pos calculator
    function getMousePos(canvasEl, evt) {
      const rect = canvasEl.getBoundingClientRect();
      return {
        x: Math.round(((evt.clientX - rect.left) / rect.width) * canvasEl.width),
        y: Math.round(((evt.clientY - rect.top) / rect.height) * canvasEl.height)
      };
    }

    // ─────────────────────────────────────────────────────────────
    // RFB Client Handshaking and Message Parsing (Real Mode)
    // ─────────────────────────────────────────────────────────────
    function initRfbConnection(wsPort) {
      rfbBuffer = [];
      const wsUrl = `ws://localhost:${wsPort}`;
      console.log('[VNC Client] Connecting to proxy at:', wsUrl);
      
      ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        console.log('[VNC Client] WebSocket open. Waiting for RFB version...');
        rfbState = 'WAITING_VERSION';
        setStatus('CONNECTING');
        setBanner('⏳', 'Handshaking...', 'Exchanging RFB version bytes...');
      };

      ws.onmessage = (event) => {
        const uintArr = new Uint8Array(event.data);
        for (let i = 0; i < uintArr.length; i++) {
          rfbBuffer.push(uintArr[i]);
        }
        parseRfbStream();
      };

      ws.onclose = (event) => {
        console.log('[VNC Client] Connection closed:', event.reason);
        handleDisconnect('Disconnected from VNC Proxy.');
      };

      ws.onerror = (err) => {
        console.error('[VNC Client] WS Error:', err);
        showToast('VNC client socket error.', 'error');
      };
    }

    function parseRfbStream() {
      if (rfbState === 'WAITING_VERSION') {
        if (rfbBuffer.length < 12) return;
        const versionBytes = rfbBuffer.splice(0, 12);
        const versionStr = String.fromCharCode.apply(null, versionBytes);
        console.log('[VNC Client] Version received:', versionStr.trim());
        
        // Reply with same version (always RFB 003.008)
        const reply = new Uint8Array(12);
        for (let i = 0; i < 12; i++) {
          reply[i] = versionBytes[i];
        }
        ws.send(reply);
        rfbState = 'WAITING_SECURITY';
        parseRfbStream(); // Check if there are more bytes in buffer

      } else if (rfbState === 'WAITING_SECURITY') {
        if (rfbBuffer.length < 1) return;
        const numTypes = rfbBuffer[0];
        if (rfbBuffer.length < 1 + numTypes) return;

        rfbBuffer.shift(); // remove numTypes
        const types = rfbBuffer.splice(0, numTypes);
        console.log('[VNC Client] Supported security types:', types);

        // Prefer Type 1 (None). Fallback to Type 2 (VNC Auth)
        let selected = types.includes(1) ? 1 : types[0];
        ws.send(new Uint8Array([selected]));

        if (selected === 1) {
          rfbState = 'WAITING_SECURITY_RESULT';
        } else {
          setBanner('🔑', 'VNC Authentication', 'Negotiating password exchange...');
          rfbState = 'WAITING_SECURITY_RESULT';
        }
        parseRfbStream();

      } else if (rfbState === 'WAITING_SECURITY_RESULT') {
        if (rfbBuffer.length < 4) return;
        const resultBytes = rfbBuffer.splice(0, 4);
        const code = (resultBytes[0] << 24) | (resultBytes[1] << 16) | (resultBytes[2] << 8) | resultBytes[3];
        
        if (code === 0) {
          console.log('[VNC Client] Handshake OK. Sending ClientInit...');
          // ClientInit: Shared-Desktop flag (1 byte = 1)
          ws.send(new Uint8Array([1]));
          rfbState = 'WAITING_SERVER_INIT';
        } else {
          console.error('[VNC Client] VNC auth failed:', code);
          showToast('VNC Authentication failed. Check Pi server config.', 'error');
          ws.close();
        }
        parseRfbStream();

      } else if (rfbState === 'WAITING_SERVER_INIT') {
        if (rfbBuffer.length < 24) return;
        // Peek name length
        const nameLength = (rfbBuffer[20] << 24) | (rfbBuffer[21] << 16) | (rfbBuffer[22] << 8) | rfbBuffer[23];
        if (rfbBuffer.length < 24 + nameLength) return; // wait for full name

        const initBytes = rfbBuffer.splice(0, 24);
        const nameBytes = rfbBuffer.splice(0, nameLength);
        const name = String.fromCharCode.apply(null, nameBytes);

        const w = (initBytes[0] << 8) | initBytes[1];
        const h = (initBytes[2] << 8) | initBytes[3];

        console.log(`[VNC Client] ServerInit: "${name}" (${w}x${h})`);
        canvas.width = w;
        canvas.height = h;
        setBanner('', '', '', false);
        setStatus('CONNECTED');

        btnConnect.disabled = true;
        btnDisconnect.disabled = false;
        showToast('VNC Desktop connected successfully!', 'success');

        // Initial update request (Incremental = 0)
        sendFramebufferRequest(0, 0, 0, w, h);

        rfbState = 'CONNECTED';
        parseRfbStream();

      } else if (rfbState === 'CONNECTED') {
        if (rfbBuffer.length < 4) return;
        const msgType = rfbBuffer[0];
        if (msgType !== 0) {
          // Unknown message, flush 1 byte to realign
          rfbBuffer.shift();
          parseRfbStream();
          return;
        }

        const numRects = (rfbBuffer[2] << 8) | rfbBuffer[3];
        let offset = 4;

        if (rfbBuffer.length < offset + 12) return; // incomplete first rect header

        const rx = (rfbBuffer[offset] << 8) | rfbBuffer[offset + 1];
        const ry = (rfbBuffer[offset + 2] << 8) | rfbBuffer[offset + 3];
        const rw = (rfbBuffer[offset + 4] << 8) | rfbBuffer[offset + 5];
        const rh = (rfbBuffer[offset + 6] << 8) | rfbBuffer[offset + 7];
        const encoding = (rfbBuffer[offset + 8] << 24) | (rfbBuffer[offset + 9] << 16) | (rfbBuffer[offset + 10] << 8) | rfbBuffer[offset + 11];

        const pixelDataSize = rw * rh * 4; // Assuming 32-bpp raw
        if (rfbBuffer.length < offset + 12 + pixelDataSize) return; // wait for full rectangle

        // Consume message header and rect header
        rfbBuffer.splice(0, offset + 12);
        const pixelBytes = rfbBuffer.splice(0, pixelDataSize);

        if (encoding === 0) { // Raw encoding
          renderRawRect(rx, ry, rw, rh, pixelBytes);
        }

        // Send incremental update request for the same region to keep updates flowing
        sendFramebufferRequest(1, rx, ry, rw, rh);

        // Process remaining buffer
        parseRfbStream();
      }
    }

    function renderRawRect(x, y, w, h, bytes) {
      const img = ctx.createImageData(w, h);
      const data = img.data;

      // Map BGRA/RGBA format to canvas RGBA
      for (let i = 0; i < bytes.length; i += 4) {
        data[i]     = bytes[i + 2]; // R
        data[i + 1] = bytes[i + 1]; // G
        data[i + 2] = bytes[i];     // B
        data[i + 3] = bytes[i + 3]; // A
      }
      ctx.putImageData(img, x, y);
    }

    function sendFramebufferRequest(incremental, x, y, w, h) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const req = new Uint8Array(10);
        req[0] = 3; // FramebufferUpdateRequest
        req[1] = incremental ? 1 : 0;
        req.set([(x >> 8) & 0xff, x & 0xff], 2);
        req.set([(y >> 8) & 0xff, y & 0xff], 4);
        req.set([(w >> 8) & 0xff, w & 0xff], 6);
        req.set([(h >> 8) & 0xff, h & 0xff], 8);
        ws.send(req);
      }
    }

    function sendPointerEvent(buttons, x, y) {
      if (ws && ws.readyState === WebSocket.OPEN && rfbState === 'CONNECTED') {
        const event = new Uint8Array(6);
        event[0] = 5; // PointerEvent
        event[1] = buttons;
        event.set([(x >> 8) & 0xff, x & 0xff], 2);
        event.set([(y >> 8) & 0xff, y & 0xff], 4);
        ws.send(event);
      }
    }

    function sendKeyEvent(down, keysym) {
      if (ws && ws.readyState === WebSocket.OPEN && rfbState === 'CONNECTED') {
        const event = new Uint8Array(8);
        event[0] = 4; // KeyEvent
        event[1] = down ? 1 : 0;
        // padding: 2 bytes
        event.set([
          (keysym >> 24) & 0xff,
          (keysym >> 16) & 0xff,
          (keysym >> 8) & 0xff,
          keysym & 0xff
        ], 4);
        ws.send(event);
      }
    }


    // ─────────────────────────────────────────────────────────────
    // Demo Mode Drawing Logic (Canvas)
    // ─────────────────────────────────────────────────────────────
    function drawDemoDesktop() {
      // 1. Wallpaper Gradient
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, '#130424'); // Dark purple
      grad.addColorStop(0.5, '#2e0828'); // Magenta tone
      grad.addColorStop(1, '#081c2f'); // Deep teal blue
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Grid lines to make it look premium
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = 0; x < canvas.width; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // 3. Desktop Icons
      demoIcons.forEach(icon => {
        // Icon shape highlight
        const boxX = icon.x - 30;
        const boxY = icon.y - 20;
        const boxW = 70;
        const boxH = 75;

        // Hover highlight
        const isHover = mousePos.x >= boxX && mousePos.x <= boxX + boxW &&
                        mousePos.y >= boxY && mousePos.y <= boxY + boxH;
        
        if (isHover) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
          // Rounded rect
          ctx.beginPath();
          ctx.roundRect(boxX, boxY, boxW, boxH, 8);
          ctx.fill();
          ctx.stroke();
        }

        // Draw symbol
        ctx.font = '28px "Segoe UI Symbol", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(icon.symbol, icon.x, icon.y + 10);

        // Draw name
        ctx.font = '11px "Inter", sans-serif';
        ctx.fillStyle = '#cdd6f4';
        ctx.fillText(icon.name, icon.x, icon.y + 44);
      });

      // 4. Windows
      demoWindows.forEach(win => {
        if (win.minimized) return;

        // Shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 12;

        // Window background
        ctx.fillStyle = '#11111b';
        ctx.beginPath();
        ctx.roundRect(win.x, win.y, win.w, win.h, 12);
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Title bar
        ctx.fillStyle = '#1e1e2e';
        ctx.beginPath();
        ctx.roundRect(win.x, win.y, win.w, 32, [12, 12, 0, 0]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();

        // Title text
        ctx.font = 'bold 12px "JetBrains Mono", monospace';
        ctx.fillStyle = '#bac2de';
        ctx.textAlign = 'left';
        ctx.fillText(win.title, win.x + 45, win.y + 17);

        // Window buttons (red, yellow, green)
        const dotColors = ['#f38ba8', '#f9e2af', '#a6e3a1'];
        dotColors.forEach((color, i) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(win.x + 18 + i * 16, win.y + 16, 5, 0, Math.PI * 2);
          ctx.fill();
        });

        // Window Content (Terminal Output)
        ctx.fillStyle = '#cdd6f4';
        ctx.font = '13px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        const startY = win.y + 54;
        win.output.forEach((line, index) => {
          // If it has a blinking cursor, draw it
          if (line.endsWith('_')) {
            const timeMs = Date.now();
            const showCursor = Math.floor(timeMs / 500) % 2 === 0;
            const content = line.substring(0, line.length - 1) + (showCursor ? '█' : ' ');
            ctx.fillText(content, win.x + 16, startY + index * 18);
          } else {
            ctx.fillText(line, win.x + 16, startY + index * 18);
          }
        });
      });

      // 5. Taskbar (Bottom)
      const taskY = canvas.height - 40;
      ctx.fillStyle = 'rgba(17, 17, 27, 0.88)';
      ctx.fillRect(0, taskY, canvas.width, 40);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(0, taskY);
      ctx.lineTo(canvas.width, taskY);
      ctx.stroke();

      // Pi Start Menu Button (gradient circle with pi symbol)
      const menuX = 24;
      const menuY = taskY + 20;
      const rGrad = ctx.createRadialGradient(menuX, menuY, 2, menuX, menuY, 15);
      rGrad.addColorStop(0, '#f38ba8');
      rGrad.addColorStop(1, '#e64570');
      ctx.fillStyle = rGrad;
      ctx.beginPath();
      ctx.arc(menuX, menuY, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('π', menuX, menuY - 1);

      // Taskbar Tray Status (Clock and Stats)
      ctx.font = '12px "Inter", sans-serif';
      ctx.fillStyle = '#cdd6f4';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(demoClockTime, canvas.width - 20, taskY + 20);

      // CPU status badge
      ctx.fillText('⚡ 42°C', canvas.width - 120, taskY + 20);
      ctx.fillText('📶 100%', canvas.width - 190, taskY + 20);

      // 6. Draw Fake OS cursor to overlay the user's cursor inside canvas
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mousePos.x, mousePos.y);
      ctx.lineTo(mousePos.x + 12, mousePos.y + 12);
      ctx.lineTo(mousePos.x + 4, mousePos.y + 13);
      ctx.lineTo(mousePos.x + 9, mousePos.y + 20);
      ctx.lineTo(mousePos.x + 6, mousePos.y + 21);
      ctx.lineTo(mousePos.x + 1, mousePos.y + 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    function updateDemoClock() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      demoClockTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    // ─────────────────────────────────────────────────────────────
    // View Connection & Action Handlers
    // ─────────────────────────────────────────────────────────────
    async function handleConnect() {
      btnConnect.disabled = true;
      setStatus('CONNECTING');
      setBanner('⏳', 'Initializing VNC Session...', 'Spawning websocket tunnel...');

      try {
        const result = await pibridge.vncProxyStart({ ip: credentials.ip, port: 5900 });
        if (result && result.success) {
          rfbPort = result.wsPort;
          console.log('[VNC] Proxy launched successfully on local port:', rfbPort);
          
          if (isDemo) {
            // Simulated connection immediately
            setTimeout(() => {
              setBanner('', '', '', false);
              setStatus('CONNECTED');
              btnConnect.disabled = true;
              btnDisconnect.disabled = false;
              showToast('Demo Desktop started!', 'success');

              // Launch Demo Loop
              updateDemoClock();
              updateInterval = setInterval(() => {
                updateDemoClock();
                drawDemoDesktop();
              }, 1000);

              // Connect local mock WebSocket server
              initRfbConnection(rfbPort);
            }, 1000);
          } else {
            // Setup real RFB protocol client
            initRfbConnection(rfbPort);
          }
        } else {
          const errMsg = (result && result.error) || 'Could not map local port.';
          handleDisconnect('Failed to start proxy: ' + errMsg);
          showToast('VNC Connection Failed: ' + errMsg, 'error');
        }
      } catch (err) {
        handleDisconnect(err.message);
        showToast('VNC Exception: ' + err.message, 'error');
      }
    }

    async function handleDisconnect(msg) {
      console.log('[VNC] Disconnecting session for:', credentials.ip);
      setStatus('DISCONNECTED');
      setBanner('🖥️', 'Embedded VNC Desktop', msg || 'Session terminated. Click Connect to restart.');

      btnConnect.disabled = false;
      btnDisconnect.disabled = true;

      if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
      }

      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }

      // Stop the proxy process
      try {
        await pibridge.vncProxyStop({ ip: credentials.ip });
      } catch (e) {
        console.warn('[VNC] Error stopping backend proxy:', e.message);
      }

      // Draw blank canvas
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // ── Fullscreen toggle handler ────────────────────────────
    function toggleFullscreen() {
      if (!document.fullscreenElement) {
        viewport.requestFullscreen().catch(err => {
          showToast(`Could not activate fullscreen: ${err.message}`, 'error');
        });
      } else {
        document.exitFullscreen();
      }
    }

    // ── Mouse & UI Event Listeners ──────────────────────────
    canvas.addEventListener('mousemove', (e) => {
      mousePos = getMousePos(canvas, e);

      if (rfbState === 'CONNECTED') {
        if (isDemo) {
          // Check dragging of window
          const termWin = demoWindows[0];
          if (termWin.isDragging) {
            termWin.x = mousePos.x - termWin.dragOffset.x;
            termWin.y = mousePos.y - termWin.dragOffset.y;
            // keep bounds
            termWin.x = Math.max(0, Math.min(canvas.width - termWin.w, termWin.x));
            termWin.y = Math.max(0, Math.min(canvas.height - termWin.h, termWin.y));
          }
          drawDemoDesktop();
        } else {
          // Forward pointer events to real server
          sendPointerEvent(currentButtons, mousePos.x, mousePos.y);
        }
      }
    });

    canvas.addEventListener('mousedown', (e) => {
      // Button masks: Left=1, Middle=2, Right=4
      if (e.button === 0) currentButtons |= 1;
      if (e.button === 1) currentButtons |= 2;
      if (e.button === 2) currentButtons |= 4;

      if (rfbState === 'CONNECTED') {
        if (isDemo) {
          // Check start Menu clicks
          const taskY = canvas.height - 40;
          if (mousePos.y >= taskY && mousePos.x >= 10 && mousePos.x <= 40) {
            showToast('Opening Start Menu... (Simulation)', 'info');
          }

          // Check desktop icon clicks
          demoIcons.forEach(icon => {
            const boxX = icon.x - 30;
            const boxY = icon.y - 20;
            const boxW = 70;
            const boxH = 75;
            const inside = mousePos.x >= boxX && mousePos.x <= boxX + boxW &&
                           mousePos.y >= boxY && mousePos.y <= boxY + boxH;

            if (inside && icon.tab) {
              // Clicked an active tab shortcut!
              showToast(`Opening ${icon.name}...`, 'success');
              const btn = document.getElementById(`nav-${icon.tab}-btn`);
              if (btn) btn.click();
            }
          });

          // Check terminal window drag bar
          const termWin = demoWindows[0];
          if (!termWin.minimized &&
              mousePos.x >= termWin.x && mousePos.x <= termWin.x + termWin.w &&
              mousePos.y >= termWin.y && mousePos.y <= termWin.y + 32) {
            
            // Check close button click
            if (mousePos.x >= termWin.x + 10 && mousePos.x <= termWin.x + 24) {
              termWin.minimized = true;
              showToast('SSH Console window closed.', 'info');
            } else {
              termWin.isDragging = true;
              termWin.dragOffset.x = mousePos.x - termWin.x;
              termWin.dragOffset.y = mousePos.y - termWin.y;
            }
          }
        } else {
          sendPointerEvent(currentButtons, mousePos.x, mousePos.y);
        }
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) currentButtons &= ~1;
      if (e.button === 1) currentButtons &= ~2;
      if (e.button === 2) currentButtons &= ~4;

      if (rfbState === 'CONNECTED') {
        if (isDemo) {
          demoWindows[0].isDragging = false;
        } else {
          sendPointerEvent(currentButtons, mousePos.x, mousePos.y);
        }
      }
    });

    // Prevent context menu on canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ── Keydown event listeners (Scoped to tab) ─────────────
    const keydownHandler = (e) => {
      if (rfbState !== 'CONNECTED' || globalActiveTab !== 'vnc') return;

      // Translate common keys to VNC keysyms
      let keysym = e.key.charCodeAt(0);
      if (e.key === 'Backspace') keysym = 0xff08;
      if (e.key === 'Tab')       keysym = 0xff09;
      if (e.key === 'Enter')     keysym = 0xff0d;
      if (e.key === 'Escape')    keysym = 0xff1b;
      if (e.key === 'ArrowLeft')  keysym = 0xff51;
      if (e.key === 'ArrowUp')    keysym = 0xff52;
      if (e.key === 'ArrowRight') keysym = 0xff53;
      if (e.key === 'ArrowDown')  keysym = 0xff54;

      if (keysym) {
        if (isDemo) {
          // Echo input into simulated console
          const termWin = demoWindows[0];
          if (e.key === 'Enter') {
            termWin.output.push('pi@raspberrypi:~ $ ');
          } else if (e.key.length === 1) {
            const lastIdx = termWin.output.length - 1;
            const currentLine = termWin.output[lastIdx];
            termWin.output[lastIdx] = currentLine.replace('_', '') + e.key + '_';
          }
          drawDemoDesktop();
        } else {
          sendKeyEvent(true, keysym);
        }
        e.preventDefault();
      }
    };

    const keyupHandler = (e) => {
      if (rfbState !== 'CONNECTED' || globalActiveTab !== 'vnc' || isDemo) return;

      let keysym = e.key.charCodeAt(0);
      if (e.key === 'Backspace') keysym = 0xff08;
      if (e.key === 'Tab')       keysym = 0xff09;
      if (e.key === 'Enter')     keysym = 0xff0d;
      if (e.key === 'Escape')    keysym = 0xff1b;
      if (e.key === 'ArrowLeft')  keysym = 0xff51;
      if (e.key === 'ArrowUp')    keysym = 0xff52;
      if (e.key === 'ArrowRight') keysym = 0xff53;
      if (e.key === 'ArrowDown')  keysym = 0xff54;

      if (keysym) {
        sendKeyEvent(false, keysym);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('keyup', keyupHandler);

    // Toolbar button click events
    btnConnect.addEventListener('click', handleConnect);
    btnDisconnect.addEventListener('click', () => handleDisconnect());
    btnFullscreen.addEventListener('click', toggleFullscreen);

    // Clean up connections when navigating away
    const navButtons = document.querySelectorAll('.nav-item');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        globalActiveTab = targetView;
        if (targetView !== 'vnc' && rfbState !== 'DISCONNECTED') {
          // If we navigate away, don't disconnect automatically to allow multi-tasking,
          // but stop redrawing intervals if in demo mode to save CPU cycles.
          if (isDemo && updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
          }
        } else if (targetView === 'vnc' && rfbState === 'CONNECTED' && isDemo && !updateInterval) {
          // Restart demo draw ticks
          updateDemoClock();
          updateInterval = setInterval(() => {
            updateDemoClock();
            drawDemoDesktop();
          }, 1000);
        }
      });
    });

    // Hook tab switches globally
    window.addEventListener('hashchange', () => {
      globalActiveTab = window.location.hash.substring(1);
    });

    // Check size initially
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    console.log('[VNC] Embedded VNC Desktop module UI boot completed.');

    return {
      disconnect: () => {
        window.removeEventListener('keydown', keydownHandler);
        window.removeEventListener('keyup', keyupHandler);
        handleDisconnect('VNC Viewer disconnected.');
      }
    };
  };
})();
