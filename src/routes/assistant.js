import {
  getProjects,
  getProject,
  createProject,
  getSessions,
  getSession,
  createSession,
  getMessages,
  addMessage,
} from '../services/assistant-db.js';
import { routePrompt } from '../services/llm-provider.js';
import { streamExecutionToSse, resolveCliCommand } from '../services/execution-engine.js';
import { saveApiKey, deleteApiKey, getVaultStatus } from '../services/vault.js';
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

  // 3. Chat Endpoint (Ask, Plan, Execute)
  // POST /api/assistant/chat
  if (urlPath === '/api/assistant/chat' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const {
        prompt,
        mode = 'ask',
        projectId = 'aion',
        sessionId: clientSessionId = null,
        provider = null,
        model = null,
        cliProfile = 'agy',
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
        metadata: { mode },
      });

      // 2. Route based on mode
      if (mode === 'execute') {
        // Find project path if available
        const project = await getProject(projectId);
        const cwd = project?.path || process.cwd();

        // Stream via SSE
        return streamExecutionToSse(res, {
          prompt: prompt.trim(),
          profileId: cliProfile,
          customCommand,
          cwd,
          sessionId,
          projectId,
        });
      }

      // Mode: 'ask' or 'plan' -> Route through LLM Provider
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
    try {
      const body = await readJsonBody(req);
      const {
        prompt,
        profileId = 'agy',
        customCommand = '',
        projectId = 'aion',
        sessionId = null,
      } = body;

      if (!prompt) {
        return sendJson(res, 400, { status: 'error', error: 'Prompt is required' });
      }

      const project = await getProject(projectId);
      const cwd = project?.path || process.cwd();

      return streamExecutionToSse(res, {
        prompt,
        profileId,
        customCommand,
        cwd,
        sessionId,
        projectId,
      });
    } catch (err) {
      return sendJson(res, 500, { status: 'error', error: err.message });
    }
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
