import { query } from '../db/pool.js';
import { hashPassword, verifyPassword, signToken } from '../services/auth.service.js';

const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const passwordOk = (p) => typeof p === 'string' && p.length >= 8;
const nameOk = (n) => typeof n === 'string' && n.trim().length >= 2 && n.trim().length <= 100;

/** POST /api/auth/signup { email, password, name } */
export async function signup(req, res) {
  const { email, password, name } = req.body || {};
  if (!emailOk(email)) {
    return res.status(400).json({ success: false, error: 'A valid email address is required.', code: 'BAD_EMAIL' });
  }
  if (!passwordOk(password)) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.', code: 'WEAK_PASSWORD' });
  }
  if (!nameOk(name)) {
    return res.status(400).json({ success: false, error: 'Name must be between 2 and 100 characters.', code: 'BAD_NAME' });
  }

  const existing = await query('select id from app_users where email = $1', [email.toLowerCase()]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ success: false, error: 'An account with this email already exists.', code: 'EMAIL_TAKEN' });
  }

  const hash = await hashPassword(password);
  const { rows } = await query(
    'insert into app_users (email, password_hash, name) values ($1, $2, $3) returning id, email, name',
    [email.toLowerCase(), hash, name || null]
  );
  const user = rows[0];
  res.json({ success: true, token: signToken(user), user: { id: user.id, email: user.email, name: user.name } });
}

/** POST /api/auth/login { email, password } */
export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!emailOk(email) || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required.', code: 'MISSING_CREDENTIALS' });
  }

  const { rows } = await query('select id, email, name, password_hash from app_users where email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ success: false, error: 'Invalid email or password.', code: 'BAD_CREDENTIALS' });
  }
  res.json({ success: true, token: signToken(user), user: { id: user.id, email: user.email, name: user.name } });
}

/** GET /api/auth/me (requireAuth) */
export async function me(req, res) {
  const { rows } = await query('select id, email, name, created_at from app_users where id = $1', [req.user.id]);
  if (rows.length === 0) {
    return res.status(404).json({ success: false, error: 'User not found.', code: 'USER_NOT_FOUND' });
  }
  res.json({ success: true, user: rows[0] });
}
