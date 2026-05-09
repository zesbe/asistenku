---
name: debug-network
description: Systematic network debugging — DNS, connectivity, TLS, routing, port checks
auto_trigger:
  - network issue
  - connectivity problem
  - cannot connect
  - connection refused
  - dns error
  - timeout
  - tidak bisa connect
  - jaringan lemot
  - internet lambat
allowed_tools:
  - bash
  - read_file
  - grep
---

# Network Debugging Skill

## When to Use
When the user reports network issues, connectivity problems, slowness, or timeouts.

## Debugging Checklist (run in order)

### 1. Basic Reachability
```bash
# Test local network
ping -c 3 -W 2 192.168.1.1
# Test internet DNS
ping -c 3 -W 2 1.1.1.1
# Test DNS resolution
dig +short google.com
nslookup google.com
```

### 2. DNS Deep Dive
```bash
# Check resolvers
cat /etc/resolv.conf
# Try alternate DNS
dig @8.8.8.8 google.com
dig @1.1.1.1 google.com
# Check DNS-over-HTTPS
curl -s 'https://cloudflare-dns.com/dns-query?name=google.com&type=A' \
  -H 'accept: application/dns-json'
```

### 3. Routing
```bash
# Current routes
ip route
# Traceroute
traceroute -n -w 2 google.com
mtr --report --report-cycles 10 google.com
```

### 4. TLS / HTTPS
```bash
# Test TLS handshake
openssl s_client -connect google.com:443 -servername google.com < /dev/null
# Check cert validity
echo | openssl s_client -connect example.com:443 2>/dev/null | openssl x509 -noout -dates
```

### 5. Port Connectivity
```bash
# TCP test
nc -zvw 3 host port
# Test common ports
for p in 80 443 22; do nc -zvw 2 host $p; done
```

### 6. MTU / Fragmentation
```bash
# Find max packet size
ping -c 3 -M do -s 1472 google.com
# Try progressively smaller if fails
```

### 7. Latency Profile
```bash
# 10-packet sample
ping -c 10 -i 0.2 target
# Report min/avg/max + jitter
```

## Root Cause Categories

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| DNS fail, IP works | DNS server down | Switch resolver to 1.1.1.1 |
| IP fail, DNS works | Routing/firewall | Check iptables, ISP |
| Slow + loss >1% | Congestion/route | Switch WAN/ISP, contact ISP |
| TLS fail only | Cert/cipher issue | Check date, openssl |
| Port-specific fail | Firewall | Check rules, open port |

## Report Format

After diagnosis, produce:

```
# Network Diagnosis Report

## Summary
One-line root cause.

## Evidence
- Finding 1 (cmd + output)
- Finding 2
- Finding 3

## Fix
- Step 1
- Step 2

## Verification
Commands to confirm fix worked.
```
