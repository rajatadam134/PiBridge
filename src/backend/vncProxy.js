/**
 * VNC WebSocket-to-TCP Proxy Module
 * 
 * Creates per-IP local WebSocket servers that bridge browser-based VNC clients
 * to real VNC servers (port 5900) on Raspberry Pi devices.
 * 
 * In demo mode, the proxy simulates a full RFB 003.008 handshake and sends
 * periodic small data packets to mimic a live VNC feed.
 */

const { WebSocketServer, WebSocket } = require('ws');
const net = require('net');
const http = require('http');
const crypto = require('crypto');

// Active proxy servers keyed by target IP address
const activeProxies = new Map();

/**
 * Bit-reversal helper function for VNC DES keys.
 * Reverses the bits of a byte so that MSB becomes LSB, etc.
 * @param {number} b - A byte value (0-255).
 * @returns {number} The bit-reversed byte.
 */
function reverseBits(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if ((b & (1 << i)) !== 0) {
      r |= (1 << (7 - i));
    }
  }
  return r;
}

/**
 * Encrypts a 16-byte VNC challenge with a VNC password using DES.
 * @param {Buffer} challenge - 16-byte random challenge.
 * @param {string} password - The authentication password.
 * @returns {Buffer} The 16-byte encrypted response.
 */
function encryptVncChallenge(challenge, password) {
  const key = Buffer.alloc(8, 0);
  const passBuf = Buffer.from(password, 'ascii');
  for (let i = 0; i < Math.min(passBuf.length, 8); i++) {
    key[i] = reverseBits(passBuf[i]);
  }

  const cipher = crypto.createCipheriv('des-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([
    cipher.update(challenge),
    cipher.final()
  ]);
}

/**
 * Finds a random available TCP port by binding to port 0.
 * @returns {Promise<number>} An available port number.
 */
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Register VNC Proxy IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getSettings - Returns current app settings object.
 * @param {Function} logToUi - Sends log messages to the renderer console.
 */
module.exports = function registerVncProxyHandlers(ipcMain, getSettings, logToUi) {

  // ---------------------------------------------------------------
  // vnc-proxy-start
  // ---------------------------------------------------------------
  ipcMain.handle('vnc-proxy-start', async (event, data) => {
    const { ip, port: targetPort } = data;
    const vncPort = targetPort || 5900;
    const settings = getSettings();

    console.log(`[VNC Proxy] vnc-proxy-start requested for ${ip}:${vncPort}`);

    // If a proxy already exists for this IP, return its port
    if (activeProxies.has(ip)) {
      const existing = activeProxies.get(ip);
      const wsPort = existing.wsPort;
      logToUi(`VNC Proxy already active for ${ip} on ws://127.0.0.1:${wsPort}`);
      console.log(`[VNC Proxy] Reusing existing proxy for ${ip} on port ${wsPort}`);
      return { success: true, wsPort };
    }

    try {
      const wsPort = await getAvailablePort();
      console.log(`[VNC Proxy] Allocated port ${wsPort} for ${ip}`);

      // Create a plain HTTP server to host the WebSocket server
      const httpServer = http.createServer();
      const wss = new WebSocketServer({ server: httpServer });

      // ---- DEMO MODE ----
      if (settings.demoMode) {
        logToUi(`[Demo Mode] Starting VNC proxy simulation for ${ip} on port ${wsPort}`);

        wss.on('connection', (clientWs) => {
          console.log(`[VNC Proxy Demo] Client connected for ${ip}`);
          logToUi(`[Demo Mode] VNC client connected to proxy for ${ip}`);

          let handshakeState = 'VERSION';
          let fbUpdateInterval = null;

          // Step 1: Send the RFB protocol version string
          setTimeout(() => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(Buffer.from('RFB 003.008\n'));
              console.log(`[VNC Proxy Demo] Sent ProtocolVersion to client`);
              logToUi(`[Demo Mode Proxy] Sent ProtocolVersion (RFB 003.008)`);
            }
          }, 100);

          clientWs.on('message', (message) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            const msgBuf = Buffer.isBuffer(message) ? message : Buffer.from(message);

            if (handshakeState === 'VERSION') {
              // Client sent its version response (12 bytes)
              handshakeState = 'SECURITY';
              setTimeout(() => {
                if (clientWs.readyState !== WebSocket.OPEN) return;
                // Security types: 1 type available, type 1 (None)
                clientWs.send(Buffer.from([1, 1]));
                console.log(`[VNC Proxy Demo] Sent SecurityTypes (1 type: None)`);
                logToUi(`[Demo Mode Proxy] Sent SecurityTypes (1 type: None)`);
              }, 50);

            } else if (handshakeState === 'SECURITY') {
              // Client selected security type (1 byte: type 1 = None)
              handshakeState = 'SECURITY_RESULT';
              setTimeout(() => {
                if (clientWs.readyState !== WebSocket.OPEN) return;
                // SecurityResult: 0 (OK)
                clientWs.send(Buffer.from([0, 0, 0, 0]));
                console.log(`[VNC Proxy Demo] Sent SecurityResult OK`);
                logToUi(`[Demo Mode Proxy] Sent SecurityResult (OK)`);
              }, 50);

            } else if (handshakeState === 'SECURITY_RESULT') {
              // Client sent ClientInit (1 byte: shared-desktop flag)
              handshakeState = 'CONNECTED';
              setTimeout(() => {
                if (clientWs.readyState !== WebSocket.OPEN) return;

                // Build ServerInit message
                const desktopName = 'PiBridge Demo OS';
                const nameBytes = Buffer.from(desktopName, 'ascii');
                const serverInit = Buffer.alloc(24 + nameBytes.length);

                // Framebuffer width: 1024
                serverInit.writeUInt16BE(1024, 0);
                // Framebuffer height: 768
                serverInit.writeUInt16BE(768, 2);

                // Pixel Format (16 bytes starting at offset 4)
                serverInit[4] = 32;   // bits-per-pixel
                serverInit[5] = 24;   // depth
                serverInit[6] = 0;    // big-endian-flag (little)
                serverInit[7] = 1;    // true-colour-flag
                serverInit.writeUInt16BE(255, 8);   // red-max
                serverInit.writeUInt16BE(255, 10);  // green-max
                serverInit.writeUInt16BE(255, 12);  // blue-max
                serverInit[14] = 16;  // red-shift
                serverInit[15] = 8;   // green-shift
                serverInit[16] = 0;   // blue-shift
                // bytes 17-19 are padding (0)

                // Name length (4 bytes at offset 20)
                serverInit.writeUInt32BE(nameBytes.length, 20);
                // Desktop name string
                nameBytes.copy(serverInit, 24);

                clientWs.send(serverInit);
                console.log(`[VNC Proxy Demo] Sent ServerInit (${desktopName}). Client fully connected.`);
                logToUi(`[Demo Mode Proxy] Sent ServerInit. VNC client is fully connected.`);

                // Start sending periodic fake framebuffer update packets
                fbUpdateInterval = setInterval(() => {
                  if (clientWs.readyState !== WebSocket.OPEN) {
                    clearInterval(fbUpdateInterval);
                    return;
                  }

                  // RFB FramebufferUpdate message (type 0)
                  // Header: messageType(1) + padding(1) + numberOfRectangles(2)
                  // Rectangle: x(2) + y(2) + width(2) + height(2) + encodingType(4) + pixelData
                  const rectW = 64;
                  const rectH = 64;
                  const pixelDataSize = rectW * rectH * 4; // 32bpp
                  const headerSize = 4 + 12; // update header + rectangle header
                  const packet = Buffer.alloc(headerSize + pixelDataSize);

                  packet[0] = 0;     // message-type: FramebufferUpdate
                  packet[1] = 0;     // padding
                  packet.writeUInt16BE(1, 2); // number of rectangles: 1

                  // Rectangle header
                  const rx = Math.floor(Math.random() * (1024 - rectW));
                  const ry = Math.floor(Math.random() * (768 - rectH));
                  packet.writeUInt16BE(rx, 4);       // x-position
                  packet.writeUInt16BE(ry, 6);       // y-position
                  packet.writeUInt16BE(rectW, 8);    // width
                  packet.writeUInt16BE(rectH, 10);   // height
                  packet.writeInt32BE(0, 12);        // encoding-type: 0 (Raw)

                  // Fill with random pixel data to simulate updates
                  for (let i = headerSize; i < packet.length; i += 4) {
                    packet[i]     = Math.floor(Math.random() * 60) + 30;   // B
                    packet[i + 1] = Math.floor(Math.random() * 60) + 40;   // G
                    packet[i + 2] = Math.floor(Math.random() * 80) + 60;   // R
                    packet[i + 3] = 255;                                    // A
                  }

                  try {
                    clientWs.send(packet, { binary: true });
                  } catch (e) {
                    console.error(`[VNC Proxy Demo] Error sending FB update: ${e.message}`);
                    clearInterval(fbUpdateInterval);
                  }
                }, 2000); // Send a fake update every 2 seconds
              }, 80);

            } else if (handshakeState === 'CONNECTED') {
              // In connected state: absorb client messages (mouse, keyboard, FB requests)
              // For demo mode, we just ignore them silently
              const msgType = msgBuf.length > 0 ? msgBuf[0] : -1;
              console.log(`[VNC Proxy Demo] Received client message type=${msgType}, length=${msgBuf.length}`);
            }
          });

          clientWs.on('close', () => {
            console.log(`[VNC Proxy Demo] Client disconnected for ${ip}`);
            logToUi(`[Demo Mode Proxy] VNC client disconnected from ${ip}`);
            if (fbUpdateInterval) clearInterval(fbUpdateInterval);
          });

          clientWs.on('error', (err) => {
            console.error(`[VNC Proxy Demo] Client WS error: ${err.message}`);
            logToUi(`[Demo Mode Proxy] Client WS error: ${err.message}`);
            if (fbUpdateInterval) clearInterval(fbUpdateInterval);
          });
        });

      } else {
        // ---- REAL MODE ----
        logToUi(`Starting VNC proxy for ${ip}:${vncPort} on ws://127.0.0.1:${wsPort}`);

        wss.on('connection', (clientWs) => {
          console.log(`[VNC Proxy] Real mode: client connected for ${ip}:${vncPort}`);
          logToUi(`VNC Proxy: Client connected. Spawning tunnel to VNC server...`);

          const tcpSocket = new net.Socket();
          let tcpState = 'WAITING_VERSION';
          let tcpBuffer = [];

          let wsState = 'WAITING_VERSION';
          let wsBuffer = [];

          // Connect to real VNC server
          tcpSocket.connect(vncPort, ip, () => {
            console.log(`[VNC Proxy] TCP connected to VNC server at ${ip}:${vncPort}`);
            logToUi(`VNC Proxy: TCP connected to VNC server at ${ip}:${vncPort}. Authenticating...`);
          });

          // Set 10-second timeout on TCP connection
          tcpSocket.setTimeout(10000);
          tcpSocket.on('timeout', () => {
            console.error(`[VNC Proxy] TCP connection timeout for ${ip}`);
            logToUi(`VNC Proxy: Connection to ${ip}:${vncPort} timed out.`);
            tcpSocket.destroy();
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close(1006, 'Connection timed out');
            }
          });

          // -----------------------------------------------------------
          // TCP Stream Parser (Handshake with VNC Server)
          // -----------------------------------------------------------
          tcpSocket.on('data', (data) => {
            if (tcpState === 'FULLY_CONNECTED') {
              // Handshake complete: forward directly to WebSocket
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(data, { binary: true });
              }
              return;
            }

            // Append to buffer
            for (let i = 0; i < data.length; i++) {
              tcpBuffer.push(data[i]);
            }

            try {
              parseTcpHandshake();
            } catch (err) {
              console.error(`[VNC Proxy] TCP handshake parsing error: ${err.message}`);
              logToUi(`VNC Proxy: Handshake parsing error: ${err.message}`);
              tcpSocket.destroy();
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            }
          });

          function parseTcpHandshake() {
            let processed = true;
            while (processed && tcpState !== 'FULLY_CONNECTED') {
              processed = false;

              if (tcpState === 'WAITING_VERSION') {
                if (tcpBuffer.length < 12) return;
                const versionBytes = tcpBuffer.splice(0, 12);
                const versionStr = String.fromCharCode.apply(null, versionBytes);
                console.log(`[VNC Proxy] Server version: ${versionStr.trim()}`);
                logToUi(`VNC Proxy: Received server version: ${versionStr.trim()}`);

                // Reply with same version
                tcpSocket.write(Buffer.from(versionBytes));
                tcpState = 'WAITING_SECURITY';
                processed = true;

              } else if (tcpState === 'WAITING_SECURITY') {
                if (tcpBuffer.length < 1) return;
                const numTypes = tcpBuffer[0];
                if (tcpBuffer.length < 1 + numTypes) return;

                tcpBuffer.shift(); // remove numTypes
                const types = tcpBuffer.splice(0, numTypes);
                console.log(`[VNC Proxy] Server security types:`, types);
                logToUi(`VNC Proxy: Server security types: ${types.join(', ')}`);

                // Select security type: prefer None (1), fallback to VNC Auth (2)
                let selectedType = 1;
                if (types.includes(1)) {
                  selectedType = 1;
                } else if (types.includes(2)) {
                  selectedType = 2;
                } else {
                  selectedType = types[0] || 1; // Fallback to first supported or None
                }

                console.log(`[VNC Proxy] Selecting security type: ${selectedType}`);
                logToUi(`VNC Proxy: Selecting security type: ${selectedType}`);
                tcpSocket.write(Buffer.from([selectedType]));

                if (selectedType === 1) {
                  // None security type goes straight to WAITING_SECURITY_RESULT
                  tcpState = 'WAITING_SECURITY_RESULT';
                } else if (selectedType === 2) {
                  // VNC Auth goes to WAITING_CHALLENGE
                  tcpState = 'WAITING_CHALLENGE';
                } else {
                  // Unsupported type, try to wait for result
                  tcpState = 'WAITING_SECURITY_RESULT';
                }
                processed = true;

              } else if (tcpState === 'WAITING_CHALLENGE') {
                if (tcpBuffer.length < 16) return;
                const challenge = Buffer.from(tcpBuffer.splice(0, 16));
                console.log(`[VNC Proxy] Received VNC Auth challenge (16 bytes)`);
                logToUi(`VNC Proxy: Received authentication challenge.`);

                // Encrypt challenge with user's password
                const password = data.password || 'raspberry';
                const response = encryptVncChallenge(challenge, password);
                console.log(`[VNC Proxy] Sending VNC Auth response`);
                logToUi(`VNC Proxy: Sending encrypted credentials response...`);
                tcpSocket.write(response);
                tcpState = 'WAITING_SECURITY_RESULT';
                processed = true;

              } else if (tcpState === 'WAITING_SECURITY_RESULT') {
                if (tcpBuffer.length < 4) return;
                const resultBytes = tcpBuffer.splice(0, 4);
                const code = (resultBytes[0] << 24) | (resultBytes[1] << 16) | (resultBytes[2] << 8) | resultBytes[3];
                console.log(`[VNC Proxy] SecurityResult code: ${code}`);

                if (code === 0) {
                  logToUi(`VNC Proxy: Authentication successful! Tunnel is active.`);
                  tcpState = 'FULLY_CONNECTED';
                  processed = true;
                  // Start handshaking with client now that we are connected
                  startWsHandshake();
                } else {
                  console.error(`[VNC Proxy] SecurityResult failed: ${code}`);
                  logToUi(`VNC Proxy: Authentication failed (code ${code}). Check VNC password.`);
                  tcpSocket.destroy();
                  if (clientWs.readyState === WebSocket.OPEN) {
                    clientWs.close();
                  }
                }
              }
            }
          }

          // -----------------------------------------------------------
          // WebSocket Handshake with Client (Faking "None" security)
          // -----------------------------------------------------------
          function startWsHandshake() {
            if (clientWs.readyState !== WebSocket.OPEN) return;
            console.log(`[VNC Proxy] Starting WebSocket handshake with client`);
            // Step 1: Send version string (RFB 003.008)
            clientWs.send(Buffer.from('RFB 003.008\n'));
            wsState = 'WAITING_VERSION';
          }

          clientWs.on('message', (message) => {
            if (wsState === 'FULLY_CONNECTED') {
              // Direct bridge WebSocket → TCP
              if (tcpSocket.writable) {
                tcpSocket.write(Buffer.isBuffer(message) ? message : Buffer.from(message));
              }
              return;
            }

            // Handshaking phase
            const msgBuf = Buffer.isBuffer(message) ? message : Buffer.from(message);
            for (let i = 0; i < msgBuf.length; i++) {
              wsBuffer.push(msgBuf[i]);
            }

            try {
              parseWsHandshake();
            } catch (err) {
              console.error(`[VNC Proxy] WS handshake parsing error: ${err.message}`);
              tcpSocket.destroy();
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.close();
              }
            }
          });

          function parseWsHandshake() {
            let processed = true;
            while (processed && wsState !== 'FULLY_CONNECTED') {
              processed = false;

              if (wsState === 'WAITING_VERSION') {
                if (wsBuffer.length < 12) return;
                wsBuffer.splice(0, 12); // Consume client version string

                // Send SecurityTypes: 1 type (None)
                console.log(`[VNC Proxy] WS Handshake: Version received, sending security types`);
                clientWs.send(Buffer.from([1, 1]));
                wsState = 'WAITING_SECURITY';
                processed = true;

              } else if (wsState === 'WAITING_SECURITY') {
                if (wsBuffer.length < 1) return;
                const selected = wsBuffer.splice(0, 1)[0];
                console.log(`[VNC Proxy] WS Handshake: Client selected security type: ${selected}`);

                // Send SecurityResult: 0 (OK)
                clientWs.send(Buffer.from([0, 0, 0, 0]));
                wsState = 'WAITING_CLIENT_INIT';
                processed = true;

              } else if (wsState === 'WAITING_CLIENT_INIT') {
                if (wsBuffer.length < 1) return;
                const clientInit = wsBuffer.splice(0, 1);
                console.log(`[VNC Proxy] WS Handshake: Received ClientInit, tunnel fully open!`);

                // Send ClientInit directly to VNC server to trigger ServerInit
                tcpSocket.write(Buffer.from(clientInit));
                wsState = 'FULLY_CONNECTED';
                processed = true;
              }
            }
          }

          // Cleanup on WebSocket close
          clientWs.on('close', () => {
            console.log(`[VNC Proxy] Client WS closed for ${ip}. Destroying TCP socket.`);
            logToUi(`VNC Proxy: Client WS closed. Cleaning up TCP for ${ip}.`);
            tcpSocket.destroy();
          });

          // Cleanup on TCP close
          tcpSocket.on('close', () => {
            console.log(`[VNC Proxy] TCP socket closed for ${ip}. Closing client WS.`);
            logToUi(`VNC Proxy: TCP connection to ${ip}:${vncPort} closed.`);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          });

          // Error handlers
          clientWs.on('error', (err) => {
            console.error(`[VNC Proxy] Client WS error for ${ip}: ${err.message}`);
            logToUi(`VNC Proxy: WS error for ${ip}: ${err.message}`);
            tcpSocket.destroy();
          });

          tcpSocket.on('error', (err) => {
            console.error(`[VNC Proxy] TCP error for ${ip}: ${err.message}`);
            logToUi(`VNC Proxy: TCP error for ${ip}: ${err.message}`);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          });
        });
      }

      // Start listening
      await new Promise((resolve, reject) => {
        httpServer.listen(wsPort, '127.0.0.1', () => {
          console.log(`[VNC Proxy] WebSocket server listening on ws://127.0.0.1:${wsPort}`);
          resolve();
        });
        httpServer.on('error', (err) => {
          console.error(`[VNC Proxy] HTTP server error: ${err.message}`);
          reject(err);
        });
      });

      // Store in the active proxies map
      activeProxies.set(ip, {
        wss,
        httpServer,
        wsPort,
        targetIp: ip,
        targetPort: vncPort
      });

      logToUi(`VNC Proxy ready for ${ip} on ws://127.0.0.1:${wsPort}`);
      console.log(`[VNC Proxy] Proxy registered. Active proxies: ${activeProxies.size}`);

      return { success: true, wsPort };

    } catch (err) {
      console.error(`[VNC Proxy] Failed to start proxy for ${ip}: ${err.message}`);
      logToUi(`VNC Proxy Error: Failed to start proxy for ${ip}: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------------
  // vnc-proxy-stop
  // ---------------------------------------------------------------
  ipcMain.handle('vnc-proxy-stop', async (event, data) => {
    const { ip } = data;

    console.log(`[VNC Proxy] vnc-proxy-stop requested for ${ip}`);

    if (!activeProxies.has(ip)) {
      console.log(`[VNC Proxy] No active proxy found for ${ip}`);
      logToUi(`VNC Proxy: No active proxy for ${ip} to stop.`);
      return { success: true };
    }

    try {
      const proxy = activeProxies.get(ip);

      // Close all connected WebSocket clients
      proxy.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.close(1000, 'Proxy shutting down');
        }
      });

      // Close the WebSocket server
      await new Promise((resolve, reject) => {
        proxy.wss.close((err) => {
          if (err) {
            console.error(`[VNC Proxy] Error closing WSS for ${ip}: ${err.message}`);
          }
          resolve();
        });
      });

      // Close the HTTP server
      await new Promise((resolve) => {
        proxy.httpServer.close(() => {
          resolve();
        });
      });

      activeProxies.delete(ip);

      logToUi(`VNC Proxy stopped for ${ip}. Active proxies: ${activeProxies.size}`);
      console.log(`[VNC Proxy] Proxy stopped for ${ip}. Remaining: ${activeProxies.size}`);

      return { success: true };
    } catch (err) {
      console.error(`[VNC Proxy] Error stopping proxy for ${ip}: ${err.message}`);
      logToUi(`VNC Proxy Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // ---------------------------------------------------------------
  // Cleanup all proxies on app exit
  // ---------------------------------------------------------------
  process.on('exit', () => {
    console.log(`[VNC Proxy] Process exit — cleaning up ${activeProxies.size} proxies`);
    for (const [ip, proxy] of activeProxies) {
      try {
        proxy.wss.clients.forEach((client) => {
          try { client.terminate(); } catch (e) { /* ignore */ }
        });
        proxy.wss.close();
        proxy.httpServer.close();
      } catch (e) {
        console.error(`[VNC Proxy] Cleanup error for ${ip}: ${e.message}`);
      }
    }
    activeProxies.clear();
  });

  console.log('[VNC Proxy] IPC handlers registered: vnc-proxy-start, vnc-proxy-stop');
};
