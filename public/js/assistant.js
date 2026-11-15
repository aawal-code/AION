/**
 * AION Assistant Workspace & BYOCLI Controller
 * Project Management, 3-Way Mode Toggle (Ask, Plan, Execute), SpeechRecognition & Terminal Streaming
 */

import { t } from './i18n.js';
import { getSvgIcon } from './icons.js';
import { showToast } from './app.js';
import { renderMarkdown } from './markdown.js';

let cachedProjects = [];
let cachedSessions = [];
let activeProjectId = 'aion';
let activeSessionId = null;
let activeMode = 'ask'; // 'ask' | 'plan' | 'execute'
let speechRecognitionInstance = null;
let isListening = false;
let isFullscreen = false;

let currentTarget = {
  runtimeMode: 'cli', // 'cli' | 'api'
  cliProfile: 'agy',
  apiProvider: 'cerebras',
  apiModel: 'llama3.3-70b',
};

/**
 * Initializes the Assistant Workspace
 */
export async function initAssistantWorkspace() {
  await loadProjects();
  await loadExecutionTarget();
  setupTargetSelector();
  setupModeToggle();
  setupNewProjectButton();
  setupNewChatButton();
  setupFullscreenChat();
  setupSpeechRecognition();
  setupCommandBarIntegration();
}

/**
 * Loads execution target configuration from GET /api/config
 */
export async function loadExecutionTarget() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      if (data.config?.executionTarget) {
        currentTarget = { ...currentTarget, ...data.config.executionTarget };
      }
    }
  } catch (_) {}
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
    else if (currentTarget.apiProvider === 'gemini') currentTarget.apiModel = 'gemini-1.5-flash';
    else if (currentTarget.apiProvider === 'ollama') currentTarget.apiModel = 'llama3.2';
    applyTargetToUi();
    persistTarget();
    showToast(`Provider: ${currentTarget.apiProvider}`, 'check');
  });

  modelSelect?.addEventListener('change', (e) => {
    currentTarget.apiModel = e.target.value;
    persistTarget();
    showToast(`Model: ${currentTarget.apiModel}`, 'check');
  });
}

async function persistTarget() {
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionTarget: currentTarget }),
    });
  } catch (_) {}
}

/**
 * Loads projects from GET /api/assistant/projects
 */
export async function loadProjects() {
  try {
    const res = await fetch('/api/assistant/projects');
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
        <span class="project-name-text">${escapeHtml(p.name)}</span>
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
  activeProjectId = projectId;
  activeSessionId = null;
  renderProjectList();
  updateProjectHeader();
  await loadProjectMessages(projectId);
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
    const sessRes = await fetch(`/api/assistant/projects/${encodeURIComponent(projectId)}/sessions`);
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

        const msgRes = await fetch(`/api/assistant/sessions/${encodeURIComponent(activeSessionId)}/messages`);
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
        content: `Welcome to **${cachedProjects.find((p) => p.id === projectId)?.name || 'AION'}** Assistant Workspace.\n\nChoose **Ask** for instant Q&A, **Plan** for architectural roadmaps, or **Execute** to stream commands directly to your configured BYOCLI.`,
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
        const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(sId)}`, {
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
        const res = await fetch(`/api/assistant/sessions/${encodeURIComponent(sId)}`, {
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
      const res = await fetch('/api/assistant/sessions', {
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
        input.placeholder = 'Run command (e.g. agy -p "check build")...';
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
      if (mode) setAssistantMode(mode);
    });
  });
}

/**
 * New Project Button wiring
 */
function setupNewProjectButton() {
  const btn = document.getElementById('btnNewProject');
  btn?.addEventListener('click', async () => {
    const name = window.prompt('Enter new Project Name (e.g. AION, Core):');
    if (!name || !name.trim()) return;

    const pathVal = window.prompt('Enter Project Working Directory (or leave empty):', process.cwd ? '' : 'C:\\');
    const context = window.prompt('Enter Pinned Context / Mission description:', `${name} Workspace`);

    try {
      const res = await fetch('/api/assistant/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          path: (pathVal || '').trim(),
          pinned_context: (context || '').trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        showToast(`Project '${data.project.name}' created`, 'check');
        await loadProjects();
        selectProject(data.project.id);
      } else {
        showToast(data.error || 'Failed creating project', 'alert');
      }
    } catch (err) {
      showToast(`Error: ${err.message}`, 'alert');
    }
  });
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
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) return;

  const container = document.getElementById('chatMessagesContainer');

  // 1. Immediately append user message to feed
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-message user-message';
  userMsgEl.innerHTML = `
    <div class="message-bubble user-bubble">
      <div class="message-content">${escapeHtml(cleanPrompt)}</div>
      <div class="message-time">Just now</div>
    </div>
  `;
  container?.appendChild(userMsgEl);
  if (container) container.scrollTop = container.scrollHeight;

  // 2. If Execute Mode and Runtime is CLI -> Live SSE Stream in Dark Terminal Block
  if (activeMode === 'execute' && currentTarget.runtimeMode === 'cli') {
    await streamExecuteMode(cleanPrompt);
    return;
  }

  // 3. If Ask, Plan, or Direct API Execute Mode -> POST /api/assistant/chat
  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-message assistant-message';
  loadingEl.innerHTML = `
    <div class="message-bubble assistant-bubble">
      <div class="message-content" style="display: flex; align-items: center; gap: 8px;">
        <span class="status-dot online" style="animation: pulseMic 1s infinite;"></span>
        <span>${activeMode === 'plan' ? 'Generating execution plan...' : (activeMode === 'execute' ? 'Synthesizing CLI actions...' : 'Thinking...')}</span>
      </div>
    </div>
  `;
  container?.appendChild(loadingEl);
  if (container) container.scrollTop = container.scrollHeight;

  try {
    const res = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: cleanPrompt,
        mode: activeMode,
        projectId: activeProjectId,
        sessionId: activeSessionId,
        runtimeMode: currentTarget.runtimeMode,
        cliProfile: currentTarget.cliProfile,
        provider: currentTarget.apiProvider,
        model: currentTarget.apiModel,
      }),
    });

    const data = await res.json();
    loadingEl.remove();

    if (res.ok && data.status === 'ok') {
      if (data.sessionId) activeSessionId = data.sessionId;
      const assistantEl = document.createElement('div');
      assistantEl.className = 'chat-message assistant-message';
      assistantEl.innerHTML = `
        <div class="message-bubble assistant-bubble">
          <div class="message-content">${formatMessageContent(data.assistantMessage?.content || data.response?.content)}</div>
          <div class="message-time">Just now</div>
        </div>
      `;
      container?.appendChild(assistantEl);
      if (container) container.scrollTop = container.scrollHeight;
    } else {
      showToast(data.error || 'Assistant failed to respond', 'alert');
    }
  } catch (err) {
    loadingEl.remove();
    showToast(`Request error: ${err.message}`, 'alert');
  }
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
    const res = await fetch('/api/assistant/chat', {
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
