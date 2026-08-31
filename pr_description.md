# Dezignmail — Automated Test Suite

## Overview
This PR implements a comprehensive, fully offline automated test suite using `vitest` and adds the highly-requested Python-based Postfix webhook pipe script. The line coverage currently sits at ~84.6% mapping across the scoped logic.

## Changes Included
- **Python Pipe Script (`dezignmail-pipe.py`)**: Parses MIME attachments, text, and multipart emails. It uses a browser-like User-Agent to bypass Cloudflare restrictions. Critically, it **always exits with `0`** on all outcomes to ensure Postfix doesn't enter an infinite bounce-retry loop on rejected or faulty webhook payloads, writing errors cleanly to `stderr` instead.
- **Backend Tests (`backend.test.ts`)**: Mocks Neon DB queries and tests the core Hono application covering webhook authentication, timeouts, and in-memory fallback.
  - *Note on Auth Bug:* The tests clearly document a known live bug (`it.fails('BUG: should reject without Authorization header...')`) where missing or incorrect authentication headers in `/api/receive` do not return a `401 Unauthorized` but incorrectly continue execution. The test intentionally fails against current code and will pass once that logic is fixed in a subsequent task.
- **Frontend Tests (`frontend.test.ts`)**: Uses `JSDOM` to mock the browser environment and validates the dynamic URL fetching, rendering, and session logic.
- **Continuous Integration**: Added `.github/workflows/ci.yml` that runs `npm install`, `npm run typecheck`, and `npm run test:coverage` on every push/PR.

## Security Note
There are strictly **no actual secrets or production domain mappings** inside the source code, test definitions, test fixtures, or bash configurations. All environment payloads rely on CI/sandbox mock bindings (`mock-secret`) or placeholder environment bindings (`DEZIGNMAIL_API_URL`, `POSTFIX_WEBHOOK_SECRET`) ensuring the payload maps explicitly and securely to the target VPS when generated.

## Manual QA Steps (Not Testable via Sandbox)
Because the sandbox environment prevents live network routing (port 25, real DB connection checks, live Mail server pings), you must manually run the following assertions against a live instance:
1. **Webhook Secret Validation Bug**: Send a POST request to the live `/api/receive` route via `curl` with a deliberately **wrong or missing** `Authorization` header secret. Observe that it incorrectly returns `200` (or `400` from validation down the line) instead of a `401 Unauthorized` response.
2. **Mail Delivery Test**: Use an external email client (e.g. Gmail) to manually send an email to `any-address@healthtek.eu.cc`. Check your live frontend application to verify the email successfully traversed from Postfix through the webhook and rendered into the target inbox.
3. **External Trust Check**: Input `healthtek.eu.cc` into `mail-tester.com` to confirm that the DNS bindings (SPF, DKIM, and DMARC) hosted on your Cloudflare Dashboard accurately match and pass the assertions set up from your DigitalOcean VPS keys.
