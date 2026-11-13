import {statfsSync} from 'node:fs';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {load} from 'cheerio';
import {db,databasePath,transaction} from './db.js';
import {fetchPage,publicUrl} from './marketplaces.js';

const departments = ['electronics','apparel','kitchen','beauty','grocery','computers','sports','toys',
  'books','automotive','home-improvement','office-products','shoes','luggage','baby','pet-supplies',
  'health','watches','jewelry','garden','musical-instruments','videogames','industrial','appliances'];
const [target=100000,budget=240,maxMiB=256] = process.argv.slice(2).map(Number);
if (![target,budget,maxMiB].every(n => Number.isSafeInteger(n) && n > 0) || databasePath === ':memory:') {
  throw Error('Supply a positive listing target, page budget and SQLite size limit in MiB.');
}

db.exec(`CREATE TABLE IF NOT EXISTS catalog_seed_pages (
  category TEXT, page INTEGER, PRIMARY KEY(category,page)
)`);
const total = db.prepare("SELECT count(DISTINCT id) AS n FROM catalog_ranks WHERE store='Amazon' AND rank BETWEEN 1 AND 100");
const ranked = db.prepare("SELECT 1 FROM catalog_ranks WHERE store='Amazon' AND id=? AND rank BETWEEN 1 AND 100 LIMIT 1");
const known = db.prepare("SELECT 1 FROM listings WHERE store='Amazon' AND id=?");
const insert = db.prepare("INSERT INTO listings VALUES ('Amazon',?,?,?,'','',NULL,NULL,'')");
const imageInsert = db.prepare("INSERT OR IGNORE INTO listing_images VALUES ('Amazon',?,?)");
const rankInsert = db.prepare("INSERT OR IGNORE INTO catalog_ranks VALUES ('Amazon',?,?,?,'Amazon India Best Sellers')");
const visited = db.prepare('SELECT 1 FROM catalog_seed_pages WHERE category=? AND page=?');
const mark = db.prepare('INSERT OR IGNORE INTO catalog_seed_pages VALUES (?,?)');
const queue = departments.map(section => ['/gp/bestsellers/'+section,1]);
const queued = new Set(queue.map(([path,page]) => path+'?pg='+page));
const pageSize = db.prepare('PRAGMA page_size').get().page_size;
const maxPages = Math.floor(maxMiB*1048576/pageSize);
db.exec("PRAGMA max_page_count="+maxPages);
const pageCount = db.prepare('PRAGMA page_count');
const initial = total.get().n;
let count = initial, requests = 0, blocked = 0;
function enqueue(path,page) {
  const key = path+'?pg='+page;
  if (queued.has(key)) return;
  queued.add(key);
  queue.push([path,page]);
}
function hasStorage() {
  const {bavail,bsize} = statfsSync(dirname(databasePath),{bigint:true});
  return bavail*bsize > 1024n*1024n*1024n && pageCount.get().page_count < maxPages-32;
}

while (queue.length && requests < budget && count < target) {
  if (!hasStorage()) { console.log('Stopped at configured storage limit or 1 GiB free-space floor.'); break; }
  const [category,page] = queue.shift();
  const done = visited.get(category,page);
  // Revisit index pages to rediscover children on later runs, but never repeat completed second pages.
  if (done && page > 1) continue;
  if (requests) await delay(1250);
  requests++;
  let html;
  try { html = await fetchPage('https://www.amazon.in'+category+'?pg='+page,7000); }
  catch (error) {
    console.log(category, page, error.message);
    if (/HTTP (403|429)/.test(error.message) && ++blocked >= 3) break;
    continue;
  }
  const $ = load(html);
  const rows = [];
  $('.zg-bdg-text').each((_, el) => {
    const rank = Number($(el).text().trim().replace(/^#/,''));
    const card = $(el).closest('[id^="p13n-asin-index"],.zg-grid-general-faceout');
    const id = card.find('a[href*="/dp/"]').first().attr('href')?.match(/\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase();
    const img = card.find('img').first();
    const title = img.attr('alt')?.trim() || card.find('a[href*="/dp/"]').first().text().trim();
    const image = img.attr('src');
    if (rank >= 1 && rank <= 100 && id && title && /^https:\/\/(?:[a-z0-9-]+\.)*(?:media-amazon\.com|ssl-images-amazon\.com)\//i.test(image || '')) {
      rows.push({rank,id,title:title.slice(0,600),image});
    }
  });
  if (rows.length) {
    transaction(() => {
      let nextCount = total.get().n;
      for (const row of rows) {
        const alreadyRanked = ranked.get(row.id);
        if (!alreadyRanked && nextCount >= target) break;
        if (!known.get(row.id)) {
          if (nextCount >= target) break;
          insert.run(row.id,publicUrl('Amazon',row.id),row.title);
          nextCount++;
        }
        imageInsert.run(row.id,row.image);
        rankInsert.run(row.id,category,row.rank);
        if (!alreadyRanked) nextCount++;
      }
      mark.run(category,page);
    });
    count = total.get().n;
    if (page === 1) enqueue(category,2);
  }
  $('a[href^="/gp/bestsellers/"]').each((_,el) => {
    const href = $(el).attr('href');
    const match = href.match(/^\/gp\/bestsellers\/([a-z-]+)\/(\d+)(?:[/?]|$)/);
    if (match && departments.includes(match[1])) enqueue(match[0].replace(/[/?]$/,'') ,1);
  });
  if (requests%10===0) console.log('Pages',requests,'saved listings',count,'queued pages',queue.length);
}
console.log(JSON.stringify({target,initial,count,added:count-initial,requests,bytes:pageCount.get().page_count*pageSize}));
