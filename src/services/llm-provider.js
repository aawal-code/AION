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
