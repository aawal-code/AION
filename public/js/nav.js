/**
 * AION Global Navigation Module
 * Responsive 260px desktop sidebar & fluid iOS slide-over drawer
 */

let activeNavId = 'all';

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
