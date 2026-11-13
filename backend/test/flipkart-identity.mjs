import assert from 'node:assert/strict';
process.env.GIVEX_DB_PATH = ':memory:';
const {parseBuyHatkeHistory,parseBuyHatkeOffers,buyHatkeLookalikes,buyHatkeHistory,buyHatkeOffers} = await import('../src/buyhatke.js');
const url = 'https://www.flipkart.com/homiboss-plastic-chair-home-outdoor-living-room-chairs-set-6-pieces/p/itm04d1eb06552cb';
const item = 'ITM04D1EB06552CB', pid = 'LRCGGT4ANPRFYHRR';
const record = (item,variant,linkItem=item,linkVariant=variant) => `{id:123,pid:"${item.toLowerCase()}",link:"https://www.flipkart.com/item/p/${linkItem.toLowerCase()}?pid=${linkVariant}",status:0,PID:"${variant}"}`;
const header = `productData:{name:"Chair",image:"https://x.example/a",link:"http://www.flipkart.com/synthetic/p/itm123?pid=${pid}",cur_price:234,site_name:"Flipkart",inStock:1,pid:"${pid}",predictedData:{history:[{from:"2026-01-01 00:00:00",to:"2026-01-02 00:00:00",price:234}]}}`;
const read = (records,productUrl=url) => parseBuyHatkeHistory(records+header,'Flipkart',item,productUrl);
assert.equal(read(record(item,pid)).length,2,'resolve an exact unique variant');
assert.equal(read('').length,0,'no mapping does not guess');
assert.equal(read(record(item,'OTHERPID')).length,0,'header PID must agree with mapping');
assert.equal(read(record(item,pid,'ITMDIFFERENT')).length,0,'mapping URL must agree on item');
assert.equal(read(record(item,pid,item,'OTHERPID')).length,0,'mapping URL must agree on variant');
assert.equal(read(record(item,pid)+record(item,'OTHERPID')).length,0,'ambiguous variants do not guess');
assert.equal(read('',url+'?pid='+pid).length,2,'explicit PID remains supported');
assert.equal(parseBuyHatkeOffers(record(item,pid)+header,'Flipkart',item,url).length,0,'no fake offers');

