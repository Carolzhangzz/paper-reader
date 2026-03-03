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
    done(text) {
      const html = '<div class="content-area">' + renderMarkdown(text) + '</div>';
      el.innerHTML = html;
      el.classList.remove('streaming');
      addCopyButton(el, text);
    },
  };
}

function addCopyButton(container, rawText) {
  const btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawText);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    } catch { btn.textContent = 'Failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); }
  });
  container.insertBefore(btn, container.firstChild);
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
