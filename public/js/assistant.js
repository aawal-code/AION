/**
 * AION Assistant Workspace & BYOCLI Controller
 * Project Management, 3-Way Mode Toggle (Ask, Plan, Execute), SpeechRecognition & Terminal Streaming
 */

import { t } from './i18n.js';
import { getSvgIcon } from './icons.js';
import { showToast } from './app.js';

let cachedProjects = [];
let activeProjectId = 'aion';
let activeSessionId = null;
let activeMode = 'ask'; // 'ask' | 'plan' | 'execute'
let speechRecognitionInstance = null;
let isListening = false;

/**
 * Initializes the Assistant Workspace
 */
export async function initAssistantWorkspace() {
  await loadProjects();
  setupModeToggle();
  setupNewProjectButton();
  setupSpeechRecognition();
  setupCommandBarIntegration();
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
export async function loadProjectMessages(projectId) {
  try {
    const sessRes = await fetch(`/api/assistant/projects/${encodeURIComponent(projectId)}/sessions`);
    if (!sessRes.ok) return;
    const sessData = await sessRes.json();

    if (sessData.status === 'ok' && Array.isArray(sessData.sessions) && sessData.sessions.length > 0) {
      const latestSession = sessData.sessions[0];
      activeSessionId = latestSession.id;
      setAssistantMode(latestSession.mode || 'ask', false);

      const msgRes = await fetch(`/api/assistant/sessions/${encodeURIComponent(activeSessionId)}/messages`);
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        if (msgData.status === 'ok' && Array.isArray(msgData.messages)) {
          renderChatMessages(msgData.messages);
          return;
        }
      }
    }

    // Default welcome if no session exists yet
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
    const name = window.prompt('Enter new Project Name (e.g. HEXIS, Nebula, Core):');
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

  // 2. If Execute Mode -> Live SSE Stream in Dark Terminal Block
  if (activeMode === 'execute') {
    await streamExecuteMode(cleanPrompt);
    return;
  }

  // 3. If Ask or Plan Mode -> POST /api/assistant/chat
  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-message assistant-message';
  loadingEl.innerHTML = `
    <div class="message-bubble assistant-bubble">
      <div class="message-content" style="display: flex; align-items: center; gap: 8px;">
        <span class="status-dot online" style="animation: pulseMic 1s infinite;"></span>
        <span>${activeMode === 'plan' ? 'Generating execution plan...' : 'Thinking...'}</span>
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
        <span class="terminal-title">agy -p "${escapeHtml(prompt)}"</span>
        <span class="terminal-badge running">Running</span>
      </div>
      <pre class="terminal-body"><code class="terminal-code">Initializing BYOCLI process...</code><span class="terminal-cursor"></span></pre>
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
  return escapeHtml(content)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\n/g, '<br>');
}

function formatTime(isoStr) {
  if (!isoStr) return 'Just now';
  try {
    return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Just now';
  }
}
