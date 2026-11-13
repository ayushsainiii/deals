import {useState} from 'react';
import {money} from './catalog.js';

export function LookAlike({items}) {
  const [expanded,setExpanded] = useState(false);
  if (!items?.length) return null;
  return <section className="panel related lookalike" aria-label="LookAlike">
    <h2>LookAlike</h2>
    <p className="muted">{items.length} similar products from {money(items[0].price)}. Check the specs and latest price at the store.</p>
    <div className="result-grid" id="lookalike-results">
      {(expanded ? items : items.slice(0,10)).map(item => <article className="result-card" key={item.url}>
        <span className="result-media"><img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer"/></span>
        <small className="lookalike-store">{item.logo && <img src={item.logo} alt="" loading="lazy" referrerPolicy="no-referrer"/>}{item.store}</small>
        <h3 className="result-title" title={item.title}>{item.title}</h3>
        <strong className="result-price">{money(item.price)}</strong>
        {item.checked && <small>Reported {item.checked}</small>}
        <a className="result-buy" href={item.url} target="_blank" rel="noopener noreferrer"
          aria-label={'Buy '+item.title+' on '+item.store}>Buy now</a>
      </article>)}
    </div>
    {items.length > 10 && <button type="button" className="secondary" aria-controls="lookalike-results"
      aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer products' : 'View all products'}</button>}
  </section>;
}
