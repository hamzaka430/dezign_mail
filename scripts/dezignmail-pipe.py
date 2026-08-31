#!/usr/bin/env python3
import sys
import os
import json
import email
from email import policy
import urllib.request
import urllib.error
import time


def log_message(level, msg):
    log_file = os.environ.get("DEZIGNMAIL_LOG", "/var/log/dezignmail-pipe.log")
    try:
        with open(log_file, "a") as f:
            f.write(f"{level}: {msg}\n")
    except Exception:
        pass

def main():
    if len(sys.argv) < 3:
        log_message("ERROR", "Usage: dezignmail-pipe.py <recipient> <sender>")
        sys.exit(0)

    recipient = sys.argv[1]
    sender = sys.argv[2]

    if not recipient or recipient.strip() == "":
        log_message("ERROR", "Recipient cannot be empty")
        sys.exit(0)

    # Read raw email from stdin
    raw_email = sys.stdin.read()

    try:
        msg = email.message_from_string(raw_email, policy=policy.default)
    except Exception as e:
        log_message("ERROR", f"Error parsing email: {e}")
        sys.exit(0)

    subject = msg.get('Subject', '(no subject)')

    body_text = ""
    body_html = ""

    # Parse MIME structure
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))

            if "attachment" not in content_disposition:
                try:
                    payload = part.get_payload(decode=True)
                    if payload:
                        charset = part.get_content_charset() or 'utf-8'
                        decoded = payload.decode(charset, errors='replace')
                        if content_type == "text/plain":
                            body_text += decoded
                        elif content_type == "text/html":
                            body_html += decoded
                except Exception:
                    pass
    else:
        try:
            payload = msg.get_payload(decode=True)
            if payload:
                charset = msg.get_content_charset() or 'utf-8'
                decoded = payload.decode(charset, errors='replace')
                if msg.get_content_type() == "text/html":
                    body_html = decoded
                else:
                    body_text = decoded
        except Exception:
            pass

    api_url = os.environ.get("DEZIGNMAIL_API_URL", "https://dezignmail.pages.dev/api/receive")
    secret = os.environ.get("POSTFIX_WEBHOOK_SECRET", "")

    # We must send a browser-like user agent to avoid CF 403s
    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    payload = {
        "to": recipient,
        "from": sender,
        "subject": subject,
        "body_text": body_text,
        "body_html": body_html,
        "size": len(raw_email)
    }

    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(api_url, data=data, headers=headers, method='POST')

    max_retries = 3
    for attempt in range(max_retries):
        try:
            # Bug fix: use the returned response object
            with urllib.request.urlopen(req, timeout=10) as response:
                if response.status in (200, 201, 202):
                    log_message("SUCCESS", "Delivered to API")
                    sys.exit(0)
                else:
                    log_message("ERROR", f"API returned status {response.status}")
                    # We treat 4xx/5xx as temp/hard failures, causing postfix to defer/bounce. Non-zero exit.
                    sys.exit(0)
        except urllib.error.HTTPError as e:
            log_message("ERROR", f"HTTPError: {e.code} {e.reason}")
            if e.code == 401 or e.code == 403 or e.code == 404:
                # hard failures, don't retry
                sys.exit(0)
        except urllib.error.URLError as e:
            log_message("ERROR", f"URLError: {e.reason}")
        except Exception as e:
            log_message("ERROR", f"Unexpected error: {e}")

        if attempt < max_retries - 1:
            time.sleep(2)

    log_message("ERROR", "Max retries reached. Delivery failed.")
    sys.exit(0)

if __name__ == "__main__":
    main()
