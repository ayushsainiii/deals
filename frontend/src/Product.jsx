import amazonLogo from './assets/amazon.png';
import flipkartLogo from './assets/flipkart.png';
import {ProductRatings} from './ProductRatings.jsx';
import {OtherStorePromotions} from './OtherStorePromotions.jsx';
import {LookAlike} from './LookAlike.jsx';
import {StoreComparison,useStoreComparison} from './StoreComparison.jsx';
import {DealScanner,isHistoricalPrice} from './DealScanner.jsx';
import {Fragment, useEffect, useId, useState} from 'react';
import {activeCoupons, mode, money, prices, recommendations, storeColors, today} from './catalog.js';

const scrape = mode === 'scrape';
const showStore = mode === 'live' || scrape;
const photo = url => typeof url === 'string' && url.startsWith('https://');
const date = time => new Date(time).toISOString().slice(0,10);

function PriceHistory({product, featured}) {
  const gradient = useId();
  const [range,setRange] = useState(0);
  const [external,setExternal] = useState({});
  const [loading,setLoading] = useState(scrape);
  const listings = JSON.stringify(product.offers.filter(offer => offer.url)
    .map(({store,listingId,url}) => ({store,id:listingId,url})));
  useEffect(() => {
    if (!scrape) return;
    const controller = new AbortController();
    setLoading(true);
    const tasks = JSON.parse(listings).map(async listing => {
      const response = await fetch('/api/price-history?'+new URLSearchParams(listing), {signal:controller.signal});
      if (!response.ok) return null;
      const {history,source} = await response.json();
      return [listing.store,{history,source}];
    });
    Promise.allSettled(tasks).then(results => {
      if (controller.signal.aborted) return;
      setExternal(Object.fromEntries(results.flatMap(result =>
        result.status === 'fulfilled' && result.value ? [result.value] : [])));
      setLoading(false);
    });
    return () => controller.abort();
  },[listings]);
  const cutoff = new Date(Date.parse(today()));
  const dayOfMonth = cutoff.getUTCDate();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - range, 1);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(dayOfMonth,lastDay));
  const minimum = date(cutoff);
  const combined = product.offers.map(offer => {
    const imported = external[offer.store];
    const history = new Map([...(imported?.history || []),...offer.history]);
    const sources = {...Object.fromEntries((imported?.history || []).map(([day]) => [day,imported.source])),
      ...offer.history_sources};
    return {...offer,history_sources:sources,history:[...history]};
  });
  const deal = <aside className="product-deal" tabIndex={0} aria-label="Deal and price drop"><DealScanner offer={combined.find(offer => offer.store === featured?.store)} today={today()} loading={loading}/></aside>;
  const series = combined.map(offer => ({
    ...offer, history:offer.history.filter(([day]) => !range || day >= minimum),
  })).filter(offer => offer.history.length);
  const loadingNote = loading && <p className="muted" role="status">Checking BuyHatke history?</p>;
  const filters = <div role="group" aria-label="Price history range" className="history-filters">
    {[[1,'1 Month'],[3,'3 Months'],[0,'Max']].map(([value,label]) => <button key={value} type="button"
      className={range === value ? '' : 'secondary'} aria-pressed={range === value} onClick={() => setRange(value)}>{label}</button>)}
  </div>;
  const header = <div className="history-heading"><h2>Price history</h2>{filters}</div>;
  if (!series.length) return <>{deal}<section className="panel history-panel">{header}{loadingNote}{!loading && <p className="muted">{range ?
    'No prices recorded in this range.' : 'No price history available for this variant yet.'}</p>}</section></>;
  const rows = series.flatMap(offer => offer.history.map(([day,price]) => ({day,price,store:offer.store,source:offer.history_sources?.[day]})))
    .sort((a,b) => b.day.localeCompare(a.day));
  const first = Date.parse(rows.at(-1).day), last = Date.parse(rows[0].day);
  const lo = Math.min(...rows.map(row => row.price)), hi = Math.max(...rows.map(row => row.price));
  const x = day => first === last ? 522 : 65 + (Date.parse(day)-first)/(last-first)*915;
  const y = price => lo === hi ? 102 : 182 - (price-lo)/(hi-lo)*160;
  return <>
    {deal}<section className="panel history-panel">{header}{loadingNote}
    <p className="history-coverage"><strong>{first === last ? 'Recorded on '+date(first) : 'Recorded from '+date(first)+' to '+date(last)}</strong></p>
    {scrape && <p className="muted history-coverage">{first === last ? 'Tracking has one recorded day. Check this listing on another day to see how its price changes.' : 'This chart shows observed prices on recorded dates. Days without a check have no recorded price.'}</p>}
    <div className="history-stats">{series.map(offer => {
      const amounts = offer.history.map(point => point[1]);
      return <div className="history-stat" key={offer.store}><strong>{offer.store}</strong><span>{amounts.length} {amounts.length === 1 ? 'check' : 'checks'} · Low {money(Math.min(...amounts))} · High {money(Math.max(...amounts))}</span></div>;
    })}</div>
    <div className="legend">{series.map(({store}) => <span key={store}><i className="dot" style={{background:storeColors[store] || "#4b3de0"}}/>{store}</span>)}</div>
    <div className="history-plot"><svg className="chart" viewBox="0 0 1000 215" role="img" aria-label="Price history by store">
      <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
        <stop stopColor="#fb8f84" stopOpacity=".45"/><stop offset=".55" stopColor="#ffdf9d" stopOpacity=".42"/>
        <stop offset="1" stopColor="#bce9db" stopOpacity=".48"/>
      </linearGradient></defs>
      <path d="M65 22H980 M65 102H980 M65 182H980" stroke="#dce4da"/>
      {series.map(offer => {
        const color = storeColors[offer.store] || "#4b3de0";
        const ordered = [...offer.history].sort((a,b) => a[0].localeCompare(b[0]));
        const line = ordered.map(([d,p]) => x(d)+','+y(p)).join(' ');
        return <Fragment key={offer.store}>
          {series.length === 1 && ordered.length > 1 && <polygon fill={'url(#'+gradient+')'}
            points={x(ordered[0][0])+',182 '+line+' '+x(ordered.at(-1)[0])+',182'}/>}
          <polyline fill="none" stroke={color} strokeWidth="3" points={line}/>
          {ordered.map(([d,p],i) => <circle key={i} cx={x(d)} cy={y(p)} r={ordered.length > 25 ? 2 : 4} fill={color}><title>{d} · {money(p)}</title></circle>)}
        </Fragment>;
      })}
      <g fill="#53665d" fontSize="13"><text x="1" y="26">{money(hi)}</text><text x="1" y="185">{money(lo)}</text>
        <text x="65" y="205">{date(first)}</text>{first !== last && <text x="980" y="205" textAnchor="end">{date(last)}</text>}
      </g>
    </svg></div>
    </section>
  </>;
}

function useProductExtras(offer) {
  const {store,listingId:id,url} = offer || {};
  const [result,setResult] = useState(null);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch('/api/product-extras?'+new URLSearchParams({store,id,url}),{signal:controller.signal})
      .then(response=>response.ok ? response.json() : {})
      .then(data=>{if (!controller.signal.aborted) setResult({url,...data});})
      .catch(()=>{});
    return ()=>controller.abort();
  },[store,id,url]);
  return result?.url === url ? result : null;
}

function ProductGallery({image,images}) {
  const [selected,setSelected] = useState(null);
  const photos = [...new Set([image,...(images || [])].filter(photo))];
  return <div>
    <div className={'product-gallery'+(photos.length ? '' : ' is-empty')}>
      {photos.length ? <img className="product-photo" src={selected || photos[0]} alt="" referrerPolicy="no-referrer"/> : 'Product image unavailable'}
    </div>
    {photos.length > 1 && <div className="product-thumbnails" role="group" aria-label="Product photos">
      {photos.map((src,index)=><button key={src} type="button" className="secondary" onClick={()=>setSelected(src)}
        aria-pressed={(selected || photos[0])===src} aria-label={'Photo '+(index+1)}><img src={src} alt="" referrerPolicy="no-referrer"/></button>)}
    </div>}
  </div>;
}

export function Product({product,catalog,onProduct,onLink,onAlert}) {
  const ranked = prices(product), best = ranked[0], next = ranked.find(offer => offer.store !== best?.store);
  const savings = next ? next.price-best.price : 0;
  const headline = next ? (savings ? best.store+' is '+money(savings)+' lower' : 'Same listed price at both stores') :
    best ? 'One store price available' : product.offers.some(offer => offer.price !== null && offer.stock === null) ?
      'Listed price ? stock unconfirmed' : 'No in-stock prices available';
  const offers = [...product.offers].sort((a,b) => Number(ranked.includes(b))-Number(ranked.includes(a)) || (a.price ?? Infinity)-(b.price ?? Infinity));
  const featured = best || offers.find(offer => offer.price !== null) || offers[0];
  const extras = useProductExtras(scrape ? featured : null);
  const comparison = useStoreComparison(scrape ? featured : null);
  const lowestByStore = new Map();
  for (const item of [...comparison.offers].sort((a,b) => a.price-b.price)) {
    const store = item.store.toLowerCase();
    if (!lowestByStore.has(store)) lowestByStore.set(store,item);
  }
  const storeDeals = [...lowestByStore.values()];
  const deals = [...new Map([...storeDeals,...(extras?.alternatives || [])]
    .map(item => [item.url,item])).values()];
  const day = today();
  const historicalPrice = scrape && featured?.price !== null && isHistoricalPrice(featured,day);
  const coupons = activeCoupons(product,day);
  const storeOffers = (product.store_offers || []).filter(offer => offer.checked === day);
  const listedCoupons = (product.listed_coupons || []).filter(coupon => coupon.expires >= day && coupon.checked === day);
  const related = scrape ? product.related || [] : recommendations(product,catalog);
  const alert = offer => onAlert({...offer,title:product.name});
  return <>
    <div className="product-stage">
      <ProductGallery key={product.id} image={product.image} images={[...(product.images || []),...(extras?.images || [])]}/>
      <div className="product-copy">
        <small className="brand-pill">{featured?.store || product.brand || product.category}</small>
        <h2>{product.name}</h2>
        <ProductRatings key={product.id+':'+featured?.url} product={product} offer={featured}/>
        <p className="muted">{[product.brand,product.variant].filter(Boolean).join(' · ')}</p>
        {featured && featured.price !== null && <><div className="main-price">{money(featured.price)}</div>
          {historicalPrice && <p className="muted" role="note">Last recorded price{featured.checked ? ' on '+featured.checked : ' - date unavailable'}. Check the store for the current price.</p>}</>}
        {featured?.price === null && featured.history.length > 0 && <p className="muted">
          Last recorded price: {money(featured.history.at(-1)[1])} ({featured.history.at(-1)[0]})
        </p>}
        <div className="summary">{headline}</div>
        {featured?.url && showStore && <a className="store-cta" target="_blank" rel="noopener noreferrer" href={featured.url}>View on {featured.store}</a>}
        {scrape && featured?.tracking_id && <button type="button" className="price-alert-cta" onClick={() => alert(featured)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>Set price alert
        </button>}
        <p className="muted">{product.details}</p>
        {scrape && featured?.url && <StoreComparison key={featured.url} offer={featured} state={comparison}/>}
      </div>
      <PriceHistory key={product.id} product={product} featured={featured}/>
    </div>
    <div className="layout product-offers-layout">
      <section className="panel" style={{gridColumn:"1/-1"}}><h2>Coupons and offers</h2>
        {!!deals.length && <section className="category-deals">
          <h3>Deals in this category</h3>
          <div className="category-deal-grid">{deals.slice(0,10).map(item => {
            const discount = item.originalPrice > item.price ?
              Math.round(100*(item.originalPrice-item.price)/item.originalPrice) : 0;
            const logo = item.logo || ({Amazon:amazonLogo,Flipkart:flipkartLogo})[item.store];
            return <a className="category-deal-card" key={item.url} href={item.url} target="_blank"
              rel="noopener noreferrer" title={item.title+' | Reported '+item.checked}>
              <span className="category-deal-photo">{photo(item.image) ?
                <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer"/> :
                <span>Image unavailable</span>}</span>
              <span className="category-deal-store">
                {logo ? <img src={logo} alt={item.store} title={item.store} loading="lazy" referrerPolicy="no-referrer"/> : item.store}
              </span>
              <span className="category-deal-title">{item.title}</span>
              <span className="category-deal-price">
                {discount > 0 && <span className="category-deal-saving" aria-label={discount+' percent off'}>&darr; {discount}%</span>}
                <strong>{money(item.price)}</strong>
              </span>
              {discount > 0 && <del>{money(item.originalPrice)}</del>}
            </a>;
          })}</div>
          <p className="muted">Reported prices. Confirm the variant and latest price at the store.</p>
        </section>}
        <h3>Coupons and payment offers</h3>
        {scrape && featured?.url && <OtherStorePromotions key={featured.url} offer={featured}/>}
        {storeOffers.map((offer,index) => <div className="coupon" key={index}>
          <h3>{offer.title}</h3><p>{offer.conditions}</p>
          <small>Listed by the store today ? Confirm eligibility at checkout</small>
        </div>)}
        {listedCoupons.map(coupon => <div className="coupon" key={coupon.code}>
          <h3>{coupon.code}</h3>
          <p>{coupon.conditions}</p>
          <small>Listed by the store today ? Valid through {coupon.expires} ? Confirm eligibility at checkout</small>
        </div>)}
        {coupons.length ? coupons.map((coupon,i) => <div className="coupon" key={i}><h3>{coupon.code || 'Store offer'} · {coupon.store}</h3>
          <p>{coupon.conditions}</p><small>{coupon.expires ? 'Minimum order '+money(coupon.minOrder)+' · Expires '+coupon.expires : 'Expiry unavailable'}</small>
          {coupon.possiblePrice !== null && <p>Possible price if eligible: <strong>{money(coupon.possiblePrice)}</strong></p>}
        </div>) : product.notices?.length ? <><small>Offers shown on the store page. Confirm eligibility at checkout.</small>
          {product.notices.map((notice,i) => <p className="product-notice" key={i}>{notice}</p>)}
        </> : !listedCoupons.length && !storeOffers.length && <p className="muted">{mode ? 'No current coupon code or payment offer was found on the featured store.' : 'No active coupons in this catalog.'}</p>}
      </section>
      {!!product.features?.length && <section className="panel"><h2>Product details</h2><ul className="features">{product.features.map((feature,i) => <li key={i}>{feature}</li>)}</ul></section>}
    </div>
    {scrape && <LookAlike key={featured?.url || product.id} items={comparison.lookalikes}/>}
    <section className="panel related"><h2>{scrape ? 'More from this brand' : 'Similar products'}</h2><div className="cards">
      {related.length ? related.map((item,i) => <article className="card" key={item.id || item.url || i}>
        {photo(item.image) && <img className="card-image" alt="" loading="lazy" referrerPolicy="no-referrer" src={item.image}/>}
        <h3>{scrape ? item.title : item.name}</h3>{!scrape && <small>{item.variant}</small>}
        <p>{scrape ? money(item.price) : 'From '+money(prices(item)[0].price)}</p>
        <button className="secondary" onClick={() => scrape ? onLink(item.url) : onProduct(item)}>{scrape ? 'Check price' : 'Compare'}</button>
      </article>) : <p className="muted">No similar products in this catalog.</p>}
    </div></section>
  </>;
}
