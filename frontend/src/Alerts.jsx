import {useEffect,useRef,useState} from 'react';
import {money} from './catalog.js';

export async function request(path, body, signal) {
  const response = await fetch(path, body === undefined ? {signal} : {
    method:'POST', headers:{'Content-Type':'application/json','X-Givex-Request':'1'},
    body:JSON.stringify(body), signal,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'The request failed.');
  return data;
}

export function Alerts({offer,onClose}) {
  const dialog = useRef(null);
  const [account,setAccount] = useState(null);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  async function load() {
    const {email} = await request('/api/account');
    const alerts = email ? (await request('/api/alerts')).alerts : [];
    setAccount({email,alerts});
  }
  async function act(action) {
    setBusy(true);
    setMessage('');
    try { await action(); } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    dialog.current.showModal();
    void act(load);
  },[]);
  return <dialog ref={dialog} id="alerts-dialog" className="panel" onClose={onClose}
    style={{width:'min(500px,calc(100% - 24px))',maxHeight:'85vh',border:'1px solid var(--line)',color:'var(--ink)'}}>
    <form method="dialog"><button className="secondary">Close</button></form>
    <h2>Price alerts</h2>
    <div id="alerts-content">{account && (!account.email ? <>
      <p>Sign in or create an account to save a price alert.</p>
      <form onSubmit={event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const action = event.nativeEvent.submitter?.value === 'register' ? 'register' : 'login';
        void act(async () => { await request('/api/account/'+action,values); await load(); });
      }}>
        <p><label>Email <input name="email" type="email" autoComplete="username" required/></label></p>
        <p><label>Password <input name="password" type="password" minLength="10" maxLength="128" autoComplete="current-password" required/></label></p>
        <button value="login" disabled={busy}>Sign in</button> <button className="secondary" value="register" disabled={busy}>Create account</button>
      </form>
    </> : <>
      <p>{account.email} <button className="secondary" disabled={busy} onClick={() => act(async () => {
        await request('/api/account/logout',{}); await load();
      })}>Sign out</button></p>
      {offer && <form onSubmit={event => {
        event.preventDefault();
        const target = new FormData(event.currentTarget).get('target');
        void act(async () => {
          const {hit} = await request('/api/alerts',{store:offer.store,listing:offer.tracking_id,target});
          await load();
          setMessage(hit ? 'Target price already reached.' : 'Price alert saved.');
        });
      }}>
        <p>{offer.title} · {offer.store}</p>
        <p><label>Target price (₹) <input name="target" type="number" min="0.01" step="0.01" required/></label></p>
        <button disabled={busy}>Save alert</button>
      </form>}
      <p className="muted">Alerts appear here when a tracked price reaches your target.</p>
      {account.alerts.map(item => <div className="offer" key={item.id}><strong>{item.title}</strong>
        <p>{item.store} · Target {money(item.target)}</p>
        <p>{item.hit_day ? 'Target reached at '+money(item.hit_price)+' on '+item.hit_day : 'Tracking'}</p>
        <button className="secondary" disabled={busy} onClick={() => act(async () => {
          await request('/api/alerts/remove',{id:item.id}); await load();
        })}>Remove</button>
      </div>)}
    </>)}</div>
    <p id="alerts-status" role="status">{message}</p>
  </dialog>;
}
