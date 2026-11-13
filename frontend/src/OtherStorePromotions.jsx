import {useEffect,useState} from 'react';

export function OtherStorePromotions({offer}) {
  const [state,setState] = useState(null);
  const {store,listingId,url} = offer;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({store,id:listingId,url});
    fetch('/api/store-promotions?'+params,{signal:controller.signal}).then(response => {
      if (!response.ok) throw Error('Offer check failed');
      return response.json();
    }).then(result => {
      if (!controller.signal.aborted) setState(result);
    }).catch(() => {
      if (!controller.signal.aborted) setState({failed:true});
    });
    return () => controller.abort();
  },[store,listingId,url]);
  if (!state) return <p className="muted" role="status">Checking matching listings at other stores…</p>;
  if (state.failed) return <p className="muted">Other store offers are unavailable right now.</p>;
  if (!state.offers.length) return <p className="muted">{state.checked ?
    'No confirmed offer found on the other listings checked.' : 'No matching store page could be checked for offers.'}</p>;
  return <>{state.offers.map((item,index) => <div className="coupon" key={item.url+':'+index}>
    <h3>{item.title} · {item.store}</h3>
    <p>{item.conditions}</p>
    <small>{item.expires && <>Valid through {item.expires} · </>}Confirm eligibility at checkout</small>
    <p><a href={item.url} target="_blank" rel="noopener noreferrer">View on {item.store}</a></p>
  </div>)}</>;
}
