import { load } from 'cheerio';
import { indiaDay, paise, validDay } from './db.js';
import { publicUrl, searchPublic } from './marketplaces.js';

const origin = 'https://www.buyhatke.com';
const cache = new Map();

function matchedHeader(html, store, id, url) {
  const header = /link:"([^"]+)",cur_price:[^,]+,[\s\S]{0,650}?site_name:"([^"]+)",inStock:[^,]+,pid:"([^"]+)"/.exec(html);
  if (!header) return [];
  let actual;
  try { actual = new URL(header[1]); } catch { return []; }
  const expected = new URL(url);
  if (store === 'Amazon') {
    if (header[2] !== store) return [];
    if (!['amazon.in','www.amazon.in'].includes(actual.hostname) ||
        actual.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase() !== id ||
        header[3].toUpperCase() !== id) return [];
  } else if (store === 'Flipkart') {
    if (header[2] !== store) return [];
    const hosts = ['www.flipkart.com','flipkart.com','dl.flipkart.com'];
    let pid = expected.searchParams.get('pid')?.toUpperCase();
    if (!pid) {
      // A Flipkart URL may identify the product page but omit the variant PID.
      // Resolve it only when the provider gives an unambiguous mapping whose
      // own product link agrees on both the item ID and the variant PID.
      const candidates = new Set();
      const mapping = /\{id:\d+,pid:"(itm[a-z0-9]+)",link:("(?:[^"\\]|\\.)*"),[^{}]{0,2500}?\bPID:"([a-z0-9]+)"/gi;
      for (const [,item,rawLink,variant] of html.matchAll(mapping)) {
        if (item.toUpperCase() !== id) continue;
        try {
          const mapped = new URL(JSON.parse(rawLink));
          const mappedItem = mapped.pathname.match(/\/p\/(itm[a-z0-9]+)\/?$/i)?.[1]?.toUpperCase();
          if (mapped.protocol !== 'https:' || !hosts.includes(mapped.hostname) || mapped.username || mapped.password || mapped.port ||
              mappedItem !== id || mapped.searchParams.get('pid')?.toUpperCase() !== variant.toUpperCase()) continue;
          candidates.add(variant.toUpperCase());
        } catch { /* Ignore malformed provider records. */ }
      }
      if (candidates.size !== 1) return [];
      pid = [...candidates][0];
    }
    if (!hosts.includes(actual.hostname) || header[3].toUpperCase() !== pid ||
        actual.searchParams.get('pid')?.toUpperCase() !== pid) return [];
  } else {
    const host = value => value.hostname.replace(/^www\./,'');
    const source = host(expected), returned = host(actual);
    const zepto = name => ['zepto.com','zeptonow.com'].includes(name);
    if (source !== returned && !(zepto(source) && zepto(returned))) return [];
    if (actual.protocol !== 'http:' && actual.protocol !== 'https:') return [];
    const path = value => value.pathname.replace(/\/+$/,'');
    const trailingId = (value, pattern) => path(value).match(pattern)?.[1];
    let matches = path(actual) === path(expected) && actual.search === expected.search;
    if (source === 'croma.com' || source === 'blinkit.com' || source === 'meesho.com' || zepto(source)) {
      const pattern = source === 'croma.com' ? /\/p\/(\d+)$/ :
        source === 'meesho.com' ? /\/p\/([a-z0-9]+)$/i :
        source === 'blinkit.com' ? /\/prid\/(\d+)$/ : /\/pvid\/([a-f0-9-]{36})$/i;
      const sku = trailingId(expected,pattern);
      matches = !!sku && sku === header[3] && sku === trailingId(actual,pattern);
    } else if (source === 'myntra.com') {
      const pattern = /\/(\d+)\/buy$/i;
      const sku = trailingId(expected,pattern);
      matches = !!sku && sku === header[3] && sku === trailingId(actual,pattern) &&
        expected.search === actual.search;
    } else if (source === 'ajio.com') {
      const pattern = /\/p\/([a-z0-9_-]+)$/i;
      const sku = trailingId(expected,pattern);
      matches = !!sku && sku.toLowerCase() === header[3].toLowerCase() &&
        sku.toLowerCase() === trailingId(actual,pattern)?.toLowerCase() && expected.search === actual.search;
    } else if (source === 'vijaysales.com') {
      matches = /^\/p\/P\d+\/\d+\/[^/]+$/i.test(path(expected)) &&
        (path(actual) === path(expected) || path(actual) === path(expected)+'/abc') &&
        header[3] === path(expected).slice(3) && actual.search === expected.search;
    }
    if (!matches) return [];
  }
  return header;
}

export function parseBuyHatkeHistory(html, store, id, url) {
  const header = matchedHeader(html,store,id,url);
  if (!header?.length) return [];
  const history = /predictedData:\{history:\[([^\]]*)\]/.exec(html.slice(header.index + header[0].length));
  if (!history) return [];
  const today = indiaDay();
  const readings = new Map();
  for (const match of history[1].matchAll(/\{from:"(\d{4}-\d{2}-\d{2}) [\d:]+",to:"(\d{4}-\d{2}-\d{2}) [\d:]+",price:(\d+(?:\.\d+)?)\}/g)) {
    const [,from,to,value] = match;
    const price = paise(Number(value).toFixed(2),'INR');
    if (price === null || !validDay(from) || !validDay(to) || from > to || to > today) continue;
    readings.set(from,price);
    readings.set(to,price);
  }
  return [...readings].sort(([a],[b]) => a.localeCompare(b));
}

function buyHatkePage(url) {
  const existing = cache.get(url);
  if (existing?.until > Date.now()) return existing.pending;
  const pending = (async () => {
    const signal = AbortSignal.timeout(6500);
    let target = new URL(origin+'/'+url);
    for (let i=0;i<3;i++) {
      const response = await fetch(target,{redirect:'manual',signal});
      if (response.ok) return response.text();
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || response.status < 300 || response.status >= 400) break;
      target = new URL(location,target);
      if (target.origin !== origin) break;
    }
    return "";
  })().catch(() => "");
  cache.delete(url);
  cache.set(url,{pending,until:Date.now()+300000});
  if (cache.size > 256) cache.delete(cache.keys().next().value);
  return pending;
}

export async function buyHatkeHistory(store,id,supplied) {
  const url = publicUrl(store,id,supplied);
  return parseBuyHatkeHistory(await buyHatkePage(url),store,id,url);
}

export function parseBuyHatkeOffers(html, store, id, url) {
  if (!matchedHeader(html,store,id,url)?.length) return [];
  const rows = new Map();
  const deliveryByPrice = new Map();
  const $ = load(html);
  $('button img[src*="/site_icons_m/"]').each((_,image) => {
    const labels = $(image).closest('button').find('p').map((_,el) => $(el).text().trim()).get();
    const [name,delivery,amount] = labels;
    const value = paise(amount?.match(/^\u20b9\s*([\d,.]+)$/)?.[1],'INR');
    if (!name || !value || !delivery) return;
    const key = name.toLowerCase()+':'+value;
    const label = /^free delivery$/i.test(delivery) ? 'Free delivery' : null;
    if (!deliveryByPrice.has(key) || deliveryByPrice.get(key) !== label) {
      deliveryByPrice.set(key,deliveryByPrice.has(key) ? null : label);
    }
  });
  const candidates = /\{prod:("(?:[^"\\]|\\.)*"),image:("(?:[^"\\]|\\.)*"),PID:"(?:[^"\\]|\\.)*",link:("(?:[^"\\]|\\.)*"),price:(\d+(?:\.\d+)?),position:\d+,contDetails:[^,]+,site_name:("(?:[^"\\]|\\.)*"),([^{}]{0,1600})/g;
  for (const [,rawTitle,rawImage,rawUrl,amount,rawStore,metadata] of html.matchAll(candidates)) {
    if (!/\btrustedFlag:true\b/.test(metadata) || /\brefurbished_flag:true\b/.test(metadata)) continue;
    try {
      const title = JSON.parse(rawTitle), name = JSON.parse(rawStore);
      if (/\b(?:renewed|refurbished|pre-owned)\b/i.test(title) || !name || name.toLowerCase() === store.toLowerCase()) continue;
      const link = new URL(JSON.parse(rawUrl));
      if (link.protocol !== 'https:' || link.username || link.password || link.port ||
          !/\.[a-z]{2,}$/i.test(link.hostname) || /(^|\.)buyhatke\.com$/i.test(link.hostname)) continue;
      link.hash = '';
      if (link.hostname.replace(/^www\./,'') === new URL(url).hostname.replace(/^www\./,'')) continue;
      const price = paise(amount,'INR');
      const stamp = metadata.match(/\blast_updated:"([^"]+)"/)?.[1];
      const checked = stamp?.slice(0,10);
      if (!price || !validDay(checked) || checked > indiaDay()) continue;
      const logo = metadata.match(/\bsite_image:"(https:\/\/compare\.buyhatke\.com\/images\/site_icons_m\/[a-z0-9_.-]+)"/i)?.[1];
      const delivery = deliveryByPrice.get(name.toLowerCase()+':'+price) || null;
      const imageUrl = JSON.parse(rawImage);
      const image = /^https:\/\/[a-z0-9.-]+\//i.test(imageUrl) ? imageUrl : null;
      const originalPrice = paise(metadata.match(/\bmrpFloat:(\d+(?:\.\d+)?)(?=[,}\s]|$)/)?.[1],'INR');
      const previous = rows.get(link.href);
      if (!previous || previous.checked < checked) rows.set(link.href,{store:name,title,url:link.href,price,checked,image,exactMatch:/\bexactSame:1\b/.test(metadata),originalPrice:originalPrice > price ? originalPrice : null,logo:logo?.endsWith("/unavail_logo.png") ? null : logo || null,delivery});
    } catch {
      // Skip malformed entries without losing the rest of the comparison.
    }
  }
  return [...rows.values()].sort((a,b) => a.price-b.price).slice(0,100);
}

export async function buyHatkeOffers(store,id,supplied) {
  const url = publicUrl(store,id,supplied);
  return parseBuyHatkeOffers(await buyHatkePage(url),store,id,url);
}

export async function buyHatkeSnapshot(store,id,url) {
  const html = await buyHatkePage(url);
  const header = matchedHeader(html,store,id,url);
  if (!header?.length) return null;
  const product = /productData:\{name:("(?:[^"\\]|\\.)*"),image:("(?:[^"\\]|\\.)*"),link:$/.exec(
    html.slice(Math.max(0,header.index-2500),header.index+5));
  if (!product) return null;
  try {
    const title = JSON.parse(product[1]).trim();
    const image = JSON.parse(product[2]);
    if (!title) return null;
    const history = parseBuyHatkeHistory(html,store,id,url);
    const offers = parseBuyHatkeOffers(html,store,id,url);
    if (!history.length && !offers.length) return null;
    return {title,image:image.startsWith('https://') ? image : '',history};
  } catch { return null; }
}


export async function buyHatkeLookalikes(store,id,supplied) {
  const url = publicUrl(store,id,supplied);
  const html = await buyHatkePage(url);
  if (!matchedHeader(html,store,id,url)?.length) return [];
  // Read the public page's flat LookAlike records without executing page scripts.
  const array = /dittoProducts:\[((?:\{(?:[^{}"\\]|"(?:[^"\\]|\\.)*")*\},?)+)\]/.exec(html)?.[1];
  if (!array) return [];
  const results = new Map();
  for (const [record] of array.matchAll(/\{(?:[^{}"\\]|"(?:[^"\\]|\\.)*")*\}/g)) {
    if (!/\bisActive:1\b/.test(record)) continue;
    try {
      const field = name => JSON.parse(record.match(new RegExp('(?:\\{|,)'+name+':("(?:[^"\\\\]|\\\\.)*")'))?.[1] || 'null');
      const title = field('prod')?.trim(), store = field('site_name')?.trim();
      const price = paise(record.match(/(?:\{|,)price:(\d+(?:\.\d+)?)(?:,|\})/)?.[1],'INR');
      const safe = value => {
        if (!value) return null;
        const link = new URL(value);
        return link.protocol === 'https:' && !link.username && !link.password && !link.port &&
          /\.[a-z]{2,}$/i.test(link.hostname) ? link.href : null;
      };
      const link = safe(field('prodUrl')), image = safe(field('imageUrl'));
      if (!title || !store || !price || !link || !image || link === url) continue;
      const logo = safe(field('site_logo'));
      const checked = field('last_updated')?.slice(0,10);
      results.set(link,{title,store,price,url:link,image,logo,checked:validDay(checked) ? checked : null});
    } catch {
      // A malformed listing should not hide the other alternatives.
    }
  }
  return [...results.values()].sort((a,b) => a.price-b.price).slice(0,60);
}

export async function buyHatkeProductExtras(store,id,supplied,savedTitle) {
  const url = publicUrl(store,id,supplied);
  const html = await buyHatkePage(url);
  const header = matchedHeader(html,store,id,url);
  let images = [];
  if (header?.length) {
    const payload = html.slice(header.index,header.index+5000);
    const thumbnails = payload.match(/thumbnailImages:\[((?:"(?:[^"\\]|\\.)*"\s*,?\s*)+)\]/)?.[1];
    if (thumbnails) {
      try {
        images = [...new Set(JSON.parse('['+thumbnails+']').filter(image =>
          typeof image === 'string' && image.startsWith('https://')))].slice(0,6);
      } catch {}
    }
    if (parseBuyHatkeOffers(html,store,id,url).length || /dittoProducts:\[\{/.test(payload)) return {images};
  }
  const title = savedTitle?.split(/[|:]/,1)[0].replace(/\b(?:cord[- ]ord|co[- ]ord)\b/gi,'co ord');
  if (!title) return {images};
  const tokens = value => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [...new Set(tokens(title).filter(word => word.length >= 2 && !/^(?:for|with|and|the|only|buy|in|of)$/.test(word)))].slice(0,6);
  if (terms.length < 2) return {images};
  const query = terms.join(' ');
  const results = await Promise.allSettled(['Amazon','Flipkart'].map(name=>searchPublic(name,query)));
  const alternatives = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (!item.image || !item.price || item.url === url) continue;
      const words = new Set(tokens(item.title.replace(/\b(?:cord[- ]ord|co[- ]ord)\b/gi,'co ord')));
      const match = terms.filter(word=>words.has(word)).length;
      if (match >= Math.max(2,Math.ceil(terms.length*.6))) {
        alternatives.set(item.url,{...item,checked:indiaDay()});
      }
    }
  }
  return {images,alternatives:[...alternatives.values()].sort((a,b)=>a.price-b.price).slice(0,10)};
}
