import { getApiKey } from './vault.js';
import { logEvent } from './sse.js';

export const PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

export const DEFAULT_MODELS = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022',
  groq: 'llama-3.3-70b-versatile',
};

/**
 * Resolves the active provider and its API key from the encrypted vault / environment
 */
export async function resolveActiveProvider(preferredProvider = null) {
  const providersToCheck = preferredProvider
    ? [preferredProvider.toLowerCase()]
    : ['anthropic', 'openai', 'groq'];

  for (const prov of providersToCheck) {
    const key = await getApiKey(prov);
    if (key && key.trim()) {
      return { provider: prov, apiKey: key.trim() };
    }
  }

  // If preferred was specified but has no key, check others as fallback
  if (preferredProvider) {
    const allProviders = ['anthropic', 'openai', 'groq'];
    for (const prov of allProviders) {
      if (prov === preferredProvider.toLowerCase()) continue;
      const key = await getApiKey(prov);
      if (key && key.trim()) {
        return { provider: prov, apiKey: key.trim() };
      }
    }
  }

  return { provider: null, apiKey: null };
}

/**
 * Intercepts prompt and routes it to OpenAI, Anthropic, or Groq
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

  // If no external LLM key is configured in the vault, provide intelligent local fallback
  if (!provider || !apiKey) {
    return generateLocalResponse({ prompt, mode, pinnedContext });
  }

  const model = requestedModel || DEFAULT_MODELS[provider] || 'gpt-4o';
  const systemPrompt = buildSystemPrompt(mode, pinnedContext);

  if (provider === 'anthropic') {
    return callAnthropic({ prompt, systemPrompt, model, apiKey, history });
  } else if (provider === 'openai') {
    return callOpenAiCompatible({
      endpoint: PROVIDER_ENDPOINTS.openai,
      provider: 'openai',
      prompt,
      systemPrompt,
      model,
      apiKey,
      history,
    });
  } else if (provider === 'groq') {
    return callOpenAiCompatible({
      endpoint: PROVIDER_ENDPOINTS.groq,
      provider: 'groq',
      prompt,
      systemPrompt,
      model,
      apiKey,
      history,
    });
  }

  return generateLocalResponse({ prompt, mode, pinnedContext });
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
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || `HTTP ${res.status} from ${provider}`;
    logEvent('ERROR', `LLM ${provider} error: ${errMsg}`);
    throw new Error(`${provider} API Error: ${errMsg}`);
  }

  const content = data.choices?.[0]?.message?.content || '';
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
  });

  const data = await res.json();

  if (!res.ok) {
    const errMsg = data.error?.message || `HTTP ${res.status} from Anthropic`;
    logEvent('ERROR', `LLM Anthropic error: ${errMsg}`);
    throw new Error(`Anthropic API Error: ${errMsg}`);
  }

  const content = data.content?.[0]?.text || '';
  return {
    provider: 'anthropic',
    model,
    content,
    usage: data.usage || null,
  };
}

/**
 * Intelligent local response when no external API key is configured
 */
function generateLocalResponse({ prompt, mode, pinnedContext }) {
  const cleanPrompt = prompt.trim();

  if (mode === 'plan') {
    return {
      provider: 'local-zero-ai',
      model: 'aion-planner-v1',
      content: `### Execution Plan: "${cleanPrompt}"\n\n` +
        `1. **Analyze Requirements & Dependencies**\n   - Scope: Target ${pinnedContext || 'active workspace'}\n   - Verify CLI tools and dependencies are available\n\n` +
        `2. **Architecture Implementation**\n   - Execute core logic changes\n   - Validate file system permissions and path safety\n\n` +
        `3. **Verification & Testing**\n   - Run regression and unit test suites\n   - Verify stdout/stderr logs and state persistence\n\n` +
        `*(To connect live cloud models like Claude 3.5 Sonnet or GPT-4o, configure your API key in Preferences → API Vault)*`,
      usage: { promptTokens: cleanPrompt.length, completionTokens: 80 },
    };
  }

  return {
    provider: 'local-zero-ai',
    model: 'aion-assistant-v1',
    content: `I received your prompt: "${cleanPrompt}".\n\n` +
      `AION Assistant is running locally. You can execute tasks directly via BYOCLI in **Execute** mode, or connect **OpenAI**, **Anthropic**, or **Groq** by adding your API key in **Preferences → API Vault**.`,
    usage: { promptTokens: cleanPrompt.length, completionTokens: 60 },
  };
}
