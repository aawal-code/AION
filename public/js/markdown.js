/**
 * Zero-Dependency GFM Markdown, Table, Code Block & Terminal Renderer
 * Designed for AION Assistant Workspace & Streaming Chat
 */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TERMINAL_LANGS = new Set([
  'bash', 'sh', 'shell', 'zsh', 'terminal', 'cmd', 'powershell', 'pwsh', 'ps1', 'console'
]);

/**
 * Initializes global copy button event delegation for code blocks
 */
let copyHandlerInitialized = false;
export function initMarkdownCopyHandler() {
  if (copyHandlerInitialized || typeof document === 'undefined') return;
  copyHandlerInitialized = true;

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.code-copy-btn');
    if (!btn) return;

    const codeWrap = btn.closest('.code-block-wrapper');
    const codeEl = codeWrap?.querySelector('code');
    const rawCode = btn.getAttribute('data-raw-code') || codeEl?.innerText || '';

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(rawCode);
      } else {
        const ta = document.createElement('textarea');
        ta.value = rawCode;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }

      const origText = btn.innerHTML;
      btn.innerHTML = `
        <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
      `;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = origText;
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.warn('[Markdown] Failed to copy code:', err.message);
    }
  });
}

// Auto-initialize copy handler if in browser
if (typeof window !== 'undefined') {
  initMarkdownCopyHandler();
}

/**
 * Main GFM Markdown to HTML compiler
 * @param {string} text - Raw Markdown content
 * @param {boolean} isStreaming - True if incoming token stream is still active
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(text, isStreaming = false) {
  if (!text || typeof text !== 'string') return '';

  let content = text;

  // Placeholder store for code blocks to prevent nested markdown token evaluation
  const codeBlocks = [];

  // 1. Extract fenced code blocks
  // Regex handles both closed ```code``` and open ```code during live streaming
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)/g;
  content = content.replace(codeBlockRegex, (match, rawLang, code) => {
    const lang = (rawLang || '').trim().toLowerCase();
    const isTerminal = TERMINAL_LANGS.has(lang);
    const cleanCode = code.replace(/\n$/, '');
    const displayLang = isTerminal ? (lang || 'terminal').toUpperCase() : (lang || 'code').toUpperCase();

    const placeholder = `%%AIONCODEBLOCK${codeBlocks.length}%%`;
    const blockHtml = `
      <div class="code-block-wrapper ${isTerminal ? 'terminal-block' : ''}">
        <div class="code-block-header">
          <div class="code-lang-badge">
            ${isTerminal ? `
              <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
            ` : `
              <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            `}
            <span>${escapeHtml(displayLang)}</span>
          </div>
          <button class="code-copy-btn" type="button" data-raw-code="${escapeHtml(cleanCode)}" title="Copy code">
            <svg class="icon icon-xs" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>
        </div>
        <pre class="code-pre"><code class="code-content language-${escapeHtml(lang)}">${escapeHtml(cleanCode)}</code></pre>
      </div>
    `.trim();

    codeBlocks.push(blockHtml);
    return placeholder;
  });

  // 2. Parse Markdown Tables
  const lines = content.split('\n');
  const processedLines = [];
  let inTable = false;
  let tableHeader = [];
  let tableAlignments = [];
  let tableRows = [];

  function flushTable() {
    if (!inTable) return;
    let html = '<div class="table-wrapper"><table class="markdown-table"><thead><tr>';
    tableHeader.forEach((th, idx) => {
      const align = tableAlignments[idx] || 'left';
      html += `<th style="text-align: ${align}">${renderInline(th)}</th>`;
    });
    html += '</tr></thead><tbody>';
    tableRows.forEach((row) => {
      html += '<tr>';
      row.forEach((td, idx) => {
        const align = tableAlignments[idx] || 'left';
        html += `<td style="text-align: ${align}">${renderInline(td)}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    processedLines.push(html);
    inTable = false;
    tableHeader = [];
    tableAlignments = [];
    tableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if line looks like a table row: | a | b |
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());

      // If next line is a separator row (e.g. |---|:---:|), this is the header row
      const nextLine = (lines[i + 1] || '').trim();
      const isSepRow = /^\|(?:\s*:?-+:?\s*\|)+$/.test(nextLine);

      if (!inTable && isSepRow) {
        inTable = true;
        tableHeader = cells;
        // Parse alignments
        const sepCells = nextLine.slice(1, -1).split('|').map((s) => s.trim());
        tableAlignments = sepCells.map((s) => {
          if (s.startsWith(':') && s.endsWith(':')) return 'center';
          if (s.endsWith(':')) return 'right';
          return 'left';
        });
        i++; // Skip the separator line
        continue;
      } else if (inTable) {
        tableRows.push(cells);
        continue;
      }
    }

    if (inTable) {
      flushTable();
    }

    processedLines.push(lines[i]);
  }

  if (inTable) {
    flushTable();
  }

  content = processedLines.join('\n');

  // 3. Headings (# - ####)
  content = content.replace(/^#### (.*?)$/gm, '<h4 class="md-heading md-h4">$1</h4>');
  content = content.replace(/^### (.*?)$/gm, '<h3 class="md-heading md-h3">$1</h3>');
  content = content.replace(/^## (.*?)$/gm, '<h2 class="md-heading md-h2">$1</h2>');
  content = content.replace(/^# (.*?)$/gm, '<h1 class="md-heading md-h1">$1</h1>');

  // 4. Blockquotes (> text)
  content = content.replace(/^(?:> ?(.*?)(?:\n|$))+/gm, (match) => {
    const quoteBody = match
      .split('\n')
      .map((l) => l.replace(/^> ?/, ''))
      .join('<br>');
    return `<blockquote class="markdown-quote">${quoteBody}</blockquote>`;
  });

  // 5. Unordered Lists (- item or * item)
  content = content.replace(/^(?:[-*] (.*?)(?:\n|$))+/gm, (match) => {
    const items = match
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^[-*] /, '')}</li>`)
      .join('');
    return `<ul class="markdown-list">${items}</ul>`;
  });

  // 6. Ordered Lists (1. item)
  content = content.replace(/^(?:\d+\. (.*?)(?:\n|$))+/gm, (match) => {
    const items = match
      .trim()
      .split('\n')
      .map((l) => `<li>${l.replace(/^\d+\. /, '')}</li>`)
      .join('');
    return `<ol class="markdown-list-ordered">${items}</ol>`;
  });

  // 7. Inline Formatting
  content = renderInline(content);

  // 8. Paragraphs / Line Breaks (collapse multiple newlines into clean breaks)
  content = content.replace(/\n\n+/g, '<br><br>');
  content = content.replace(/\n/g, '<br>');

  // 9. Restore Fenced Code Blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    content = content.replace(`%%AIONCODEBLOCK${i}%%`, codeBlocks[i]);
  }

  return content;
}

/**
 * Parses inline formatting (bold, italic, code, links)
 */
function renderInline(str) {
  if (!str) return '';

  return str
    // Inline code: `code`
    .replace(/`([^`]+)`/g, (_, code) => `<code class="inline-code">${escapeHtml(code)}</code>`)
    // Bold: **text** or __text__
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Strikethrough: ~~text~~
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    // Markdown link: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safeUrl = escapeHtml(url.trim());
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="markdown-link">${escapeHtml(label)}</a>`;
    });
}
