// ===== Groq API + PDF Fetching =====

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export function getApiKey() {
  return localStorage.getItem('groq_api_key') || '';
}

export function setApiKey(key) {
  localStorage.setItem('groq_api_key', key);
}

export function getModel() {
  return localStorage.getItem('groq_model') || 'llama-3.3-70b-versatile';
}

export function setModel(model) {
  localStorage.setItem('groq_model', model);
}

// ===== ArXiv helpers =====

/**
 * Extract arxiv ID from various URL formats
 */
export function parseArxivId(url) {
  // arxiv.org/abs/2301.00234 or arxiv.org/pdf/2301.00234
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return match ? match[1] : null;
}

/**
 * Fetch arxiv metadata via export API (through CORS proxy)
 */
export async function fetchArxivMetadata(arxivId) {
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${arxivId}`;
  const res = await fetch(CORS_PROXY + encodeURIComponent(apiUrl));
  if (!res.ok) throw new Error('Failed to fetch arxiv metadata');
  const xml = await res.text();
  return parseArxivXml(xml);
}

function parseArxivXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const entry = doc.querySelector('entry');
  if (!entry) throw new Error('No arxiv entry found');

  const getText = (tag) => {
    const el = entry.querySelector(tag);
    return el ? el.textContent.trim() : '';
  };

  const authors = [...entry.querySelectorAll('author name')].map(n => n.textContent.trim());

  return {
    title: getText('title').replace(/\s+/g, ' '),
    authors,
    abstract: getText('summary').replace(/\s+/g, ' '),
    published: getText('published'),
  };
}

// ===== PDF fetching =====

/**
 * Fetch a PDF via CORS proxy, returns ArrayBuffer
 */
export async function fetchPdfBuffer(url) {
  // Ensure we have the direct PDF URL
  let pdfUrl = url;
  const arxivId = parseArxivId(url);
  if (arxivId) {
    pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
  }

  const res = await fetch(CORS_PROXY + encodeURIComponent(pdfUrl), {
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status})`);

  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
    throw new Error('PDF is too large (>50MB)');
  }

  return await res.arrayBuffer();
}

// ===== URL classification =====

export function classifyUrl(url) {
  url = url.trim();
  if (!url) return { type: 'invalid' };

  if (parseArxivId(url)) return { type: 'arxiv', id: parseArxivId(url) };
  if (url.match(/^https?:\/\/.+\.pdf(\?.*)?$/i)) return { type: 'pdf', url };
  if (url.match(/^10\.\d{4,}/)) return { type: 'doi', doi: url };
  if (url.match(/doi\.org\/(10\.\d{4,}.*)/)) {
    return { type: 'doi', doi: url.match(/doi\.org\/(10\.\d{4,}.*)/)[1] };
  }
  // Try as direct URL
  if (url.match(/^https?:\/\//)) return { type: 'url', url };

  return { type: 'invalid' };
}

// ===== Groq LLM Streaming =====

/**
 * Stream a chat completion from Groq. Calls onChunk(text) for each token.
 * Returns the full accumulated text.
 */
export async function streamChat(messages, { onChunk, onDone, signal } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Please set your Groq API key in Settings');

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getModel(),
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) throw new Error('Invalid API key. Check Settings.');
    if (res.status === 429) throw new Error('Rate limited. Please wait a moment.');
    throw new Error(`Groq API error (${res.status}): ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      try {
        const json = JSON.parse(data);
        const token = json.choices?.[0]?.delta?.content || '';
        if (token) {
          full += token;
          onChunk?.(token, full);
        }
      } catch { /* skip malformed lines */ }
    }
  }

  onDone?.(full);
  return full;
}
