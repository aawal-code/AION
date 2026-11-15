import { getApiKey } from './vault.js';
import { logEvent } from './sse.js';

export const PROVIDER_ENDPOINTS = {
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
};

export const DEFAULT_MODELS = {
  cerebras: 'llama3.3-70b',
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.2',
};

/**
 * Resolves the active provider and its API key from the encrypted vault / environment
 */
export async function resolveActiveProvider(preferredProvider = null) {
  const allProviders = ['cerebras', 'anthropic', 'openai', 'groq', 'gemini', 'ollama'];
  if (preferredProvider != null && (typeof preferredProvider !== 'string' || !allProviders.includes(preferredProvider.toLowerCase()))) throw new Error('Unsupported AI provider');
  const providersToCheck = preferredProvider
    ? [preferredProvider.toLowerCase()]
    : allProviders;

  for (const prov of providersToCheck) {
    const key = await getApiKey(prov);
    if (key && key.trim()) {
      return { provider: prov, apiKey: key.trim() };
    }
  }

  return { provider: null, apiKey: null };
}

/**
 * Intercepts prompt and routes it to OpenAI, Anthropic, Cerebras, Groq, Gemini, or Ollama
 */
export async function routePrompt({
  prompt,
  mode = 'ask',
  provider: requestedProvider = null,
  model: requestedModel = null,
  pinnedContext = '',
  history = [],
}) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Prompt is required');
  }

  const { provider, apiKey } = await resolveActiveProvider(requestedProvider);

  if (!provider || !apiKey) {
    const error = new Error('The selected AI provider is not configured. Add its credential in Settings.'); error.statusCode = 503; throw error;
  }

  const model = requestedModel || DEFAULT_MODELS[provider] || 'llama3.3-70b';
  const systemPrompt = buildSystemPrompt(mode, pinnedContext);

  if (provider === 'anthropic') {
    return callAnthropic({ prompt, systemPrompt, model, apiKey, history });
  } else if (PROVIDER_ENDPOINTS[provider]) {
    return callOpenAiCompatible({
      endpoint: PROVIDER_ENDPOINTS[provider],
      provider,
      prompt,
      systemPrompt,
      model,
      apiKey: apiKey || 'ollama',
      history,
    });
  }

  throw new Error('Unsupported AI provider');
}

/**
 * Builds system prompt tailored to the 3-Way Mode (Ask, Plan, Execute)
 */
function buildSystemPrompt(mode, pinnedContext = '') {
  const contextNote = pinnedContext ? `\nActive Project Context: ${pinnedContext}` : '';

  if (mode === 'plan') {
    return `You are AION Architect, an autonomous engineering strategist. Break down the user's request into a structured, step-by-step milestone plan with clear objectives, file targets, and verification criteria.${contextNote}`;
  }

  if (mode === 'execute') {
    return `You are AION CLI Execution Bridge. Prepare terminal commands and executable scripts for autonomous task execution.${contextNote}`;
  }

  return `You are AION Assistant, a clean, precise, and Apple-grade workstation intelligence. Respond concisely and accurately.${contextNote}`;
}

/**
 * OpenAI & Groq Compatible Chat Completion API Caller
 */
async function callOpenAiCompatible({ endpoint, provider, prompt, systemPrompt, model, apiKey, history = [] }) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    })),
    { role: 'user', content: prompt },
  ];

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const data = await res.json();

  if (!res.ok) {
    logEvent('ERROR', `LLM ${provider} request failed with HTTP ${res.status}`);
    throw new Error(`${provider} request failed (HTTP ${res.status})`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI provider returned an empty response');
  return {
    provider,
    model,
    content,
    usage: data.usage || null,
  };
}

/**
 * Anthropic Messages API Caller
 */
async function callAnthropic({ prompt, systemPrompt, model, apiKey, history = [] }) {
  const messages = [
    ...history.slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    })),
    { role: 'user', content: prompt },
  ];

  const res = await fetch(PROVIDER_ENDPOINTS.anthropic, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const data = await res.json();

  if (!res.ok) {
    logEvent('ERROR', `LLM Anthropic request failed with HTTP ${res.status}`);
    throw new Error(`Anthropic request failed (HTTP ${res.status})`);
  }

  const content = data.content?.filter((item) => item.type === 'text').map((item) => item.text).join('') || '';
  if (!content.trim()) throw new Error('AI provider returned an empty response');
  return {
    provider: 'anthropic',
    model,
    content,
    usage: data.usage || null,
  };
}

// Stream only text from the explicitly selected provider. Never persist partial output.
export async function streamPrompt({ prompt, mode, provider: selected, model: selectedModel, pinnedContext = '', history = [], signal, onText }) {
  if (!['ask', 'plan'].includes(mode) || typeof prompt !== 'string' || !prompt.trim()) throw new Error('Invalid chat request');
  const { provider, apiKey } = await resolveActiveProvider(selected);
  if (!provider || !apiKey) { const error = new Error('The selected AI provider is not configured. Add its credential in Settings.'); error.statusCode = 503; throw error; }
  const model = selectedModel || DEFAULT_MODELS[provider];
  const previous = history.slice(-6).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content || '' }));
  const system = buildSystemPrompt(mode, pinnedContext);
  const anthropic = provider === 'anthropic';
  const body = anthropic ? { model, max_tokens: 4096, system, messages: [...previous, { role: 'user', content: prompt }], stream: true } : { model, messages: [{ role: 'system', content: system }, ...previous, { role: 'user', content: prompt }], stream: true };
  const headers = anthropic ? { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  const response = await fetch(PROVIDER_ENDPOINTS[provider], { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  if (!response.ok || !response.body) { const error = new Error(`AI provider request failed (HTTP ${response.status})`); error.publicMessage = error.message; throw error; }
  const decoder = new TextDecoder(); let pending = '', content = '', finished = false;
  const processEvent = async (event) => {
    const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return; if (data === '[DONE]') { finished = true; return; }
    let packet; try { packet = JSON.parse(data); } catch { throw new Error('Invalid AI provider stream'); }
    if (packet.type === 'error' || packet.error) throw new Error('AI provider stream failed');
    if (packet.type === 'message_stop') finished = true;
    const text = anthropic ? (packet.type === 'content_block_delta' && packet.delta?.type === 'text_delta' ? packet.delta.text : '') : packet.choices?.[0]?.delta?.content;
    if (text != null && typeof text !== 'string') throw new Error('Invalid AI provider response');
    if (text) { content += text; if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('AI response exceeds limit'); await onText(text); }
  };
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let match; while ((match = /\r?\n\r?\n/.exec(pending))) { const event = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length); await processEvent(event); }
    if (Buffer.byteLength(pending) > 128 * 1024) throw new Error('AI provider stream event exceeds limit');
  }
  pending += decoder.decode(); if (pending.trim()) await processEvent(pending);
  if (!finished || !content.trim()) throw new Error('AI provider stream ended before completion');
  return { provider, model, content, usage: null };
}
