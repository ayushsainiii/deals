import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { decodeHTML } from 'entities';
import { db, indiaDay, paise, transaction, validDay } from './db.js';
import { refreshListing, saveCatalog } from './catalog.js';
import { fetchPage, listingKey, publicUrl } from './marketplaces.js';
import { setTimeout as delay } from 'node:timers/promises';

export async function refresh(limit = 25) {
  const day = indiaDay();
  const rows = db.prepare(`SELECT store,id,url FROM listings l WHERE NOT EXISTS
    (SELECT 1 FROM history h WHERE h.store=l.store AND h.id=l.id AND h.day=?)
    AND NOT EXISTS (SELECT 1 FROM sale_prices s WHERE s.store=l.store AND s.id=l.id AND s.end_day>=?)
    ORDER BY EXISTS(SELECT 1 FROM sale_prices s WHERE s.store=l.store AND s.id=l.id) DESC,checked,store,id LIMIT ?`).all(day,day,limit);
  let saved = 0;
  for (const [index,row] of rows.entries()) {
    if (index) await delay(1000);
    try {
      await refreshListing(row.store,row.id.split(':')[0],row.url);
      saved++;
    } catch (error) {
      console.error(row.store,row.id,error.message);
    }
  }
  console.log(day+': checked '+rows.length+', saved '+saved+', unavailable '+(rows.length-saved)+'.');
  return rows.length-saved;
}

export function scheduleRefresh() {
  const schedule = () => {
    const now = Date.now();
    let next = Date.parse(indiaDay(now)+'T09:00:00+05:30');
    if (next <= now) next += 86400000;
    setTimeout(async () => {
      try { await refresh(); } catch (error) { console.error('Daily refresh failed:',error.message); }
      schedule();
    },next-now).unref();
  };
  schedule();
}

async function seed(section, quota, pageLimit) {
  const root = 'https://www.amazon.in/gp/bestsellers/'+section;
  const queue = [[root,1]];
  const visited = new Set(), saved = new Set();
  for (let i=0;i<pageLimit && queue.length && saved.size<quota;i++) {
    const [category,page] = queue.shift();
    const key = category+'?pg='+page;
    if (visited.has(key)) continue;
    visited.add(key);
    if (visited.size>1) await delay(2000);
    let html;
    try { html = await fetchPage(key,7000); }
    catch (error) {
      console.error(error.message);
      if (/\b(?:403|429)\b/.test(error.message)) break;
      continue;
    }
    const cards = html.split(/class="zg-bdg-text[^"]*"[^>]*>\s*#(\d+)\s*</);
    const batch = [];
    for (let j=1;j+1<cards.length && saved.size<quota;j+=2) {
      const rank = Number(cards[j]), card = cards[j+1];
      const id = card.match(/\/dp\/([A-Z0-9]{10})[/?"]/i)?.[1]?.toUpperCase();
      const image = card.match(/<img\b[^>]*\balt="([^"]+)"[^>]*\bsrc="(https:\/\/[^"]+)"/);
      if (!id || !image || saved.has(id) || rank>100) continue;
      saved.add(id);
      batch.push({store:'Amazon',listingId:id,url:publicUrl('Amazon',id),title:decodeHTML(image[1]),image:decodeHTML(image[2]),rank});
    }
    saveCatalog(batch,category,'Amazon India Best Sellers');
    if (cards.length>1) {
      for (const match of html.matchAll(new RegExp('href="(/gp/bestsellers/'+section+'/\\d+)(?:/|")','g'))) {
        const child = 'https://www.amazon.in'+match[1];
        if (!visited.has(child+'?pg=1') && !queue.some(row=>row[0]===child && row[1]===1)) queue.push([child,1]);
      }
      if (page===1) queue.unshift([category,2]);
    }
  }
  console.log(section+': '+saved.size+' unique ranked listings found.');
}

async function importHistory(path, source, check) {
  if (!path || !source || source.length>80) throw new Error('Supply a CSV path and --source with 1–80 characters.');
  const rows = parse(await readFile(path),{bom:true,columns:true,skip_empty_lines:true,info:true});
  const entries = new Map();
  for (const {record,info} of rows) {
    try {
      if (!['product_url','date','price_inr'].every(key=>Object.hasOwn(record,key))) throw new Error('Expected product_url,date,price_inr columns.');
      const url = new URL(record.product_url.trim());
      if (url.protocol!=='https:' || url.username || url.password || url.port) throw new Error('Use a full HTTPS product URL.');
      const amazon = ['amazon.in','www.amazon.in'].includes(url.hostname);
      const store = amazon?'Amazon':'Flipkart';
      const id = (amazon?url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i):
        url.pathname.match(/^\/[^/]+\/p\/(itm[a-z0-9]+)\/?$/i))?.[1].toUpperCase();
      if (!id) throw new Error('Could not identify the listing.');
      const key = listingKey(id,publicUrl(store,id,url.href));
      const day = record.date;
      const price = paise(record.price_inr.trim(),'INR');
      if (!validDay(day) || day>indiaDay() || price===null) throw new Error('Use a non-future YYYY-MM-DD date and positive INR price.');
      const index = JSON.stringify([store,key,day]);
      if (entries.has(index) && entries.get(index)[3]!==price) throw new Error('Conflicting prices for this listing and day.');
      entries.set(index,[store,key,day,price,source]);
    } catch (error) { throw new Error('CSV line '+info.lines+': '+error.message); }
  }
  if (!entries.size) throw new Error('CSV contains no price observations.');
  if (!check) transaction(() => {
    const insert = db.prepare('INSERT INTO imported_history VALUES (?,?,?,?,?) ON CONFLICT(store,id,day) DO UPDATE SET price=excluded.price,source=excluded.source');
    for (const row of entries.values()) insert.run(...row);
  });
  console.log((check?'Validated ':'Imported ')+entries.size+' price observations.');
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [action,...args] = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name)+1] : undefined;
  try {
    if (action==='refresh') {
      const limit = Number(option('--limit') ?? 25);
      if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('--limit must be between 1 and 100.');
      process.exitCode = Number(await refresh(limit)>0);
    } else if (action==='seed') {
      const pages = Number(option('--pages') ?? 8);
      if (!Number.isInteger(pages) || pages<1) throw new Error('--pages must be a positive integer.');
      await seed('electronics',4500,pages);
      await seed('apparel',500,pages);
    } else if (action==='import-history') {
      await importHistory(args[0],option('--source')?.trim(),args.includes('--check'));
    } else throw new Error('Use refresh, seed, or import-history.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
