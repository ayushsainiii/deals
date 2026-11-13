const factors = {mg:.001,g:1,gm:1,gms:1,gram:1,grams:1,kg:1000,ml:1,l:1000,litre:1000,litres:1000,liter:1000,liters:1000};
export function quantity(title) {
  const matches = [...title.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|g(?:ms?)?|grams?|kg|ml|litres?|liters?|l)\b/g)];
  if (matches.length !== 1) return null;
  const [text,amount,unit] = matches[0];
  const start = matches[0].index;
  const before = title.slice(0,start);
  const after = title.slice(start+text.length);
  const packs = [before.match(/\b(\d+)\s*[x×]\s*$/i)?.[1],
    after.match(/^\s*[x×]\s*(\d+)\b/i)?.[1], title.match(/\bpack of\s+(\d+)\b/i)?.[1]]
    .filter(Boolean).map(Number);
  if (new Set(packs).size > 1) return null;
  const total = Number(amount)*factors[unit]*(packs[0] ?? 1);
  return total > 0 ? {total,unit:/^(?:ml|l)/.test(unit) ? 'ml' : 'g'} : null;
}

export function rankByValue(items) {
  const groups = new Map();
  const ranked = items.map(item => {
    const size = quantity(item.title);
    if (!size || !Number.isSafeInteger(item.price) || item.price <= 0) return item;
    const value = {...item,size,unitPrice:item.price*100/size.total};
    if (!groups.has(size.unit)) groups.set(size.unit,[]);
    groups.get(size.unit).push(value);
    return value;
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const cheapest = Math.min(...group.map(item => item.unitPrice));
    for (const item of group) {
      const pricePoints = 70*cheapest/item.unitPrice;
      const rating = item.rating;
      const count = rating?.ratings || rating?.reviews || 0;
      const confidence = count/(count+20);
      const stars = rating?.value > 0 && rating.value <= 5 ? rating.value : 3.5;
      item.valuePoints = Math.round(pricePoints + 30*(3.5+(stars-3.5)*confidence)/5);
    }
    group.sort((a,b) => b.valuePoints-a.valuePoints || a.unitPrice-b.unitPrice);
  }
  return ranked.map(item => item.size ? groups.get(item.size.unit).shift() : item);
}
