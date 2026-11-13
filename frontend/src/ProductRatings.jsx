import {useEffect,useState} from 'react';
import {mode} from './catalog.js';

function Rating({rating,showStore = true}) {
  return <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:7,margin:'5px 0'}}>
    <strong style={{color:'#a44713'}}>{rating.value.toFixed(1)}</strong>
    <span role="img" aria-label={rating.value.toFixed(1)+' out of 5 stars'}
      style={{position:'relative',display:'inline-block',color:'#b8b9c4',letterSpacing:1}}>
      <span aria-hidden="true">{'\u2605'.repeat(5)}</span>
      <span aria-hidden="true" style={{position:'absolute',left:0,top:0,overflow:'hidden',whiteSpace:'nowrap',
        width:(rating.value*20)+'%',color:'#c45313'}}>{'\u2605'.repeat(5)}</span>
    </span>
    <small>{[rating.ratings && rating.ratings.toLocaleString('en-IN')+' ratings',
      rating.reviews && rating.reviews.toLocaleString('en-IN')+' reviews'].filter(Boolean).join(' / ')}</small>
    {showStore && (rating.url ? <a href={rating.url} target="_blank" rel="noopener noreferrer">{rating.store}</a> : <small>{rating.store}</small>)}
  </div>;
}

export function ProductRatings({product,offer}) {
  const [others,setOthers] = useState([]);
  const {store,id,url} = offer ? {store:offer.store,id:offer.listingId,url:offer.url} : {};
  useEffect(() => {
    if (mode !== 'scrape' || !url) return;
    const controller = new AbortController();
    fetch('/api/store-promotions?'+new URLSearchParams({store,id,url}),{signal:controller.signal})
      .then(response => response.ok ? response.json() : null)
      .then(data => {if (!controller.signal.aborted) setOthers(data?.ratings || []);})
      .catch(() => {});
    return () => controller.abort();
  },[store,id,url]);
  const primary = product.rating && {...product.rating,store:product.id.split(':')[0]};
  const reviews = product.reviewItems || [];
  if (!primary && !others.length && !reviews.length) return <small>Product ratings unavailable</small>;
  return <div aria-label="Product ratings">
    {primary && <Rating rating={primary} showStore={false}/>}
    {reviews.length > 0 && <details><summary>Customer review excerpts on {product.id.split(':')[0]}</summary>
      {reviews.map((review,index) => <div className="offer" key={index}>
        {review.title && <strong>{review.title}</strong>}
        <p>{review.text}</p>
      </div>)}
      {url && <a href={url} target="_blank" rel="noopener noreferrer">Read more on the store</a>}
    </details>}
    {others.length > 0 && <details><summary>Ratings from other stores</summary>
      {others.map(rating => <Rating key={rating.url} rating={rating}/>)}
    </details>}
  </div>;
}
