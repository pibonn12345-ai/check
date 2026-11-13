// server.js — Express backend
// Runtime: Node >= 18 | Target: linux/amd64 (Docker)
'use strict';

const express = require('express');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image

// --- Middleware -----------------------------------------------------------

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logger
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ` +
      `${res.statusCode} ${Date.now() - t0}ms ${req.ip}`
    );
  });
  next();
});

// --- Helpers --------------------------------------------------------------

function safe_filename(id, ext) {
  // id is a UUID — already safe, but belt-and-suspenders
  return id.replace(/[^a-zA-Z0-9_-]/g, '') + '.' + ext.replace(/[^a-z]/g, '');
}

function date_folder() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// --- Routes ---------------------------------------------------------------

app.post('/api/collect', (req, res) => {
  try {
    const { image, meta } = req.body;

    if (!meta || typeof meta !== 'object') {
      return res.status(400).json({ error: 'missing meta' });
    }

    const folder = path.join(DATA_DIR, date_folder());
    const resolved = path.resolve(folder);
    if (!resolved.startsWith(DATA_DIR)) {
      return res.status(400).json({ error: 'bad path' });
    }

    fs.mkdirSync(folder, { recursive: true });
    const id = randomUUID();

    // --- Save image -------------------------------------------------------
    if (image && typeof image === 'string') {
      const m = image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
      if (m) {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_IMAGE_BYTES) {
          return res.status(413).json({ error: 'image too large' });
        }
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        fs.writeFileSync(path.join(folder, safe_filename(id, ext)), buf);
      }
    }

    // --- Build record -----------------------------------------------------
    const record = {
      id,
      server: {
        ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.ip,
        user_agent: req.headers['user-agent'],
        referer: req.headers['referer'] || req.headers['referrer'] || null,
        accept_language: req.headers['accept-language'],
        headers: req.headers,
        timestamp: new Date().toISOString(),
      },
      client: meta,
    };

    fs.writeFileSync(
      path.join(folder, safe_filename(id, 'json')),
      JSON.stringify(record, null, 2)
    );

    console.log(`[COLLECT] ${id} | ip=${record.server.ip} | tag=${meta._tag || '-'}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[ERROR]', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// SPA fallback — serve index.html for unknown GETs
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ----------------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] gate listening :${PORT}`);
});
