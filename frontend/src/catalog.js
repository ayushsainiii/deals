import {publicStoreName,publicStoreUrl} from '../../shared/store-url.js';
export const mode = document.documentElement.dataset.mode;
const scrapeMode = mode === "scrape";
const formatINR = new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",minimumFractionDigits:0,maximumFractionDigits:2});
const money = paise => formatINR.format(paise / 100);
const today = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata"}).format(new Date());
const storeColors = {Amazon:"#a44925",Flipkart:"#14684e"};
const prices = product => product.offers.filter(offer => offer.stock && offer.price !== null).sort((a,b) => a.price-b.price);
const validMoney = value => Number.isSafeInteger(value) && value >= 0;
const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const storeValid = value => value === "Amazon" || value === "Flipkart";
function identifyLink(input) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (["amazon.in","www.amazon.in"].includes(url.hostname)) {
    const match = url.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i);
    return match ? ["Amazon",match[1].toUpperCase()] : null;
  }
  if (["flipkart.com","www.flipkart.com","dl.flipkart.com"].includes(url.hostname)) {
    if (scrapeMode) {
      const match = url.pathname.match(/^\/[a-z0-9%._~-]+\/p\/(itm[a-z0-9]+)\/?$/i);
      return match ? ["Flipkart",match[1].toUpperCase()] : null;
    }
    const id = url.searchParams.get("pid");
    return /^\/[\s\S]*\/p\/[^/]+/.test(url.pathname) && /^[a-z0-9]{6,40}$/i.test(id ?? "") ? ["Flipkart",id.toUpperCase()] : null;
  }
  return null;
}
function lookup(input, products) {
  const query = input.trim();
  if (!query) return {matches:[],message:"Enter a product name or store link."};
  if (/^(?:[a-z]+:\/\/|(?:www\.)?(?:amazon\.in|flipkart\.com)\/)/i.test(query)) {
    let listing = null;
    try { listing = identifyLink(query.includes("://") ? query : "https://" + query); } catch {}
    if (!listing) return {matches:[],message:"Use a full Amazon India or Flipkart product link."};
    const [store,id] = listing;
    const matches = products.filter(p => p.offers.some(o => o.store === store && o.listingId.toUpperCase() === id));
    return {matches,message:matches.length ? "" : "This listing is not in the loaded catalog."};
  }
  const words = query.toLowerCase().split(/\s+/);
  const matches = products.filter(p => words.every(word => [p.name,p.brand,p.variant].join(" ").toLowerCase().includes(word)));
  return {matches,message:matches.length ? "" : "No matching product. Try a brand, model or variant."};
}
function validateCatalog(products) {
  if (!Array.isArray(products) || !products.length) throw Error("Catalog must be a nonempty product list.");
  const productsSeen = new Set();
  const listingsSeen = new Set();
  for (const p of products) {
    if (!p || !["id","name","brand","category","variant","details"].every(k => typeof p[k] === "string") ||
        !p.id.trim() || !p.name.trim() || productsSeen.has(p.id) || !Array.isArray(p.offers) || !Array.isArray(p.coupons)) throw Error("Invalid product or duplicate product ID.");
    productsSeen.add(p.id);
    for (const o of p.offers) {
      if (!o || (!storeValid(o.store) && !(scrapeMode && o.url && publicStoreName(publicStoreUrl(o.url)) === o.store)) || !/^[a-z0-9]{6,40}$/i.test(o.listingId ?? "") ||
          typeof o.listingId !== "string" || !(o.price === null || validMoney(o.price)) || ![true,false,null].includes(o.stock) ||
          !(validDate(o.checked) || (scrapeMode && o.checked === "")) || !Array.isArray(o.history) ||
          !o.history.every(point => Array.isArray(point) && point.length === 2 && validDate(point[0]) && validMoney(point[1]))) throw Error("Invalid store offer or history.");
      const key = o.store + ":" + o.listingId.toUpperCase();
      if (listingsSeen.has(key)) throw Error("Duplicate marketplace listing: " + key);
      listingsSeen.add(key);
      if (o.url && storeValid(o.store)) {
        const listing = identifyLink(o.url);
        if (!listing || listing[0] !== o.store || listing[1] !== o.listingId.toUpperCase()) throw Error("Store link must match the listing ID.");
      }
    }
    for (const c of p.coupons) {
      if (!c || !storeValid(c.store) || typeof c.code !== "string" || typeof c.conditions !== "string" ||
          !validMoney(c.discount) || !validMoney(c.minOrder) || !(c.expires === null || validDate(c.expires))) throw Error("Invalid coupon.");
    }
  }
  return products;
}
function activeCoupons(product, date) {
  return product.coupons.filter(c => c.expires === null || c.expires >= date).map(c => {
    const offer = prices(product).find(o => o.store === c.store && o.price >= c.minOrder);
    return {...c, possiblePrice:offer && c.showEstimate !== false ? Math.max(0,offer.price-c.discount) : null};
  });
}
function recommendations(product, products) {
  const price = prices(product)[0]?.price ?? 0;
  return products.filter(p => p.id !== product.id && p.category === product.category && prices(p).length)
    .sort((a,b) => Math.abs(prices(a)[0].price-price)-Math.abs(prices(b)[0].price-price)).slice(0,4);
}

export {money, today, prices, validMoney, identifyLink, lookup, validateCatalog, activeCoupons, recommendations, storeColors};
