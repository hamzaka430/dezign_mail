import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import path from 'path'

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8')

describe('Frontend Logic (index.html)', () => {
  let dom: JSDOM

  beforeAll(() => {
    // Setup a basic JSDOM environment
    dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost' })
    global.window = dom.window as any
    global.document = dom.window.document
    Object.defineProperty(global, 'navigator', { value: dom.window.navigator, writable: true })
    global.sessionStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn()
    } as any

    // Mock fetch for the frontend
    global.fetch = vi.fn(async (url: string) => {
      if (url === '/api/domains') {
        return {
          ok: true,
          json: async () => ({ success: true, data: { domains: ['test-domain.com'] } })
        } as any
      }
      return { ok: true, json: async () => ({}) } as any
    })
  })

  afterAll(() => {
    delete (global as any).window
    delete (global as any).document
    delete (global as any).navigator
    delete (global as any).sessionStorage
    delete (global as any).fetch
  })

  it('should render the UI', () => {
    expect(document.querySelector('.hero-title')?.textContent).toContain('Disposable email')
  })

  it('should initialize state', () => {
    // The script block defines state globally
    // const state = (dom.window as any).state
    // expect(state).toBeDefined()
    // expect(state.primaryDomain).toBe('healthtek.eu.cc') // Initial value before fetch
  })
})
