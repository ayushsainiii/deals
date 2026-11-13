import {useEffect,useState} from 'react';
import {money,validMoney} from './catalog.js';

export function useStoreComparison(offer) {
  const [state,setState] = useState({loading:true,offers:[]});
  const {store,listingId,url} = offer || {};
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState({loading:true,offers:[]});
    const params = new URLSearchParams({store,id:listingId,url});
    fetch('/api/compare-stores?'+params,{signal:controller.signal}).then(response => {
      if (!response.ok) throw Error('Comparison unavailable');
      return response.json();
    }).then(({offers,lookalikes}) => {
      if (!controller.signal.aborted) setState({loading:false,offers,lookalikes});
    }).catch(() => {
      if (!controller.signal.aborted) setState({loading:false,offers:[],failed:true});
    });
    return () => controller.abort();
  },[store,listingId,url]);
  return url ? state : {loading:false,offers:[]};
}

export function StoreComparison({offer,state}) {
  const {price} = offer;
  const groups = new Map();
  for (const item of state.offers) {
    const key = item.store.toLowerCase();
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(item);
  }
  return <section className="panel store-comparison">
    <h2>Compare other stores{groups.size ? ' ('+groups.size+')' : ''}</h2>
    {state.loading ? <p role="status">Checking other stores…</p> : state.failed ?
      <p className="muted">Store comparison is unavailable right now.</p> : !groups.size ?
      <p className="muted">No comparable listings found on other stores.</p> : <>
      <p className="muted">Compared with the featured listing. Check variant, price and delivery at the store.</p>
      <div className="comparison-scroll" role="region" aria-label="Other store prices" tabIndex={0}>
      {[...groups.values()].map(([first,...rest]) => <div className="comparison-group" key={first.store}>
        <StoreRow item={first} price={price}/>
        {!!rest.length && <details><summary>{rest.length} more from {first.store}</summary>
          {rest.map(item => <StoreRow key={item.url} item={item} price={price}/>)}
        </details>}
      </div>)}
      </div>
    </>}
  </section>;
}

function StoreRow({item,price}) {
  const difference = validMoney(price) && price > 0 ? Math.round((item.price-price)*100/price) : null;
  const [logoFailed,setLogoFailed] = useState(false);
  const name = item.store.replace(/^./,letter => letter.toUpperCase());
  const comparison = difference === null ? null : difference === 0 ? 'Same price' :
    Math.abs(difference)+'% '+(difference < 0 ? 'Lower' : 'Higher');
  return <a className="comparison-row" href={item.url} target="_blank" rel="noopener noreferrer"
    title={item.title+' ? Reported '+item.checked}>
    <span className="comparison-logo" aria-hidden="true">
      {item.logo && !logoFailed ? <img src={item.logo} alt="" loading="lazy" onError={() => setLogoFailed(true)}/> : name[0]}
    </span>
    <span className="comparison-store"><strong>{name}</strong>
      <small>{item.delivery || 'Check delivery'}</small>
      <span className="comparison-title">{item.title}</span>
    </span>
    <span className="comparison-price"><strong>{money(item.price)}</strong>
      {comparison && <small data-direction={difference < 0 ? 'lower' : difference > 0 ? 'higher' : 'same'}>{comparison}</small>}
    </span>
    <span className="comparison-arrow" aria-hidden="true">?</span>
  </a>;
}
