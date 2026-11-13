import { matchingStoreOffers } from './store-promotions.js';
import { buyHatkeHistory, buyHatkeOffers, buyHatkeLookalikes, buyHatkeProductExtras } from './buyhatke.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { account } from './accounts.js';
import { cardPrice, lookup, lookupPublicStore, savedProduct, searchCatalog } from './catalog.js';
import { otherListing, publicUrl, StoreError, validId } from './marketplaces.js';
import { providerLookup, providerSearch } from './providers.js';
import { scheduleRefresh } from './jobs.js';

const args = process.argv.slice(2);
const mode = args.includes('--test') ? 'test' : args.includes('--live') ? 'live' : (process.env.GIVEX_MODE || 'scrape');
if (!['test','live','scrape'].includes(mode)) throw new Error('GIVEX_MODE must be test, live or scrape.');
const frontend = await build({
  absWorkingDir:fileURLToPath(new URL('../../',import.meta.url)),
  entryPoints:{app:'./frontend/src/App.jsx'}, outdir:'frontend-build',
  bundle:true, minify:true, jsx:'automatic', write:false, tsconfigRaw:{},
  plugins:[{name:'local-frontend-files', setup(builder) {
    const require = createRequire(import.meta.url);
    builder.onResolve({filter:/.*/}, args => {
      const path = args.path.startsWith('.') ? resolve(args.resolveDir,args.path) : require.resolve(args.path);
      return {path,namespace:'frontend-file'};
    });
    builder.onLoad({filter:/.*/,namespace:'frontend-file'}, async args => ({
      contents:await readFile(args.path),
      loader:extname(args.path) === '.png' ? 'dataurl' : extname(args.path).slice(1),
      resolveDir:resolve(args.path,'..'),
    }));
  }}],
});
const assets = new Map(frontend.outputFiles.map(file => [
  '/assets/'+file.path.split(/[\\/]/).at(-1), file.contents,
]));
const html = new URL('../../frontend/index.html',import.meta.url);
const catalog = mode==='test' ? JSON.parse(await readFile(new URL('../../shared/sample-catalog.json',import.meta.url),'utf8')) : [];
const readPaths = new Set(['/api/account','/api/alerts']);
const writePaths = new Set(['/api/account/register','/api/account/login','/api/account/logout','/api/alerts','/api/alerts/remove']);

function reply(res,status,payload,cookie) {
  const json = typeof payload !== 'string';
  const body = json ? JSON.stringify(payload) : payload;
  res.writeHead(status,{
    'Content-Type':json?'application/json; charset=utf-8':'text/html; charset=utf-8',
    'Cache-Control':'no-store',
    ...(cookie?{'Set-Cookie':cookie}:{}),
  });
  res.end(body);
}

async function readJson(req) {
  if (req.headers['x-givex-request']!=='1' || req.headers['content-type']?.split(';')[0].trim()!=='application/json' ||
      Number(req.headers['content-length'])>4096) throw new Error('Invalid request.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size>4096) throw new Error('Invalid request.');
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Invalid request.');
  return body;
}

const server = createServer(async (req,res) => {
  try {
    const {pathname,searchParams:params} = new URL(req.url,'http://localhost');
    const method = req.method;
    if (method==='GET' && assets.has(pathname)) {
      res.writeHead(200, {
        'Content-Type':pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
        'Cache-Control':'no-cache',
      });
      return res.end(assets.get(pathname));
    }
    if (method==='GET' && pathname==='/') {
      const page = (await readFile(html,'utf8')).replace('<html lang="en">','<html lang="en" data-mode="'+mode+'">');
      return reply(res,200,page);
    }
    if ((method==='GET' && readPaths.has(pathname)) || (method==='POST' && writePaths.has(pathname))) {
      let body = {};
      if (method==='POST') {
        try { body = await readJson(req); }
        catch { req.resume(); return reply(res,400,{error:'Invalid request.'}); }
      }
      if (mode!=='scrape') return reply(res,404,{error:'Alerts are available in public page mode.'});
      return reply(res,...await account(method,pathname,body,req.headers.cookie));
    }
    if (method==='GET' && pathname==='/api/search' && mode!=='test') {
      const query = (params.get('q') || '').trim();
      if (query.length<2 || query.length>120) return reply(res,400,{error:'Enter 2–120 characters to search.'});
      return reply(res,200,await (mode==='scrape'?searchCatalog(query):providerSearch(query)));
    }
    if (method==='GET' && pathname==='/api/store-promotions' && mode==='scrape') {
      const store = params.get('store'), id = (params.get('id') || '').toUpperCase();
      if (!validId(store,id) && !/^[A-F0-9]{32}$/.test(id)) return reply(res,400,{error:'Invalid product ID.'});
      return reply(res,200,await matchingStoreOffers(store,id,params.get('url')));
    }
    if (method==='GET' && pathname==='/api/compare-stores' && mode==='scrape') {
      const store = params.get('store'), id = (params.get('id') || '').toUpperCase();
      if (!validId(store,id) && !/^[A-F0-9]{32}$/.test(id)) return reply(res,400,{error:'Invalid marketplace or product ID.'});
      const url = params.get('url');
      const [offers,lookalikes] = await Promise.all([buyHatkeOffers(store,id,url),buyHatkeLookalikes(store,id,url)]);
      return reply(res,200,{offers,lookalikes,source:'BuyHatke'});
    }
    if (method==='GET' && pathname==='/api/product-extras' && mode==='scrape') {
      const store = params.get('store'), id = (params.get('id') || '').toUpperCase();
      if (!validId(store,id) && !/^[A-F0-9]{32}$/.test(id)) return reply(res,400,{error:'Invalid product ID.'});
      const url = publicUrl(store,id,params.get('url'));
      const product = savedProduct(store,id,url);
      return reply(res,200,product ? await buyHatkeProductExtras(store,id,url,product.name) : {});
    }
    if (method==='GET' && pathname==='/api/price-history' && mode==='scrape') {
      const store = params.get('store'), id = (params.get('id') || '').toUpperCase();
      if (!validId(store,id) && !/^[A-F0-9]{32}$/.test(id)) return reply(res,400,{error:'Invalid marketplace or product ID.'});
      const history = await buyHatkeHistory(store,id,params.get('url'));
      return reply(res,200,{history,source:'BuyHatke'});
    }
    if (method==='GET' && pathname==='/api/store-product' && mode==='scrape') {
      const {store,id,url} = otherListing(params.get('url'));
      const product = params.get('saved')==='1' ? savedProduct(store,id,url) : await lookupPublicStore(store,id,url);
      return reply(res,200,{product});
    }
    const card = pathname==='/api/card-price' && mode==='scrape';
    if (method==='GET' && (pathname==='/api/lookup' || card)) {
      const store = params.get('store'), id = (params.get('id') || '').toUpperCase();
      if (!validId(store,id) && !(card && /^[A-F0-9]{32}$/.test(id))) return reply(res,400,{error:'Invalid marketplace or product ID.'});
      if (mode==='test') {
        const product = catalog.find(item=>item.offers.some(offer=>offer.store===store && offer.listingId===id));
        return product ? reply(res,200,{product}) : reply(res,404,{error:'This link is not in the test catalog. Use one of the example links.'});
      }
      if (mode==='live') return reply(res,200,{product:await providerLookup(store,id)});
      const url = publicUrl(store,id,params.get('url'));
      if (card) return reply(res,200,{price:await cardPrice(store,id,url)});
      const product = params.get('saved')==='1' ? savedProduct(store,id,url) :
        store === 'Flipkart' ? await lookupPublicStore(store,id,url) : await lookup(store,id,url);
      return reply(res,200,{product});
    }
    return reply(res,404,{error:'Not found.'});
  } catch (error) {
    if (error instanceof StoreError) return reply(res,503,{error:error.message});
    console.error('Request failed:',error.name,error.code || '');
    return reply(res,502,{error:'Unexpected provider response.'});
  }
});
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8766);
server.listen(port,host,() => {
  console.log('GivexIndia ('+mode+') listening on '+host+':'+server.address().port);
  if (mode==='scrape' && process.env.GIVEX_DAILY_REFRESH!=='0') scheduleRefresh();
});
