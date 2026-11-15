/**
 * AION Global Navigation Module
 * Responsive 260px desktop sidebar & fluid iOS slide-over drawer
 */

let activeNavId = 'home';
let initialized = false;

/**
 * Open the mobile slide-over sidebar drawer
 */
export function openSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * Close the mobile slide-over sidebar drawer
 */
export function closeSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  document.body.style.overflow = '';
}

/**
 * Toggle the mobile slide-over sidebar drawer
 */
export function toggleSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (sidebar?.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

/**
 * Set active navigation visual state across sidebar items
 * @param {string} navId - 'all', 'assistant', or a device ID
 */
export function setActiveNav(navId) {
  activeNavId = navId;

  const allDevicesBtn = document.getElementById('navItemAllDevices');
  document.getElementById('navItemHome')?.classList.toggle('active', navId === 'home');
  const assistantBtn = document.getElementById('navItemAssistant');

  if (allDevicesBtn) {
    allDevicesBtn.classList.toggle('active', navId === 'all');
  }

  if (assistantBtn) {
    assistantBtn.classList.toggle('active', navId === 'assistant');
  }

  // Update dynamic device items in sidebar
  const deviceItems = document.querySelectorAll('.sidebar-device-item');
  deviceItems.forEach((btn) => {
    const devId = btn.getAttribute('data-device-id');
    btn.classList.toggle('active', devId === navId);
  });

  // On mobile screens, automatically close drawer after selecting a navigation target
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

/**
 * Get the currently active navigation target
 */
export function getActiveNav() {
  return activeNavId;
}

/**
 * Initialize global navigation event listeners
 */
export function initNav() {
  if (initialized) return; initialized = true;
  const setCompact = (compact) => { document.body.classList.toggle('sidebar-compact', compact); const button = document.getElementById('btnCollapseSidebar'); if (button) { button.setAttribute('aria-expanded', String(!compact)); button.setAttribute('aria-label', compact ? 'Expand sidebar' : 'Collapse sidebar'); } };
  let compact = false; try { compact = localStorage.getItem('aion_sidebar_compact') === 'true'; } catch {} setCompact(compact);
  document.getElementById('btnCollapseSidebar')?.addEventListener('click', () => { compact = !compact; setCompact(compact); try { localStorage.setItem('aion_sidebar_compact', String(compact)); } catch {} });
  const syncMobile = (id) => { for (const [name, selected] of [['mobileNavHome', id === 'home'], ['mobileNavChat', id === 'assistant'], ['mobileNavDevices', id !== 'home' && id !== 'assistant']]) { const button = document.getElementById(name); if (button) { if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); } } };
  window.addEventListener('aion:navigation', (event) => syncMobile(event.detail.id)); syncMobile('home');
  const go = (id) => { setActiveNav(id); if (typeof window.aionSelectDevice === 'function') window.aionSelectDevice(id); };
  document.getElementById('navItemHome')?.addEventListener('click', () => go('home'));
  document.getElementById('mobileNavHome')?.addEventListener('click', () => go('home'));
  document.getElementById('mobileNavChat')?.addEventListener('click', () => go('assistant'));
  document.getElementById('mobileNavDevices')?.addEventListener('click', () => go('all'));
  document.getElementById('mobileNavSettings')?.addEventListener('click', () => document.getElementById('btnMobileSettings')?.click());
  // Mobile drawer hamburger trigger
  const btnToggle = document.getElementById('btnToggleSidebarMobile');
  if (btnToggle) {
    btnToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });
  }

  // Backdrop overlay click to dismiss
  const backdrop = document.getElementById('sidebarBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeSidebar();
    });
  }

  // Close drawer on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('appSidebar');
      if (sidebar?.classList.contains('open')) {
        closeSidebar();
      }
    }
  });

  // Close drawer if resized to desktop layout
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      closeSidebar();
    }
  });

  // Setup click handler for "All Devices" overview row
  const navItemAll = document.getElementById('navItemAllDevices');
  if (navItemAll) {
    navItemAll.addEventListener('click', () => {
      setActiveNav('all');
      if (typeof window.aionSelectDevice === 'function') {
        window.aionSelectDevice('all');
      }
    });
  }

  // Setup click handler for "Assistant Workspace"
  const navItemAssistant = document.getElementById('navItemAssistant');
  if (navItemAssistant) {
    navItemAssistant.addEventListener('click', () => {
      setActiveNav('assistant');
      if (typeof window.aionSelectDevice === 'function') {
        window.aionSelectDevice('assistant');
      }
    });
  }
}

// Auto-initialize when loaded as a module if document is already ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
}
