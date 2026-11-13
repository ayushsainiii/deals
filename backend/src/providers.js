import { indiaDay, paise } from './db.js';
import { StoreError, stores, validId } from './marketplaces.js';

function setting(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new StoreError('Business data access is missing ('+name+').');
  return value;
}
async function fetchJson(url, params, headers = {}) {
  try {
    const response = await fetch(url+'?'+new URLSearchParams(params), {
      redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json',...headers},
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new StoreError('Data provider returned HTTP '+response.status+'.');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError('Data provider response is unavailable.');
  }
}
const keepa = (path, params) => fetchJson('https://api.keepa.com/'+path,{key:setting('KEEPA_API_KEY'),domain:10,...params});
const affiliate = (path, params) => fetchJson('https://affiliate-api.flipkart.net/affiliate/1.0/'+path+'.json',params,{
  'Fk-Affiliate-Id':setting('FLIPKART_AFFILIATE_ID'),'Fk-Affiliate-Token':setting('FLIPKART_AFFILIATE_TOKEN'),
});
const keepaDay = minute => indiaDay(Date.UTC(2011,0,1)+minute*60000);
const product = (offer,name,brand,variant,details,coupons=[]) => ({
  id:offer.store+':'+offer.listingId,name,brand:brand || '',variant:variant || '',category:'Product',details,offers:[offer],coupons,
});
function flipkartUrl(raw,id) {
  try {
    const url = new URL(raw);
    if (!['flipkart.com','www.flipkart.com','dl.flipkart.com'].includes(url.hostname) ||
        !['http:','https:'].includes(url.protocol) || url.username || url.password || url.port ||
        url.searchParams.get('pid')?.toUpperCase() !== id) return undefined;
    url.protocol = 'https:';
    return url.href;
  } catch { return undefined; }
}

export async function providerLookup(store,id) {
  if (store === 'Amazon') {
    const payload = await keepa('product',{asin:id,history:1,days:90,stats:90,offers:20,update:0});
    const item = payload.products?.find(p => p.asin === id && p.title);
    if (!item) throw new StoreError('Keepa returned no matching Amazon India listing.');
    if (!Number.isInteger(item.lastUpdate)) throw new StoreError('Keepa did not report when this listing was checked.');
    const price = item.stats?.current?.[1] >= 0 ? item.stats.current[1] : null;
    const series = item.csv?.[1] || [];
    const history = new Map();
    for (let i=0;i+1<series.length;i+=2) if (series[i+1]>=0) history.set(keepaDay(series[i]),series[i+1]);
    const coupons = [];
    const coupon = item.coupon?.[0];
    if (item.offersSuccessful && coupon) {
      const description = coupon<0 ? Math.abs(coupon)+'% off' : new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(coupon/100)+' off';
      coupons.push({store,code:'',discount:0,minOrder:0,expires:null,showEstimate:false,
        conditions:'Keepa observed a '+description+' one-time Buy Box coupon. Check listing and checkout eligibility.'});
    }
    return product({store,listingId:id,price,stock:price===null?null:true,checked:keepaDay(item.lastUpdate),
      history:[...history].sort(),url:'https://www.amazon.in/dp/'+id},item.title,item.brand,item.model,'New price before shipping · Keepa',coupons);
  }
  const item = (await affiliate('product',{id})).productBaseInfoV1;
  if (String(item?.productId).toUpperCase() !== id || !item?.title) throw new StoreError('Flipkart returned no matching listing.');
  return product({store,listingId:id,price:paise(item.flipkartSellingPrice?.amount,item.flipkartSellingPrice?.currency),
    stock:typeof item.inStock === 'boolean'?item.inStock:null,checked:indiaDay(),history:[],url:flipkartUrl(item.productUrl,id)},
    item.title,item.productBrand,'','Listed selling price · Flipkart Affiliate API');
}

async function searchProvider(store,query) {
  const amazon = store === 'Amazon';
  const items = amazon ? (await keepa('search',{type:'product',term:query})).products :
    (await affiliate('search',{query,resultCount:10})).productInfoList.map(row => row.productBaseInfoV1);
  const results = new Map();
  for (const item of items) {
    const listingId = String(amazon?item.asin:item.productId).toUpperCase();
    if (!validId(store,listingId) || typeof item.title !== 'string' || !item.title.trim()) continue;
    results.set(listingId,{store,listingId,title:item.title,
      url:amazon?'https://www.amazon.in/dp/'+listingId:flipkartUrl(item.productUrl,listingId)});
  }
  return [...results.values()].slice(0,10);
}

export async function providerSearch(query) {
  const settled = await Promise.allSettled(stores.map(store => searchProvider(store,query)));
  return {results:settled.flatMap(entry => entry.status==='fulfilled'?entry.value:[]),
    unavailable:stores.filter((_,index)=>settled[index].status==='rejected')};
}
