import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const databasePath = process.env.GIVEX_DB_PATH || fileURLToPath(new URL('../../data/givex-prices.sqlite3', import.meta.url));
if (!process.env.GIVEX_DB_PATH) mkdirSync(new URL('../../data/', import.meta.url), {recursive:true});
export const db = new DatabaseSync(databasePath);
db.exec(`PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS listings (store TEXT,id TEXT,url TEXT,title TEXT,brand TEXT,gtin TEXT,price INTEGER,stock INTEGER,checked TEXT,PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS search_prices (store TEXT,id TEXT,price INTEGER NOT NULL,checked TEXT NOT NULL,PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS history (store TEXT,id TEXT,day TEXT,price INTEGER,PRIMARY KEY(store,id,day));
CREATE TABLE IF NOT EXISTS listing_images (store TEXT,id TEXT,url TEXT,PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS imported_history (store TEXT,id TEXT,day TEXT,price INTEGER,source TEXT NOT NULL,PRIMARY KEY(store,id,day));
CREATE TABLE IF NOT EXISTS catalog_ranks (store TEXT,id TEXT,category TEXT,rank INTEGER,source TEXT,PRIMARY KEY(store,id,category));
CREATE TABLE IF NOT EXISTS sale_prices (store TEXT,id TEXT,end_day TEXT NOT NULL,PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS listing_details (store TEXT,id TEXT,payload TEXT NOT NULL,PRIMARY KEY(store,id));
CREATE TABLE IF NOT EXISTS alert_users (id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt BLOB NOT NULL,password BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS alert_sessions (token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS price_alerts (id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,store TEXT NOT NULL,listing TEXT NOT NULL,target INTEGER NOT NULL,hit_price INTEGER,hit_day TEXT,UNIQUE(user_id,store,listing));
CREATE TRIGGER IF NOT EXISTS notify_price_alert AFTER INSERT ON history BEGIN
 UPDATE price_alerts SET hit_price=NEW.price,hit_day=NEW.day
 WHERE store=NEW.store AND listing=NEW.id AND hit_day IS NULL AND NEW.price<=target
 AND EXISTS(SELECT 1 FROM listings WHERE store=NEW.store AND id=NEW.id AND stock=1);
END;`);

export function transaction(action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const indiaDay = (date = Date.now()) => new Date(Number(date) + 330 * 60000).toISOString().slice(0, 10);
export function paise(amount, currency) {
  if (amount == null || currency !== 'INR') return null;
  const value = Number(String(amount).replaceAll(',', '')) * 100;
  const rounded = Math.round(value);
  return Number.isFinite(value) && rounded > 0 && rounded <= 1e12 && Math.abs(value - rounded) < 0.00001 ? rounded : null;
}
export const validDay = day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
