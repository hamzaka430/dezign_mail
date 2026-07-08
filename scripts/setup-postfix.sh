#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Dezignmail — Postfix Mail Server Setup Script
# Tested on: Ubuntu 22.04 LTS (DigitalOcean Droplet)
# Run as root: sudo bash setup-postfix.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

DOMAIN="dezignwise.online"
API_ENDPOINT="https://dezignmail.pages.dev/api/receive"  # Your Cloudflare Pages URL
HOSTNAME="mail.${DOMAIN}"
VPS_IP=$(curl -s https://api.ipify.org)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Dezignmail Mail Server Setup"
echo "  Domain: ${DOMAIN}"
echo "  VPS IP: ${VPS_IP}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Update & Install Dependencies ──────────────────────────────────────────
echo "[1/8] Installing packages..."
apt-get update -qq
apt-get install -y -qq \
  postfix \
  postfix-pcre \
  opendkim \
  opendkim-tools \
  curl \
  python3 \
  python3-pip \
  jq \
  certbot \
  openssl

# ── 2. Set hostname ───────────────────────────────────────────────────────────
echo "[2/8] Setting hostname..."
hostnamectl set-hostname ${HOSTNAME}
echo "127.0.0.1 ${HOSTNAME} ${DOMAIN}" >> /etc/hosts

# ── 3. Configure Postfix ──────────────────────────────────────────────────────
echo "[3/8] Configuring Postfix..."
cat > /etc/postfix/main.cf << EOF
# Dezignmail Postfix Configuration
myhostname = ${HOSTNAME}
mydomain = ${DOMAIN}
myorigin = \$mydomain
inet_interfaces = all
inet_protocols = ipv4
mydestination = \$myhostname, localhost.\$mydomain, localhost
mynetworks = 127.0.0.0/8
relayhost =

# Domain configuration
virtual_alias_domains = ${DOMAIN}
virtual_alias_maps = pcre:/etc/postfix/virtual_catchall

# Catch-all: pipe all mail to our forwarder script
virtual_transport = pipe

# Pipe transport
pipe_destination_concurrency_limit = 2
pipe_destination_recipient_limit = 1

# TLS (optional but recommended)
smtpd_tls_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem
smtpd_tls_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
smtpd_use_tls=yes
smtpd_tls_session_cache_database = btree:\${data_directory}/smtpd_scache
smtp_tls_session_cache_database = btree:\${data_directory}/smtp_scache

# Size limits
message_size_limit = 10485760
mailbox_size_limit = 0

# OpenDKIM milter
milter_default_action = accept
milter_protocol = 6
smtpd_milters = inet:localhost:8891
non_smtpd_milters = inet:localhost:8891

# Logging
maillog_file = /var/log/postfix/mail.log
EOF

# ── 4. Catch-All Virtual Map ───────────────────────────────────────────────────
echo "[4/8] Setting up catch-all..."
cat > /etc/postfix/virtual_catchall << 'EOF'
# Catch-all: forward all @dezignwise.online to the mail pipe
/.+@dezignwise\.online$/    dezignmail_pipe
EOF

postmap /etc/postfix/virtual_catchall

# ── 5. Mail Pipe Script (Python) ───────────────────────────────────────────────
echo "[5/8] Creating mail pipe script..."
cat > /usr/local/bin/dezignmail-pipe.py << 'PYEOF'
#!/usr/bin/env python3
"""
Dezignmail Mail Pipe
Reads incoming email from stdin (Postfix pipe transport) and POSTs it to the API.
"""

import sys
import email
import email.policy
import json
import urllib.request
import urllib.error
import os
import re

API_ENDPOINT = os.environ.get('DEZIGNMAIL_API', 'REPLACE_WITH_API_URL')
TO_ADDRESS   = os.environ.get('RECIPIENT', '')

def extract_body(msg):
    """Extract plain text and HTML body parts."""
    text_body = ''
    html_body = ''

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/plain' and not text_body:
                try:
                    text_body = part.get_payload(decode=True).decode('utf-8', errors='replace')
                except Exception:
                    pass
            elif ct == 'text/html' and not html_body:
                try:
                    html_body = part.get_payload(decode=True).decode('utf-8', errors='replace')
                except Exception:
                    pass
    else:
        ct = msg.get_content_type()
        payload = msg.get_payload(decode=True)
        if payload:
            decoded = payload.decode('utf-8', errors='replace')
            if ct == 'text/html':
                html_body = decoded
            else:
                text_body = decoded

    return text_body, html_body


def parse_address(addr_str):
    """Parse 'Name <email>' or 'email' format."""
    if not addr_str:
        return '', ''
    match = re.match(r'^"?(.+?)"?\s*<(.+?)>\s*$', addr_str.strip())
    if match:
        return match.group(1).strip('"'), match.group(2)
    return '', addr_str.strip()


def main():
    raw = sys.stdin.buffer.read()
    if not raw:
        sys.exit(0)

    msg = email.message_from_bytes(raw, policy=email.policy.default)

    from_raw   = msg.get('From', '')
    from_name, from_addr = parse_address(from_raw)
    subject    = msg.get('Subject', '(no subject)')
    to_addr    = TO_ADDRESS or msg.get('To', '').split(',')[0].strip()
    text_body, html_body = extract_body(msg)

    payload = {
        'to':         to_addr.lower(),
        'from':       from_addr,
        'from_name':  from_name,
        'subject':    subject,
        'body_text':  text_body[:50000],   # limit to 50KB
        'body_html':  html_body[:100000],  # limit to 100KB
        'size':       len(raw)
    }

    try:
        req = urllib.request.Request(
            API_ENDPOINT,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except urllib.error.URLError as e:
        # Log but don't bounce — Postfix will see exit 0 as success
        with open('/var/log/dezignmail-pipe.log', 'a') as f:
            f.write(f'ERROR delivering {to_addr}: {e}\n')
        sys.exit(0)  # exit 0 to avoid bounce storms

    sys.exit(0)


if __name__ == '__main__':
    main()
PYEOF

# Replace API endpoint placeholder
sed -i "s|REPLACE_WITH_API_URL|${API_ENDPOINT}|g" /usr/local/bin/dezignmail-pipe.py
chmod +x /usr/local/bin/dezignmail-pipe.py

# ── 6. Postfix Master (pipe transport) ────────────────────────────────────────
echo "[6/8] Configuring transport..."
cat >> /etc/postfix/master.cf << 'EOF'

# Dezignmail pipe transport
dezignmail_pipe unix  -       n       n       -       -       pipe
  flags=Rq user=nobody argv=/usr/local/bin/dezignmail-pipe.py
  null_sender=
EOF

# ── 7. OpenDKIM Setup ────────────────────────────────────────────────────────
echo "[7/8] Setting up DKIM..."
mkdir -p /etc/opendkim/keys/${DOMAIN}
cd /etc/opendkim/keys/${DOMAIN}
opendkim-genkey -t -s mail -d ${DOMAIN}
chown opendkim:opendkim mail.private

cat > /etc/opendkim.conf << EOF
AutoRestart         Yes
AutoRestartRate     10/1h
UMask               002
Syslog              yes
SyslogSuccess       Yes
LogWhy              Yes
Canonicalization    relaxed/simple
ExternalIgnoreList  refile:/etc/opendkim/TrustedHosts
InternalHosts       refile:/etc/opendkim/TrustedHosts
KeyTable            refile:/etc/opendkim/KeyTable
SigningTable        refile:/etc/opendkim/SigningTable
Mode                sv
PidFile             /run/opendkim/opendkim.pid
SignatureAlgorithm  rsa-sha256
UserID              opendkim:opendkim
Socket              inet:8891@localhost
EOF

echo "127.0.0.1
localhost
${HOSTNAME}
${DOMAIN}" > /etc/opendkim/TrustedHosts

echo "mail._domainkey.${DOMAIN} ${DOMAIN}:mail:/etc/opendkim/keys/${DOMAIN}/mail.private" > /etc/opendkim/KeyTable
echo "*@${DOMAIN} mail._domainkey.${DOMAIN}" > /etc/opendkim/SigningTable

# ── 8. Start Services ────────────────────────────────────────────────────────
echo "[8/8] Starting services..."
systemctl enable opendkim postfix
systemctl restart opendkim
postfix check
systemctl restart postfix

# ── Print DKIM DNS record ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Add these DNS records to dezignwise.online:"
echo ""
echo "  MX   @        10  ${HOSTNAME}"
echo "  A    mail     ${VPS_IP}"
echo "  TXT  @        v=spf1 mx ip4:${VPS_IP} -all"
echo "  TXT  _dmarc   v=DMARC1; p=none; rua=mailto:dmarc@${DOMAIN}"
echo ""
echo "  DKIM (TXT record for mail._domainkey.${DOMAIN}):"
cat /etc/opendkim/keys/${DOMAIN}/mail.txt
echo ""
echo "Test with: echo 'test' | mail -s 'Test Email' test@${DOMAIN}"
