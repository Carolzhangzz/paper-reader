// ===== Backend API Client =====

const API_BASE = '';  // Same origin

/**
 * Load a paper by URL. Returns paper metadata.
 */
export async function loadPaper(url) {
  const res = await fetch(`${API_BASE}/api/paper/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to load paper');
  }

  return await res.json();
}

/**
 * Generic SSE streaming consumer.
 * Calls onChunk(token, fullText) for each token, onDone(fullText) when complete.
 */
async function consumeSSE(url, body, { onChunk, onDone } = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `Request failed (${res.status})`);
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
        if (json.error) throw new Error(json.error);
        if (json.token) {
          full += json.token;
          onChunk?.(json.token, full);
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }

  onDone?.(full);
  return full;
}

export function streamSummarize(paperId, callbacks) {
  return consumeSSE('/api/paper/summarize', { paper_id: paperId }, callbacks);
}

export function streamExtract(paperId, callbacks) {
  return consumeSSE('/api/paper/extract', { paper_id: paperId }, callbacks);
}

export function streamTranslate(paperId, targetLang, callbacks) {
  return consumeSSE('/api/paper/translate', { paper_id: paperId, target_lang: targetLang }, callbacks);
}

export function streamChat(paperId, question, history, callbacks) {
  return consumeSSE('/api/paper/chat', { paper_id: paperId, question, history }, callbacks);
}
