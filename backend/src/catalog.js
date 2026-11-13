import { buyHatkeSnapshot } from './buyhatke.js';
import { db, indiaDay, transaction } from './db.js';
import { fetchPage, listingKey, parseProduct, publicUrl, searchPublic, StoreError, stores } from './marketplaces.js';

export function saveCatalog(rows, category = null, source = null) {
  transaction(() => {
    for (const row of rows) {
      const id = listingKey(row.listingId, row.url);
      db.prepare("INSERT OR IGNORE INTO listings VALUES (?,?,?,?,'','',NULL,NULL,'')").run(row.store,id,row.url,row.title);
      if (row.price != null) db.prepare(`INSERT INTO search_prices VALUES (?,?,?,?)
        ON CONFLICT(store,id) DO UPDATE SET price=excluded.price,checked=excluded.checked`)
        .run(row.store,id,row.price,indiaDay());
      if (row.image) db.prepare('INSERT OR IGNORE INTO listing_images VALUES (?,?,?)').run(row.store,id,row.image);
      if (category) db.prepare('INSERT OR REPLACE INTO catalog_ranks VALUES (?,?,?,?,?)').run(row.store,id,category,row.rank,source);
    }
  });
}

export function recordProduct(store, listing, url, data, refreshOnly = false) {
  const id = listingKey(listing, url);
  const day = indiaDay();
  const {title,brand,gtin,price,stock,extra} = data;
  const previous = store === 'Flipkart' && price === null ?
    db.prepare('SELECT price,stock,checked FROM listings WHERE store=? AND id=?').get(store,id) : null;
  if (refreshOnly && price === null) throw new StoreError('No listed price was available.');
  transaction(() => {
    if (refreshOnly) {
      db.prepare('UPDATE listings SET price=?,stock=?,checked=? WHERE store=? AND id=?').run(price,stock,day,store,id);
    } else {
      db.prepare('INSERT OR REPLACE INTO listings VALUES (?,?,?,?,?,?,?,?,?)').run(store,id,url,title,brand,gtin,previous?.price ?? price,previous?.price != null ? previous.stock : stock,previous?.price != null ? previous.checked : day);
      db.prepare('INSERT OR REPLACE INTO listing_details VALUES (?,?,?)').run(store,id,JSON.stringify(extra));
      if (extra.image) db.prepare('INSERT OR REPLACE INTO listing_images VALUES (?,?,?)').run(store,id,extra.image);
    }
    if (price !== null) {
      db.prepare('INSERT OR REPLACE INTO history VALUES (?,?,?,?)').run(store,id,day,price);
      if (extra.sale_end && extra.sale_end >= day) {
        db.prepare('INSERT OR REPLACE INTO sale_prices VALUES (?,?,?)').run(store,id,extra.sale_end);
      } else db.prepare('DELETE FROM sale_prices WHERE store=? AND id=?').run(store,id);
    }
  });
}

export function savedProduct(store, listing, url) {
  const id = listingKey(listing,url);
  const row = db.prepare('SELECT * FROM listings WHERE store=? AND id=?').get(store,id);
  if (!row) return null;
  const details = db.prepare('SELECT payload FROM listing_details WHERE store=? AND id=?').get(store,id);
  const image = db.prepare('SELECT url FROM listing_images WHERE store=? AND id=?').get(store,id);
  const extra = details ? JSON.parse(details.payload) : {image:image?.url || ''};
  const matches = db.prepare("SELECT * FROM listings WHERE (store=? AND id=?) OR (gtin=? AND gtin<>'' AND store<>?) ORDER BY checked DESC")
    .all(store,id,row.gtin,store);
  const offers = [];
  for (const offer of matches) {
    if (offers.some(other => other.store === offer.store)) continue;
    const params = [offer.store,offer.id];
    const imported = db.prepare('SELECT day,price,source FROM imported_history WHERE store=? AND id=?').all(...params);
    const observed = db.prepare("SELECT day,price,'GivexIndia observation' AS source FROM history WHERE store=? AND id=?").all(...params);
    const daily = [...new Map([...imported,...observed].map(point => [point.day,point])).values()].sort((a,b) => a.day.localeCompare(b.day));
    const end = db.prepare('SELECT end_day FROM sale_prices WHERE store=? AND id=?').get(...params)?.end_day;
    offers.push({store:offer.store,listingId:offer.id.split(':')[0],url:offer.url,price:offer.price,
      stock:offer.stock === null ? null : Boolean(offer.stock),checked:offer.checked,
      tracking_id:offer.id,history:daily.map(point => [point.day,point.price]),
      history_sources:Object.fromEntries(daily.map(point => [point.day,point.source])),
      sale_end:end && end >= indiaDay() ? end : null});
  }
  const related = db.prepare(`SELECT listings.url,title,price,listing_images.url AS image FROM listings
    LEFT JOIN listing_images USING(store,id) WHERE brand=? AND brand<>'' AND (listings.store<>? OR listings.id<>?)
    AND (gtin<>? OR gtin='') AND stock=1 AND price IS NOT NULL ORDER BY ABS(price-?),checked DESC LIMIT 4`)
    .all(row.brand,store,id,row.gtin,row.price || 0);
  return {id:store+':'+id,name:row.title,brand:row.brand,category:'Product',variant:'',gtin:row.gtin,
    details:'Public product page · Previously checked prices may differ at checkout.',offers,coupons:[],...extra,related};
}

// Provider history is a previously recorded price, not a current stock check.
export function saveSnapshot(store,listing,url,snapshot) {
  const id = listingKey(listing,url);
  saveCatalog([{store,listingId:listing,url,title:snapshot.title,image:snapshot.image}]);
  transaction(() => {
    const insert = db.prepare('INSERT OR IGNORE INTO imported_history VALUES (?,?,?,?,?)');
    for (const [day,price] of snapshot.history) insert.run(store,id,day,price,'BuyHatke');
    const latest = snapshot.history.at(-1);
    if (latest && store === 'Flipkart') db.prepare('UPDATE listings SET price=?,checked=?,stock=NULL WHERE store=? AND id=? AND price IS NULL')
      .run(latest[1],latest[0],store,id);
  });
  return savedProduct(store,listing,url);
}

export async function lookupPublicStore(store,id,url) {
  try {
    const product = await lookup(store,id,url);
    if (store === 'Flipkart' && product.offers.find(offer => offer.store === store)?.price == null) {
      try {
        const snapshot = await buyHatkeSnapshot(store,id,url);
        if (snapshot) return saveSnapshot(store,id,url,snapshot);
      } catch {} // The store's product is still useful if the provider is unavailable.
    }
    return product;
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    const snapshot = await buyHatkeSnapshot(store,id,url);
    if (!snapshot) throw error;
    return saveSnapshot(store,id,url,snapshot);
  }
}

export async function refreshListing(store, listing, url, timeout = 12000) {
  const canonical = publicUrl(store,listing,url);
  const data = parseProduct(await fetchPage(canonical,timeout),store,canonical);
  recordProduct(store,listing,canonical,data,true);
  return data.price;
}

export async function lookup(store, listing, url) {
  const id = listingKey(listing,url);
  if (db.prepare('SELECT 1 FROM sale_prices WHERE store=? AND id=? AND end_day>=?').get(store,id,indiaDay())) {
    return savedProduct(store,listing,url);
  }
  const data = parseProduct(await fetchPage(url),store,url);
  if (!stores.includes(store) && data.price === null) throw new StoreError('This store did not expose a public INR price for this product.');
  recordProduct(store,listing,url,data);
  const result = savedProduct(store,listing,url);
  if (result.offers.length > 1 || !stores.includes(store)) return result;
  if (!data.gtin) {
    result.comparison_note = 'This listing did not expose a product barcode. An exact match on the other store could not be verified.';
    return result;
  }
  const other = stores.find(name => name !== store);
  try {
    const candidates = await searchPublic(other,data.gtin.replace(/^0+/,''));
    for (const candidate of candidates.slice(0,2)) {
      const match = parseProduct(await fetchPage(candidate.url,4000),other,candidate.url);
      if (match.gtin === data.gtin) {
        recordProduct(other,candidate.listingId,candidate.url,match);
        return savedProduct(store,listing,url);
      }
    }
    result.comparison_note = 'No verified match found on '+other+'.';
  } catch {
    result.comparison_note = other+' lookup is currently unavailable.';
  }
  return result;
}

const attempts = new Map();
const queue = [];
let running = 0;
function nextPrice() {
  while (running < 3 && queue.length) {
    const {work,resolve,reject} = queue.shift();
    running++;
    work().then(resolve,reject).finally(() => { running--; nextPrice(); });
  }
}
export async function cardPrice(store, listing, url) {
  const id = listingKey(listing,url);
  const saved = db.prepare('SELECT price FROM listings WHERE store=? AND id=?').get(store,id);
  if (!saved || saved.price !== null) return saved?.price ?? null;
  const key = store+':'+id;
  const attempt = attempts.get(key);
  if (attempt?.pending) return attempt.pending;
  if (attempt?.until > Date.now() || queue.length >= 30) return null;
  const pending = new Promise((resolve,reject) => {
    queue.push({work:() => refreshListing(store,listing,url,5000),resolve,reject});
    nextPrice();
  });
  attempts.delete(key);
  attempts.set(key,{pending});
  try { return await pending; }
  finally {
    attempts.set(key,{until:Date.now()+120000});
    if (attempts.size > 512) attempts.delete(attempts.keys().next().value);
  }
}

const accessory = /\b(?:chargers?|charging|adapt[eo]rs?|cables?|cases?|covers?|tempered glass|screen protectors?|power\s*banks?|holders?|mounts?|earphones?|headphones?|skins?|replacement)\b/g;
const normalize = text => (text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).join(' ');
function relevance(title, query) {
  const name = normalize(title);
  const terms = [...name.matchAll(accessory)];
  const intent = [...query.matchAll(accessory)][0];
  const singular = word => word.replace(/s$/,'');
  if (intent) {
    if (terms.some(term => singular(term[0]) === singular(intent[0]))) {
      return Number(singular(terms[0][0]) !== singular(intent[0]));
    }
    return terms.length ? 1 : 2;
  }
  const match = (' '+name+' ').indexOf(' '+query+' ');
  if (match < 0) return terms.length ? 3 : 1;
  if (terms.some(term => term.index < match) || /\b(?:compatible (?:with|for)|designed for|for|fits)\b/.test(name.slice(0,match))) return 3;
  const suffix = name.slice(match+query.length).split(' with ',1)[0];
  return [...suffix.matchAll(accessory)].length ? 2 : 0;
}

db.function('fold', {deterministic:true}, value => value.toLowerCase());
db.function('relevance', {deterministic:true}, relevance);
const cache = new Map();
export async function searchCatalog(query) {
  const words = query.toLowerCase().split(/\s+/);
  const key = words.join(' ');
  const phrase = normalize(query);
  const saved = db.prepare(`SELECT listings.store,listings.id,listings.url,title,listing_images.url AS image,COALESCE(listings.price,search_prices.price) AS price,listings.checked,listing_details.payload AS details
    FROM listings LEFT JOIN listing_images USING(store,id)
    LEFT JOIN listing_details USING(store,id)
    LEFT JOIN search_prices ON search_prices.store=listings.store AND search_prices.id=listings.id AND search_prices.checked=? WHERE ${words.map(()=>'instr(fold(title),?)>0').join(' AND ')}
    ORDER BY relevance(title,?),COALESCE((SELECT MIN(rank) FROM catalog_ranks r WHERE r.store=listings.store AND r.id=listings.id),999999),
    listings.checked DESC LIMIT 20`).all(indiaDay(),...words,phrase);
  const cached = cache.get(key);
  if (saved.length) {
    const results = saved.map(({id,details,...row}) => ({...row,listingId:id.split(':')[0],rating:details ? JSON.parse(details).rating ?? null : null}));
    return {results,unavailable:[],source:'saved'};
  }
  if (cached?.until > Date.now()) return cached.result;
  const settled = await Promise.allSettled(stores.map(store => searchPublic(store,query)));
  const result = {results:[],unavailable:[],source:'public'};
  settled.forEach((entry,index) => {
    if (entry.status === 'fulfilled') result.results.push(...entry.value);
    else result.unavailable.push(stores[index]);
  });
  result.results.sort((a,b)=>relevance(a.title,phrase)-relevance(b.title,phrase));
  if (result.results.length) saveCatalog(result.results);
  cache.delete(key);
  cache.set(key,{result,until:Date.now()+(result.unavailable.length?30000:300000)});
  if (cache.size>128) cache.delete(cache.keys().next().value);
  return result;
}
