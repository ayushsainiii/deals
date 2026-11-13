import {SpecialOffers} from './SpecialOffers.jsx';
import {rankByValue} from './value-ranking.js';
import {useEffect,useMemo,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import demo from '../../shared/sample-catalog.json';
import {mode,identifyLink,lookup,validateCatalog,money,prices,validMoney} from './catalog.js';
import {Product} from './Product.jsx';
import {Alerts,request} from './Alerts.jsx';
import './styles.css';
import amazonLogo from './assets/amazon.png';
import flipkartLogo from './assets/flipkart.png';

const scrape = mode === 'scrape', test = mode === 'test';
const sample = validateCatalog(demo);
const examples = [['Product name','Demo Phone X'],['Amazon link','https://www.amazon.in/dp/B000DEMO01'],
  ['Flipkart link','https://www.flipkart.com/demo-phone/p/itmdemo?pid=MOBDEMOPHONE128']];
const session = Date.now().toString(36);
const icons = {Amazon:amazonLogo, Flipkart:flipkartLogo};

function Cards({items,onOpen}) {
  const [fetched,setFetched] = useState({});
  useEffect(() => {
    if (!scrape) return;
    const controller = new AbortController();
    const pending = items.filter(item => !validMoney(item.price));
    let next = 0;
    async function worker() {
      while (!controller.signal.aborted && next < pending.length) {
        const item = pending[next++];
        try {
          const {price} = await request('/api/card-price?'+new URLSearchParams({
            store:item.store,id:item.listingId,url:item.url,
          }),undefined,controller.signal);
          if (!controller.signal.aborted) setFetched(current => ({...current,[item.key]:price ?? null}));
        } catch {
          if (!controller.signal.aborted) setFetched(current => ({...current,[item.key]:null}));
        }
      }
    }
    for (let i=0;i<Math.min(3,pending.length);i++) void worker();
    return () => controller.abort();
  },[items]);
  const [sort,setSort] = useState(false);
  const priced = useMemo(() => items.map(item => ({...item,price:validMoney(item.price) ? item.price : fetched[item.key]})),[items,fetched]);
  const values = useMemo(() => rankByValue(priced),[priced]);
  const cards = sort ? values : priced.map(item => values.find(value => value.key === item.key) || item);
  return <>
    {values.some(item => item.unitPrice) && <div style={{margin:'8px 0 12px'}}>
      <button type="button" className="secondary" aria-pressed={sort} onClick={() => setSort(!sort)}>
        {sort ? 'Show relevance order' : 'Sort by quantity value'}
      </button>
      {sort && <small> Within each unit: up to 70 points for unit price and 30 for ratings. Missing ratings use a neutral baseline.</small>}
    </div>}
    <div className="result-grid">{cards.map(item => {
    const {key,title,image,store,url} = item;
    const price = validMoney(item.price) ? item.price : fetched[key];
    let buy = false;
    try { buy = !!mode && !test && url && (identifyLink(url)?.[0] === store || (scrape && new URL(url).protocol === 'https:')); } catch {}
    return <article className="result-card" key={key}>
      {Object.hasOwn(icons,store) && <span className="result-store" data-store={store} title={store}><img src={icons[store]} alt={store}/></span>}
      <button type="button" className="result-open" onClick={() => onOpen(item)}>
        <span className="result-visual"><span className="result-media">
          {typeof image === 'string' && image.startsWith('https://') ?
            <img alt="" loading="lazy" referrerPolicy="no-referrer" src={image}/> :
            <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#85839c" strokeWidth="1.4"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 6"/></svg>}
        </span></span>
        <span className="result-title" title={title}>{title}</span>
        <span className={'result-price'+(validMoney(price) ? '' : ' is-unknown')}>{validMoney(price) ? money(price) :
          scrape && price === undefined ? 'Checking price…' : 'Price unavailable'}</span>
      </button>
      {buy && <a className="result-buy" target="_blank" rel="noopener noreferrer" href={url} aria-label={'Buy '+title+' on '+store}>Buy Now</a>}
    </article>;
  })}</div></>;
}

function App() {
  const [catalog,setCatalog] = useState(mode && !test ? [] : sample);
  const [imported,setImported] = useState(false);
  const [query,setQuery] = useState('');
  const [offer,setOffer] = useState(null);
  const initial = {index:0,query:'',status:'',product:mode ? null : sample[0],items:null};
  const [screen,setScreen] = useState(initial);
  const current = useRef(initial);
  const saved = useRef(new Map());
  const nextIndex = useRef(0);
  const pending = useRef(null);
  const scroll = useRef(null);
  function update(patch) {
    current.current = {...current.current,...patch};
    setScreen(current.current);
  }
  useLayoutEffect(() => {
    if (scroll.current) {
      window.scrollTo(...scroll.current);
      scroll.current = null;
    }
  },[screen]);
  useEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    window.history.replaceState({session,index:0},'');
    function restore(event) {
      const snapshot = saved.current.get(event.state?.index);
      if (event.state?.session !== session || !snapshot) return;
      pending.current?.abort();
      save();
      scroll.current = snapshot.scroll;
      current.current = snapshot.screen;
      setScreen(snapshot.screen);
      setQuery('');
    }
    window.addEventListener('popstate',restore);
    return () => {
      pending.current?.abort();
      window.removeEventListener('popstate',restore);
      window.history.scrollRestoration = previousRestoration;
    };
  },[]);
  function save() {
    saved.current.set(current.current.index,{screen:current.current,scroll:[window.scrollX,window.scrollY]});
  }
  function advance(value) {
    pending.current?.abort();
    save();
    const index = ++nextIndex.current;
    window.history.pushState({session,index},'');
    scroll.current = [0,0];
    update({index,query:value,status:'',product:null,items:null});
    setQuery('');
  }
  function openProduct(product) {
    advance(query);
    update({product});
  }
  async function search(input,keepQuery = false) {
    advance(keepQuery ? query : input);
    const controller = new AbortController();
    pending.current = controller;
    const signal = controller.signal;
    const get = path => request(path,undefined,signal);
    const change = patch => { if (!signal.aborted) update(patch); };
    const value = input.trim();
    const isLink = /^(?:[a-z]+:\/\/|(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/)/i.test(value);
    let showingSaved = false;
    try {
      if (mode && !test && !isLink) {
        change({status:'Searching stores…'});
        const {results,source,unavailable} = await get('/api/search?'+new URLSearchParams({q:value}));
        const note = unavailable.length ? ' Search unavailable for '+unavailable.join(' and ')+'.' : '';
        const label = source === 'saved' ? 'Saved products · ' : source === 'public' ? 'Store search results · ' : '';
        change({items:results.map((item,i) => ({...item,key:item.store+':'+item.listingId+':'+i})),
          status:(results.length ? label+'Select a product.' : 'No product results.')+note});
      } else if (mode && (!test || isLink)) {
        const url = value.includes('://') ? value : 'https://'+value;
        let listing;
        try { listing = identifyLink(url); } catch {}
        if (!listing && !scrape) return change({status:'Paste a full Amazon India or Flipkart product link.'});
        const [store,id] = listing || ['store page'];
        const path = listing ? '/api/lookup?'+new URLSearchParams(scrape ? {store,id,url} : {store,id}) :
          '/api/store-product?'+new URLSearchParams({url});
        change({status:'Checking '+store+'…'});
        if (scrape) {
          try {
            const {product} = await get(path+'&saved=1');
            if (product) {
              change({product:validateCatalog([product])[0],status:'Checking for newer prices and details…'});
              showingSaved = true;
            }
          } catch {}
        }
        if (signal.aborted) return;
        const {product} = await get(path);
        change({product:validateCatalog([product])[0],status:''});
      } else {
        const {matches,message} = lookup(input,catalog);
        if (matches.length === 1) return change({product:matches[0]});
        change({status:message || 'Choose the exact variant.',items:matches.map(product => ({
          key:product.id,product,image:product.image,title:[product.name,product.variant].filter(Boolean).join(' · '),...prices(product)[0],
        }))});
      }
    } catch (error) {
      change({status:showingSaved ? 'Showing saved details. The store refresh is unavailable.' : error.message});
    }
  }
  function openItem(item) {
    if (item.product) return openProduct(item.product);
    const url = scrape && item.url ? item.url : item.store === 'Amazon' ? 'https://www.amazon.in/dp/'+item.listingId :
      'https://www.flipkart.com/product/p/listing?pid='+item.listingId;
    void search(url,true);
  }
  function replaceCatalog(products,isImported) {
    pending.current?.abort();
    setCatalog(products);
    setImported(isImported);
    setQuery('');
    update({query:'',items:null,product:products[0],status:''});
  }
  return <>
    <header><nav><span className="brand">GivexIndia</span><span id="mode" className="tag">
      {test ? 'Test mode · Sample prices' : scrape ? 'Public page lookup' : mode ? 'Store lookup' : imported ? 'Imported catalog' : 'Demo data'}
    </span></nav></header>
    <main>
      <section className="hero">
        <h1>Find the better price.</h1>
        <p>{test ? 'Search the sample catalog or try a store link to check the local server.' :
          scrape ? 'Paste a store product link or search by product name.' : 'Search by product name or paste a full Amazon India or Flipkart product link.'}</p>
        <form className="search" id="search" onSubmit={event => {event.preventDefault(); void search(query);}}>
          <input id="query" aria-label="Product name or store link" placeholder="e.g. Demo Phone X" required value={query} onChange={event => setQuery(event.target.value)}/>
          <button>Compare</button>
        </form>
        {(test || (!mode && !imported)) && <div className="examples"><small>Try an example</small>{examples.map(([label,value]) =>
          <button key={label} type="button" className="secondary" onClick={() => search(value)}>{label}</button>)}</div>}
      </section>
      {mode && !test && screen.index === 0 && !screen.product && !screen.items && <SpecialOffers/>}
      <div id="status" role="status" aria-live="polite">{screen.status}</div>
      <div id="results">
        {screen.product && <>
          {!!screen.index && <p><button type="button" className="secondary" onClick={() => window.history.back()}>← Back</button></p>}
          <Product product={screen.product} catalog={catalog} onProduct={openProduct} onLink={url => search(url,true)} onAlert={setOffer}/>
        </>}
        {!!screen.items?.length && <Cards key={screen.index} items={screen.items} onOpen={openItem}/>}
      </div>
      {!mode && <footer className="foot"><label>Load a catalog JSON <input type="file" accept=".json,application/json" onChange={async event => {
        const input = event.currentTarget, file = input.files[0];
        if (!file) return;
        try { replaceCatalog(validateCatalog(JSON.parse(await file.text())),true); }
        catch (error) { update({status:'Catalog could not be loaded. '+error.message}); }
        finally { input.value = ''; }
      }}/></label> <button type="button" className="secondary" onClick={() => replaceCatalog(sample,false)}>Reset demo</button></footer>}
    </main>
    {offer && <Alerts offer={offer} onClose={() => setOffer(null)}/>}
  </>;
}

createRoot(document.getElementById('root')).render(<App/>);
