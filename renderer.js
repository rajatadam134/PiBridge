// State Variables
let currentDevices = [];
let appSettings = {};
let activeTargetIp = null;
let activePolls = {}; // Mapping of IP -> IntervalID
let deviceCredentials = {}; // Cache credentials entered by user for each IP
let activeView = 'scan'; // Track current view
let activeModuleHandle = null; // Track current active module handle
let originalPlaceholders = {}; // Cache original empty state HTML for module containers

// DOM Elements
const navScanBtn = document.getElementById('nav-scan-btn');
const navSettingsBtn = document.getElementById('nav-settings-btn');
const devicesView = document.getElementById('devices-view');
const settingsView = document.getElementById('settings-view');

const scanBtn = document.getElementById('scan-btn');
const networkInfo = document.getElementById('network-info');
const emptyState = document.getElementById('empty-state');
const devicesGrid = document.getElementById('devices-grid');
const piCountBadge = document.getElementById('pi-count');

const scanProgressBar = document.getElementById('scan-progress-bar');
const scanProgressText = document.getElementById('scan-progress-text');
const pulseRing = document.querySelector('.pulse-ring');

const consoleLogs = document.getElementById('console-logs');
const toggleConsoleBtn = document.getElementById('toggle-console');
const logsConsole = document.querySelector('.logs-console');

// Modal Elements
const credsModal = document.getElementById('creds-modal');
const closeCredsBtn = document.getElementById('close-creds-btn');
const cancelCredsBtn = document.getElementById('cancel-creds-btn');
const credsForm = document.getElementById('creds-form');
const targetPiIpText = document.getElementById('target-pi-ip');
const targetIpHidden = document.getElementById('target-ip-hidden');
const modalSshUser = document.getElementById('modal-ssh-user');
const modalSshPass = document.getElementById('modal-ssh-pass');

// Settings Form
const settingsForm = document.getElementById('settings-form');
const demoModeInput = document.getElementById('demo-mode-input');
const sshUserInput = document.getElementById('ssh-user-input');
const sshPassInput = document.getElementById('ssh-pass-input');
const vncPathInput = document.getElementById('vnc-path-input');
const scanTimeoutInput = document.getElementById('scan-timeout-input');
const scanConcurrencyInput = document.getElementById('scan-concurrency-input');

// Toast Container
const toastContainer = document.getElementById('toast-container');

// Help Docs Link
const docsLink = document.getElementById('docs-link');

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
async function init() {
  try {
    // Expose platform-specific classes
    const platform = window.pibridge.platform;
    if (platform) {
      document.body.classList.add(`platform-${platform}`);
    }

    // Load Settings
    appSettings = await window.pibridge.getSettings();
    fillSettingsForm(appSettings);
    
    if (appSettings.demoMode) {
      networkInfo.innerText = 'Demo Subnet: wlan0 (192.168.1.15)';
      showToast('App is in Demo Mode. Ready for simulated testing!', 'info');
    } else {
      networkInfo.innerText = 'Auto-detecting interfaces... Click Scan.';
    }

    // Cache original module empty states
    originalPlaceholders = {
      terminal: document.getElementById('terminal-container').innerHTML,
      sftp: document.getElementById('sftp-container').innerHTML,
      vnc: document.getElementById('vnc-container').innerHTML,
      installer: document.getElementById('installer-container').innerHTML,
      backup: document.getElementById('backup-container').innerHTML
    };

    // Set up logs
    window.pibridge.onLog((msg) => {
      appendLog(msg);
    });

    // Setup Scan Event Listeners
    window.pibridge.onScanProgress((data) => {
      updateScanProgress(data);
    });

    window.pibridge.onScanComplete((devices) => {
      finalizeScan(devices);
    });

    // Setup VNC Result Listeners
    window.pibridge.onVncResult((result) => {
      handleVncResult(result);
    });

    // Setup VNC Launch Result Listeners
    window.pibridge.onLaunchResult((result) => {
      handleLaunchResult(result);
    });

    // Listen for menu-triggered scans
    window.pibridge.onTriggerScan(() => {
      startNetworkScan();
    });

    // Listen for menu-triggered settings
    window.pibridge.onTriggerSettings(() => {
      switchView('settings');
    });

    // Event Listeners for Navigation (All 7 Tabs)
    const navButtons = [
      { id: 'nav-scan-btn', view: 'scan' },
      { id: 'nav-terminal-btn', view: 'terminal' },
      { id: 'nav-sftp-btn', view: 'sftp' },
      { id: 'nav-vnc-btn', view: 'vnc' },
      { id: 'nav-installer-btn', view: 'installer' },
      { id: 'nav-backup-btn', view: 'backup' },
      { id: 'nav-settings-btn', view: 'settings' }
    ];

    navButtons.forEach(nav => {
      const btn = document.getElementById(nav.id);
      if (btn) {
        btn.addEventListener('click', () => switchView(nav.view));
      }
    });

    // Active device selector dropdown listener
    const deviceSelector = document.getElementById('device-selector');
    if (deviceSelector) {
      deviceSelector.addEventListener('change', (e) => {
        selectActiveDevice(e.target.value);
      });
    }

    // Event Listener for Scan
    scanBtn.addEventListener('click', startNetworkScan);

    // Console minimize/expand toggle
    toggleConsoleBtn.addEventListener('click', toggleConsole);

    // Settings Save
    settingsForm.addEventListener('submit', saveSettings);

    // Immediate Demo Mode save on toggle
    demoModeInput.addEventListener('change', () => {
      saveSettings();
    });

    // Modal actions
    closeCredsBtn.addEventListener('click', hideCredsModal);
    cancelCredsBtn.addEventListener('click', hideCredsModal);
    credsForm.addEventListener('submit', submitCredsForm);

    // Help Link Click
    docsLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.pibridge.openUrl('https://github.com/raspberrypi/documentation');
    });

    // Wire up software updater panel
    setupUpdaterUI();

    logsConsole.classList.add('minimized');
    appendLog('[System] Renderer initialized successfully.');
  } catch (err) {
    console.error('Renderer initialization error:', err);
    appendLog(`[ERROR] Initialization failed: ${err.message}`);
    showToast(`Initialization failed: ${err.message}`, 'error');
  }
}

// -------------------------------------------------------------
// Toast Notifications
// -------------------------------------------------------------
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeIn 0.3s ease reverse';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// -------------------------------------------------------------
// Activity Logs Console
// -------------------------------------------------------------
function appendLog(message) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  if (message.toLowerCase().includes('error') || message.toLowerCase().includes('failed')) {
    entry.className += ' error';
  } else if (message.toLowerCase().includes('success') || message.toLowerCase().includes('successful')) {
    entry.className += ' success';
  } else if (message.toLowerCase().includes('warning') || message.toLowerCase().includes('not found')) {
    entry.className += ' warning';
  } else if (message.toLowerCase().includes('scanning') || message.toLowerCase().includes('found') || message.toLowerCase().includes('reboot') || message.toLowerCase().includes('shutdown')) {
    entry.className += ' system';
  }
  
  entry.innerText = message;
  consoleLogs.appendChild(entry);
  consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Expand console
function toggleConsole() {
  if (logsConsole.classList.contains('minimized')) {
    logsConsole.classList.remove('minimized');
    logsConsole.classList.add('expanded');
    document.querySelector('.console-toggle-btn').innerText = '▼';
  } else {
    logsConsole.classList.remove('expanded');
    logsConsole.classList.add('minimized');
    document.querySelector('.console-toggle-btn').innerText = '▲';
  }
}

// -------------------------------------------------------------
// View Switching
// -------------------------------------------------------------
// -------------------------------------------------------------
// View Switching & Session Routing (v1.2.0)
// -------------------------------------------------------------
function cleanupActiveModule() {
  if (activeModuleHandle) {
    if (typeof activeModuleHandle.disconnect === 'function') {
      try {
        activeModuleHandle.disconnect();
      } catch (err) {
        console.warn('Error disconnecting module:', err);
      }
    }
    activeModuleHandle = null;
  }
}

function showUnverifiedWarning(containerId, ip) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `
      <div class="module-placeholder">
        <div class="empty-icon">🔒</div>
        <h4>Credentials Required</h4>
        <p>Configure credentials for <strong>${ip}</strong> to access this feature.</p>
        <button class="btn btn-secondary" style="margin-top: 16px;" id="warning-btn-creds-${containerId}">
          🔑 Configure Credentials
        </button>
      </div>
    `;
    const btn = document.getElementById(`warning-btn-creds-${containerId}`);
    if (btn) {
      btn.addEventListener('click', () => showCredsModal(ip));
    }
  }
}

async function loadActiveModule() {
  const toolViews = ['terminal', 'sftp', 'vnc', 'installer', 'backup'];
  if (!toolViews.includes(activeView)) {
    return;
  }

  const containerId = `${activeView}-container`;
  const container = document.getElementById(containerId);
  if (!container) return;

  // If no activeTargetIp is selected
  if (!activeTargetIp || activeTargetIp === '---') {
    container.innerHTML = originalPlaceholders[activeView];
    return;
  }

  // Check credentials cache
  let credentials = deviceCredentials[activeTargetIp];
  const isDemo = appSettings.demoMode;

  if (!isDemo && !credentials) {
    showUnverifiedWarning(containerId, activeTargetIp);
    showCredsModal(activeTargetIp);
    return;
  }

  // Always disconnect the previous module first
  cleanupActiveModule();

  // Fallback to default credentials in Demo Mode if none are cached
  if (isDemo && !credentials) {
    credentials = {
      username: appSettings.sshUsername || 'pi',
      password: appSettings.sshPassword || 'raspberry'
    };
  }

  const creds = {
    ip: activeTargetIp,
    username: credentials.username,
    password: credentials.password
  };

  appendLog(`[System] Mounting ${activeView} session for ${activeTargetIp}...`);
  
  try {
    if (activeView === 'terminal') {
      activeModuleHandle = await window.initTerminal(window.pibridge, containerId, creds);
    } else if (activeView === 'sftp') {
      activeModuleHandle = await window.initSftp(window.pibridge, containerId, creds);
    } else if (activeView === 'vnc') {
      activeModuleHandle = await window.initVnc(window.pibridge, containerId, creds);
    } else if (activeView === 'installer') {
      activeModuleHandle = await window.initInstaller(window.pibridge, containerId, creds);
    } else if (activeView === 'backup') {
      activeModuleHandle = await window.initBackup(window.pibridge, containerId, creds);
    }
  } catch (err) {
    console.error(`Failed to initialize module ${activeView}:`, err);
    appendLog(`[ERROR] Failed to load ${activeView}: ${err.message}`);
    showToast(`Failed to load ${activeView}: ${err.message}`, 'error');
  }
}

function selectActiveDevice(ip) {
  if (!ip || ip === '---') {
    activeTargetIp = null;
    document.getElementById('active-device-panel').style.display = 'none';
    document.getElementById('active-device-ip').innerText = '---';
    cleanupActiveModule();
    loadActiveModule(); // Will revert to placeholder
    return;
  }

  activeTargetIp = ip;
  document.getElementById('active-device-panel').style.display = 'block';
  document.getElementById('active-device-ip').innerText = ip;

  const selector = document.getElementById('device-selector');
  if (selector && selector.value !== ip) {
    selector.value = ip;
  }

  // Load the active module for the newly selected device
  loadActiveModule();
}

function updateDeviceSelector() {
  const selector = document.getElementById('device-selector');
  const activePanel = document.getElementById('active-device-panel');
  if (!selector || !activePanel) return;

  // Clear existing options
  selector.innerHTML = '';

  if (currentDevices.length === 0) {
    activePanel.style.display = 'none';
    if (activeTargetIp) {
      selectActiveDevice(null);
    }
    return;
  }

  // Populate options
  currentDevices.forEach(device => {
    const opt = document.createElement('option');
    opt.value = device.ip;
    const displayName = device.isPi ? `Raspberry Pi (${device.ip})` : `Linux Target (${device.ip})`;
    opt.innerText = displayName;
    selector.appendChild(opt);
  });

  // Show active device sidebar panel
  activePanel.style.display = 'block';

  // If there's no active target selected yet, or the active target is no longer in the list,
  // select the first discovered device.
  if (!activeTargetIp || !currentDevices.find(d => d.ip === activeTargetIp)) {
    selectActiveDevice(currentDevices[0].ip);
  } else {
    // Keep the current selection in dropdown
    selector.value = activeTargetIp;
  }
}

function switchView(viewName) {
  const views = {
    scan: { btn: 'nav-scan-btn', section: 'devices-view', title: 'Network Discovery' },
    terminal: { btn: 'nav-terminal-btn', section: 'terminal-view', title: 'SSH Terminal' },
    sftp: { btn: 'nav-sftp-btn', section: 'sftp-view', title: 'SFTP File Explorer' },
    vnc: { btn: 'nav-vnc-btn', section: 'vnc-view', title: 'Embedded VNC Desktop' },
    installer: { btn: 'nav-installer-btn', section: 'installer-view', title: 'App Store for Pi' },
    backup: { btn: 'nav-backup-btn', section: 'backup-view', title: 'SD Card Backup & Restore' },
    settings: { btn: 'nav-settings-btn', section: 'settings-view', title: 'Configuration Settings' }
  };

  if (!views[viewName]) return;

  activeView = viewName;

  // Clean up any active module session before navigation
  cleanupActiveModule();

  // Update navigation button active states and sections visibility
  Object.keys(views).forEach(v => {
    const btn = document.getElementById(views[v].btn);
    const section = document.getElementById(views[v].section);
    if (btn) {
      if (v === viewName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    if (section) {
      if (v === viewName) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    }
  });

  // Update top bar title
  const viewTitle = document.getElementById('view-title');
  if (viewTitle) {
    viewTitle.innerText = views[viewName].title;
  }

  // Show scan button in top bar header only when on the scan view
  const headerScanBtn = document.getElementById('scan-btn');
  if (headerScanBtn) {
    headerScanBtn.style.display = (viewName === 'scan') ? 'inline-flex' : 'none';
  }

  // Load the module associated with the active view
  loadActiveModule();
}

// -------------------------------------------------------------
// Settings Panel
// -------------------------------------------------------------
function fillSettingsForm(settings) {
  demoModeInput.checked = settings.demoMode;
  sshUserInput.value = settings.sshUsername;
  sshPassInput.value = settings.sshPassword;
  vncPathInput.value = settings.customVncPath || '';
  scanTimeoutInput.value = settings.scanTimeout;
  scanConcurrencyInput.value = settings.scanConcurrency;
}

async function saveSettings(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  
  const newSettings = {
    demoMode: demoModeInput.checked,
    sshUsername: sshUserInput.value.trim(),
    sshPassword: sshPassInput.value.trim(),
    customVncPath: vncPathInput.value.trim(),
    scanTimeout: parseInt(scanTimeoutInput.value),
    scanConcurrency: parseInt(scanConcurrencyInput.value)
  };

  appSettings = await window.pibridge.saveSettings(newSettings);
  
  if (appSettings.demoMode) {
    networkInfo.innerText = 'Demo Subnet: wlan0 (192.168.1.15)';
  } else {
    networkInfo.innerText = 'Auto-detecting interfaces... Click Scan.';
  }

  // Clear discovered devices to match the new mode
  currentDevices = [];
  updateDeviceSelector();
  devicesGrid.innerHTML = '';
  devicesGrid.style.display = 'none';
  emptyState.style.display = 'flex';

  cleanupActiveModule();
  loadActiveModule();

  showToast('Settings saved successfully!', 'success');
}

// -------------------------------------------------------------
// Subnet Scanning Logic
// -------------------------------------------------------------
function startNetworkScan() {
  // Clear any active polling loops first
  Object.keys(activePolls).forEach(ip => {
    clearInterval(activePolls[ip]);
  });
  activePolls = {};
  
  currentDevices = [];
  updateDeviceSelector(); // Reset active device dropdown
  devicesGrid.innerHTML = '';
  devicesGrid.style.display = 'none';
  emptyState.style.display = 'flex';
  
  scanBtn.disabled = true;
  scanBtn.innerHTML = '<span class="btn-icon spinning">⏳</span> Scanning...';
  
  scanProgressBar.style.width = '0%';
  scanProgressText.innerText = 'Scanning...';
  pulseRing.classList.add('active');
  
  piCountBadge.innerText = 'Scanning...';
  piCountBadge.className = 'count-badge';

  window.pibridge.scan();
}

function updateScanProgress(data) {
  const { progress, deviceFound } = data;
  scanProgressBar.style.width = `${progress}%`;
  scanProgressText.innerText = `Scanning (${progress}%)`;

  if (deviceFound) {
    if (!currentDevices.find(d => d.ip === deviceFound.ip)) {
      currentDevices.push(deviceFound);
      renderDeviceCard(deviceFound);
      updateDeviceSelector(); // Update active device dropdown
      
      emptyState.style.display = 'none';
      devicesGrid.style.display = 'grid';
      
      const piCount = currentDevices.filter(d => d.isPi).length;
      piCountBadge.innerText = `${piCount} Pi / ${currentDevices.length} Total`;
      piCountBadge.className = 'count-badge';
      
      showToast(`Detected active SSH target: ${deviceFound.ip}`, 'info');
    }
  }
}

function finalizeScan(devices) {
  scanBtn.disabled = false;
  scanBtn.innerHTML = '<span class="btn-icon">⚡</span> Scan Network';
  
  scanProgressBar.style.width = '100%';
  scanProgressText.innerText = 'Completed';
  pulseRing.classList.remove('active');

  const piCount = currentDevices.filter(d => d.isPi).length;
  piCountBadge.innerText = `${piCount} Pi / ${currentDevices.length} Total`;

  updateDeviceSelector(); // Ensure dropdown is finalized

  if (currentDevices.length === 0) {
    emptyState.style.display = 'flex';
    devicesGrid.style.display = 'none';
    showToast('Scan finished. No devices with SSH enabled were found.', 'info');
  } else {
    showToast(`Scan complete. Found ${currentDevices.length} devices total.`, 'success');
  }
}

// -------------------------------------------------------------
// Card Rendering & Dynamic updates
// -------------------------------------------------------------
function renderDeviceCard(device) {
  const card = document.createElement('div');
  card.className = `device-card glass ${device.isPi ? 'is-pi' : 'not-pi'}`;
  card.id = `card-${device.ip.replace(/\./g, '-')}`;

  const identityText = device.isPi ? 'Raspberry Pi' : 'Linux Device';
  const tagText = device.isPi ? 'Pi OUI Verified' : 'SSH Detected';
  
  const vncStatusText = device.vncOpen ? 'VNC Active' : 'VNC Disabled';
  const vncStatusClass = device.vncOpen ? 'badge-connected' : 'badge-disconnected';
  const vncStatusDot = device.vncOpen ? 'green' : 'red';

  card.innerHTML = `
    <div class="device-header">
      <div class="device-title">
        <span class="device-name">${identityText} <span class="device-oui-tag">${tagText}</span></span>
        <span class="device-mac">MAC: ${device.mac}</span>
      </div>
      <div class="device-status-badge ${vncStatusClass}" id="vnc-badge-${device.ip.replace(/\./g, '-')}">
        <span class="status-dot ${vncStatusDot}"></span>
        <span class="vnc-label">${vncStatusText}</span>
      </div>
    </div>

    <div class="device-ip-section">
      <span class="device-ip">${device.ip}</span>
      <button class="btn-copy-ip" title="Copy IP to clipboard">📋</button>
    </div>

    <div class="device-details">
      <div class="detail-row">
        <span class="detail-label">SSH Port (22)</span>
        <span class="detail-value" style="color: var(--accent-green)">Enabled</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">VNC Port (5900)</span>
        <span class="detail-value" id="vnc-port-val-${device.ip.replace(/\./g, '-')}">${device.vncOpen ? 'Open' : 'Closed'}</span>
      </div>
    </div>

    <div class="device-actions">
      <button class="btn btn-secondary btn-ssh" id="btn-ssh-${device.ip.replace(/\./g, '-')}">
        🔧 Configure VNC
      </button>
      <button class="btn btn-primary btn-vnc" id="btn-vnc-${device.ip.replace(/\./g, '-')}" ${!device.vncOpen ? 'disabled' : ''}>
        🖥️ Open VNC
      </button>
    </div>

    <!-- v1.1.0 Stats & Control Drawer -->
    <div class="device-drawer" id="drawer-${device.ip.replace(/\./g, '-')}">
      <div class="device-drawer-content">
        <!-- Stats bars -->
        <div class="stats-container">
          <div class="stat-item">
            <div class="stat-header">
              <span>CPU Temperature</span>
              <span class="stat-val" id="val-temp-${device.ip.replace(/\./g, '-')}">--°C</span>
            </div>
            <div class="stat-bar-outer">
              <div class="stat-bar-inner" id="bar-temp-${device.ip.replace(/\./g, '-')}" style="width: 0%"></div>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-header">
              <span>Memory Usage</span>
              <span class="stat-val" id="val-ram-${device.ip.replace(/\./g, '-')}">-- / -- MB</span>
            </div>
            <div class="stat-bar-outer">
              <div class="stat-bar-inner" id="bar-ram-${device.ip.replace(/\./g, '-')}" style="width: 0%"></div>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-header">
              <span>Disk Space</span>
              <span class="stat-val" id="val-disk-${device.ip.replace(/\./g, '-')}">-- / -- GB</span>
            </div>
            <div class="stat-bar-outer">
              <div class="stat-bar-inner" id="bar-disk-${device.ip.replace(/\./g, '-')}" style="width: 0%"></div>
            </div>
          </div>
        </div>

        <!-- Controls panel -->
        <div class="device-drawer-controls">
          <div class="resolution-row">
            <label for="resolution-${device.ip.replace(/\./g, '-')}">Headless Resolution</label>
            <select class="select-resolution" id="resolution-${device.ip.replace(/\./g, '-')}">
              <option value="1920x1080">1920 x 1080 (1080p)</option>
              <option value="1280x720">1280 x 720 (720p)</option>
              <option value="1024x768">1024 x 768 (XGA)</option>
            </select>
          </div>
          
          <div class="power-row">
            <button class="btn btn-secondary btn-reboot" id="btn-reboot-${device.ip.replace(/\./g, '-')}">🔄 Reboot</button>
            <button class="btn btn-danger btn-shutdown" id="btn-shutdown-${device.ip.replace(/\./g, '-')}">🛑 Shutdown</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Expansion Trigger -->
    <div class="device-expand-panel">
      <button class="device-expand-btn" id="btn-expand-${device.ip.replace(/\./g, '-')}">System Dashboard</button>
    </div>
  `;

  // Attach card event listeners
  card.querySelector('.btn-copy-ip').addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent card selection click
    window.pibridge.copyToClipboard(device.ip);
    showToast(`IP ${device.ip} copied to clipboard!`, 'info');
  });

  // Clicking the card itself selects it as active
  card.addEventListener('click', (e) => {
    // Avoid triggering if clicking buttons or inputs/selectors inside the card
    if (!e.target.closest('.device-actions') && 
        !e.target.closest('.device-drawer') && 
        !e.target.closest('.device-expand-panel') &&
        !e.target.closest('.btn-copy-ip')) {
      selectActiveDevice(device.ip);
    }
  });

  card.querySelector('.btn-ssh').addEventListener('click', (e) => {
    e.stopPropagation();
    selectActiveDevice(device.ip);
    showCredsModal(device.ip);
  });

  card.querySelector('.btn-vnc').addEventListener('click', (e) => {
    e.stopPropagation();
    selectActiveDevice(device.ip);
    // Switch to the Embedded VNC tab
    switchView('vnc');
  });

  // Expand button handler (v1.1.0)
  card.querySelector('.device-expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    selectActiveDevice(device.ip);
    toggleDeviceDrawer(device.ip);
  });

  // Stats controls (v1.1.0)
  card.querySelector('.select-resolution').addEventListener('change', (e) => {
    handleResolutionChange(device.ip, e.target.value);
  });

  card.querySelector('.btn-reboot').addEventListener('click', () => {
    handlePowerAction(device.ip, 'reboot');
  });

  card.querySelector('.btn-shutdown').addEventListener('click', () => {
    handlePowerAction(device.ip, 'shutdown');
  });

  devicesGrid.appendChild(card);
}

// -------------------------------------------------------------
// Drawer expanding and polling (v1.1.0)
// -------------------------------------------------------------
function toggleDeviceDrawer(ip) {
  const ipKey = ip.replace(/\./g, '-');
  const card = document.getElementById(`card-${ipKey}`);
  
  if (!card) return;

  const isExpanding = !card.classList.contains('expanded');

  if (isExpanding) {
    card.classList.add('expanded');
    startStatsPolling(ip);
  } else {
    card.classList.remove('expanded');
    stopStatsPolling(ip);
  }
}

function startStatsPolling(ip) {
  // Clear any existing polling loop
  if (activePolls[ip]) {
    clearInterval(activePolls[ip]);
  }

  // Initial fetch
  fetchStats(ip);

  // Poll every 8 seconds
  activePolls[ip] = setInterval(() => {
    fetchStats(ip);
  }, 8000);
}

function stopStatsPolling(ip) {
  if (activePolls[ip]) {
    clearInterval(activePolls[ip]);
    delete activePolls[ip];
  }
}

async function fetchStats(ip) {
  const ipKey = ip.replace(/\./g, '-');
  
  const creds = deviceCredentials[ip] || {
    username: appSettings.sshUsername,
    password: appSettings.sshPassword
  };

  if (!appSettings.demoMode && !deviceCredentials[ip]) {
    updateStatsUi(ip, { 
      error: true, 
      message: 'Configure VNC first (checks credentials)' 
    });
    return;
  }

  const result = await window.pibridge.getPiStats({
    ip,
    username: creds.username,
    password: creds.password
  });

  updateStatsUi(ip, result);
}

function updateStatsUi(ip, result) {
  const ipKey = ip.replace(/\./g, '-');
  
  const valTemp = document.getElementById(`val-temp-${ipKey}`);
  const barTemp = document.getElementById(`bar-temp-${ipKey}`);
  const valRam = document.getElementById(`val-ram-${ipKey}`);
  const barRam = document.getElementById(`bar-ram-${ipKey}`);
  const valDisk = document.getElementById(`val-disk-${ipKey}`);
  const barDisk = document.getElementById(`bar-disk-${ipKey}`);

  if (!valTemp) return;

  if (result.error) {
    valTemp.innerText = 'Unavailable';
    valTemp.style.color = 'var(--text-muted)';
    barTemp.style.width = '0%';
    
    valRam.innerText = result.message || 'Configure VNC';
    valRam.style.color = 'var(--text-muted)';
    barRam.style.width = '0%';
    
    valDisk.innerText = 'Locked';
    valDisk.style.color = 'var(--text-muted)';
    barDisk.style.width = '0%';
    return;
  }

  // 1. CPU Temp
  valTemp.innerText = result.temp;
  valTemp.style.color = '';
  const tempNum = parseFloat(result.temp.replace('°C', '')) || 0;
  const tempPercent = Math.min(Math.max(((tempNum - 30) / 50) * 100, 0), 100);
  barTemp.style.width = `${tempPercent}%`;
  
  barTemp.className = 'stat-bar-inner';
  if (tempNum > 70) {
    barTemp.className += ' danger';
  } else if (tempNum > 58) {
    barTemp.className += ' warning';
  }

  // 2. RAM Usage
  valRam.innerText = `${result.ramUsed} / ${result.ramTotal} MB`;
  valRam.style.color = '';
  barRam.style.width = `${result.ramPercent}%`;
  
  barRam.className = 'stat-bar-inner';
  if (result.ramPercent > 85) {
    barRam.className += ' danger';
  } else if (result.ramPercent > 65) {
    barRam.className += ' warning';
  }

  // 3. Disk Space
  valDisk.innerText = `${result.diskUsed} / ${result.diskTotal}`;
  valDisk.style.color = '';
  barDisk.style.width = `${result.diskPercent}%`;
  
  barDisk.className = 'stat-bar-inner';
  if (result.diskPercent > 90) {
    barDisk.className += ' danger';
  } else if (result.diskPercent > 75) {
    barDisk.className += ' warning';
  }

  if (result.osVersion) {
    const card = document.getElementById(`card-${ipKey}`);
    const nameEl = card.querySelector('.device-name');
    if (nameEl && !nameEl.dataset.osUpdated) {
      nameEl.dataset.osUpdated = 'true';
      const label = card.querySelector('.device-mac');
      label.innerText = `${result.osVersion} • MAC: ${label.innerText.replace('MAC: ', '')}`;
    }
  }
}

// -------------------------------------------------------------
// Power & Resolution Actions (v1.1.0)
// -------------------------------------------------------------
async function handleResolutionChange(ip, resolution) {
  const creds = deviceCredentials[ip] || {
    username: appSettings.sshUsername,
    password: appSettings.sshPassword
  };

  if (!appSettings.demoMode && !deviceCredentials[ip]) {
    showToast('Configure VNC first to apply settings.', 'error');
    return;
  }

  showToast(`Updating headless resolution to ${resolution}...`, 'info');
  const result = await window.pibridge.changeResolution({
    ip,
    username: creds.username,
    password: creds.password,
    resolution
  });

  if (result.success) {
    showToast(`Resolution set successfully! Please reboot your Pi to apply.`, 'success');
  } else {
    showToast(`Failed to update resolution: ${result.error}`, 'error');
  }
}

async function handlePowerAction(ip, action) {
  const confirmMsg = action === 'reboot' 
    ? `Are you sure you want to reboot the Raspberry Pi at ${ip}?`
    : `Are you sure you want to shutdown the Raspberry Pi at ${ip}?`;

  if (!confirm(confirmMsg)) return;

  const creds = deviceCredentials[ip] || {
    username: appSettings.sshUsername,
    password: appSettings.sshPassword
  };

  if (!appSettings.demoMode && !deviceCredentials[ip]) {
    showToast(`Configure VNC first to authorize power command.`, 'error');
    return;
  }

  showToast(`Sending ${action} command to ${ip}...`, 'info');
  stopStatsPolling(ip);

  const ipKey = ip.replace(/\./g, '-');
  document.getElementById(`card-${ipKey}`).classList.remove('expanded');

  const result = action === 'reboot'
    ? await window.pibridge.rebootPi({ ip, username: creds.username, password: creds.password })
    : await window.pibridge.shutdownPi({ ip, username: creds.username, password: creds.password });

  if (result.success) {
    showToast(`Power command (${action}) sent successfully.`, 'success');
    
    const badge = document.getElementById(`vnc-badge-${ipKey}`);
    const vncPortVal = document.getElementById(`vnc-port-val-${ipKey}`);
    const btnVnc = document.getElementById(`btn-vnc-${ipKey}`);
    const btnSsh = document.getElementById(`btn-ssh-${ipKey}`);

    if (badge && vncPortVal && btnVnc && btnSsh) {
      badge.className = 'device-status-badge badge-disconnected';
      badge.querySelector('.status-dot').className = 'status-dot red';
      badge.querySelector('.vnc-label').innerText = 'Offline';
      vncPortVal.innerText = 'Closed';
      btnVnc.disabled = true;
      btnSsh.disabled = true;
    }
  } else {
    showToast(`Power command failed: ${result.error}`, 'error');
  }
}

// -------------------------------------------------------------
// VNC Credentials Modal
// -------------------------------------------------------------
function showCredsModal(ip) {
  activeTargetIp = ip;
  targetPiIpText.innerText = ip;
  targetIpHidden.value = ip;
  
  modalSshUser.value = appSettings.sshUsername;
  modalSshPass.value = appSettings.sshPassword;
  
  credsModal.classList.add('active');
  modalSshPass.focus();
}

function hideCredsModal() {
  credsModal.classList.remove('active');
  activeTargetIp = null;
}

function submitCredsForm(e) {
  e.preventDefault();
  
  const ip = targetIpHidden.value;
  const username = modalSshUser.value.trim();
  const password = modalSshPass.value.trim();

  const confirmBtn = document.getElementById('confirm-creds-btn');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="btn-icon spinning">⏳</span> Configuring...';

  appendLog(`[System] Initializing VNC auto-configuration for ${ip}...`);

  deviceCredentials[ip] = { username, password };

  window.pibridge.connectVnc({
    ip,
    username,
    password
  });
}

function handleVncResult(result) {
  const confirmBtn = document.getElementById('confirm-creds-btn');
  confirmBtn.disabled = false;
  confirmBtn.innerHTML = 'Connect & Enable VNC';
  
  hideCredsModal();

  const ipKey = result.ip.replace(/\./g, '-');
  const card = document.getElementById(`card-${ipKey}`);
  
  if (!card) return;

  if (result.success) {
    showToast(`VNC server enabled successfully on ${result.ip}!`, 'success');
    
    const devIndex = currentDevices.findIndex(d => d.ip === result.ip);
    if (devIndex !== -1) {
      currentDevices[devIndex].vncOpen = result.vncOpen;
    }

    const badge = document.getElementById(`vnc-badge-${ipKey}`);
    const vncPortVal = document.getElementById(`vnc-port-val-${ipKey}`);
    const btnVnc = document.getElementById(`btn-vnc-${ipKey}`);

    if (badge && vncPortVal && btnVnc) {
      if (result.vncOpen) {
        badge.className = 'device-status-badge badge-connected';
        badge.querySelector('.status-dot').className = 'status-dot green';
        badge.querySelector('.vnc-label').innerText = 'VNC Active';
        vncPortVal.innerText = 'Open';
        vncPortVal.style.color = '';
        btnVnc.disabled = false;
      } else {
        badge.className = 'device-status-badge badge-connected';
        badge.querySelector('.status-dot').className = 'status-dot orange';
        badge.querySelector('.vnc-label').innerText = 'VNC Starting';
        vncPortVal.innerText = 'Closed (Starting)';
        vncPortVal.style.color = '#f59e0b';
        btnVnc.disabled = false;
        showToast(result.warning || 'VNC service enabled. Wait a few seconds for it to start.', 'info');
      }
    }

    // Automatically trigger loadActiveModule if this verified IP is the active target IP
    if (result.ip === activeTargetIp) {
      loadActiveModule();
    }

    setTimeout(() => {
      toggleDeviceDrawer(result.ip);
    }, 500);
  } else {
    delete deviceCredentials[result.ip];
    showToast(`Failed to enable VNC: ${result.error}`, 'error');
  }
}

// -------------------------------------------------------------
// VNC Launcher
// -------------------------------------------------------------
function handleLaunchResult(result) {
  if (result.success) {
    showToast(`Successfully opened connection to ${result.ip} in VNC Viewer.`, 'success');
  } else {
    showToast(result.error, 'error');
    appendLog(`[VNC Launcher Warning] ${result.error}`);
  }
}

// -------------------------------------------------------------
// Software Updates UI Wireup
// -------------------------------------------------------------
function setupUpdaterUI() {
  const checkBtn = document.getElementById('check-updates-btn');
  const statusText = document.getElementById('update-status-text');
  const progressWrapper = document.getElementById('updater-progress-wrapper');
  const progressPercent = document.getElementById('updater-progress-percent');
  const progressBar = document.getElementById('updater-progress-bar');
  const installWrapper = document.getElementById('updater-install-wrapper');
  const installBtn = document.getElementById('install-update-btn');

  if (!checkBtn) return;

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    checkBtn.innerText = 'Checking...';
    statusText.innerText = 'Checking for updates...';
    statusText.style.color = 'rgba(255,255,255,0.4)';
    progressWrapper.style.display = 'none';
    installWrapper.style.display = 'none';

    try {
      const res = await window.pibridge.updaterCheck();
      if (!res.success) {
        // Fallback: only show toast if the status has not already been updated by the status listener
        if (statusText.innerText === 'Checking for updates...') {
          showToast(`Failed to check for updates: ${res.error}`, 'error');
          checkBtn.disabled = false;
          checkBtn.innerText = 'Check for Updates';
          statusText.innerText = 'Error checking for updates.';
          statusText.style.color = 'var(--accent-red)';
        }
      }
    } catch (err) {
      // Fallback: only show toast if the status has not already been updated by the status listener
      if (statusText.innerText === 'Checking for updates...') {
        showToast(`Failed to check for updates: ${err.message}`, 'error');
        checkBtn.disabled = false;
        checkBtn.innerText = 'Check for Updates';
        statusText.innerText = 'Error checking for updates.';
        statusText.style.color = 'var(--accent-red)';
      }
    }
  });

  installBtn.addEventListener('click', async () => {
    installBtn.disabled = true;
    installBtn.innerText = 'Installing...';
    try {
      await window.pibridge.updaterInstall();
    } catch (err) {
      showToast(`Failed to install update: ${err.message}`, 'error');
      installBtn.disabled = false;
      installBtn.innerText = 'Restart to Install';
    }
  });

  window.pibridge.onUpdateStatus((data) => {
    console.log(`[Updater status event]`, data);
    const { status, data: detail } = data;
    switch (status) {
      case 'checking':
        checkBtn.disabled = true;
        checkBtn.innerText = 'Checking...';
        statusText.innerText = 'Checking for updates...';
        statusText.style.color = 'rgba(255,255,255,0.4)';
        break;
      case 'available':
        const version = detail && detail.version ? detail.version : '1.2.1';
        statusText.innerText = `Update available (v${version})`;
        statusText.style.color = '#a855f7'; // purple accent
        showToast(`A new software update (v${version}) is available!`, 'success');
        
        // Trigger update download
        progressWrapper.style.display = 'block';
        progressBar.style.width = '0%';
        progressPercent.innerText = '0%';
        window.pibridge.updaterDownload().catch(err => {
          showToast(`Download failed: ${err.message}`, 'error');
        });
        break;
      case 'not-available':
        checkBtn.disabled = false;
        checkBtn.innerText = 'Check for Updates';
        statusText.innerText = 'App is up-to-date (v1.2.0)';
        statusText.style.color = 'var(--accent-green)';
        showToast('PiBridge is up-to-date!', 'success');
        break;
      case 'downloaded':
        progressWrapper.style.display = 'none';
        installWrapper.style.display = 'flex';
        checkBtn.disabled = false;
        checkBtn.innerText = 'Check for Updates';
        statusText.innerText = 'Update downloaded and ready to install.';
        statusText.style.color = 'var(--accent-green)';
        showToast('Update downloaded! Click Restart to Install.', 'success');
        break;
      case 'error':
        checkBtn.disabled = false;
        checkBtn.innerText = 'Check for Updates';
        statusText.innerText = 'Error checking for updates.';
        statusText.style.color = 'var(--accent-red)';
        progressWrapper.style.display = 'none';
        showToast(`Update error: ${detail || 'unknown error'}`, 'error');
        break;
    }
  });

  window.pibridge.onUpdateDownloadProgress((percent) => {
    progressWrapper.style.display = 'block';
    progressBar.style.width = `${percent}%`;
    progressPercent.innerText = `${percent}%`;
  });
}

// Run init on load
window.addEventListener('DOMContentLoaded', init);
