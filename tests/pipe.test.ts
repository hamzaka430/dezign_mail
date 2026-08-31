import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import http from 'http'
import fs from 'fs'

const execAsync = promisify(exec)

// A small mock HTTP server to act as the webhook endpoint for the python pipe script
describe('dezignmail-pipe.py', { timeout: 15000 }, () => {
  let server: http.Server
  let lastRequest: any = null
  let requestCount = 0

  beforeAll(async () => {
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        requestCount++
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          lastRequest = {
            method: req.method,
            headers: req.headers,
            body: body ? JSON.parse(body) : null
          }

          if (req.headers['authorization'] !== 'Bearer mock-secret') {
            res.writeHead(401)
            res.end()
            return
          }

          if (lastRequest.body.to === 'fail@example.com') {
             res.writeHead(500)
             res.end()
             return
          }

          res.writeHead(200)
          res.end(JSON.stringify({ success: true }))
        })
      })
      server.listen(45678, () => resolve(undefined))
    })
  })

  afterAll(() => {
    server.close()
  })

    const logPath = path.resolve(__dirname, 'test.log')
  beforeEach(() => {
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath)
    }
  })

  const runScript = async (fixtureFile: string, recipient: string, sender: string, extraEnv = {}) => {
    const scriptPath = path.resolve(__dirname, '../scripts/dezignmail-pipe.py')
    const fixturePath = path.resolve(__dirname, 'fixtures', fixtureFile)

    try {
      await execAsync(`python3 ${scriptPath} "${recipient}" "${sender}" < ${fixturePath}`, {
        env: {
          ...process.env,
          DEZIGNMAIL_API_URL: 'http://localhost:45678',
          DEZIGNMAIL_LOG: path.resolve(__dirname, 'test.log'),
          POSTFIX_WEBHOOK_SECRET: 'mock-secret',
          ...extraEnv
        }
      })
      return 0
    } catch (e: any) {
       return e.code || 1
    }
  }

  it('should parse basic text email and post to API', async () => {
    requestCount = 0
    const code = await runScript('test.eml', 'test@example.com', 'sender@example.com')
        expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('SUCCESS: Delivered to API')
    expect(requestCount).toBe(1)
    expect(lastRequest.headers['user-agent']).toContain('Mozilla')
    expect(lastRequest.body.to).toBe('test@example.com')
    expect(lastRequest.body.subject).toBe('Test Email')
    expect(lastRequest.body.body_text).toContain('This is a test email body')
  })

  it('should parse multipart email and post to API', async () => {
    const code = await runScript('multipart.eml', 'test@example.com', 'sender@example.com')
        expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('SUCCESS: Delivered to API')
    expect(lastRequest.body.body_text).toContain('Text version.')
    expect(lastRequest.body.body_html).toContain('HTML version.')
  })

  it('should ignore attachments', async () => {
    const code = await runScript('attachment.eml', 'test@example.com', 'sender@example.com')
        expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('SUCCESS: Delivered to API')
    expect(lastRequest.body.body_text).toContain('Check out this attachment.')
    expect(lastRequest.body.body_text).not.toContain('Attachment content.')
  })

  it('should exit 0 but fail delivery if auth fails', async () => {
    const code = await runScript('test.eml', 'test@example.com', 'sender@example.com', { POSTFIX_WEBHOOK_SECRET: 'wrong' })
    expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('ERROR:')
  })

  it('should exit 0 but fail delivery if recipient is empty', async () => {
    const code = await runScript('test.eml', '', 'sender@example.com')
    expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('ERROR:')
  })

  it('should retry on 500 error and eventually fail', async () => {
    requestCount = 0
    const code = await runScript('test.eml', 'fail@example.com', 'sender@example.com')
    expect(code).toBe(0)
    const logOutput = fs.readFileSync(logPath, 'utf8')
    expect(logOutput).toContain('ERROR:')
    expect(requestCount).toBe(3) // Ensure max retries are hit
  })
})
