import {
  getProjects,
  getProject,
  createProject,
  getSessions,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  getMessages,
  addMessage,
} from '../services/assistant-db.js';
import { routePrompt } from '../services/llm-provider.js';
import { saveApiKey, deleteApiKey, getVaultStatus } from '../services/vault.js';
import { loadConfig } from '../services/config.js';
import { logEvent } from '../services/sse.js';

/**
 * Utility to parse JSON body
 */
function readJsonBody(req, maxSize = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('error', (err) => reject(new Error(`Stream error: ${err.message}`)));
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        req.destroy();
        const err = new Error('Payload too large');
        err.statusCode = 413;
        reject(err);
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Dispatches /api/assistant/* routes
 */
export async function handleAssistantRoutes(req, res, urlPath) {
  const method = req.method;

  // 1. Projects
  // GET /api/assistant/projects
  if (urlPath === '/api/assistant/projects' && method === 'GET') {
    try {
      const projects = await getProjects();
      return sendJson(res, 200, { status: 'ok', projects });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // POST /api/assistant/projects
  if (urlPath === '/api/assistant/projects' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { status: 'error', error: 'Project name is required' });
      }
      const project = await createProject(body);
      return sendJson(res, 201, { status: 'ok', project });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // GET /api/assistant/projects/:id
  const projMatch = urlPath.match(/^\/api\/assistant\/projects\/([^/]+)$/);
  if (projMatch && method === 'GET') {
    try {
      const project = await getProject(decodeURIComponent(projMatch[1]));
      if (!project) return sendJson(res, 404, { status: 'error', error: 'Project not found' });
      return sendJson(res, 200, { status: 'ok', project });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // GET /api/assistant/projects/:id/sessions
  const projSessMatch = urlPath.match(/^\/api\/assistant\/projects\/([^/]+)\/sessions$/);
  if (projSessMatch && method === 'GET') {
    try {
      const projectId = decodeURIComponent(projSessMatch[1]);
      const sessions = await getSessions(projectId);
      return sendJson(res, 200, { status: 'ok', sessions });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 2. Sessions
  // POST /api/assistant/sessions
  if (urlPath === '/api/assistant/sessions' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!body.projectId) {
        return sendJson(res, 400, { status: 'error', error: 'projectId is required' });
      }
      const session = await createSession(body);
      return sendJson(res, 201, { status: 'ok', session });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // GET /api/assistant/sessions/:id/messages
  const sessMsgMatch = urlPath.match(/^\/api\/assistant\/sessions\/([^/]+)\/messages$/);
  if (sessMsgMatch && method === 'GET') {
    try {
      const sessionId = decodeURIComponent(sessMsgMatch[1]);
      const messages = await getMessages(sessionId);
      return sendJson(res, 200, { status: 'ok', messages });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // PATCH /api/assistant/sessions/:id (Rename or update mode)
  const sessIdMatch = urlPath.match(/^\/api\/assistant\/sessions\/([^/]+)$/);
  if (sessIdMatch && method === 'PATCH') {
    try {
      const sessionId = decodeURIComponent(sessIdMatch[1]);
      const body = await readJsonBody(req);
      const updated = await updateSession(sessionId, body);
      if (!updated) return sendJson(res, 404, { status: 'error', error: 'Session not found' });
      return sendJson(res, 200, { status: 'ok', session: updated });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // DELETE /api/assistant/sessions/:id
  if (sessIdMatch && method === 'DELETE') {
    try {
      const sessionId = decodeURIComponent(sessIdMatch[1]);
      const success = await deleteSession(sessionId);
      return sendJson(res, 200, { status: 'ok', success });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 3. Chat Endpoint (Ask, Plan, Execute)
  // POST /api/assistant/chat
  if (urlPath === '/api/assistant/chat' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const config = loadConfig();
      const execTarget = config.executionTarget || {};

      const {
        prompt,
        mode = 'ask',
        projectId = 'aion',
        sessionId: clientSessionId = null,
        runtimeMode = execTarget.runtimeMode || 'cli',
        provider = execTarget.apiProvider || 'cerebras',
        model = execTarget.apiModel || null,
        cliProfile = execTarget.cliProfile || 'agy',
        customCommand = '',
      } = body;

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        return sendJson(res, 400, { status: 'error', error: 'Prompt is required' });
      }

      // Ensure active session exists
      let sessionId = clientSessionId;
      if (!sessionId) {
        const newSess = await createSession({ projectId, mode });
        sessionId = newSess.id;
      }

      // 1. Record User Message
      const userMessage = await addMessage({
        sessionId,
        role: 'user',
        content: prompt.trim(),
        metadata: { mode, runtimeMode, cliProfile, provider, model },
      });

      // 2. Route based on mode and runtime
      if (mode === 'execute' && runtimeMode !== 'api') {
        return sendJson(res, 503, {
          status: 'disabled',
          error: 'CLI execution is disabled pending an approved, sandboxed task runner.',
        });
      }

      // Mode: 'ask' or 'plan' or (mode === 'execute' && runtimeMode === 'api') -> Route through LLM Provider
      const project = await getProject(projectId);
      const history = await getMessages(sessionId);

      const llmResult = await routePrompt({
        prompt: prompt.trim(),
        mode,
        provider,
        model,
        pinnedContext: project?.pinned_context || '',
        history,
      });

      // 3. Record Assistant Response
      const assistantMessage = await addMessage({
        sessionId,
        role: 'assistant',
        content: llmResult.content,
        metadata: {
          mode,
          runtimeMode,
          cliProfile,
          provider: llmResult.provider,
          model: llmResult.model,
          usage: llmResult.usage,
        },
      });

      return sendJson(res, 200, {
        status: 'ok',
        sessionId,
        mode,
        userMessage,
        assistantMessage,
        response: llmResult,
      });
    } catch (err) {
      logEvent('ERROR', `Assistant chat error: ${err.message}`);
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // 4. Standalone SSE Execution Stream: POST /api/assistant/execute
  if (urlPath === '/api/assistant/execute' && method === 'POST') {
    return sendJson(res, 503, {
      status: 'disabled',
      error: 'CLI execution is disabled pending an approved, sandboxed task runner.',
    });
  }

  // 5. API Vault Endpoints
  // GET /api/assistant/vault
  if (urlPath === '/api/assistant/vault' && method === 'GET') {
    try {
      const status = await getVaultStatus();
      return sendJson(res, 200, { status: 'ok', vault: status });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // POST /api/assistant/vault
  if (urlPath === '/api/assistant/vault' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { provider, key } = body;
      if (!provider) {
        return sendJson(res, 400, { status: 'error', error: 'Provider is required' });
      }
      saveApiKey(provider, key || '');
      const status = await getVaultStatus();
      return sendJson(res, 200, { status: 'ok', vault: status });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  // DELETE /api/assistant/vault/:provider
  const vaultDelMatch = urlPath.match(/^\/api\/assistant\/vault\/([^/]+)$/);
  if (vaultDelMatch && method === 'DELETE') {
    try {
      const provider = decodeURIComponent(vaultDelMatch[1]);
      deleteApiKey(provider);
      const status = await getVaultStatus();
      return sendJson(res, 200, { status: 'ok', vault: status });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
  }

  return false;
}
