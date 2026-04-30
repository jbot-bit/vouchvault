---
source: https://core.telegram.org/bots/webhooks
captured: 2026-04-29
status: verbatim — refresh by re-fetching wholesale, do not selectively edit
note: WebFetch markdown conversion. "Marvin's Marvellous Guide to All Things Webhook" — TLS, ports, IP ranges, setWebhook.
---

# Marvin's Marvellous Guide to All Things Webhook

## Overview

Telegram supports two mechanisms for processing bot updates: **getUpdates** (pull) and **setWebhook** (push). The webhook approach offers advantages by delivering updates immediately to your bot rather than requiring frequent polling.

## Key Requirements

### The Short Version

Your server must:

- Support IPv4 (IPv6 not currently supported)
- Accept incoming POSTs from subnets `149.154.160.0/20` and `91.108.4.0/22` on ports 443, 80, 88, or 8443
- Handle TLS1.2+ HTTPS traffic
- Provide a supported, verified, or self-signed certificate
- Match certificate CN or SAN to the supplied domain
- Supply complete intermediate certificates for verification chains

## Detailed Requirements

### Domain Name

You need a publicly reachable server with a domain name. VPS/web hosting providers can supply this. For self-signed certificates, an IP address as CN is acceptable instead.

### Open Port

Supported ports are: **443, 80, 88**, and **8443**. Other ports will not function. Your bot must listen on one of these and be reachable via public address.

To restrict access to Telegram only, allow traffic from the specified IP ranges.

### SSL/TLS Encryption

Webhooks require SSL/TLS encryption regardless of port. Plain HTTP is not supported. The connection works differently than getUpdates—Telegram connects to your server, so you handle server-side encryption.

### TLS Version

Minimum requirement is **TLS1.2**. Older versions (SSLv2/3, TLS1.0, TLS1.1) are not supported due to security vulnerabilities.

### Certificate Requirements

The certificate's Common Name (CN) or Subject Alternative Name (SAN) must exactly match your webhook domain. For self-signed certificates, an IP address can serve as CN.

Server Name Indication (SNI)-routing is supported.

### Verified vs. Self-Signed Certificates

**Verified Certificates**: Issued by trusted Certificate Authorities. Check Ubuntu's trusted certificate list to confirm root CA support.

**Self-Signed Certificates**: You act as the CA. The public certificate must be uploaded as multipart/form data in PEM-encoded (ASCII BASE64) format when setting the webhook.

### Certificate Chain

Many verified certificates require intermediate certificates. The provider should supply these. Incomplete chains will cause webhook failures despite successful browser access.

For Apache, add intermediates to the file configured in `SSLCertificateFile`. For Nginx, add to `ssl_certificate_key`. Use: `cat your_domain_name.pem intermediate.pem >> bundle.pem`

## Certificate Acquisition

### Verified Supported Certificates

Generate a Certificate Signing Request (CSR) using OpenSSL or Java keytool. Submit to a trusted CA like Let's Encrypt or StartSSL (verifying root CA support beforehand).

Example OpenSSL command:
```
openssl req -newkey rsa:2048 -keyout yourprivatekey.key -out yoursigningrequest.csr
```

The CN must match your webhook domain exactly.

### Self-Signed Certificates

Generate using OpenSSL:
```
openssl req -newkey rsa:2048 -sha256 -nodes -keyout YOURPRIVATE.key -x509 -days 365 -out YOURPUBLIC.pem -subj "/C=US/ST=New York/L=Brooklyn/O=Example Brooklyn Company/CN=YOURDOMAIN.EXAMPLE"
```

Or Java keytool (with conversion to PEM format required).

## Setting the Webhook

Use the `setWebhook` method via the Telegram Bot API.

**For verified certificates with trusted roots:**
```
curl -F "url=https://<YOURDOMAIN.EXAMPLE>/<WEBHOOKLOCATION>" https://api.telegram.org/bot<YOURTOKEN>/setWebhook
```

**For self-signed certificates:**
```
curl -F "url=https://<YOURDOMAIN.EXAMPLE>/<WEBHOOKLOCATION>" -F "certificate=@<YOURCERTIFICATE>.pem" https://api.telegram.org/bot<YOURTOKEN>/setWebhook
```

Use `-F` for multipart/form-data. The certificate parameter is an inputFile type.

For non-standard ports (80, 88, 8443), specify in the URL:
```
url=https://<YOURDOMAIN.EXAMPLE>:88/<WEBHOOKLOCATION>
```

### Untrusted Root Certificates

If your root CA isn't on Telegram's trusted list, supply the root certificate as inputFile in the certificate parameter, similar to self-signed setup:
```
curl -F "url=https://<YOURDOMAIN.EXAMPLE>" -F "certificate=@<YOURCAROOTCERTIFICATE>.pem" https://api.telegram.org/bot<YOURTOKEN>/setWebhook
```

Convert DER format to PEM:
```
openssl x509 -inform der -in root.cer -out root.pem
```

To clear a webhook:
```
curl -F "url=" https://api.telegram.org/bot<YOURTOKEN>/setWebhook
```

## Verification and Troubleshooting

### Checking Ports and Firewall (Linux)

Verify bot is listening:
```
netstat –ln | grep portnumber
sudo lsof -i | grep process name
```

Check firewall status:
```
sudo iptables –L
sudo ufw status verbose
```

Allow incoming traffic:
```
sudo iptables –A INPUT –p tcp –m tcp –dport portnumber -j ACCEPT
sudo ufw allow portnumber/tcp
```

Restrict to Telegram IP ranges:
```
sudo iptables –A INPUT –i interfacename –p tcp –m iprange -s 149.154.160.0/20,91.108.4.0/22 –dport portnumber -j ACCEPT
```

### Verifying TLS Version

Online tools: Symantec crypto report or Qualys SSL.

**Using Chrome**: Open URL and inspect certificate details in security tab.

**Using curl**:
```
curl --tlsv1.2 -v -k https://yourbotdomain:yourbotport/
```

**Using OpenSSL**:
```
openssl s_client -tls1_2 -connect yourbotdomain:yourbotport -servername yourbotdomain
```

### Configuration Examples

**Apache**: `SSLProtocol -all +TLSv1.2`

**Nginx**: `ssl_protocols TLSv1.2;`

**Java JVM**: `-Dhttps.protocols=TLSv1.2 -Djdk.tls.client.protocols=TLSv1.2`

## Testing with Example Updates

Telegram provides example update JSON payloads for testing. Use curl with test data:

```
curl --tlsv1.2 -v -k -X POST -H "Content-Type: application/json" -H "Cache-Control: no-cache" -d '{
"update_id":10000,
"message":{
  "date":1441645532,
  "chat":{"last_name":"Test Lastname","id":1111111,"first_name":"Test","username":"Test"},
  "message_id":1365,
  "from":{"last_name":"Test Lastname","id":1111111,"first_name":"Test","username":"Test"},
  "text":"/start"
}
}' "https://YOUR.BOT.URL:YOURPORT/"
```

Example updates available for: messages with text, forwarded messages, replies, edited messages, entities, audio, voice, documents, inline queries, callback queries, and more.

## Additional Resources

The guide references @CanOfWormsBot for automated certificate chain verification assistance and recommends checking this document regularly as Telegram's IP ranges may change.
