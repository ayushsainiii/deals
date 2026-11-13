import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db, indiaDay, paise, transaction } from './db.js';

const digest = promisify(scrypt);
const sessionSeconds = 7*86400;
const tokenKey = token => createHash('sha256').update(token).digest('hex');
const error = (status,message) => [status,{error:message}];
const cookieFor = (token,seconds) => 'givex_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+seconds+
  (process.env.GIVEX_SECURE_COOKIE === '1' ? '; Secure' : '');

export async function account(method,path,body,cookie = '') {
  const token = cookie.match(/(?:^|;\s*)givex_session=([A-Za-z0-9_-]+)/)?.[1] || '';
  const key = tokenKey(token);
  const now = Math.floor(Date.now()/1000);
  if (method === 'POST' && ['/api/account/register','/api/account/login'].includes(path)) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(400,'Enter a valid email address.');
    if (typeof password !== 'string' || [...password].length < 10 || [...password].length > 128) return error(400,'Use a password with 10–128 characters.');
    const register = path.endsWith('/register');
    const existing = register ? null : db.prepare('SELECT id,salt,password FROM alert_users WHERE email=?').get(email);
    const salt = register ? randomBytes(16) : existing?.salt || Buffer.alloc(16);
    const hash = await digest(password,salt,64);
    if (!register && (!existing || !timingSafeEqual(hash,existing.password))) return error(401,'Email or password is incorrect.');
    return transaction(() => {
      let id = existing?.id;
      if (register) {
        const inserted = db.prepare('INSERT OR IGNORE INTO alert_users(email,salt,password) VALUES (?,?,?)').run(email,salt,hash);
        if (!inserted.changes) return error(409,'Could not create this account. Try signing in.');
        id = inserted.lastInsertRowid;
      }
      const fresh = randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM alert_sessions WHERE token=? OR expires<=?').run(key,now);
      db.prepare('INSERT INTO alert_sessions VALUES (?,?,?)').run(tokenKey(fresh),id,now+sessionSeconds);
      return [200,{email},cookieFor(fresh,sessionSeconds)];
    });
  }
  const user = db.prepare('SELECT id,email FROM alert_users JOIN alert_sessions ON id=user_id WHERE token=? AND expires>?').get(key,now);
  if (method === 'GET' && path === '/api/account') return [200,{email:user?.email ?? null}];
  if (method === 'POST' && path === '/api/account/logout') {
    db.prepare('DELETE FROM alert_sessions WHERE token=?').run(key);
    return [200,{email:null},cookieFor('',0)];
  }
  if (!user) return error(401,'Sign in to manage price alerts.');
  if (method === 'GET' && path === '/api/alerts') {
    const alerts = db.prepare('SELECT a.id,l.title,a.store,a.target,a.hit_price,a.hit_day FROM price_alerts a JOIN listings l ON l.store=a.store AND l.id=a.listing WHERE a.user_id=? ORDER BY a.id DESC').all(user.id);
    return [200,{alerts}];
  }
  if (method === 'POST' && path === '/api/alerts/remove') {
    if (!Number.isSafeInteger(body.id) || body.id<=0) return error(400,'Invalid alert ID.');
    db.prepare('DELETE FROM price_alerts WHERE id=? AND user_id=?').run(body.id,user.id);
    return [200,{}];
  }
  if (method === 'POST' && path === '/api/alerts') {
    const {store,listing} = body;
    const target = typeof body.target === 'string' && /^[0-9]{1,10}(?:\.[0-9]{1,2})?$/.test(body.target) ? paise(body.target,'INR') : null;
    if (typeof store !== 'string' || typeof listing !== 'string' || target === null) return error(400,'Choose a listing and enter a valid target price.');
    return transaction(() => {
      const offer = db.prepare('SELECT price,stock,checked FROM listings WHERE store=? AND id=?').get(store,listing);
      if (!offer) return error(404,'Check this product before setting an alert.');
      const day = indiaDay();
      const hit = offer.price !== null && offer.stock === 1 && offer.checked === day && offer.price <= target;
      db.prepare('INSERT INTO price_alerts(user_id,store,listing,target,hit_price,hit_day) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,store,listing) DO UPDATE SET target=excluded.target,hit_price=excluded.hit_price,hit_day=excluded.hit_day')
        .run(user.id,store,listing,target,hit ? offer.price : null,hit ? day : null);
      return [200,{hit}];
    });
  }
  return error(404,'Unknown account action.');
}
