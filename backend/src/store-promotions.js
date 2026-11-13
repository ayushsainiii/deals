import {buyHatkeOffers} from './buyhatke.js';
import {savedProduct} from './catalog.js';
import {fetchPage,parseProduct,publicUrl} from './marketplaces.js';

const cache = new Map();
const normalize = title => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function matchingStoreOffers(store,id,supplied) {
  const url = publicUrl(store,id,supplied);
  const product = savedProduct(store,id,url);
  if (!product) return {checked:0,offers:[],ratings:[]};
  const cached = cache.get(url);
  if (cached?.until > Date.now()) return cached.result;
  const result = scan(store,id,url,product);
  cache.delete(url);
  cache.set(url,{until:Date.now()+300000,result});
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}

async function scan(store,id,url,product) {
  const candidates = await buyHatkeOffers(store,id,url);
  const selected = new Map();
  const matched = candidate => product.offers.some(offer => offer.url === candidate.url) ||
    candidate.exactMatch || (product.model?.length >= 6 && candidate.title.toUpperCase().includes(product.model)) ||
    normalize(candidate.title) === normalize(product.name);
  const savedMatches = product.offers.filter(offer => offer.store !== store && offer.url);
  for (const item of [...savedMatches,...candidates.filter(matched)]) {
    if (!selected.has(item.store)) selected.set(item.store,item);
    if (selected.size >= 4) break;
  }
  const results = await Promise.allSettled([...selected.values()].map(async item => {
    const data = parseProduct(await fetchPage(item.url,4500),item.store,item.url);
    const exact = (product.gtin && data.gtin === product.gtin) ||
      (product.model?.length >= 6 && product.model === data.extra.model &&
        product.brand && product.brand.toLowerCase() === data.brand.toLowerCase()) ||
      normalize(product.name) === normalize(data.title);
    if (!exact) return {offers:[],rating:null};
    const offers = [
      ...data.extra.listed_coupons.map(offer => ({...offer,title:'Coupon code '+offer.code})),
      ...data.extra.store_offers,
    ].map(offer => ({...offer,store:item.store,url:item.url}));
    return {offers,rating:data.extra.rating ? {...data.extra.rating,store:item.store,url:item.url} : null};
  }));
  return {checked:results.filter(result => result.status === 'fulfilled').length,
    offers:results.flatMap(result => result.status === 'fulfilled' ? result.value.offers : []),
    ratings:results.flatMap(result => result.status === 'fulfilled' && result.value.rating ? [result.value.rating] : [])};
}
