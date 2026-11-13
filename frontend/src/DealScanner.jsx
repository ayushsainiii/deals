import {useState} from 'react';
import {money, validMoney} from './catalog.js';

const waitOptions = [[3,'2?3 Days',65],[7,'1 Week',78],[30,'1 Month',90]];
const colors = ['#e34e50','#f09233','#e6ba35','#79b847','#159655'];
export const isHistoricalPrice = (offer, day) => Boolean(offer && (offer.checked !== day || offer.history_sources?.[offer.checked] === 'BuyHatke'));
const point = angle => [80 + 58 * Math.cos(angle), 76 - 58 * Math.sin(angle)];

export function assessDeal(offer, days, today) {
  if (!offer || !validMoney(offer.price)) return null;
  const now = Date.parse(isHistoricalPrice(offer,today) && /^\d{4}-\d{2}-\d{2}$/.test(offer.checked || '') ? offer.checked : today);
  const samples = [...new Map(offer.history)].filter(([day,price]) => {
    const age = (now-Date.parse(day))/86400000;
    return age > 0 && (!days || age <= days) && validMoney(price);
  });
  if (samples.length < 3) return null;
  const values = samples.map(([,price]) => price);
  const low = Math.min(...values), high = Math.max(...values);
  const average = Math.round(values.reduce((sum,price) => sum+price,0)/values.length);
  const current = offer.price;
  // A flat history only supports a neutral score at its usual price.
  const position = high === low ? (current < low ? 1 : current > high ? 0 : .5) :
    Math.max(0,Math.min(1,(high-current)/(high-low)));
  const score = Math.round(position*100);
  const recommendation = current <= low && (high > low || current < low) ? 'Good time to buy' :
    current > average ? 'Consider waiting' :
    score >= 75 && current < average ? 'Good time to buy' : 'Fair price';
  return {low,high,average,score,recommendation,count:samples.length};
}

function Meter({score}) {
  const [x,y] = point(Math.PI*(1-score/100));
  return <svg viewBox="0 0 160 91" role="img" aria-label={'Deal score '+score+' out of 100'}>
    {colors.map((color,index) => {
      const start = point(Math.PI*(1-index/5)-.018);
      const end = point(Math.PI*(1-(index+1)/5)+.018);
      return <path key={color} d={'M '+start.join(' ')+' A 58 58 0 0 1 '+end.join(' ')}
        stroke={color} strokeWidth="12" fill="none"/>;
    })}
    <line x1="80" y1="76" x2={x} y2={y} stroke="#4338ca" strokeWidth="4" strokeLinecap="round"/>
    <circle cx="80" cy="76" r="5" fill="white" stroke="#4338ca" strokeWidth="3"/>
    <text x="16" y="89" fontSize="9">0</text><text x="132" y="89" fontSize="9">100</text>
  </svg>;
}

export function DealScanner({offer,today,loading}) {
  const [view,setView] = useState('Price Drop');
  const [wait,setWait] = useState(3);
  const deal = assessDeal(offer,0,today);
  const threshold = waitOptions.find(([days]) => days === wait)[2];
  const scanner = view === 'Deal Scanner';
  const historical = isHistoricalPrice(offer,today);
  const atLow = deal && offer.price < deal.average && offer.price <= deal.low;
  const buy = deal && (atLow || (deal.score >= threshold && offer.price < deal.average));
  const waitForPrice = deal && !buy && (offer.price > deal.average || (wait > 3 && offer.price > deal.low));
  const unavailable = offer?.stock === false;
  const unknown = offer?.stock == null;
  const recommendation = historical ? (buy ? 'Last recorded price was low' : waitForPrice ? 'Last recorded price was high' : 'Last recorded price was mid-range') : unavailable ? 'Wait for restock' : buy ?
    (unknown ? 'Good price if in stock' : 'Go ahead & buy now') :
    waitForPrice ? 'Consider waiting' : 'Fair price if you need it';
  const reason = historical ? 'The price and stock may have changed. Check the store.' : unavailable ? 'The store marks this listing as out of stock.' : atLow ? 'At or below the recorded low' : buy ? 'Near the lower end of recorded prices' :
    waitForPrice ? 'Lower prices have been recorded' : 'Close to the usual price';
  return <section className="deal-scanner" aria-label="Deal scanner">
    <div className="deal-tabs" role="group" aria-label="Deal view">
      {['Deal Scanner','Price Drop'].map(label => <button key={label} type="button"
        aria-pressed={view === label} onClick={() => setView(label)}>{label}</button>)}
    </div>
    <div className="deal-content">
      <h3>{historical ? 'Historical price assessment' : scanner ? 'How good is this deal?' : 'Should you buy now?'}</h3>
      {historical && <p className="deal-hint">Based on the last recorded price{offer?.checked ? ' on '+offer.checked : ''}. Check the store for the current price.</p>}
      {!scanner && <>
        <div className="deal-ranges" role="group" aria-label="How long can you wait?">
          {waitOptions.map(([value,label]) => <button key={value} type="button"
            aria-pressed={wait === value} onClick={() => setWait(value)}>{label}</button>)}
        </div>
        <p className="deal-hint">Select how long you can wait.</p>
      </>}
      {deal ? <>
        <div className="deal-reading">
          <div className="deal-meter"><Meter score={deal.score}/>
            <div className="deal-legend"><span>Bad Time</span><span>Good Time</span></div>
          </div>
          <div className="deal-recommendation" aria-live="polite">
            <p>{scanner ? 'Deal Score' : 'Our Recommendation'}</p>
            <strong data-tone={scanner || historical ? 'neutral' : unavailable ? 'wait' : buy ? 'good' : waitForPrice ? 'wait' : 'neutral'}>
              {scanner ? deal.score+'/100' : recommendation}
            </strong>
            <p>{scanner ? historical ? 'Based on the last recorded price' : 'Compared with recorded prices' : reason}</p>
            {unknown && <p>Check stock on the store page.</p>}
          </div>
        </div>
        <h3>Price Stats</h3>
        <dl className="deal-stats">{[['Highest Price','?',deal.high],['Average Price','?',deal.average],['Lowest Price','?',deal.low]].map(([label,arrow,value]) =>
          <div key={label}><dt>{label} <span aria-hidden="true">{arrow}</span></dt><dd>{money(value)}</dd></div>)}</dl>
        <p className="deal-hint">{offer.store} ? {deal.count} earlier readings. Waiting options adjust the recommendation using recorded prices.</p>
      </> : <p className="deal-hint">{loading ? 'Checking price history?' :
        unavailable ? 'Out of stock. Check again when the store restocks.' : !validMoney(offer?.price) ?
          'A current listed price is needed for a recommendation.' :
          'Not enough earlier price readings for a reliable recommendation.'}</p>}
    </div>
  </section>;
}
