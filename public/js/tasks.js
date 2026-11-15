let request; let getContext; let refreshTimer; let generation = 0; let pollCount = 0;
const el = (id) => document.getElementById(id);
async function call(url, method = 'GET', body) {
  const response = await request(url, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Task request failed'); return data;
}
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function showError(error) { const target = el('taskError'); target.textContent = error.message; target.hidden = false; }
export async function refreshTaskPanel() {
  if (!request || !getContext || !el('taskPanel')?.open) return;
  const context = getContext(), version = ++generation; clearTimeout(refreshTimer);
  try {
    const data = await call(`/api/assistant/projects/${encodeURIComponent(context.projectId)}/tasks`);
    if (version !== generation || context.projectId !== getContext().projectId) return;
    const list = el('taskList'); list.replaceChildren();
    if (!data.tasks.length) list.append(text('p', 'No tasks for this project.'));
    for (const task of data.tasks) {
      const item = document.createElement('section'); item.className = 'task-entry';
      item.append(text('strong', task.title), text('p', `Status: ${task.status} · Host: ${task.target_host}`));
      const lock = task.action === 'workstation_lock';
      item.append(text('p', `Action: ${lock ? 'Request a lock of this Windows workstation' : 'SHA-256 of the text below'}. Folders: none. Permission: ${task.permissions.join(', ')}. Budget: ${task.max_input_bytes} bytes, ${task.max_duration_ms} ms. Approval expires: ${new Date(task.expires_at).toLocaleString()}.`));
      if (!lock) { const input = text('pre', task.input_text); input.className = 'task-input-preview'; item.append(input); }
      if (task.result) item.append(text('p', lock ? 'Lock was requested; the actual lock state is not verified.' : `SHA-256: ${task.result.sha256}`));
      if (task.error) item.append(text('p', `Failure: ${task.error}`));
      const actions = document.createElement('div'); actions.className = 'assistant-project-form-actions';
      for (const [label, action, allowed] of [['Approve', 'approve', task.status === 'pending'], ['Run', 'run', task.status === 'approved'], ['Cancel', 'cancel', ['pending', 'approved', 'running'].includes(task.status)]]) {
        if (!allowed) continue; const button = text('button', label); button.type = 'button'; button.className = 'btn-secondary';
        button.addEventListener('click', async () => { button.disabled = true; try { await call(`/api/assistant/tasks/${encodeURIComponent(task.id)}/${action}`, 'POST', {}); pollCount = 0; await refreshTaskPanel(); } catch (error) { showError(error); button.disabled = false; } }); actions.append(button);
      }
      const history = document.createElement('details'); history.append(text('summary', 'Task history'));
      history.addEventListener('toggle', async () => { if (!history.open) return; try { const entry = await call(`/api/assistant/tasks/${encodeURIComponent(task.id)}`); const list = document.createElement('ul'); for (const checkpoint of entry.history) list.append(text('li', `${new Date(checkpoint.at).toLocaleString()} · ${checkpoint.event} · ${checkpoint.actor}`)); history.replaceChildren(text('summary', 'Task history'), list); } catch (error) { showError(error); } });
      item.append(actions, history); list.append(item);
    }
    if (data.tasks.some((task) => ['running', 'dispatching'].includes(task.status))) { if (pollCount++ < 25) refreshTimer = setTimeout(refreshTaskPanel, 300); } else pollCount = 0;
  } catch (error) { showError(error); }
}
export function initTaskPanel(options) {
  request = options.request; getContext = options.getContext;
  el('taskPanel')?.addEventListener('toggle', () => { if (el('taskPanel').open) refreshTaskPanel(); else { clearTimeout(refreshTimer); generation++; pollCount = 0; } });
  el('taskAction')?.addEventListener('change', () => { const lock = el('taskAction').value === 'workstation_lock'; el('taskInputGroup').hidden = lock; el('taskInput').required = !lock; el('taskScopeHelp').textContent = lock ? 'Folders: none · Permission: workstation lock · Timeout: 5 seconds · Approval expires in 10 minutes. The lock outcome cannot be verified.' : 'Folders: none · Permission: compute SHA-256 · Limit: 64 KiB, 1 second · Approval expires in 10 minutes.'; });
  el('taskProposalForm')?.addEventListener('submit', async (event) => {
    event.preventDefault(); el('taskError').hidden = true; const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    try { const context = getContext(), lock = el('taskAction').value === 'workstation_lock'; await call('/api/assistant/tasks', 'POST', { projectId: context.projectId, sessionId: context.sessionId, title: el('taskTitle').value, action: lock ? 'workstation_lock' : 'hash_text', input: lock ? '' : el('taskInput').value, targetHost: el('taskHost').value, folders: [], permissions: [lock ? 'workstation:lock' : 'compute:sha256'], maxInputBytes: lock ? 0 : 65536, maxDurationMs: lock ? 5000 : 1000, expiresInMinutes: 10 }); event.target.reset(); el('taskAction').dispatchEvent(new Event('change')); await refreshTaskPanel(); }
    catch (error) { showError(error); } finally { button.disabled = false; }
  });
}
