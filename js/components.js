// ===== UI Rendering Components =====

/**
 * Render markdown text to HTML using marked.js
 */
export function renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return marked.parse(text);
  }
  // Fallback: basic escaping
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/**
 * Show paper info in the left panel
 */
export function showPaperInfo(paper) {
  const titleEl = document.getElementById('paper-title');
  const authorsEl = document.getElementById('paper-authors');
  const abstractEl = document.getElementById('paper-abstract');
  const infoEl = document.getElementById('paper-info');
  const emptyEl = document.getElementById('empty-state');
  const tabsEl = document.getElementById('tabs-container');

  titleEl.textContent = paper.title || 'Untitled';
  authorsEl.textContent = paper.authors?.length
    ? paper.authors.join(', ')
    : 'Unknown authors';
  abstractEl.textContent = paper.abstract || '';

  infoEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');
  tabsEl.classList.remove('hidden');
}

/**
 * Render sections in the Sections tab
 */
export function renderSections(sections) {
  const container = document.getElementById('sections-content');
  if (!sections?.length) {
    container.innerHTML = '<p style="color:var(--text-muted)">No sections detected</p>';
    return;
  }

  container.innerHTML = sections.map((s, i) => `
    <div class="section-item" data-index="${i}">
      <div class="section-heading">${escapeHtml(s.heading)}</div>
      <div class="section-preview">${escapeHtml(s.content.slice(0, 200))}...</div>
    </div>
  `).join('');

  // Click to expand/collapse
  container.querySelectorAll('.section-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.index);
      const expanded = el.querySelector('.section-expanded');
      if (expanded) {
        expanded.remove();
        return;
      }
      const div = document.createElement('div');
      div.className = 'section-expanded';
      div.textContent = sections[idx].content;
      el.appendChild(div);
    });
  });
}

/**
 * Add a chat message to the chat panel
 */
export function addChatMessage(role, content, { streaming = false } = {}) {
  const container = document.getElementById('chat-messages');

  // Remove empty state
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;

  if (role === 'assistant') {
    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-area';
    if (streaming) contentDiv.classList.add('streaming-cursor');
    contentDiv.innerHTML = renderMarkdown(content);
    msg.appendChild(contentDiv);
  } else {
    msg.textContent = content;
  }

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

/**
 * Update the last assistant message with new content (for streaming)
 */
export function updateLastAssistantMessage(content, { done = false } = {}) {
  const container = document.getElementById('chat-messages');
  const msgs = container.querySelectorAll('.chat-msg.assistant');
  const last = msgs[msgs.length - 1];
  if (!last) return;

  const contentDiv = last.querySelector('.content-area');
  if (contentDiv) {
    contentDiv.innerHTML = renderMarkdown(content);
    if (done) contentDiv.classList.remove('streaming-cursor');
  }
  container.scrollTop = container.scrollHeight;
}

/**
 * Stream content into a content area element
 */
export function createStreamTarget(elementId) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  el.classList.add('streaming-cursor');

  return {
    update(text) {
      el.innerHTML = renderMarkdown(text);
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },
    done(text) {
      el.innerHTML = renderMarkdown(text);
      el.classList.remove('streaming-cursor');
    },
  };
}

/**
 * Show a toast notification
 */
export function showToast(message, type = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

/**
 * Show/hide loading state
 */
export function setLoading(show, text = 'Loading paper...') {
  const el = document.getElementById('loading-state');
  const textEl = document.getElementById('loading-text');
  textEl.textContent = text;
  el.classList.toggle('hidden', !show);
}

// ===== Helpers =====

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
