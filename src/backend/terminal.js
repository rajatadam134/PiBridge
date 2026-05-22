/**
 * PiBridge SSH Terminal Backend Module
 *
 * Manages interactive SSH PTY shell sessions over ssh2.
 * Sessions are stored in a Map keyed by a unique sessionId (timestamp-based).
 * Shell output is streamed to the renderer via webContents.send('terminal-data', ...).
 *
 * Exports: registerTerminalHandlers(ipcMain, getSettings, logToUi, getMainWindow)
 */

const { Client } = require('ssh2');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Active session storage:  sessionId  →  { conn, stream, isDemo, demoState }
// ---------------------------------------------------------------------------
const activeSessions = new Map();

/**
 * Generate a unique session identifier (timestamp + random hex).
 */
function generateSessionId() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `term-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// Demo-mode helpers
// ---------------------------------------------------------------------------

/**
 * Build a simulated shell prompt string.
 */
function demoPrompt(username) {
  return `${username || 'pi'}@raspberrypi:~$ `;
}

/**
 * Return simulated output for well-known commands in demo mode.
 */
function simulateDemoCommand(cmd, ip, username) {
  const trimmed = cmd.trim();
  if (trimmed === '') return '';

  const tokens = trimmed.split(/\s+/);
  const base = tokens[0].toLowerCase();

  switch (base) {
    case 'ls':
      return 'Desktop  Documents  Downloads  Music  Pictures  Public  Templates  Videos  info.txt\r\n';

    case 'pwd':
      return `/home/${username || 'pi'}\r\n`;

    case 'whoami':
      return `${username || 'pi'}\r\n`;

    case 'uname':
      if (trimmed.includes('-a')) {
        return 'Linux raspberrypi 6.1.21-v8+ #1642 SMP PREEMPT Mon Apr  3 17:24:16 BST 2023 aarch64 GNU/Linux\r\n';
      }
      return 'Linux\r\n';

    case 'cat':
      if (tokens[1] === '/etc/os-release') {
        return [
          'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
          'NAME="Debian GNU/Linux"',
          'VERSION_ID="12"',
          'VERSION="12 (bookworm)"',
          'VERSION_CODENAME=bookworm',
          'ID=debian',
          'HOME_URL="https://www.debian.org/"',
          'SUPPORT_URL="https://www.debian.org/support"',
          'BUG_REPORT_URL="https://bugs.debian.org/"'
        ].join('\r\n') + '\r\n';
      }
      if (tokens[1] === 'info.txt') {
        return 'PiBridge Premium Remote Manager v1.1.0\r\nConnection: demo mode\r\nStatus: Connected in Demo Mode.\r\n';
      }
      if (!tokens[1]) {
        return 'Usage: cat <filename>\r\nTry: cat /etc/os-release\r\n';
      }
      return `cat: ${tokens[1]}: No such file or directory\r\n`;

    case 'top': {
      const uptime = '12:34:56 up  3:22,  1 user,  load average: 0.08, 0.12, 0.09';
      return [
        `top - ${uptime}`,
        'Tasks:  98 total,   1 running,  97 sleeping,   0 stopped,   0 zombie',
        '%Cpu(s):  2.3 us,  0.8 sy,  0.0 ni, 96.7 id,  0.1 wa,  0.0 hi,  0.1 si,  0.0 st',
        'MiB Mem :   3791.4 total,   2105.3 free,    842.6 used,    843.5 buff/cache',
        'MiB Swap:    100.0 total,    100.0 free,      0.0 used.   2712.1 avail Mem',
        '',
        '  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
        '  512 root      20   0  148392  38252  20012 S   1.3   1.0   2:14.32 Xorg',
        ' 1024 pi        20   0   93476  26364  18420 S   0.7   0.7   0:42.18 lxpanel',
        '  256 root      20   0   42880  12448   9176 S   0.3   0.3   0:18.06 systemd-journal',
        ' 2048 pi        20   0   12096   3780   3100 R   0.3   0.1   0:00.02 top',
        ''
      ].join('\r\n') + '\r\n';
    }

    case 'free':
      if (trimmed.includes('-m')) {
        return [
          '               total        used        free      shared  buff/cache   available',
          'Mem:            3791         842        2105          36         843        2712',
          'Swap:            100           0         100',
          ''
        ].join('\r\n') + '\r\n';
      }
      return [
        '               total        used        free      shared  buff/cache   available',
        'Mem:         3882496      862412     2154936       37284      865148     2777612',
        'Swap:         102396           0      102396',
        ''
      ].join('\r\n') + '\r\n';

    case 'clear':
      return '\x1b[2J\x1b[H';

    case 'help':
      return [
        'PiBridge SSH Terminal (Demo Mode) — Supported commands:',
        '  ls            - List directory contents',
        '  pwd           - Print working directory',
        '  whoami        - Print current user',
        '  uname -a      - System information',
        '  cat <file>    - Display file contents',
        '  top           - Process status (static snapshot)',
        '  free -m       - Memory usage',
        '  clear         - Clear terminal screen',
        '  help          - Show this help message',
        '  exit          - Close the terminal session',
        ''
      ].join('\r\n') + '\r\n';

    case 'exit':
      return '__EXIT__';

    case 'cd':
      return '';  // silently accept, no actual fs change in demo

    case 'hostname':
      return 'raspberrypi\r\n';

    case 'date':
      return new Date().toUTCString() + '\r\n';

    case 'uptime':
      return ' 12:34:56 up  3:22,  1 user,  load average: 0.08, 0.12, 0.09\r\n';

    default:
      return `bash: ${base}: command not found\r\n`;
  }
}

/**
 * Produce a Linux-style SSH welcome banner for demo mode.
 */
function demoBanner(ip, username) {
  return [
    'Linux raspberrypi 6.1.21-v8+ #1642 SMP PREEMPT Mon Apr  3 17:24:16 BST 2023 aarch64',
    '',
    'The programs included with the Debian GNU/Linux system are free software;',
    'the exact distribution terms for each program are described in the',
    'individual files in /usr/share/doc/*/copyright.',
    '',
    'Debian GNU/Linux comes with ABSOLUTELY NO WARRANTY, to the extent',
    'permitted by applicable law.',
    `Last login: ${new Date().toUTCString()} from 192.168.1.15`,
    '',
    ''
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// Main registration
// ---------------------------------------------------------------------------

/**
 * Register all IPC handlers for the terminal module.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {Function} getSettings  – returns current settings object
 * @param {Function} logToUi      – sends a log string to the renderer activity console
 * @param {Function} getMainWindow – returns the current BrowserWindow (or null)
 */
module.exports = function registerTerminalHandlers(ipcMain, getSettings, logToUi, getMainWindow) {

  // -----------------------------------------------------------------------
  // Helper – safely send data to the renderer
  // -----------------------------------------------------------------------
  function sendToRenderer(channel, payload) {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, payload);
    }
  }

  // -----------------------------------------------------------------------
  // IPC: terminal-start
  // Opens an SSH connection, starts a PTY shell, returns { success, sessionId }
  // -----------------------------------------------------------------------
  ipcMain.handle('terminal-start', async (event, data) => {
    const { ip, username, password } = data;
    const settings = getSettings();
    const sessionId = generateSessionId();

    console.log(`[Terminal] terminal-start requested for ${ip}, sessionId=${sessionId}, demoMode=${settings.demoMode}`);
    logToUi(`Terminal: Opening SSH shell to ${ip}...`);

    // ---- DEMO MODE ----
    if (settings.demoMode) {
      console.log(`[Terminal] Demo mode – creating simulated session ${sessionId}`);

      const demoState = {
        buffer: '',
        prompt: demoPrompt(username),
        username: username || 'pi',
        ip: ip
      };

      activeSessions.set(sessionId, { conn: null, stream: null, isDemo: true, demoState });

      // Send welcome banner + initial prompt after a short delay (feel natural)
      setTimeout(() => {
        const banner = demoBanner(ip, username);
        sendToRenderer('terminal-data', { sessionId, data: banner + demoState.prompt });
      }, 300);

      logToUi(`Terminal: [Demo] Shell session opened for ${ip} (${sessionId})`);
      return { success: true, sessionId };
    }

    // ---- REAL MODE ----
    return new Promise((resolve) => {
      const conn = new Client();

      conn.on('ready', () => {
        console.log(`[Terminal] SSH connection ready for ${ip}, requesting PTY shell`);
        logToUi(`Terminal: SSH connected to ${ip}. Spawning interactive shell...`);

        conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
          if (err) {
            console.error(`[Terminal] Failed to spawn shell on ${ip}:`, err.message);
            logToUi(`Terminal: Shell spawn failed on ${ip} — ${err.message}`);
            conn.end();
            resolve({ success: false, error: err.message });
            return;
          }

          // Store session
          activeSessions.set(sessionId, { conn, stream, isDemo: false, demoState: null });
          console.log(`[Terminal] Shell stream opened for session ${sessionId}`);

          // Pipe shell stdout → renderer
          stream.on('data', (chunk) => {
            sendToRenderer('terminal-data', { sessionId, data: chunk.toString('utf8') });
          });

          // Pipe shell stderr → renderer
          stream.stderr.on('data', (chunk) => {
            sendToRenderer('terminal-data', { sessionId, data: chunk.toString('utf8') });
          });

          // Handle stream close
          stream.on('close', () => {
            console.log(`[Terminal] Stream closed for session ${sessionId}`);
            sendToRenderer('terminal-data', { sessionId, data: '\r\n*** Connection Closed ***\r\n' });
            cleanupSession(sessionId);
          });

          logToUi(`Terminal: Shell session active for ${ip} (${sessionId})`);
          resolve({ success: true, sessionId });
        });
      });

      conn.on('error', (err) => {
        console.error(`[Terminal] SSH connection error for ${ip}:`, err.message);
        logToUi(`Terminal: Connection error to ${ip} — ${err.message}`);
        cleanupSession(sessionId);
        resolve({ success: false, error: err.message });
      });

      conn.on('end', () => {
        console.log(`[Terminal] SSH connection ended for session ${sessionId}`);
        sendToRenderer('terminal-data', { sessionId, data: '\r\n*** Connection Ended ***\r\n' });
        cleanupSession(sessionId);
      });

      conn.connect({
        host: ip,
        port: 22,
        username: username || 'pi',
        password: password || 'raspberry',
        readyTimeout: 10000
      });
    });
  });

  // -----------------------------------------------------------------------
  // IPC: terminal-send
  // Sends keystrokes / data to the PTY stream. Returns { success }.
  // -----------------------------------------------------------------------
  ipcMain.handle('terminal-send', async (event, data) => {
    const { sessionId, input } = data;
    const session = activeSessions.get(sessionId);

    if (!session) {
      console.warn(`[Terminal] terminal-send: no session found for ${sessionId}`);
      return { success: false, error: 'Session not found' };
    }

    // ---- DEMO MODE ----
    if (session.isDemo) {
      const ds = session.demoState;

      for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (ch === '\r' || ch === '\n') {
          // User pressed Enter – execute the buffered command
          const cmd = ds.buffer.trim();
          sendToRenderer('terminal-data', { sessionId, data: '\r\n' });

          const output = simulateDemoCommand(cmd, ds.ip, ds.username);

          if (output === '__EXIT__') {
            sendToRenderer('terminal-data', { sessionId, data: 'logout\r\nConnection to ' + ds.ip + ' closed.\r\n' });
            cleanupSession(sessionId);
            return { success: true };
          }

          if (output) {
            sendToRenderer('terminal-data', { sessionId, data: output });
          }

          // Show prompt again
          sendToRenderer('terminal-data', { sessionId, data: ds.prompt });
          ds.buffer = '';

        } else if (ch === '\x7f' || ch === '\x08') {
          // Backspace
          if (ds.buffer.length > 0) {
            ds.buffer = ds.buffer.slice(0, -1);
            sendToRenderer('terminal-data', { sessionId, data: '\b \b' });
          }

        } else if (ch === '\x03') {
          // Ctrl+C
          sendToRenderer('terminal-data', { sessionId, data: '^C\r\n' + ds.prompt });
          ds.buffer = '';

        } else if (ch === '\x04') {
          // Ctrl+D (EOF)
          sendToRenderer('terminal-data', { sessionId, data: '\r\nlogout\r\nConnection to ' + ds.ip + ' closed.\r\n' });
          cleanupSession(sessionId);
          return { success: true };

        } else if (ch === '\x0c') {
          // Ctrl+L (clear screen)
          sendToRenderer('terminal-data', { sessionId, data: '\x1b[2J\x1b[H' + ds.prompt + ds.buffer });

        } else {
          const code = ch.charCodeAt(0);
          // Only echo printable characters
          if (code >= 32 && code <= 126) {
            ds.buffer += ch;
            sendToRenderer('terminal-data', { sessionId, data: ch });
          }
        }
      }

      return { success: true };
    }

    // ---- REAL MODE ----
    if (session.stream) {
      try {
        session.stream.write(input);
        return { success: true };
      } catch (err) {
        console.error(`[Terminal] Write error on session ${sessionId}:`, err.message);
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: 'Stream not available' };
  });

  // -----------------------------------------------------------------------
  // IPC: terminal-resize
  // Resizes the PTY. Returns { success }.
  // -----------------------------------------------------------------------
  ipcMain.handle('terminal-resize', async (event, data) => {
    const { sessionId, cols, rows } = data;
    const session = activeSessions.get(sessionId);

    if (!session) {
      console.warn(`[Terminal] terminal-resize: no session found for ${sessionId}`);
      return { success: false, error: 'Session not found' };
    }

    // Demo mode – no real PTY, just acknowledge
    if (session.isDemo) {
      console.log(`[Terminal] Demo resize ignored for session ${sessionId}: ${cols}x${rows}`);
      return { success: true };
    }

    // Real mode – resize the ssh2 stream window
    if (session.stream && typeof session.stream.setWindow === 'function') {
      try {
        session.stream.setWindow(rows, cols, 0, 0);
        console.log(`[Terminal] Resized session ${sessionId} to ${cols}x${rows}`);
        return { success: true };
      } catch (err) {
        console.error(`[Terminal] Resize error on session ${sessionId}:`, err.message);
        return { success: false, error: err.message };
      }
    }

    return { success: false, error: 'Stream not available for resize' };
  });

  // -----------------------------------------------------------------------
  // IPC: terminal-close
  // Closes the SSH connection and shell. Returns { success }.
  // -----------------------------------------------------------------------
  ipcMain.handle('terminal-close', async (event, data) => {
    const { sessionId } = data;
    console.log(`[Terminal] terminal-close requested for session ${sessionId}`);
    logToUi(`Terminal: Closing session ${sessionId}`);

    cleanupSession(sessionId);
    return { success: true };
  });

  // -----------------------------------------------------------------------
  // Cleanup helper
  // -----------------------------------------------------------------------
  function cleanupSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    console.log(`[Terminal] Cleaning up session ${sessionId}, isDemo=${session.isDemo}`);

    if (!session.isDemo) {
      try {
        if (session.stream) {
          session.stream.end();
          session.stream.destroy();
        }
      } catch (e) {
        console.error(`[Terminal] Error closing stream for ${sessionId}:`, e.message);
      }
      try {
        if (session.conn) {
          session.conn.end();
          session.conn.destroy();
        }
      } catch (e) {
        console.error(`[Terminal] Error closing connection for ${sessionId}:`, e.message);
      }
    }

    activeSessions.delete(sessionId);
    console.log(`[Terminal] Session ${sessionId} removed. Active sessions: ${activeSessions.size}`);
  }

  // -----------------------------------------------------------------------
  // Cleanup all sessions on app quit (defensive)
  // -----------------------------------------------------------------------
  const { app } = require('electron');
  app.on('will-quit', () => {
    console.log(`[Terminal] App quitting – cleaning up ${activeSessions.size} active session(s)`);
    for (const [sid] of activeSessions) {
      cleanupSession(sid);
    }
  });

  console.log('[Terminal] Terminal IPC handlers registered successfully.');
};
