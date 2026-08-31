import { describe, it, expect, vi, beforeEach } from 'vitest'
import app from '../src/index'
import type { Env } from '../src/types'

// Mock the Neon DB module
vi.mock('../src/db', () => ({
  getDb: vi.fn(() => {
    // Return a mock tagged template literal function
    const mockDb = vi.fn((strings, ...values) => {
      const query = strings.join('?')
      if (query.includes('SELECT * FROM inboxes WHERE id = ?')) {
        if (values[0] === 'expired-session') return []
        return [{
          id: 'test-session',
          address: 'test@healthtek.eu.cc',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          is_active: true
        }]
      }
      if (query.includes('SELECT * FROM messages WHERE inbox_id = ?')) {
        return [{
          id: 'msg-1',
          inbox_id: 'test-session',
          inbox_address: 'test@healthtek.eu.cc',
          from_address: 'sender@example.com',
          subject: 'Test Subject',
          body_html: '<p>Hi</p>',
          body_text: 'Hi',
          received_at: new Date().toISOString(),
          is_read: false
        }]
      }
      if (query.includes('SELECT id FROM inboxes WHERE address = ?')) {
         if (values[0] === 'not-found@healthtek.eu.cc') return []
         return [{id: 'test-session'}]
      }
      if (query.includes('SELECT * FROM messages WHERE id = ?')) {
         return [{
           id: 'msg-1',
           inbox_address: 'test@healthtek.eu.cc',
           is_read: false
         }]
      }
      if (query.includes('SELECT expires_at FROM inboxes WHERE id = ?')) {
         return [{expires_at: new Date(Date.now() + 7200000).toISOString()}]
      }
      return []
    })
    return mockDb
  })
}))

describe('Backend API Routes', () => {
  const env: Env = {
    ALLOWED_DOMAINS: 'healthtek.eu.cc',
    POSTFIX_WEBHOOK_SECRET: 'super-secret-key',
    DATABASE_URL: 'postgres://mock:mock@mock.neon.tech/mock'
  }

  it('GET /api/domains should return ALLOWED_DOMAINS', async () => {
    const res = await app.request('/api/domains', {}, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.domains).toContain('healthtek.eu.cc')
  })

  it('GET /api/health should return ok', async () => {
    const res = await app.request('/api/health', {}, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.status).toBe('ok')
  })

  it('POST /api/inbox/create should return a new session', async () => {
    const res = await app.request('/api/inbox/create', {
      method: 'POST',
      body: JSON.stringify({ custom_alias: 'my-alias' })
    }, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.email_address).toBe('my-alias@healthtek.eu.cc')
    expect(json.data.session_id).toBeDefined()
  })

  it('GET /api/inbox/:id should return session details', async () => {
    const res = await app.request('/api/inbox/test-session', {}, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.email_address).toBe('test@healthtek.eu.cc')
  })

  it('GET /api/inbox/:id should return 404 for unknown/expired session', async () => {
    const res = await app.request('/api/inbox/expired-session', {}, { ...env })
    expect(res.status).toBe(404)
    const json = await res.json() as any
    expect(json.success).toBe(false)
  })

  it('GET /api/inbox/:id/messages should list messages', async () => {
    const res = await app.request('/api/inbox/test-session/messages', {}, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.message_count).toBe(1)
    expect(json.data.messages[0].subject).toBe('Test Subject')
  })

  it('GET /api/inbox/:id/messages/:msgId should return the message', async () => {
    const res = await app.request('/api/inbox/test-session/messages/msg-1', {}, { ...env })
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.data.id).toBe('msg-1')
  })

  it('DELETE /api/inbox/:id/messages/:msgId should return success', async () => {
    const res = await app.request('/api/inbox/test-session/messages/msg-1', { method: 'DELETE' }, { ...env })
    expect(res.status).toBe(200)
  })

  it('DELETE /api/inbox/:id should return success', async () => {
    const res = await app.request('/api/inbox/test-session', { method: 'DELETE' }, { ...env })
    expect(res.status).toBe(200)
  })

  it('POST /api/inbox/:id/extend should return success', async () => {
    const res = await app.request('/api/inbox/test-session/extend', { method: 'POST' }, { ...env })
    expect(res.status).toBe(200)
  })

  describe('POST /api/receive (Webhook)', () => {
    const payload = {
      to: 'test@healthtek.eu.cc',
      from: 'sender@example.com',
      subject: 'Hello',
      body_text: 'World'
    }

    it('should reject without Authorization header', async () => {
      const res = await app.request('/api/receive', {
        method: 'POST',
        body: JSON.stringify(payload)
      }, { ...env })
      expect(res.status).toBe(401)
    })

    it('should reject with wrong secret', async () => {
      const res = await app.request('/api/receive', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer wrong-secret' },
        body: JSON.stringify(payload)
      }, { ...env })
      expect(res.status).toBe(401)
    })

    it('should accept with correct secret and valid payload', async () => {
      const res = await app.request('/api/receive', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer super-secret-key' },
        body: JSON.stringify(payload)
      }, { ...env })
      expect(res.status).toBe(200)
      const json = await res.json() as any
      expect(json.success).toBe(true)
    })

    it('should return 404 for unknown inbox address', async () => {
      const res = await app.request('/api/receive', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer super-secret-key' },
        body: JSON.stringify({ ...payload, to: 'not-found@healthtek.eu.cc' })
      }, { ...env })
      expect(res.status).toBe(404)
    })
  })
})
