const { Client } = require('ssh2');

// ─────────────────────────────────────────────────────────────
// App Catalog — curated list of popular Raspberry Pi applications
// ─────────────────────────────────────────────────────────────
const APP_CATALOG = [
  {
    id: 'docker',
    name: 'Docker',
    description: 'Container runtime for building and running containerized applications on your Pi.',
    icon: '🐳',
    category: 'Development',
    installCmd: 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER',
    uninstallCmd: 'sudo apt-get purge -y docker-ce docker-ce-cli containerd.io && sudo rm -rf /var/lib/docker',
    checkCmd: 'docker --version'
  },
  {
    id: 'nodejs',
    name: 'Node.js',
    description: 'JavaScript runtime built on V8 for building fast, scalable server-side applications.',
    icon: '🟢',
    category: 'Development',
    installCmd: 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs',
    uninstallCmd: 'sudo apt-get purge -y nodejs && sudo rm -rf /etc/apt/sources.list.d/nodesource.list',
    checkCmd: 'node --version'
  },
  {
    id: 'python3',
    name: 'Python 3 + pip',
    description: 'The Python 3 interpreter and pip package manager for scripting and automation.',
    icon: '🐍',
    category: 'Development',
    installCmd: 'sudo apt-get update && sudo apt-get install -y python3 python3-pip',
    uninstallCmd: 'sudo apt-get purge -y python3 python3-pip',
    checkCmd: 'python3 --version'
  },
  {
    id: 'pihole',
    name: 'Pi-hole',
    description: 'Network-wide ad blocker that acts as a DNS sinkhole to protect your entire network.',
    icon: '🛡️',
    category: 'Networking',
    installCmd: 'curl -sSL https://install.pi-hole.net | sudo bash /dev/stdin --unattended',
    uninstallCmd: 'sudo pihole uninstall',
    checkCmd: 'pihole version'
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    description: 'Open-source home automation platform for controlling smart home devices.',
    icon: '🏠',
    category: 'Smart Home',
    installCmd: 'sudo apt-get install -y python3-venv && python3 -m venv homeassistant && source homeassistant/bin/activate && pip install homeassistant',
    uninstallCmd: 'rm -rf ~/homeassistant && sudo apt-get purge -y python3-venv',
    checkCmd: 'test -d ~/homeassistant && echo installed'
  },
  {
    id: 'plex',
    name: 'Plex Media Server',
    description: 'Stream your personal media collection to any device on your network.',
    icon: '🎬',
    category: 'Media',
    installCmd: "curl https://downloads.plex.tv/plex-keys/PlexSign.key | sudo apt-key add - && echo 'deb https://downloads.plex.tv/repo/deb public main' | sudo tee /etc/apt/sources.list.d/plexmediaserver.list && sudo apt-get update && sudo apt-get install -y plexmediaserver",
    uninstallCmd: 'sudo apt-get purge -y plexmediaserver && sudo rm -f /etc/apt/sources.list.d/plexmediaserver.list',
    checkCmd: 'dpkg -l plexmediaserver'
  },
  {
    id: 'samba',
    name: 'Samba File Sharing',
    description: 'SMB/CIFS file sharing server to share folders with Windows and macOS devices.',
    icon: '📁',
    category: 'Networking',
    installCmd: 'sudo apt-get update && sudo apt-get install -y samba',
    uninstallCmd: 'sudo apt-get purge -y samba samba-common',
    checkCmd: 'samba --version'
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Distributed version control system for tracking code changes and collaboration.',
    icon: '📦',
    category: 'Development',
    installCmd: 'sudo apt-get update && sudo apt-get install -y git',
    uninstallCmd: 'sudo apt-get purge -y git',
    checkCmd: 'git --version'
  },
  {
    id: 'nginx',
    name: 'Nginx',
    description: 'High-performance HTTP server and reverse proxy for serving web applications.',
    icon: '🌐',
    category: 'Web Server',
    installCmd: 'sudo apt-get update && sudo apt-get install -y nginx && sudo systemctl enable nginx',
    uninstallCmd: 'sudo systemctl stop nginx && sudo apt-get purge -y nginx nginx-common',
    checkCmd: 'nginx -v'
  },
  {
    id: 'vlc',
    name: 'VLC Media Player',
    description: 'Versatile multimedia player supporting nearly every audio and video format.',
    icon: '🎵',
    category: 'Media',
    installCmd: 'sudo apt-get update && sudo apt-get install -y vlc',
    uninstallCmd: 'sudo apt-get purge -y vlc',
    checkCmd: 'vlc --version'
  },
  {
    id: 'htop',
    name: 'htop',
    description: 'Interactive process viewer and system monitor with a colorful terminal UI.',
    icon: '📊',
    category: 'System Tools',
    installCmd: 'sudo apt-get update && sudo apt-get install -y htop',
    uninstallCmd: 'sudo apt-get purge -y htop',
    checkCmd: 'htop --version'
  },
  {
    id: 'cockpit',
    name: 'Cockpit',
    description: 'Web-based server management dashboard for monitoring and administering your Pi.',
    icon: '🖥️',
    category: 'System Tools',
    installCmd: 'sudo apt-get update && sudo apt-get install -y cockpit && sudo systemctl enable cockpit',
    uninstallCmd: 'sudo systemctl stop cockpit && sudo apt-get purge -y cockpit',
    checkCmd: 'dpkg -l cockpit'
  }
];

// ─────────────────────────────────────────────────────────────
// Demo mode: Seeded random install states (~40% installed)
// ─────────────────────────────────────────────────────────────
const demoInstalledSet = new Set();
(function seedDemoStates() {
  APP_CATALOG.forEach(app => {
    if (Math.random() < 0.4) {
      demoInstalledSet.add(app.id);
    }
  });
  // Guarantee at least a few are installed for a realistic feel
  if (demoInstalledSet.size === 0) {
    demoInstalledSet.add('python3');
    demoInstalledSet.add('git');
  }
  console.log('[Installer] Demo mode seed — installed apps:', [...demoInstalledSet]);
})();

// ─────────────────────────────────────────────────────────────
// SSH command execution helper
// ─────────────────────────────────────────────────────────────
function runSshCommand(ip, username, password, command, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.end();
        resolve({ success: false, output: 'Command timed out after ' + (timeoutMs / 1000) + ' seconds.' });
      }
    }, timeoutMs);

    conn.on('ready', () => {
      console.log(`[Installer] SSH connection established to ${ip}`);

      // Wrap the entire command in sudo -S so password is piped from echo
      const wrappedCmd = `echo '${password}' | sudo -S bash -c '${command.replace(/'/g, "'\\''")}'`;

      conn.exec(wrappedCmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          settled = true;
          conn.end();
          console.error(`[Installer] SSH exec error on ${ip}:`, err.message);
          resolve({ success: false, output: err.message });
          return;
        }

        stream.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        stream.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        stream.on('close', (code) => {
          clearTimeout(timer);
          if (settled) return;
          settled = true;
          conn.end();

          const combinedOutput = (stdout + '\n' + stderr).trim();
          console.log(`[Installer] Command on ${ip} exited with code ${code}`);

          if (code === 0 || code === null) {
            resolve({ success: true, output: combinedOutput });
          } else {
            // Some check commands exit non-zero when package is not found — that's expected
            resolve({ success: false, output: combinedOutput, exitCode: code });
          }
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      console.error(`[Installer] SSH connection error to ${ip}:`, err.message);
      resolve({ success: false, output: `SSH connection error: ${err.message}` });
    });

    conn.connect({
      host: ip,
      port: 22,
      username: username,
      password: password,
      readyTimeout: 10000
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Find an app from the catalog by ID
// ─────────────────────────────────────────────────────────────
function findApp(appId) {
  return APP_CATALOG.find(a => a.id === appId) || null;
}

// ─────────────────────────────────────────────────────────────
// IPC Handler Registration
// ─────────────────────────────────────────────────────────────
function registerInstallerHandlers(ipcMain, getSettings, logToUi) {

  // ── 1. Get Catalog ──────────────────────────────────────────
  ipcMain.handle('installer-get-catalog', async () => {
    console.log('[Installer] Catalog requested — returning', APP_CATALOG.length, 'apps');
    return {
      success: true,
      apps: APP_CATALOG.map(app => ({
        id: app.id,
        name: app.name,
        description: app.description,
        icon: app.icon,
        category: app.category,
        installCmd: app.installCmd,
        uninstallCmd: app.uninstallCmd,
        checkCmd: app.checkCmd
      }))
    };
  });

  // ── 2. Check Install Status ─────────────────────────────────
  ipcMain.handle('installer-check-status', async (event, data) => {
    const { ip, username, password, appId } = data;
    const settings = getSettings();
    const app = findApp(appId);

    if (!app) {
      console.error(`[Installer] Unknown app ID: ${appId}`);
      return { success: false, installed: false, error: `Unknown app: ${appId}` };
    }

    console.log(`[Installer] Checking status of "${app.name}" on ${ip}`);

    // Demo mode
    if (settings.demoMode) {
      await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
      const installed = demoInstalledSet.has(appId);
      console.log(`[Installer][Demo] "${app.name}" installed: ${installed}`);
      logToUi(`[Demo] ${app.name} check: ${installed ? 'Installed ✓' : 'Not installed'}`);
      return { success: true, installed };
    }

    // Real mode — run checkCmd via SSH
    const result = await runSshCommand(ip, username, password, app.checkCmd, 15000);
    // A successful exit (code 0) means the app is installed
    const installed = result.success;
    console.log(`[Installer] "${app.name}" on ${ip}: installed=${installed}, output=${result.output.substring(0, 120)}`);
    logToUi(`${app.name} check on ${ip}: ${installed ? 'Installed ✓' : 'Not installed'}`);
    return { success: true, installed };
  });

  // ── 3. Install App ──────────────────────────────────────────
  ipcMain.handle('installer-install', async (event, data) => {
    const { ip, username, password, appId } = data;
    const settings = getSettings();
    const app = findApp(appId);

    if (!app) {
      console.error(`[Installer] Unknown app ID for install: ${appId}`);
      return { success: false, output: `Unknown app: ${appId}` };
    }

    console.log(`[Installer] Installing "${app.name}" on ${ip}`);
    logToUi(`Installing ${app.name} on ${ip}...`);

    // Demo mode
    if (settings.demoMode) {
      const delay = 2000 + Math.random() * 1000; // 2–3 seconds
      await new Promise(r => setTimeout(r, delay));
      demoInstalledSet.add(appId);
      const fakeOutput = `Reading package lists... Done\nBuilding dependency tree... Done\nThe following NEW packages will be installed:\n  ${app.id}\n0 upgraded, 1 newly installed, 0 to remove.\nSetting up ${app.id} ...\n${app.name} installed successfully.`;
      console.log(`[Installer][Demo] "${app.name}" install simulated successfully`);
      logToUi(`[Demo] ${app.name} installed successfully on ${ip}`);
      return { success: true, output: fakeOutput };
    }

    // Real mode — run installCmd over SSH with a generous 2-minute timeout
    const result = await runSshCommand(ip, username, password, app.installCmd, 120000);
    if (result.success) {
      logToUi(`${app.name} installed successfully on ${ip}`);
    } else {
      logToUi(`${app.name} installation failed on ${ip}: ${result.output.substring(0, 200)}`);
    }
    return { success: result.success, output: result.output };
  });

  // ── 4. Uninstall App ────────────────────────────────────────
  ipcMain.handle('installer-uninstall', async (event, data) => {
    const { ip, username, password, appId } = data;
    const settings = getSettings();
    const app = findApp(appId);

    if (!app) {
      console.error(`[Installer] Unknown app ID for uninstall: ${appId}`);
      return { success: false, output: `Unknown app: ${appId}` };
    }

    console.log(`[Installer] Uninstalling "${app.name}" from ${ip}`);
    logToUi(`Uninstalling ${app.name} from ${ip}...`);

    // Demo mode
    if (settings.demoMode) {
      const delay = 1500 + Math.random() * 1000;
      await new Promise(r => setTimeout(r, delay));
      demoInstalledSet.delete(appId);
      const fakeOutput = `Reading package lists... Done\nRemoving ${app.id} ...\nPurging configuration files for ${app.id} ...\n${app.name} has been removed.`;
      console.log(`[Installer][Demo] "${app.name}" uninstall simulated successfully`);
      logToUi(`[Demo] ${app.name} uninstalled from ${ip}`);
      return { success: true, output: fakeOutput };
    }

    // Real mode
    const result = await runSshCommand(ip, username, password, app.uninstallCmd, 60000);
    if (result.success) {
      logToUi(`${app.name} uninstalled from ${ip}`);
    } else {
      logToUi(`${app.name} uninstall failed on ${ip}: ${result.output.substring(0, 200)}`);
    }
    return { success: result.success, output: result.output };
  });

  console.log('[Installer] All IPC handlers registered successfully.');
}

module.exports = { registerInstallerHandlers };
