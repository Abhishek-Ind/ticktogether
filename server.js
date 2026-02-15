const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const members = new Map();
const timers = [];
const MEMBER_TTL_MS = 45_000;

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const cleanupMembers = () => {
  const now = Date.now();
  for (const [clientId, member] of members.entries()) {
    if (now - member.lastSeenAt > MEMBER_TTL_MS) {
      members.delete(clientId);
    }
  }
};

const updatePresence = (clientId, name) => {
  const cleanId = String(clientId || '').trim().slice(0, 80);
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanId) return null;

  members.set(cleanId, {
    id: cleanId,
    name: cleanName || `Member-${cleanId.slice(0, 4)}`,
    lastSeenAt: Date.now()
  });

  return members.get(cleanId);
};

const handleApi = async (req, res, url) => {
  if (req.method === 'POST' && url.pathname === '/api/presence') {
    const body = await readBody(req);
    const member = updatePresence(body.clientId, body.name);
    if (!member) return sendJson(res, 400, { error: 'Missing clientId.' });
    cleanupMembers();
    return sendJson(res, 200, { member, members: Array.from(members.values()) });
  }

  if (req.method === 'GET' && url.pathname === '/api/members') {
    cleanupMembers();
    return sendJson(res, 200, { members: Array.from(members.values()) });
  }

  if (req.method === 'POST' && url.pathname === '/api/timers') {
    const body = await readBody(req);
    const member = updatePresence(body.clientId, body.name);
    if (!member) return sendJson(res, 400, { error: 'Missing clientId.' });

    const seconds = Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) {
      return sendJson(res, 400, { error: 'Timer duration must be between 1 second and 24 hours.' });
    }

    const instruction = String(body.instruction || '').trim().slice(0, 200) || 'No instruction provided.';
    const knownMembers = Array.from(members.keys());
    const requestedTargets = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    const targetMemberIds = requestedTargets.filter((id) => members.has(id));
    const finalTargets = targetMemberIds.length > 0 ? targetMemberIds : knownMembers;

    const timer = {
      id: `${member.id}-${Date.now()}`,
      startedBy: member.name,
      startedById: member.id,
      startAt: Date.now(),
      seconds,
      instruction,
      targetMemberIds: finalTargets,
      targetMemberNames: finalTargets.map((id) => members.get(id)?.name).filter(Boolean)
    };

    timers.push(timer);
    return sendJson(res, 201, { timer });
  }

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const clientId = String(url.searchParams.get('clientId') || '').trim();
    const since = Number(url.searchParams.get('since') || 0);
    const visibleTimers = timers.filter(
      (timer) => timer.startAt > since && timer.targetMemberIds.includes(clientId)
    );
    return sendJson(res, 200, { timers: visibleTimers, now: Date.now() });
  }

  sendJson(res, 404, { error: 'Not found' });
};

const contentTypeFor = (filePath) => {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const safePath = path.normalize(requestedPath).replace(/^\.\.(\/|\\|$)/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
      res.end(data);
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`TickTogether running on http://localhost:${PORT}`);
});
