import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {BlockList} from 'node:net';
import {publicStoreName,publicStoreUrl} from '../../shared/store-url.js';
import { load } from 'cheerio';
import { indiaDay, paise, validDay } from './db.js';

export class StoreError extends Error {}
export const stores = ['Amazon', 'Flipkart'];
export const validId = (store, id) => store === 'Amazon' ? /^[A-Z0-9]{10}$/.test(id) :
  store === 'Flipkart' && /^[A-Z0-9]{6,40}$/.test(id);
const flipkartHosts = ['flipkart.com', 'www.flipkart.com', 'dl.flipkart.com'];

export function otherListing(input) {
  let url;
  try { url = publicStoreUrl(input); } catch { throw new StoreError('Use a public HTTPS product link.'); }
  if (['amazon.in','www.amazon.in',...flipkartHosts].includes(url.hostname)) {
    throw new StoreError('Paste a full Amazon or Flipkart product link.');
  }
  const id = createHash('sha256').update(url.href).digest('hex').slice(0,32).toUpperCase();
  return {store:publicStoreName(url),id,url:url.href};
}

const blocked = new BlockList();
for (const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(ip,bits);

async function fetchOtherPage(input, timeout) {
  const signal = AbortSignal.timeout(timeout);
  let url = publicStoreUrl(input);
  const host = url.hostname.replace(/^www\./,'');
  for (let attempt=0;attempt<3;attempt++) {
    const addresses = await lookup(url.hostname,{family:4,all:true});
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({address}) => blocked.check(address))) throw new StoreError('Store address is not public.');
    const response = await new Promise((resolve,reject) => {
      const req = request(url,{signal,agent:false,family:4,headers:{Accept:'text/html','Accept-Encoding':'identity','User-Agent':'node'},
        lookup:(_hostname,options,callback) => options.all ? callback(null,[addresses[0]]) :
          callback(null,addresses[0].address,4)},resolve);
      req.on('error',reject);
      req.end();
    });
    if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
      response.destroy();
      url = publicStoreUrl(new URL(response.headers.location,url).href);
      if (url.hostname.replace(/^www\./,'') !== host) throw new StoreError('Store redirected to a different website.');
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new StoreError('Store page unavailable (HTTP '+response.statusCode+').');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > 5_000_000) throw new StoreError('Store page is too large.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new StoreError('Store page redirected too many times.');
}

export function publicUrl(store, id, supplied) {
  if (store === 'Amazon' && validId(store, id)) return 'https://www.amazon.in/dp/' + id;
  let url;
  try { url = new URL(supplied); } catch {}
  if (store === 'Flipkart' && url?.protocol === 'https:' && !url.username && !url.password &&
      !url.port && flipkartHosts.includes(url.hostname) &&
      /^\/[a-z0-9%._~-]+\/p\/itm[a-z0-9]+\/?$/i.test(url.pathname) &&
      url.pathname.split('/')[3].toUpperCase() === id) {
    const pid = url.searchParams.get('pid') || '';
    return 'https://www.flipkart.com' + url.pathname + (/^[a-z0-9]{6,40}$/i.test(pid) ? '?pid=' + pid : '');
  }
  if (!stores.includes(store)) {
    const listing = otherListing(supplied);
    if (listing.store === store && listing.id === id) return listing.url;
  }
  throw new StoreError('Use a valid store product link.');
}

export const listingKey = (id, url) => {
  const pid = new URL(url).searchParams.get('pid');
  if (id.length === 32) return id;
  return pid ? id + ':' + pid.toUpperCase() : id;
};

export async function fetchPage(url, timeout = 12000) {
  try {
    if (!['amazon.in','www.amazon.in',...flipkartHosts].includes(new URL(url).hostname)) return await fetchOtherPage(url,timeout);
    const response = await fetch(url, {redirect:'manual', signal:AbortSignal.timeout(timeout),
      headers:{'User-Agent':'GivexIndiaLocal/1.0', Accept:'text/html'}});
    if (!response.ok) {
      await response.body?.cancel();
      throw new StoreError('Store page unavailable (HTTP ' + response.status + ').');
    }
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let html = '', size = 0;
    while (size < 5000000) {
      const {value, done} = await reader.read();
      if (done) break;
      html += decoder.decode(value.subarray(0, 5000000 - size), {stream:true});
      size += value.length;
    }
    if (size >= 5000000) await reader.cancel();
    return html + decoder.decode();
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('Could not reach the store over HTTPS.');
  }
}

const tidy = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export function listedCoupons(offers, checked = indiaDay()) {
  const coupons = new Map();
  for (const text of offers) {
    // Require the code, savings and an explicit expiry in the same offer.
    const code = text.match(/\b(?:[Cc]oupon|[Pp]romo|[Cc]laim) code\s*[:\-]?\s*["']?([A-Z0-9][A-Z0-9_-]{3,31})\b/);
    const end = text.match(/\b(?:expires(?: on)?|valid (?:until|through)|ends(?: on)?)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/i);
    if (!code || !end || !/[0-9]/.test(code[1]) && /^(?:HERE|THIS|ABOVE|BELOW|CHECKOUT|APPLY|ENTER|CODE)$/.test(code[1])) continue;
    if (!/(?:save|discount|off|cashback)/i.test(text) || !/(?:\u20b9\s*[1-9]|\b[1-9]\d*(?:\.\d+)?\s*%)/.test(text)) continue;
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    let expires = end[1];
    if (!validDay(expires)) {
      const [day,month,year] = expires.split(/\s+/);
      const index = months.indexOf(month?.slice(0,3).toLowerCase());
      if (index < 0) continue;
      expires = year+'-'+String(index+1).padStart(2,'0')+'-'+day.padStart(2,'0');
    }
    if (!validDay(expires) || expires < checked || /\b(?:expired|not applicable|sold out|upcoming)\b/i.test(text)) continue;
    coupons.set(code[1],{code:code[1],expires,checked,conditions:text});
  }
  return [...coupons.values()];
}

export function parseProduct(html, store, expectedUrl) {
  const $ = load(html);
  const products = [];
  function collect(value) {
    if (Array.isArray(value)) { value.forEach(collect); return; }
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().includes('Product')) products.push(value);
    if (value['@graph']) collect(value['@graph']);
  }
  $('script[type="application/ld+json" i]').each((_, element) => {
    const raw = $(element).text();
    try { collect(JSON.parse(raw)); } catch {
      // Croma sometimes embeds unescaped HTML and newlines in the description.
      if (store !== 'Croma' || !/"@type"\s*:\s*"Product"/.test(raw)) return;
      const name = raw.match(/"name"\s*:\s*("(?:[^"\\]|\\.)*")/)?.[1];
      const image = raw.match(/"image"\s*:\s*(\[[^\]]*\])/)?.[1];
      const offer = raw.match(/"offers"\s*:\s*(\{[^{}]*\})/)?.[1];
      if (!name || !offer) return;
      try {
        collect({'@type':'Product',name:JSON.parse(name),image:image ? JSON.parse(image) : [],
          offers:JSON.parse(offer),aggregateRating:JSON.parse(raw.match(/"aggregateRating"\s*:\s*(\{[^{}]*\})/)?.[1] || 'null'),brand:raw.match(/"brand"\s*:\s*\{[^{}]*"name"\s*:\s*"([^"]+)"/)?.[1]});
      } catch {}
    }
  });
  if (products.length > 1) throw new StoreError('The store page returned multiple products. A unique listing could not be verified.');
  const product = products[0] || {};
  if (store === 'myntra.com') {
    const rawState = html.match(/window\.__myx\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/)?.[1];
    try {
      const data = JSON.parse(rawState).pdpData;
      const canonical = $('link[rel="canonical"]').attr('href') || '';
      const pageId = canonical.match(/\/(\d+)\/buy(?:[?#]|$)/i)?.[1];
      const expectedId = expectedUrl && new URL(expectedUrl).pathname.match(/\/(\d+)\/buy\/?$/i)?.[1];
      if (data && pageId && expectedId === pageId && String(data.id) === pageId) {
        const discounted = paise(data.price?.discounted, 'INR');
        if (discounted !== null) product.offers = {price:data.price.discounted,priceCurrency:'INR'};
        if (typeof data.name === 'string' && data.name.trim()) product.name = data.name;
        if (typeof data.brand?.name === 'string') product.brand = data.brand.name;
        else if (typeof data.brand === 'string') product.brand = data.brand;
        if (data.ratings) product.aggregateRating = {
          ratingValue:data.ratings.averageRating, bestRating:5,
          ratingCount:data.ratings.totalCount, reviewCount:data.ratings.reviewInfo?.reviewsCount,
        };
        const images = data.media?.albums?.flatMap(album => album.images || [])
          .map(image => image.imageURL?.replace(/^http:\/\//,'https://'))
          .filter(image => typeof image === 'string' && /^https:\/\/assets\.myntassets\.com\//i.test(image));
        if (images?.length) product.image = [...new Set(images)].slice(0,8);
      }
    } catch {
      // Keep the standard structured-data result when embedded state is unavailable.
    }
  }
  const meta = key => $('meta').filter((_, el) =>
    ($(el).attr('property') || $(el).attr('name') || $(el).attr('itemprop') || '').toLowerCase() === key
  ).first().attr('content');
  const amazonTitle = store === 'Amazon' ? tidy($('#productTitle').text()) : '';
  const ratingData = product.aggregateRating || {};
  const amazonStars = amazonTitle ? tidy($('#acrPopover').attr('title') || $('#acrPopover .a-icon-alt').first().text()) : '';
  const amazonCount = amazonTitle ? tidy($('#acrCustomerReviewText').first().attr('aria-label') || $('#acrCustomerReviewText').first().text()) : '';
  const ratingValue = Number(ratingData.ratingValue ?? amazonStars.match(/([0-5](?:\.\d+)?)\s+out of 5/i)?.[1]);
  const ratingCount = Number(ratingData.ratingCount ?? amazonCount.match(/^\(?([\d,]+)/)?.[1].replaceAll(',',''));
  const reviewCount = Number(ratingData.reviewCount);
  const rating = ratingValue > 0 && ratingValue <= 5 && Number(ratingData.bestRating ?? 5) === 5 ? {
    value:ratingValue,
    ratings:Number.isSafeInteger(ratingCount) && ratingCount > 0 ? ratingCount : null,
    reviews:Number.isSafeInteger(reviewCount) && reviewCount > 0 ? reviewCount : null,
  } : null;
  const reviewItems = amazonTitle ? $('[data-hook="review"]').toArray().slice(0,8).flatMap(element => {
    const review = $(element);
    const text = tidy(review.find('[data-hook="review-body"],[data-hook="reviewText"]').first().text());
    if (!text) return [];
    const title = tidy(review.find('[data-hook="review-title"],[data-hook="reviewTitle"]').first().text());
    return [{title:title.slice(0,180),text:text.slice(0,180)}];
  }).slice(0,3) : [];
  const title = amazonTitle || product.name || meta('og:title');
  const offer = (Array.isArray(product.offers) ? (product.offers.length === 1 ? product.offers[0] : null) : product.offers) || {};
  const structuredPrice = paise(offer.price, offer.priceCurrency);
  let price = structuredPrice;
  if (price === null && (products.length || meta('og:type') === 'product')) {
    price = paise(meta('product:price:amount'), meta('product:price:currency'));
  }
  if (amazonTitle && price === null) {
    const area = $('#corePrice_feature_div,#corePriceDisplay_desktop_feature_div');
    const value = area.find('.a-price:not(.a-text-price) .a-offscreen').first().text().match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
    const featured = area.find('.priceToPay').first();
    const whole = tidy(featured.find('.a-price-whole').text()).replace(/\.$/, '');
    const fraction = tidy(featured.find('.a-price-fraction').text());
    if (value) price = paise(value[1], 'INR');
    else if (/^[\d,]+$/.test(whole) && /^\d{0,2}$/.test(fraction)) price = paise(whole + '.' + (fraction || '00'), 'INR');
  }
  if (typeof title !== 'string' || !title.trim() || (!products.length && price === null && !amazonTitle)) {
    throw new StoreError('The store page did not expose identifiable product data.');
  }
  let brand = typeof product.brand === 'object' ? product.brand?.name : product.brand;
  let availability = String(offer.availability || '').split('/').at(-1);
  const notices = [];
  const offerTexts = typeof offer.description === 'string' ? [tidy(offer.description).slice(0,500)] : [];
  if (amazonTitle) {
    const byline = tidy($('#bylineInfo').text()).match(/^(?:Visit the (.+?) Store|Brand:\s*(.+))$/i);
    brand ||= byline?.[1] || byline?.[2];
    const message = tidy($('#availability').text());
    if (/\bout of stock\b|currently unavailable/i.test(message)) availability = 'OutOfStock';
    else if (/\bin stock\b/i.test(message)) availability = 'InStock';
    for (const selector of ['#couponsInBuybox', '#promotionMessageInsideBuyBox']) {
      const notice = tidy($(selector).text());
      if (/₹\s*\d|\d\s*%|coupon code/i.test(notice)) { notices.push(notice.slice(0,500)); offerTexts.push(notice); }
    }
  }
  const storeOffers = (typeof offer.description === 'string' ? [tidy(offer.description).slice(0,500)] : []).filter(text =>
    /\b(?:cashback|instant discount|bank offer|no cost emi)\b/i.test(text) &&
    /(?:\u20b9\s*\d|\d\s*%)/.test(text) &&
    !/\b(?:expired|upcoming|not applicable)\b/i.test(text)
  ).map(conditions => ({title:'Payment offer',conditions,checked:indiaDay()}));
  if (amazonTitle) {
    $('#vsxoffers_feature_div .a-carousel-card').each((_,card) => {
      const text = tidy($(card).text());
      const match = text.match(/^(Bank Offer|Cashback|No Cost EMI|Partner Offers?|Special Offer|Coupon)\s+(.+?)\s+\d+ offers?(?:\s|$)/i);
      if (!match || !/(?:\u20b9\s*\d|\d\s*%)/.test(match[2]) ||
          /\b(?:expired|upcoming|not applicable)\b/i.test(match[2])) return;
      storeOffers.push({title:match[1],conditions:match[2].slice(0,500),checked:indiaDay()});
    });
  }
  const gtin = ['gtin14','gtin13','gtin12','gtin8','gtin'].map(key => String(product[key] || ''))
    .find(value => /^(?:\d{8}|\d{12,14})$/.test(value));
  const features = $('#feature-bullets .a-list-item').map((_, el) => tidy($(el).text())).get();
  if (Array.isArray(product.additionalProperty)) {
    for (const prop of product.additionalProperty) if (prop?.name && prop.value) features.push(prop.name + ': ' + prop.value);
  }
  if (typeof product.description === 'string') features.push(tidy(product.description));
  const images = product.image || $('#landingImage').attr('data-old-hires') || $('#landingImage').attr('src') || meta('og:image');
  const image = Array.isArray(images) ? images[0] : images;
  return {
    title:title.trim(), brand:String(brand || ''), gtin:gtin?.padStart(14, '0') || '', price,
    stock:availability === 'InStock' ? 1 : ['OutOfStock','SoldOut'].includes(availability) ? 0 : null,
    extra:{rating,reviewItems,images:Array.isArray(images) ? [...new Set(images.filter(value =>
      typeof value === 'string' && value.startsWith('https://')))].slice(0,8) : [],features:features.filter(Boolean).slice(0,8).map(value => value.slice(0,650)),
      image:typeof image === 'string' && image.startsWith('https://') ? image : '',
      model:typeof product.mpn === 'string' ? product.mpn.trim().toUpperCase() : '',
      notices:[...new Set(notices)], store_offers:storeOffers, listed_coupons:listedCoupons(offerTexts), sale_end:structuredPrice !== null && validDay(offer.priceValidUntil) ? offer.priceValidUntil : null},
  };
}

const words = text => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
export async function searchPublic(store, query) {
  const base = store === 'Amazon' ? 'https://www.amazon.in/s' : 'https://www.flipkart.com/search';
  const $ = load(await fetchPage(base + '?' + new URLSearchParams({[store === 'Amazon' ? 'k' : 'q']:query}), 5000));
  const rows = new Map(), images = new Map();
  $('a[href]').each((_, element) => {
    const link = $(element);
    let url;
    try { url = new URL(link.attr('href'), base); } catch { return; }
    const amazon = store === 'Amazon';
    if (amazon ? !['www.amazon.in','amazon.in'].includes(url.hostname) : !flipkartHosts.includes(url.hostname)) return;
    const match = amazon ? url.pathname.match(/\/dp\/([a-z0-9]{10})(?:\/|$)/i) :
      url.pathname.match(/^\/([^/]+)\/p\/(itm[a-z0-9]+)\/?$/i);
    if (!match) return;
    const id = match[amazon ? 1 : 2].toUpperCase();
    let canonical;
    try { canonical = publicUrl(store, id, url.href); } catch { return; }
    for (const el of link.find('img').toArray()) {
      const src = $(el).attr('data-src') || $(el).attr('src');
      try {
        const image = new URL(src);
        const domains = amazon ? ['media-amazon.com','ssl-images-amazon.com'] : ['flixcart.com','flipkart.com'];
        if (image.protocol === 'https:' && domains.some(domain => image.hostname === domain || image.hostname.endsWith('.' + domain))) {
          if (!images.has(canonical)) images.set(canonical, src);
        }
      } catch {}
    }
    let title = amazon ? link.find('h2[aria-label]').first().attr('aria-label') :
      link.attr('title') || link.attr('aria-label');
    if (!amazon && !title) {
      try { title = decodeURIComponent(match[1]).replaceAll('-', ' '); } catch { return; }
    }
    if (!tidy(title)) return;
    const card = link.closest('[data-component-type="s-search-result"]');
    const priceText = amazon
      ? (card.attr('data-asin') === id ? card.find('.a-price:not(.a-text-price) .a-offscreen').first().text() : '')
      : link.find('div.hZ3P6w').first().text();
    const amount = tidy(priceText).match(/^₹\s*([\d,]+(?:\.\d{1,2})?)$/);
    const price = amount ? paise(amount[1],'INR') : null;
    const previous = rows.get(canonical);
    if (!previous) rows.set(canonical, {store,listingId:id,title:tidy(title),url:canonical,price});
    else if (previous.price === null && price !== null) previous.price = price;
  });
  const terms = words(query);
  const score = row => terms.filter(term => words(row.title).includes(term)).length;
  return [...rows.values()].sort((a,b) => score(b) - score(a)).slice(0,10)
    .map(row => ({...row,image:images.get(row.url) || null}));
}
