#!/bin/bash
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

echo "Installing required packages..."
apt-get update && apt-get install -y postfix opendkim opendkim-tools mailutils curl python3

echo "Configuring Postfix main.cf..."
cat << 'MAINCF' >> /etc/postfix/main.cf
myhostname = mail.example.com
mydomain = example.com
myorigin = $mydomain
mydestination = $myhostname, localhost.$mydomain, localhost
inet_interfaces = all
inet_protocols = ipv4
virtual_alias_maps = regexp:/etc/postfix/virtual
dezignmail_destination_recipient_limit = 1
MAINCF

echo "Creating catch-all virtual map..."
echo '/@dezignwise\.online$/  dezignmail_pipe' > /etc/postfix/virtual
postmap /etc/postfix/virtual

echo "Adding pipe transport to master.cf..."
cat << 'MASTERCF' >> /etc/postfix/master.cf
dezignmail_pipe unix  -       n       n       -       -       pipe
  flags=Rq user=www-data argv=/usr/local/bin/dezignmail-pipe.sh ${recipient} ${sender} ${subject}
MASTERCF

echo "Installing dezignmail-pipe.sh..."
cp "$(dirname "$0")/dezignmail-pipe.sh" /usr/local/bin/dezignmail-pipe.sh
chmod +x /usr/local/bin/dezignmail-pipe.sh

echo "Generating DKIM keys..."
mkdir -p /etc/opendkim/keys/example.com
opendkim-genkey -b 2048 -d example.com -D /etc/opendkim/keys/example.com/ -s mail -v
chown -R opendkim:opendkim /etc/opendkim/keys/example.com

echo "Generating DNS records instructions..."
DNS_FILE="$(dirname "$0")/dns-records.txt"
echo "=== DNS Records for example.com ===" > "$DNS_FILE"
echo "" >> "$DNS_FILE"
echo "MX Record:" >> "$DNS_FILE"
echo "  example.com  MX  10  mail.example.com" >> "$DNS_FILE"
echo "" >> "$DNS_FILE"
echo "A Record:" >> "$DNS_FILE"
echo "  mail.example.com  A  <YOUR_VPS_IP>" >> "$DNS_FILE"
echo "" >> "$DNS_FILE"
echo "SPF Record (TXT):" >> "$DNS_FILE"
echo "  example.com  TXT  \"v=spf1 ip4:<YOUR_VPS_IP> -all\"" >> "$DNS_FILE"
echo "" >> "$DNS_FILE"
echo "DKIM Record (TXT) — copy from below:" >> "$DNS_FILE"
cat /etc/opendkim/keys/example.com/mail.txt >> "$DNS_FILE"
echo "" >> "$DNS_FILE"
echo "DMARC Record (TXT):" >> "$DNS_FILE"
echo "  _dmarc.example.com  TXT  \"v=DMARC1; p=none; rua=mailto:admin@example.com\"" >> "$DNS_FILE"

echo "Setup complete! Please see $DNS_FILE for DNS records you need to create."
echo "Restarting Postfix..."
systemctl restart postfix || echo "Postfix could not be restarted automatically, please start it."