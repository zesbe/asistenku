---
name: indonesian-web-stack
description: Best practices for Indonesian web apps (payment gateways, KTP OCR, bahasa locale, regional CDN)
auto_trigger:
  - midtrans
  - xendit
  - doku
  - tripay
  - nicepay
  - duitku
  - ipaymu
  - iplay
  - payment gateway indonesia
  - ktp ocr
  - nik validation
  - indonesia bank
  - virtual account
  - qris
---

# Indonesian Web Stack Skill

## When to Use
When user builds apps for Indonesian market.

## Payment Gateways (choose one)

### Midtrans (most popular)
```javascript
// Server-side
const midtransClient = require('midtrans-client')
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
})
const params = {
  transaction_details: { order_id: 'order-123', gross_amount: 100000 },
  customer_details: { email: 'user@email.com', first_name: 'Budi' },
}
const transaction = await snap.createTransaction(params)
// Return transaction.token to frontend
```

### Xendit (developer-friendly)
```javascript
const { Xendit } = require('xendit-node')
const x = new Xendit({ secretKey: process.env.XENDIT_SECRET_KEY })
const invoice = await x.Invoice.createInvoice({
  external_id: 'invoice-123',
  amount: 100000,
  payer_email: 'user@email.com',
  description: 'Payment for xyz',
})
```

### QRIS (universal QR code)
```javascript
// Midtrans QRIS
// Xendit QR Code
// Generate QRIS static + dynamic
```

## KTP (ID Card) Validation

### NIK Structure (16 digits)
```
┌──┬──┬──┬──┬──┬──┬──┬──┬──┐
│PP│KK│KC│DD│MM│YY│SR│SR│SR│
└──┴──┴──┴──┴──┴──┴──┴──┴──┘
PP: Province (32=Jabar, 31=DKI, etc)
KK: Kabupaten/Kota
KC: Kecamatan
DD+40: If female (e.g., 15 Aug → DD=55)
MM: Birth month
YY: Last 2 digits birth year
SR: Sequence number
```

### Validate NIK
```javascript
function validateNIK(nik) {
  if (nik.length !== 16) return { valid: false, reason: 'Must be 16 digits' }
  if (!/^\d{16}$/.test(nik)) return { valid: false, reason: 'Numeric only' }

  const province = nik.substring(0, 2)
  const day = parseInt(nik.substring(6, 8))
  const month = parseInt(nik.substring(8, 10))
  const year = parseInt(nik.substring(10, 12))

  const gender = day > 40 ? 'F' : 'M'
  const realDay = day > 40 ? day - 40 : day

  // Validate ranges
  if (realDay < 1 || realDay > 31) return { valid: false }
  if (month < 1 || month > 12) return { valid: false }

  return {
    valid: true,
    province,
    birthDate: `${2000 + year}-${String(month).padStart(2, '0')}-${String(realDay).padStart(2, '0')}`,
    gender,
  }
}
```

## Indonesian Locale

### Number Formatting
```javascript
// Rp. 1.000.000
new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(1000000)
// Date: 9 Mei 2026
new Intl.DateTimeFormat('id-ID', { dateStyle: 'long' }).format(new Date())
```

### Phone Number
```javascript
// Normalize: +62, 0, 62, 628 → +628...
function normalizePhone(phone) {
  let p = phone.replace(/\D/g, '')
  if (p.startsWith('0')) p = '62' + p.substring(1)
  if (!p.startsWith('62')) p = '62' + p
  return '+' + p
}
```

## CDN/Hosting (Indonesia-optimized)

- **Cloudflare**: Jakarta PoP, free tier great
- **Bunny CDN**: cheap, Jakarta available
- **Biznet Gio**: local Indonesian CDN
- **DigitalOcean Singapore**: lowest latency ID
- **Oracle Cloud Jakarta (free tier ARM)**: generous

## Database Hosting ID-friendly

- Supabase (Singapore) — free tier
- PlanetScale (Singapore)
- Neon (Singapore)
- Railway (Singapore)
- Self-host di Biznet Indonesia

## Bank Transfer Verification

For manual bank transfers, use:
- Automated via Xendit/Flip
- Manual: matching rupiah-unique amounts (Rp. 100.001, 100.002) for disambiguation
- OCR bukti transfer via Google Vision / Azure OCR
