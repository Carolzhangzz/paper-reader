export function renderMarkdown(text) {
  if (typeof marked !== 'undefined') return marked.parse(text);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

export function createStreamTarget(elementId) {
  const el = document.getElementById(elementId);
  el.innerHTML = '';
  el.classList.add('streaming');
  return {
    update(text) { el.innerHTML = '<div class="content-area">' + renderMarkdown(text) + '</div>'; },
    done(text) { el.innerHTML = '<div class="content-area">' + renderMarkdown(text) + '</div>'; el.classList.remove('streaming'); },
  };
}

export function addChatMessage(role, content, { streaming = false } = {}) {
  const c = document.getElementById('chat-messages');
  const empty = c.querySelector('.chat-empty');
  if (empty) empty.remove();
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  if (role === 'assistant') {
    const d = document.createElement('div');
    d.className = 'content-area';
    if (streaming) d.classList.add('streaming');
    d.innerHTML = renderMarkdown(content);
    msg.appendChild(d);
  } else { msg.textContent = content; }
  c.appendChild(msg);
  c.scrollTop = c.scrollHeight;
}

export function updateLastAssistantMessage(content, { done = false } = {}) {
  const msgs = document.querySelectorAll('#chat-messages .chat-msg.assistant');
  const last = msgs[msgs.length - 1];
  if (!last) return;
  const d = last.querySelector('.content-area');
  if (d) { d.innerHTML = renderMarkdown(content); if (done) d.classList.remove('streaming'); }
  document.getElementById('chat-messages').scrollTop = 999999;
}

export function showToast(message, type = 'error') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function setLoading(show, text = 'Loading...') {
  document.getElementById('loading-text').textContent = text;
  document.getElementById('loading-state').classList.toggle('hidden', !show);
}
