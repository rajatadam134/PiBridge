// ─────────────────────────────────────────────────────────────
// PiBridge — One-Click App Installer Frontend Module
// ─────────────────────────────────────────────────────────────
// Initialised via: window.initInstaller(pibridge, containerId, credentials)
// All CSS class names are prefixed with `installer-` to avoid collisions.

(function () {
  'use strict';

  // ── Inject scoped styles ──────────────────────────────────
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* ── Layout ────────────────────────────────────── */
    .installer-root {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 16px;
      animation: fadeIn 0.3s ease;
    }

    /* ── Search / Filter Bar ──────────────────────── */
    .installer-toolbar {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .installer-search-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .installer-search-input {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-sm, 8px);
      padding: 10px 14px;
      color: var(--text-primary, #f3f4f6);
      font-size: 13px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .installer-search-input::placeholder {
      color: var(--text-muted, #6b7280);
    }
    .installer-search-input:focus {
      border-color: var(--accent-purple, #a855f7);
    }

    .installer-refresh-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-sm, 8px);
      padding: 10px 14px;
      color: var(--text-secondary, #9ca3af);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .installer-refresh-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary, #f3f4f6);
    }
    .installer-refresh-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ── Category Pills ───────────────────────────── */
    .installer-category-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .installer-pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary, #9ca3af);
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .installer-pill:hover {
      background: rgba(168, 85, 247, 0.1);
      color: var(--text-primary, #f3f4f6);
    }
    .installer-pill.active {
      background: rgba(168, 85, 247, 0.18);
      border-color: rgba(168, 85, 247, 0.35);
      color: var(--accent-purple, #a855f7);
    }

    /* ── App Grid ─────────────────────────────────── */
    .installer-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
      flex: 1;
      overflow-y: auto;
      padding-bottom: 8px;
    }

    /* ── App Card ─────────────────────────────────── */
    .installer-card {
      background: var(--bg-card, rgba(22, 22, 38, 0.55));
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--radius-md, 12px);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1);
      position: relative;
      overflow: hidden;
    }
    .installer-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(135deg, var(--accent-purple, #a855f7), var(--accent-blue, #3b82f6));
      opacity: 0;
      transition: opacity 0.25s;
    }
    .installer-card:hover {
      border-color: rgba(168, 85, 247, 0.25);
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.1);
      transform: translateY(-2px);
    }
    .installer-card:hover::before {
      opacity: 1;
    }

    .installer-card-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .installer-icon {
      font-size: 32px;
      line-height: 1;
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.03);
      border-radius: var(--radius-sm, 8px);
    }

    .installer-card-info {
      flex: 1;
      min-width: 0;
    }

    .installer-app-name {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary, #f3f4f6);
      margin: 0 0 4px 0;
    }

    .installer-category-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(59, 130, 246, 0.12);
      color: var(--accent-blue, #3b82f6);
      border: 1px solid rgba(59, 130, 246, 0.2);
    }

    .installer-app-desc {
      font-size: 12px;
      color: var(--text-secondary, #9ca3af);
      line-height: 1.45;
      margin: 0;
      flex: 1;
    }

    /* ── Action Button ────────────────────────────── */
    .installer-action-btn {
      width: 100%;
      padding: 9px 16px;
      border-radius: var(--radius-sm, 8px);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .installer-action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    /* States */
    .installer-btn-install {
      background: linear-gradient(135deg, #10b981, #059669);
      color: #fff;
    }
    .installer-btn-install:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
    }

    .installer-btn-installed {
      background: rgba(16, 185, 129, 0.12);
      color: var(--accent-green, #10b981);
      border: 1px solid rgba(16, 185, 129, 0.25);
    }
    .installer-btn-installed:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.12);
      color: var(--accent-red, #ef4444);
      border-color: rgba(239, 68, 68, 0.3);
    }

    .installer-btn-working {
      background: rgba(168, 85, 247, 0.12);
      color: var(--accent-purple, #a855f7);
      border: 1px solid rgba(168, 85, 247, 0.2);
    }

    .installer-btn-error {
      background: rgba(239, 68, 68, 0.12);
      color: var(--accent-red, #ef4444);
      border: 1px solid rgba(239, 68, 68, 0.25);
    }

    /* Spinner animation */
    .installer-spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: installer-spin 0.7s linear infinite;
    }
    @keyframes installer-spin {
      to { transform: rotate(360deg); }
    }

    /* ── Status Bar ───────────────────────────────── */
    .installer-status-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 16px;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: var(--radius-sm, 8px);
      font-size: 12px;
      color: var(--text-secondary, #9ca3af);
    }
    .installer-status-bar .installer-status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-green, #10b981);
      margin-right: 6px;
    }

    .installer-status-left {
      display: flex;
      align-items: center;
      gap: 4px;
      font-family: var(--font-mono, monospace);
      font-weight: 500;
    }

    .installer-status-right {
      font-weight: 600;
      color: var(--text-primary, #f3f4f6);
    }

    /* ── Empty State ──────────────────────────────── */
    .installer-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
      color: var(--text-muted, #6b7280);
      grid-column: 1 / -1;
    }
    .installer-empty-icon {
      font-size: 36px;
      margin-bottom: 10px;
      opacity: 0.5;
    }
    .installer-empty-text {
      font-size: 14px;
    }

    /* ── Output Modal ─────────────────────────────── */
    .installer-modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 9000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    }
    .installer-modal {
      background: var(--bg-deep, #0c0c16);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: var(--radius-lg, 16px);
      width: 560px;
      max-width: 90vw;
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 16px 64px rgba(0, 0, 0, 0.5);
    }
    .installer-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .installer-modal-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-primary, #f3f4f6);
    }
    .installer-modal-close {
      background: transparent;
      border: none;
      color: var(--text-muted, #6b7280);
      font-size: 18px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .installer-modal-close:hover {
      color: var(--text-primary, #f3f4f6);
      background: rgba(255, 255, 255, 0.06);
    }
    .installer-modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .installer-modal-output {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.04);
      border-radius: var(--radius-sm, 8px);
      padding: 12px;
      font-family: var(--font-mono, monospace);
      font-size: 11px;
      color: var(--text-secondary, #9ca3af);
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.6;
      max-height: 320px;
      overflow-y: auto;
      user-select: text;
    }
  `;
  document.head.appendChild(styleEl);

  // ── Categories to display as filter pills ─────────────────
  const CATEGORIES = ['All', 'Development', 'Networking', 'Media', 'Smart Home', 'System Tools', 'Web Server'];

  // ── Helper: Toast (reuse existing toaster if present) ─────
  function showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) { console.log('[Installer Toast]', type, message); return; }

    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    toast.innerHTML = '<span>' + icon + '</span> <span>' + message + '</span>';
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'fadeIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Helper: Show output modal ─────────────────────────────
  function showOutputModal(title, output) {
    // Remove any existing modal
    const old = document.querySelector('.installer-modal-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.className = 'installer-modal-overlay';
    overlay.innerHTML = `
      <div class="installer-modal">
        <div class="installer-modal-header">
          <span class="installer-modal-title">${title}</span>
          <button class="installer-modal-close">✕</button>
        </div>
        <div class="installer-modal-body">
          <pre class="installer-modal-output">${escapeHtml(output)}</pre>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Close handlers
    overlay.querySelector('.installer-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ═════════════════════════════════════════════════════════════
  // Main Initialisation
  // ═════════════════════════════════════════════════════════════
  window.initInstaller = function initInstaller(pibridge, containerId, credentials) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error('[Installer] Container element not found:', containerId);
      return;
    }

    console.log('[Installer] Initializing app installer UI in container:', containerId);

    // State
    let catalog = [];             // Full app list from backend
    let statusMap = {};           // { appId: 'unknown' | 'checking' | 'installed' | 'not_installed' | 'installing' | 'uninstalling' | 'error' }
    let activeCategory = 'All';
    let searchQuery = '';

    // ── Build the DOM skeleton ──────────────────────────────
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'installer-root';
    root.innerHTML = `
      <div class="installer-toolbar">
        <div class="installer-search-row">
          <input type="text" class="installer-search-input" placeholder="🔍  Search apps by name or description...">
          <button class="installer-refresh-btn">🔄 Refresh Status</button>
        </div>
        <div class="installer-category-bar"></div>
      </div>
      <div class="installer-grid"></div>
      <div class="installer-status-bar">
        <span class="installer-status-left">
          <span class="installer-status-dot"></span>
          <span class="installer-status-ip">Not connected</span>
        </span>
        <span class="installer-status-right installer-status-count">0 installed</span>
      </div>
    `;
    container.appendChild(root);

    // ── References ──────────────────────────────────────────
    const searchInput = root.querySelector('.installer-search-input');
    const refreshBtn = root.querySelector('.installer-refresh-btn');
    const categoryBar = root.querySelector('.installer-category-bar');
    const grid = root.querySelector('.installer-grid');
    const statusIp = root.querySelector('.installer-status-ip');
    const statusCount = root.querySelector('.installer-status-count');

    // ── Update connected IP display ─────────────────────────
    function updateStatusBar() {
      if (credentials && credentials.ip) {
        statusIp.textContent = credentials.ip;
      } else {
        statusIp.textContent = 'Not connected';
      }
      const installedCount = Object.values(statusMap).filter(s => s === 'installed').length;
      statusCount.textContent = installedCount + ' installed';
    }

    // ── Build category pills ────────────────────────────────
    function renderCategoryPills() {
      categoryBar.innerHTML = '';
      CATEGORIES.forEach(cat => {
        const pill = document.createElement('button');
        pill.className = 'installer-pill' + (activeCategory === cat ? ' active' : '');
        pill.textContent = cat;
        pill.addEventListener('click', () => {
          activeCategory = cat;
          renderCategoryPills();
          renderGrid();
        });
        categoryBar.appendChild(pill);
      });
    }

    // ── Filter logic ────────────────────────────────────────
    function getFilteredApps() {
      return catalog.filter(app => {
        // Category filter
        if (activeCategory !== 'All' && app.category !== activeCategory) return false;
        // Search filter
        if (searchQuery) {
          const q = searchQuery.toLowerCase();
          return app.name.toLowerCase().includes(q) || app.description.toLowerCase().includes(q);
        }
        return true;
      });
    }

    // ── Render a single card ────────────────────────────────
    function createCard(app) {
      const card = document.createElement('div');
      card.className = 'installer-card';
      card.dataset.appId = app.id;

      const status = statusMap[app.id] || 'unknown';

      card.innerHTML = `
        <div class="installer-card-header">
          <div class="installer-icon">${app.icon}</div>
          <div class="installer-card-info">
            <div class="installer-app-name">${escapeHtml(app.name)}</div>
            <span class="installer-category-badge">${escapeHtml(app.category)}</span>
          </div>
        </div>
        <p class="installer-app-desc">${escapeHtml(app.description)}</p>
        <button class="installer-action-btn ${getButtonClass(status)}" data-app-id="${app.id}">
          ${getButtonContent(status)}
        </button>
      `;

      // Wire button
      const btn = card.querySelector('.installer-action-btn');
      btn.addEventListener('click', () => handleAction(app.id));

      // Hover on installed → show "Uninstall"
      if (status === 'installed') {
        btn.addEventListener('mouseenter', () => {
          btn.innerHTML = '🗑️ Uninstall';
        });
        btn.addEventListener('mouseleave', () => {
          btn.innerHTML = getButtonContent('installed');
        });
      }

      return card;
    }

    function getButtonClass(status) {
      switch (status) {
        case 'installed':     return 'installer-btn-installed';
        case 'installing':
        case 'uninstalling':
        case 'checking':      return 'installer-btn-working';
        case 'error':         return 'installer-btn-error';
        default:              return 'installer-btn-install';
      }
    }

    function getButtonContent(status) {
      switch (status) {
        case 'checking':      return '<span class="installer-spinner"></span> Checking...';
        case 'installed':     return '✅ Installed';
        case 'installing':    return '<span class="installer-spinner"></span> Installing...';
        case 'uninstalling':  return '<span class="installer-spinner"></span> Uninstalling...';
        case 'error':         return '⚠️ Error — Retry';
        default:              return '⬇️ Install';
      }
    }

    // ── Render the full grid ────────────────────────────────
    function renderGrid() {
      grid.innerHTML = '';
      const filtered = getFilteredApps();

      if (filtered.length === 0) {
        grid.innerHTML = `
          <div class="installer-empty">
            <div class="installer-empty-icon">📭</div>
            <div class="installer-empty-text">No apps match your search.</div>
          </div>
        `;
        return;
      }

      filtered.forEach(app => {
        grid.appendChild(createCard(app));
      });
      updateStatusBar();
    }

    // ── Re-render only a single card (avoid full grid flash) ─
    function refreshCard(appId) {
      const existing = grid.querySelector(`.installer-card[data-app-id="${appId}"]`);
      const app = catalog.find(a => a.id === appId);
      if (!existing || !app) { renderGrid(); return; }
      const newCard = createCard(app);
      existing.replaceWith(newCard);
      updateStatusBar();
    }

    // ── Action handler ──────────────────────────────────────
    async function handleAction(appId) {
      const currentStatus = statusMap[appId] || 'unknown';

      // Don't allow actions while working
      if (['installing', 'uninstalling', 'checking'].includes(currentStatus)) return;

      if (!credentials || !credentials.ip) {
        showToast('No device connected. Please select a Pi first.', 'error');
        return;
      }

      const app = catalog.find(a => a.id === appId);
      if (!app) return;

      if (currentStatus === 'installed') {
        // Uninstall flow
        if (!confirm(`Are you sure you want to uninstall ${app.name} from ${credentials.ip}?`)) return;

        statusMap[appId] = 'uninstalling';
        refreshCard(appId);

        try {
          const result = await pibridge.installerUninstall({
            ip: credentials.ip,
            username: credentials.username,
            password: credentials.password,
            appId: appId
          });

          if (result.success) {
            statusMap[appId] = 'not_installed';
            showToast(app.name + ' uninstalled successfully!', 'success');
            if (result.output) showOutputModal(app.name + ' — Uninstall Output', result.output);
          } else {
            statusMap[appId] = 'installed'; // revert
            showToast('Failed to uninstall ' + app.name, 'error');
            if (result.output) showOutputModal(app.name + ' — Error', result.output);
          }
        } catch (err) {
          console.error('[Installer] Uninstall error:', err);
          statusMap[appId] = 'error';
          showToast('Uninstall error: ' + err.message, 'error');
        }
        refreshCard(appId);
      } else {
        // Install flow (or retry after error)
        statusMap[appId] = 'installing';
        refreshCard(appId);

        try {
          const result = await pibridge.installerInstall({
            ip: credentials.ip,
            username: credentials.username,
            password: credentials.password,
            appId: appId
          });

          if (result.success) {
            statusMap[appId] = 'installed';
            showToast(app.name + ' installed successfully!', 'success');
            if (result.output) showOutputModal(app.name + ' — Install Output', result.output);
          } else {
            statusMap[appId] = 'error';
            showToast('Failed to install ' + app.name, 'error');
            if (result.output) showOutputModal(app.name + ' — Error', result.output);
          }
        } catch (err) {
          console.error('[Installer] Install error:', err);
          statusMap[appId] = 'error';
          showToast('Install error: ' + err.message, 'error');
        }
        refreshCard(appId);
      }
    }

    // ── Check status of all apps ────────────────────────────
    async function checkAllStatuses() {
      if (!credentials || !credentials.ip) {
        showToast('No device connected. Cannot check app statuses.', 'error');
        return;
      }

      console.log('[Installer] Checking install status for all apps on', credentials.ip);
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<span class="installer-spinner"></span> Checking...';

      for (const app of catalog) {
        statusMap[app.id] = 'checking';
        refreshCard(app.id);
      }

      // Check statuses concurrently in batches of 4 to avoid overwhelming the Pi
      const batchSize = 4;
      for (let i = 0; i < catalog.length; i += batchSize) {
        const batch = catalog.slice(i, i + batchSize);
        await Promise.all(batch.map(async (app) => {
          try {
            const result = await pibridge.installerCheckStatus({
              ip: credentials.ip,
              username: credentials.username,
              password: credentials.password,
              appId: app.id
            });

            if (result.success) {
              statusMap[app.id] = result.installed ? 'installed' : 'not_installed';
            } else {
              statusMap[app.id] = 'unknown';
            }
          } catch (err) {
            console.error('[Installer] Status check error for', app.id, err);
            statusMap[app.id] = 'unknown';
          }
          refreshCard(app.id);
        }));
      }

      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '🔄 Refresh Status';
      updateStatusBar();
      console.log('[Installer] Status check complete:', { ...statusMap });
    }

    // ── Load catalog from backend ───────────────────────────
    async function loadCatalog() {
      try {
        console.log('[Installer] Loading app catalog from backend...');
        const result = await pibridge.installerGetCatalog();
        if (result.success && Array.isArray(result.apps)) {
          catalog = result.apps;
          console.log('[Installer] Loaded', catalog.length, 'apps');
          // Initialize all statuses as unknown
          catalog.forEach(app => { statusMap[app.id] = 'unknown'; });
          renderCategoryPills();
          renderGrid();
          // Auto-check statuses if we have credentials
          if (credentials && credentials.ip) {
            checkAllStatuses();
          }
        } else {
          console.error('[Installer] Failed to load catalog:', result);
          showToast('Failed to load app catalog.', 'error');
        }
      } catch (err) {
        console.error('[Installer] Catalog load error:', err);
        showToast('Error loading catalog: ' + err.message, 'error');
      }
    }

    // ── Wire events ─────────────────────────────────────────
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      renderGrid();
    });

    refreshBtn.addEventListener('click', () => {
      checkAllStatuses();
    });

    // ── Boot ────────────────────────────────────────────────
    renderCategoryPills();
    updateStatusBar();
    loadCatalog();

    console.log('[Installer] UI initialisation complete.');

    return {
      disconnect: () => {
        container.innerHTML = '';
      }
    };
  };

})();
