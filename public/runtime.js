(() => {
  const storageKey = 'botHubRuntimeBase';
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('runtime');

  if (requested === 'clear') localStorage.removeItem(storageKey);
  else if (requested) {
    const normalized = normalizeRuntime(requested);
    if (normalized) localStorage.setItem(storageKey, normalized);
  }

  const base = normalizeRuntime(localStorage.getItem(storageKey) || '');
  const nativeFetch = window.fetch.bind(window);

  window.botHubRuntime = {
    base,
    mode: base ? (isLoopback(base) ? 'local-docker' : 'remote-runtime') : 'same-origin',
    set(value) {
      const normalized = normalizeRuntime(value);
      if (!normalized) throw new Error('Runtime URL must be localhost/127.0.0.1 HTTP or a public HTTPS URL.');
      localStorage.setItem(storageKey, normalized);
      window.location.reload();
    },
    clear() {
      localStorage.removeItem(storageKey);
      window.location.reload();
    }
  };

  if (base) {
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/')) return nativeFetch(`${base}${input}`, init);
      if (input instanceof Request) {
        const url = new URL(input.url);
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
          return nativeFetch(new Request(`${base}${url.pathname}${url.search}`, input), init);
        }
      }
      return nativeFetch(input, init);
    };
  }

  function normalizeRuntime(value) {
    const text = String(value || '').trim().replace(/\/$/, '');
    if (!text) return '';
    if (text === 'local') return 'http://127.0.0.1:8787';
    try {
      const url = new URL(text);
      if (url.username || url.password) return '';
      if (url.protocol === 'https:') return url.origin;
      if (url.protocol === 'http:' && isLoopback(url.origin)) return url.origin;
      return '';
    } catch {
      return '';
    }
  }

  function isLoopback(value) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch {
      return false;
    }
  }
})();
