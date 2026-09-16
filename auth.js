/**
 * MeasureCraft — Backend authentication helpers
 *
 * Optional: requires `bcryptjs` and `jsonwebtoken`.
 * If packages are missing, falls back to the existing demo login behaviour.
 *
 * Env:
 *   JWT_SECRET          — required for signed tokens (default: weak demo secret)
 *   JWT_EXPIRES_IN      — e.g. "7d" (default 7d)
 *   ADMIN_EMAIL         — optional bootstrap admin
 *   ADMIN_PASSWORD_HASH — bcrypt hash of admin password
 *
 * Usage in server.js:
 *   const auth = require('./auth');
 *   app.post('/api/login', auth.loginHandler);
 *   app.get('/api/me', auth.requireAuth, (req, res) => res.json({ user: req.user }));
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let bcrypt = null;
let jwt = null;
try {
  bcrypt = require('bcryptjs');
} catch (_) {
  console.warn('[auth] bcryptjs not installed — run: npm install bcryptjs');
}
try {
  jwt = require('jsonwebtoken');
} catch (_) {
  console.warn('[auth] jsonwebtoken not installed — run: npm install jsonwebtoken');
}

const JWT_SECRET = process.env.JWT_SECRET || '';
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters in production.');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'measurecraft-dev-secret-change-me';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';
const USERS_FILE = path.join(
  process.env.RESEARCH_DATA_DIR || path.join(__dirname, 'data'),
  'users.json'
);

const DEMO_USERS = [
  {
    id: 'demo',
    email: 'demo@measurecraft.com',
    // password: demo1234  (only used when bcrypt is available for verification against hash)
    passwordHash: null,
    role: 'qs',
    name: 'Demo User',
  },
];

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (Array.isArray(raw)) return raw;
    }
  } catch (err) {
    console.warn('[auth] could not load users.json', err.message);
  }
  return DEMO_USERS.slice();
}

function saveUsers(users) {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.warn('[auth] could not save users.json', err.message);
  }
}

function hashPassword(plain) {
  if (!bcrypt) {
    // Weak fallback for local demo only
    return 'plain:' + crypto.createHash('sha256').update(String(plain)).digest('hex');
  }
  return bcrypt.hashSync(String(plain), 10);
}

function verifyPassword(plain, hash) {
  if (!hash) return false;
  if (hash.startsWith('plain:')) {
    const h = 'plain:' + crypto.createHash('sha256').update(String(plain)).digest('hex');
    return h === hash;
  }
  if (!bcrypt) {
    // Legacy demo: accept known demo password when no bcrypt
    return plain === 'demo1234' && hash === null;
  }
  return bcrypt.compareSync(String(plain), hash);
}

function signToken(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role || 'qs',
    name: user.name || user.email,
  };
  if (!jwt) {
    // Base64 fallback (not secure — for offline demo only)
    return Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 864e5 })).toString(
      'base64url'
    );
  }
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  if (!token) return null;
  if (!jwt) {
    try {
      const obj = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      if (obj.exp && Date.now() > obj.exp) return null;
      return obj;
    } catch {
      return null;
    }
  }
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET);
  } catch {
    return null;
  }
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.headers['x-mc-token']) return String(req.headers['x-mc-token']).trim();
  if (req.cookies && req.cookies.mc_token) return req.cookies.mc_token;
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  req.user = payload;
  next();
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient role', code: 'FORBIDDEN' });
    }
    next();
  };
}

async function loginHandler(req, res) {
  try {
    const email = String((req.body && req.body.email) || '')
      .trim()
      .toLowerCase();
    const password = String((req.body && req.body.password) || '');
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const users = loadUsers();
    let user = users.find((u) => String(u.email).toLowerCase() === email);

    // Bootstrap demo user on first run
    if (!user && email === 'demo@measurecraft.com' && password === 'demo1234') {
      user = {
        id: 'demo',
        email: 'demo@measurecraft.com',
        passwordHash: hashPassword('demo1234'),
        role: 'qs',
        name: 'Demo User',
      };
      users.push(user);
      saveUsers(users);
    }

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'BAD_CREDENTIALS' });
    }

    // Allow demo password even if hash is null (legacy)
    const ok =
      verifyPassword(password, user.passwordHash) ||
      (email === 'demo@measurecraft.com' && password === 'demo1234');

    if (!ok) {
      return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'BAD_CREDENTIALS' });
    }

    // Upgrade plain demo to hashed if bcrypt is available
    if (bcrypt && (!user.passwordHash || user.passwordHash.startsWith('plain:'))) {
      user.passwordHash = hashPassword(password);
      saveUsers(users);
    }

    const token = signToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || 'qs',
        name: user.name || user.email,
      },
      expiresIn: JWT_EXPIRES,
    });
  } catch (err) {
    console.error('[auth] login', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

function registerHandler(req, res) {
  try {
    const email = String((req.body && req.body.email) || '')
      .trim()
      .toLowerCase();
    const password = String((req.body && req.body.password) || '');
    const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
    const role = String((req.body && req.body.role) || 'qs').toLowerCase();
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ success: false, error: 'Valid email and password (min 6) required' });
    }
    const allowedRoles = ['qs', 'senior_qs', 'reviewer', 'client', 'admin'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    const users = loadUsers();
    if (users.some((u) => String(u.email).toLowerCase() === email)) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }
    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      email,
      passwordHash: hashPassword(password),
      role,
      name: name || email.split('@')[0],
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    saveUsers(users);
    const token = signToken(user);
    res.status(201).json({
      success: true,
      token,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('[auth] register', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  loginHandler,
  registerHandler,
  requireAuth,
  requireRole,
  signToken,
  verifyToken,
  extractToken,
  hashPassword,
  loadUsers,
  saveUsers,
};
