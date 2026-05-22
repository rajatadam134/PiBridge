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

// Active proxy servers keyed by target IP address
const activeProxies = new Map();

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
          logToUi(`VNC Proxy: Client connected. Bridging to ${ip}:${vncPort}`);

          // Open a TCP connection to the Pi's VNC server
          const tcpSocket = new net.Socket();

          tcpSocket.connect(vncPort, ip, () => {
            console.log(`[VNC Proxy] TCP connected to ${ip}:${vncPort}`);
            logToUi(`VNC Proxy: TCP connection established to ${ip}:${vncPort}`);
          });

          // Bridge: WebSocket → TCP
          clientWs.on('message', (message) => {
            if (tcpSocket.writable) {
              tcpSocket.write(Buffer.isBuffer(message) ? message : Buffer.from(message));
            }
          });

          // Bridge: TCP → WebSocket
          tcpSocket.on('data', (data) => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(data, { binary: true });
            }
          });

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
