/**
 * AION Assistant Workspace & BYOCLI Controller
 * Project Management, 3-Way Mode Toggle (Ask, Plan, Execute), SpeechRecognition & Terminal Streaming
 */

import { t } from './i18n.js';
import { getSvgIcon } from './icons.js';
import { showToast } from './app.js';
import { renderMarkdown } from './markdown.js';
import { initTaskPanel, refreshTaskPanel } from './tasks.js';

// All mutating requests use the same-origin session's CSRF token.
function assistantFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    const csrf = decodeURIComponent((document.cookie.split('; ').find((item) => item.startsWith('aion_csrf=')) || '').slice(10));
    options = { ...options, headers: { ...options.headers, 'X-AION-CSRF': csrf } };
  }
  return fetch(url, options);
}

let cachedProjects = [];
let cachedSessions = [];
let activeProjectId = 'aion';
let activeSessionId = null;
let activeChatController = null;
let activeMode = 'ask'; // 'ask' | 'plan' | 'execute'
let speechRecognitionInstance = null;
let isListening = false;
let isFullscreen = false;

let currentTarget = {
  runtimeMode: 'api', // CLI execution is disabled
  cliProfile: 'agy',
  apiProvider: 'cerebras',
  apiModel: 'llama3.3-70b',
};

/**
 * Initializes the Assistant Workspace
 */
export async function initAssistantWorkspace() {
  window.addEventListener('aion:authenticated', () => { loadProjects(); loadExecutionTarget(); });
  await loadProjects();
  await loadExecutionTarget();
  setupTargetSelector();
  setupModeToggle();
  setupNewProjectButton();
  setupProjectManagement();
  initTaskPanel({ request: assistantFetch, getContext: () => ({ projectId: activeProjectId, sessionId: activeSessionId }) });
  setupNewChatButton();
  setupFullscreenChat();
  setupSpeechRecognition();
}

/**
 * Loads execution target configuration from GET /api/config
 */
export async function loadExecutionTarget() {
  try {
    const res = await assistantFetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data.config?.executionTarget) {
        currentTarget = { ...currentTarget, ...data.config.executionTarget };
      }
    }
  } catch (_) {}
  // Older profiles may still select the disabled CLI runtime.
  currentTarget.runtimeMode = 'api';
  applyTargetToUi();
}

export function applyTargetToUi() {
  const cliBtn = document.getElementById('targetModeCli');
  const apiBtn = document.getElementById('targetModeApi');
  const cliWrap = document.getElementById('targetCliWrap');
  const apiWrap = document.getElementById('targetApiWrap');
  const cliSelect = document.getElementById('targetCliSelect');
  const provSelect = document.getElementById('targetProviderSelect');
  const modelSelect = document.getElementById('targetModelSelect');

  const isCli = currentTarget.runtimeMode === 'cli';
  if (cliBtn) cliBtn.classList.toggle('active', isCli);
  if (apiBtn) apiBtn.classList.toggle('active', !isCli);

  if (cliWrap) cliWrap.style.display = isCli ? 'inline-flex' : 'none';
  if (apiWrap) apiWrap.style.display = !isCli ? 'inline-flex' : 'none';

  if (cliSelect && currentTarget.cliProfile) cliSelect.value = currentTarget.cliProfile;
  if (provSelect && currentTarget.apiProvider) provSelect.value = currentTarget.apiProvider;
  if (modelSelect && currentTarget.apiModel) modelSelect.value = currentTarget.apiModel;
}

export function setupTargetSelector() {
  const cliBtn = document.getElementById('targetModeCli');
  const apiBtn = document.getElementById('targetModeApi');
  const cliSelect = document.getElementById('targetCliSelect');
  const provSelect = document.getElementById('targetProviderSelect');
  const modelSelect = document.getElementById('targetModelSelect');

  cliBtn?.addEventListener('click', () => {
    currentTarget.runtimeMode = 'cli';
    applyTargetToUi();
    persistTarget();
    showToast('Runtime: CLI Agent Mode', 'check');
  });

  apiBtn?.addEventListener('click', () => {
    currentTarget.runtimeMode = 'api';
    applyTargetToUi();
    persistTarget();
    showToast('Runtime: Direct API Mode', 'check');
  });

  cliSelect?.addEventListener('change', (e) => {
    currentTarget.cliProfile = e.target.value;
    persistTarget();
    showToast(`CLI Agent: ${currentTarget.cliProfile}`, 'check');
  });

  provSelect?.addEventListener('change', (e) => {
    currentTarget.apiProvider = e.target.value;
    if (currentTarget.apiProvider === 'cerebras') currentTarget.apiModel = 'llama3.3-70b';
    else if (currentTarget.apiProvider === 'openai') currentTarget.apiModel = 'gpt-4o';
    else if (currentTarget.apiProvider === 'anthropic') currentTarget.apiModel = 'claude-3-5-sonnet-20241022';
    else if (currentTarget.apiProvider === 'groq') currentTarget.apiModel = 'llama-3.3-70b-versatile';
    else if (currentTarget.apiProvider === 'gemini') currentTarget.apiModel = 'gemini-1.5-flash';
    else if (currentTarget.apiProvider === 'ollama') currentTarget.apiModel = 'llama3.2';
    applyTargetToUi();
    persistTarget();
  });

  modelSelect?.addEventListener('change', (e) => {
    currentTarget.apiModel = e.target.value.trim();
    persistTarget();
  });
}

let targetSaveQueue = Promise.resolve();
async function persistTarget() {
  const target = { ...currentTarget };
  targetSaveQueue = targetSaveQueue.catch(() => {}).then(async () => {
    const response = await assistantFetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executionTarget: target }) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Could not save provider selection'); }
  });
  try { await targetSaveQueue; } catch (error) { showToast(error.message, 'alert'); }
}

/**
 * Loads projects from GET /api/assistant/projects
 */
export async function loadProjects() {
  try {
    const res = await assistantFetch('/api/assistant/projects');
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok' && Array.isArray(data.projects)) {
      cachedProjects = data.projects;
      if (!cachedProjects.some((p) => p.id === activeProjectId)) {
        activeProjectId = cachedProjects[0]?.id || 'aion';
      }
      renderProjectList();
      updateProjectHeader();
      await loadProjectMessages(activeProjectId);
    }
  } catch (err) {
    console.debug('[Assistant] Projects fetch error:', err.message);
  }
}

/**
 * Renders left-hand project list
 */
export function renderProjectList() {
  const container = document.getElementById('assistantProjectsList');
  if (!container) return;

  if (cachedProjects.length === 0) {
    container.innerHTML = '<div style="font-size: 11.5px; color: var(--text-tertiary); padding: 8px;">No projects</div>';
    return;
  }

  container.innerHTML = cachedProjects
    .map((p) => {
      const isActive = p.id === activeProjectId;
      return `
      <button class="assistant-project-item ${isActive ? 'active' : ''}" data-project-id="${escapeHtml(p.id)}" type="button">
        <svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="project-name-text">${escapeHtml(p.name)}${p.archived_at ? ' (Archived)' : ''}</span>
      </button>
    `;
    })
    .join('');

  container.querySelectorAll('.assistant-project-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-project-id');
      if (id) selectProject(id);
    });
  });
}

/**
 * Selects active project
 */
export async function selectProject(projectId) {
  activeChatController?.abort();
  activeProjectId = projectId;
  activeSessionId = null;
  renderProjectList();
  updateProjectHeader();
  await loadProjectMessages(projectId);
  await refreshProjectManagement();
  await refreshTaskPanel();
}

/**
 * Updates top bar title and pinned context
 */
export function updateProjectHeader() {
  const project = cachedProjects.find((p) => p.id === activeProjectId) || cachedProjects[0];
  const nameEl = document.getElementById('assistantCurrentProjectName');
  const contextEl = document.getElementById('assistantPinnedContext');
  const modeInd = document.getElementById('assistantModeIndicator');

  if (nameEl) nameEl.textContent = project?.name || 'AION';
  if (contextEl) contextEl.textContent = project?.pinned_context || project?.path || 'Active Workspace';
  if (modeInd) {
    modeInd.textContent = activeMode.toUpperCase();
    modeInd.className = `assistant-mode-indicator ${activeMode}`;
  }
}

/**
 * Loads messages for active project
 */
export async function loadProjectMessages(projectId, specificSessionId = null) {
  try {
    const sessRes = await assistantFetch(`/api/assistant/projects/${encodeURIComponent(projectId)}/sessions`);
    if (!sessRes.ok) return;
    const sessData = await sessRes.json();

    if (sessData.status === 'ok' && Array.isArray(sessData.sessions)) {
      cachedSessions = sessData.sessions;
      renderSessionList();

      const selectedSession = specificSessionId
        ? cachedSessions.find((s) => s.id === specificSessionId)
        : cachedSessions[0];

      if (selectedSession) {
        activeSessionId = selectedSession.id;
        setAssistantMode(selectedSession.mode || 'ask', false);

        const msgRes = await assistantFetch(`/api/assistant/sessions/${encodeURIComponent(activeSessionId)}/messages`);
        if (msgRes.ok) {
          const msgData = await msgRes.json();
          if (msgData.status === 'ok' && Array.isArray(msgData.messages)) {
            renderChatMessages(msgData.messages);
            return;
          }
        }
      }
    }

    // Default welcome if no session exists yet
    activeSessionId = null;
    renderChatMessages([
      {
        role: 'assistant',
        content: `Welcome to **${cachedProjects.find((p) => p.id === projectId)?.name || 'AION'}** Assistant Workspace.\n\nChoose **Ask** for questions or **Plan** for a read-only plan. Configure an API provider in Preferences. Execution is currently unavailable.`,
        timestamp: new Date().toISOString(),
      },
    ]);
  } catch (err) {
    console.debug('[Assistant] Session fetch error:', err.message);
  }
}

export function renderSessionList() {
  const container = document.getElementById('assistantSessionsList');
  if (!container) return;

  if (cachedSessions.length === 0) {
    container.innerHTML = '<div style="font-size: 11px; color: var(--text-tertiary); padding: 6px 10px;">No chats yet</div>';
    return;
  }

  container.innerHTML = cachedSessions.map((s) => {
    const isActive = s.id === activeSessionId;
    const title = s.title || `Chat ${formatTime(s.created_at)}`;
    return `
      <div class="assistant-session-item ${isActive ? 'active' : ''}" data-session-id="${escapeHtml(s.id)}">
        <div class="session-item-content">
          <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="session-title-text" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        </div>
        <div class="session-item-actions">
          <button class="btn-icon-subtle btn-rename-session" type="button" data-session-id="${escapeHtml(s.id)}" data-title="${escapeHtml(title)}" title="Rename Chat">
            <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button class="btn-icon-subtle btn-delete-session" type="button" data-session-id="${escapeHtml(s.id)}" title="Delete Chat">
            <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire click to switch session
  container.querySelectorAll('.assistant-session-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-rename-session') || e.target.closest('.btn-delete-session')) return;
      const sId = item.getAttribute('data-session-id');
      if (sId && sId !== activeSessionId) {
        activeSessionId = sId;
        loadProjectMessages(activeProjectId, sId);
      }
    });
  });

  // Wire rename
  container.querySelectorAll('.btn-rename-session').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-session-id');
      const currentTitle = btn.getAttribute('data-title') || 'New Chat';
      const newTitle = window.prompt('Rename Chat Thread:', currentTitle);
      if (!newTitle || !newTitle.trim() || newTitle.trim() === currentTitle) return;

      try {
        const res = await assistantFetch(`/api/assistant/sessions/${encodeURIComponent(sId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newTitle.trim() }),
        });
        if (res.ok) {
          showToast('Chat renamed', 'check');
          await loadProjectMessages(activeProjectId, activeSessionId);
        }
      } catch (err) {
        showToast('Failed to rename chat', 'error');
      }
    });
  });

  // Wire delete
  container.querySelectorAll('.btn-delete-session').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute('data-session-id');
      if (!window.confirm('Delete this chat thread and its history?')) return;

      try {
        const res = await assistantFetch(`/api/assistant/sessions/${encodeURIComponent(sId)}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          showToast('Chat deleted', 'trash');
          activeSessionId = null;
          await loadProjectMessages(activeProjectId);
        }
      } catch (err) {
        showToast('Failed to delete chat', 'error');
      }
    });
  });
}

export function setupNewChatButton() {
  const btn = document.getElementById('btnNewChat');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      const res = await assistantFetch('/api/assistant/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProjectId,
          title: `Chat ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          mode: activeMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'ok' && data.session) {
          showToast('New Chat started', 'check');
          await loadProjectMessages(activeProjectId, data.session.id);
        }
      }
    } catch (err) {
      showToast('Failed creating chat', 'error');
    }
  });
}

export function setupFullscreenChat() {
  const btn = document.getElementById('btnToggleFullscreenChat');
  const view = document.getElementById('canvasChatView');
  const iconEnter = document.getElementById('iconFullscreenEnter');
  const iconExit = document.getElementById('iconFullscreenExit');

  function setFullscreen(enable) {
    isFullscreen = Boolean(enable);
    if (view) view.classList.toggle('assistant-fullscreen', isFullscreen);
    if (iconEnter) iconEnter.style.display = isFullscreen ? 'none' : 'block';
    if (iconExit) iconExit.style.display = isFullscreen ? 'block' : 'none';
  }

  btn?.addEventListener('click', () => {
    setFullscreen(!isFullscreen);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreen) {
      setFullscreen(false);
    }
  });
}

/**
 * 3-Way Mode Toggle (Ask, Plan, Execute)
 */
export function setAssistantMode(mode, triggerToast = true) {
  activeMode = ['ask', 'plan', 'execute'].includes(mode) ? mode : 'ask';

  if (typeof document !== 'undefined') {
    const buttons = document.querySelectorAll('.assistant-mode-btn');
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === activeMode);
    });

    const modeInd = document.getElementById('assistantModeIndicator');
    if (modeInd) {
      modeInd.textContent = activeMode.toUpperCase();
      modeInd.className = `assistant-mode-indicator ${activeMode}`;
    }

    const input = document.getElementById('commandInput');
    if (input) {
      if (activeMode === 'execute') {
        input.placeholder = 'Use Tasks and approvals to propose a bounded action';
      } else if (activeMode === 'plan') {
        input.placeholder = 'Describe feature or goal to plan...';
      } else {
        input.placeholder = 'Ask anything about your workstation...';
      }
    }

    if (triggerToast) {
      showToast(`Mode: ${activeMode.toUpperCase()}`, 'check');
    }
  }
}

export function getAssistantMode() {
  return activeMode;
}

function setupModeToggle() {
  document.querySelectorAll('.assistant-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      if (mode) { setAssistantMode(mode); if (mode === 'execute') { const panel = document.getElementById('taskPanel'); if (panel) { panel.open = true; panel.scrollIntoView({ block: 'nearest' }); } } }
    });
  });
}

/**
 * New Project Button wiring
 */
function setupNewProjectButton() {
  const button = document.getElementById('btnNewProject');
  const form = document.getElementById('newProjectForm');
  const name = document.getElementById('newProjectName');
  const error = document.getElementById('newProjectError');
  const setOpen = (open) => { form.hidden = !open; button.setAttribute('aria-expanded', String(open)); if (open) name.focus(); else button.focus(); };
  button?.addEventListener('click', () => setOpen(form.hidden));
  document.getElementById('cancelNewProject')?.addEventListener('click', () => { form.reset(); error.hidden = true; setOpen(false); });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); error.hidden = true;
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
    try {
      const res = await assistantFetch('/api/assistant/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.value.trim(), path: document.getElementById('newProjectPath').value.trim(), pinned_context: document.getElementById('newProjectContext').value.trim() }) });
      const data = await res.json(); if (!res.ok || data.status !== 'ok') throw new Error(data.error || 'Could not create project');
      form.reset(); setOpen(false); await loadProjects(); await selectProject(data.project.id); showToast('Project created', 'check');
    } catch (err) { error.textContent = err.message; error.hidden = false; }
    finally { submit.disabled = false; }
  });
}

async function refreshProjectManagement() {
  const project = cachedProjects.find((item) => item.id === activeProjectId);
  if (!project) return;
  const name = document.getElementById('projectRename'); if (name) name.value = project.name;
  const archive = document.getElementById('projectArchive'); if (archive) archive.textContent = project.archived_at ? 'Restore' : 'Archive';
  const list = document.getElementById('projectFolders'); if (!list) return;
  try { const res = await assistantFetch(`/api/assistant/projects/${encodeURIComponent(project.id)}/folders`); if (!res.ok) throw new Error('Unable to load folders'); const data = await res.json(); list.replaceChildren(...data.folders.map((folder) => { const item = document.createElement('li'); item.textContent = folder.path; return item; })); }
  catch { list.textContent = 'Unable to load folders.'; }
}
function setupProjectManagement() {
  const error = document.getElementById('projectManageError');
  const run = async (url, method, body) => { error.hidden = true; try { const res = await assistantFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Unable to update project'); await loadProjects(); await refreshProjectManagement(); return true; } catch (err) { error.textContent = err.message; error.hidden = false; return false; } };
  document.getElementById('projectManage')?.addEventListener('toggle', refreshProjectManagement);
  document.getElementById('projectRenameForm')?.addEventListener('submit', (event) => { event.preventDefault(); run(`/api/assistant/projects/${encodeURIComponent(activeProjectId)}`, 'PATCH', { name: document.getElementById('projectRename').value }); });
  document.getElementById('projectArchive')?.addEventListener('click', () => { const project = cachedProjects.find((item) => item.id === activeProjectId); if (project) run(`/api/assistant/projects/${encodeURIComponent(activeProjectId)}`, 'PATCH', { archived: !project.archived_at }); });
  document.getElementById('projectFolderForm')?.addEventListener('submit', async (event) => { event.preventDefault(); if (await run(`/api/assistant/projects/${encodeURIComponent(activeProjectId)}/folders`, 'POST', { path: document.getElementById('projectFolderPath').value })) event.target.reset(); });
}

/**
 * Speech Recognition Integration for Microphone Button
 */
export function setupSpeechRecognition() {
  const micBtn = document.getElementById('commandMicBtn');
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    if (micBtn) micBtn.title = 'Voice input not supported in this browser';
    return;
  }

  speechRecognitionInstance = new SpeechRecognition();
  speechRecognitionInstance.continuous = false;
  speechRecognitionInstance.interimResults = true;
  speechRecognitionInstance.lang = 'en-US';

  speechRecognitionInstance.onstart = () => {
    isListening = true;
    micBtn?.classList.add('listening');
    showToast('Listening... Speak now', 'activity');
  };

  speechRecognitionInstance.onresult = (event) => {
    const input = document.getElementById('commandInput');
    if (!input) return;

    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = transcript;
  };

  speechRecognitionInstance.onerror = (event) => {
    isListening = false;
    micBtn?.classList.remove('listening');
    if (event.error !== 'no-speech') {
      showToast(`Mic error: ${event.error}`, 'alert');
    }
  };

  speechRecognitionInstance.onend = () => {
    isListening = false;
    micBtn?.classList.remove('listening');
  };

  micBtn?.addEventListener('click', () => {
    toggleSpeechRecognition();
  });
}

export function toggleSpeechRecognition() {
  if (!speechRecognitionInstance) {
    showToast('Speech Recognition not supported on this device', 'alert');
    return;
  }

  if (isListening) {
    speechRecognitionInstance.stop();
  } else {
    try {
      speechRecognitionInstance.start();
    } catch (err) {
      speechRecognitionInstance.stop();
    }
  }
}

/**
 * Chat Message Feed Rendering & Terminal Streaming Blocks
 */
export function renderChatMessages(messages) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  container.innerHTML = messages
    .map((msg) => {
      const isUser = msg.role === 'user';
      let meta = null;
      try {
        meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
      } catch {}

      if (meta?.mode === 'execute' && !isUser) {
        // Render Dark Terminal Block for Execute Mode
        const code = meta.exitCode !== undefined ? meta.exitCode : 0;
        const statusBadge = code === 0
          ? '<span class="terminal-badge completed">Completed</span>'
          : '<span class="terminal-badge failed">Failed</span>';

        return `
          <div class="chat-message assistant-message" style="width: 100%;">
            <div class="terminal-block">
              <div class="terminal-header">
                <div class="terminal-dots">
                  <span class="terminal-dot red"></span>
                  <span class="terminal-dot yellow"></span>
                  <span class="terminal-dot green"></span>
                </div>
                <span class="terminal-title">${escapeHtml(meta.command || 'BYOCLI Execution')}</span>
                ${statusBadge}
              </div>
              <pre class="terminal-body"><code>${escapeHtml(msg.content)}</code></pre>
            </div>
          </div>
        `;
      }

      return `
        <div class="chat-message ${isUser ? 'user-message' : 'assistant-message'}">
          <div class="message-bubble ${isUser ? 'user-bubble' : 'assistant-bubble'}">
            <div class="message-content">${formatMessageContent(msg.content)}</div>
            <div class="message-time">${formatTime(msg.timestamp)}</div>
          </div>
        </div>
      `;
    })
    .join('');

  container.scrollTop = container.scrollHeight;
}

/**
 * Handles Prompt Submission from Command Bar
 */
export async function sendAssistantPrompt(prompt) {
  const cleanPrompt = (prompt || '').trim(); if (!cleanPrompt) return;
  if (activeChatController) { showToast('A response is already in progress.', 'alert'); return; }
  if (activeMode === 'execute') { showToast('Execution is unavailable until an approved task runner is ready.', 'alert'); return; }
  const container = document.getElementById('chatMessagesContainer');
  const userEl = document.createElement('div'); userEl.className = 'chat-message user-message'; userEl.innerHTML = `<div class="message-bubble user-bubble"><div class="message-content">${escapeHtml(cleanPrompt)}</div></div>`; container?.appendChild(userEl);
  const responseEl = document.createElement('div'); responseEl.className = 'chat-message assistant-message';
  const bubble = document.createElement('div'); bubble.className = 'message-bubble assistant-bubble';
  const content = document.createElement('div'); content.className = 'message-content'; content.textContent = 'Thinking…';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-secondary'; cancel.textContent = 'Cancel response';
  bubble.append(content, cancel); responseEl.append(bubble); container?.appendChild(responseEl);
  const controller = new AbortController(); activeChatController = controller; cancel.addEventListener('click', () => controller.abort()); let text = '', done = false;
  try {
    const res = await assistantFetch('/api/assistant/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ prompt: cleanPrompt, mode: activeMode, projectId: activeProjectId, sessionId: activeSessionId, runtimeMode: currentTarget.runtimeMode, provider: currentTarget.apiProvider, model: currentTarget.apiModel }) });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Unable to start chat'); }
    const reader = res.body.getReader(), decoder = new TextDecoder(); let pending = '';
    const handle = (event) => { if (controller.signal.aborted) throw new Error('Response cancelled'); const lines = event.split(/\r?\n/); const type = lines.find((line) => line.startsWith('event:'))?.slice(6).trim(); const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n'); if (!raw) return; const data = JSON.parse(raw);
      if (type === 'session') activeSessionId = data.sessionId;
      if (type === 'delta') { text += data.text; content.textContent = text; if (container) container.scrollTop = container.scrollHeight; }
      if (type === 'done') { done = true; content.innerHTML = formatMessageContent(data.assistantMessage.content); }
      if (type === 'error') throw new Error(data.error || 'AI response failed');
    };
    while (true) { const part = await reader.read(); pending += decoder.decode(part.value || new Uint8Array(), { stream: !part.done }); let match; while ((match = /\r?\n\r?\n/.exec(pending))) { handle(pending.slice(0, match.index)); pending = pending.slice(match.index + match[0].length); } if (part.done) break; }
    if (!done) throw new Error('AI response ended before completion');
    if (!controller.signal.aborted) await loadProjectMessages(activeProjectId, activeSessionId);
  } catch (error) { content.textContent = controller.signal.aborted ? 'Response cancelled.' : error.message; }
  finally { cancel.remove(); if (activeChatController === controller) activeChatController = null; }
}

/**
 * Handles Live SSE Streaming Terminal Block for Execute Mode
 */
async function streamExecuteMode(prompt) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;

  const cliCmdName = currentTarget.cliProfile || 'agy';
  const terminalEl = document.createElement('div');
  terminalEl.className = 'chat-message assistant-message';
  terminalEl.style.width = '100%';
  terminalEl.innerHTML = `
    <div class="terminal-block">
      <div class="terminal-header">
        <div class="terminal-dots">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
        </div>
        <span class="terminal-title">${escapeHtml(cliCmdName)} -p "${escapeHtml(prompt)}"</span>
        <span class="terminal-badge running">Running</span>
      </div>
      <pre class="terminal-body"><code class="terminal-code">Initializing ${escapeHtml(cliCmdName)} execution stream...</code><span class="terminal-cursor"></span></pre>
    </div>
  `;

  container.appendChild(terminalEl);
  container.scrollTop = container.scrollHeight;

  const codeEl = terminalEl.querySelector('.terminal-code');
  const badgeEl = terminalEl.querySelector('.terminal-badge');
  const cursorEl = terminalEl.querySelector('.terminal-cursor');

  try {
    const res = await assistantFetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        mode: 'execute',
        projectId: activeProjectId,
        sessionId: activeSessionId,
        runtimeMode: currentTarget.runtimeMode,
        cliProfile: currentTarget.cliProfile,
        provider: currentTarget.apiProvider,
        model: currentTarget.apiModel,
      }),
    });

    if (!res.ok) {
      if (codeEl) codeEl.textContent = `Error: HTTP ${res.status}`;
      if (badgeEl) {
        badgeEl.textContent = 'Failed';
        badgeEl.className = 'terminal-badge failed';
      }
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let currentEvent = 'data';

    if (codeEl) codeEl.textContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.replace('event: ', '').trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.replace('data: ', '').trim());
            if (currentEvent === 'stdout' || currentEvent === 'stderr') {
              accumulated += data.text || '';
              if (codeEl) codeEl.textContent = accumulated;
              container.scrollTop = container.scrollHeight;
            } else if (currentEvent === 'exit') {
              const code = data.code ?? 0;
              if (badgeEl) {
                badgeEl.textContent = code === 0 ? 'Completed' : `Exit ${code}`;
                badgeEl.className = code === 0 ? 'terminal-badge completed' : 'terminal-badge failed';
              }
              if (cursorEl) cursorEl.remove();
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    if (codeEl) codeEl.textContent += `\nStream error: ${err.message}`;
    if (badgeEl) {
      badgeEl.textContent = 'Error';
      badgeEl.className = 'terminal-badge failed';
    }
  }
}

/**
 * Wires Command Bar submission to Assistant Workspace
 */
function setupCommandBarIntegration() {
  const form = document.getElementById('commandBarForm');
  const input = document.getElementById('commandInput');

  form?.addEventListener('submit', (e) => {
    // Check if Assistant view is currently visible
    const chatView = document.getElementById('canvasChatView');
    if (!chatView || chatView.style.display === 'none') {
      return; // Let standard global workstation command bar handle it
    }

    e.preventDefault();
    e.stopPropagation();

    const text = input?.value?.trim();
    if (!text) return;

    if (input) input.value = '';
    sendAssistantPrompt(text);
  });
}

/**
 * Helpers
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMessageContent(content) {
  if (!content) return '';
  return renderMarkdown(content);
}

function formatTime(isoStr) {
  if (!isoStr) return 'Just now';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Just now';
  }
}
