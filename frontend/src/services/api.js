// One tiny fetch wrapper for the whole app. Calls go to "/api/..." which Vite
// proxies to the Express backend (:5000) in dev. Engagement endpoints need the
// API key — pass { auth: true } and it attaches the Bearer header.

const BASE = '/api'
const API_KEY = import.meta.env.VITE_API_KEY || ''

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth && API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}${msg ? ` — ${msg}` : ''}`)
  }

  const ct = res.headers.get('content-type') || ''
  return ct.includes('application/json') ? res.json() : res.text()
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
}
