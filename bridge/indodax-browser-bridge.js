let cdpId=0;
function cdp(socket,method,params={}){
  return new Promise((resolve,reject)=>{
    const id=++cdpId;
    const timer=setTimeout(()=>{cleanup();reject(new Error("CDP timeout "+method));},15000);
    const cleanup=()=>{clearTimeout(timer);socket.removeEventListener("message",onMessage);socket.removeEventListener("close",onClose);};
    const onClose=()=>{cleanup();reject(new Error("CDP closed "+method));};
    const onMessage=(event)=>{let msg;try{msg=JSON.parse(event.data);}catch{return;}if(msg.id!==id)return;cleanup();if(msg.error)reject(new Error(msg.error.message||"CDP error"));else resolve(msg.result);};
    socket.addEventListener("message",onMessage);socket.addEventListener("close",onClose);socket.send(JSON.stringify({id,method,params}));
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const cleanSymbols=(u)=>{
  const raw=u.searchParams.get("symbols")||u.searchParams.get("symbol")||"BTCUSDT,ETHUSDT";
  return [...new Set(raw.split(",").map(x=>x.trim().toUpperCase().replace(/[^A-Z0-9]/g,"")).filter(Boolean))].slice(0,2);
};
addEventListener("fetch",event=>event.respondWith((async()=>{
  const u=new URL(event.request.url);
  if(u.pathname==="/health") return new Response(JSON.stringify({ok:true,service:"kai-trad-indodax-bridge",mode:"browser-cdp-batch",maxSymbols:2}),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  if(u.pathname!=="/batch"&&u.pathname!=="/snapshot") return new Response("Not found",{status:404});
  const symbols=cleanSymbols(u);
  const now=Math.floor(Date.now()/1000);
  const mainFrom=now-(200+24)*15*60;
  const fastFrom=now-(200*5+24)*60;
  let session=null,socket=null;
  const started=Date.now();
  try{
    const launched=await BROWSER.launch({keepAlive:20000,targets:true});
    session=launched.sessionId;
    let target=(launched.targets||[]).find(x=>x.type==="page");
    if(!target) target=await BROWSER.devtools.newTarget(session,"about:blank");
    const connection=await BROWSER.connectSession(session,{targetId:target.id});
    const response=await connection.webSocket.fetch("https://browser-binding.invalid",{headers:{Upgrade:"websocket"}});
    if(!response.webSocket) throw new Error("Browser Run page websocket unavailable");
    socket=response.webSocket;socket.accept();
    await cdp(socket,"Page.enable");
    await cdp(socket,"Runtime.enable");
    await cdp(socket,"Page.navigate",{url:"https://indodax.com/api/server_time"});
    await sleep(500);
    const cfg={symbols,now,mainFrom,fastFrom};
    const expression="(async()=>{const cfg="+JSON.stringify(cfg)+";const fetchJson=async url=>{const r=await fetch(url,{credentials:'omit',cache:'no-store'});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=text}return {status:r.status,body}};const pairsRes=await fetchJson('https://indodax.com/api/pairs');if(pairsRes.status!==200||!Array.isArray(pairsRes.body))return {pairsStatus:pairsRes.status,symbols:{},error:'pairs unavailable'};const out={};await Promise.all(cfg.symbols.map(async symbol=>{const pair=pairsRes.body.find(p=>String(p.symbol||'').toUpperCase()===symbol);if(!pair){out[symbol]={supported:false,error:'pair unavailable'};return}const base='https://indodax.com';const [ticker,main,fast]=await Promise.all([fetchJson(base+'/api/ticker/'+encodeURIComponent(pair.id)),fetchJson(base+'/tradingview/history_v2?from='+cfg.mainFrom+'&to='+cfg.now+'&tf=15&symbol='+encodeURIComponent(pair.symbol)),fetchJson(base+'/tradingview/history_v2?from='+cfg.fastFrom+'&to='+cfg.now+'&tf=1&symbol='+encodeURIComponent(pair.symbol))]);out[symbol]={supported:true,pair:{id:pair.id,symbol:pair.symbol,ticker_id:pair.ticker_id,trade_min_base_currency:pair.trade_min_base_currency,is_maintenance:pair.is_maintenance,is_market_suspended:pair.is_market_suspended},ticker,main,fast};}));return {pairsStatus:pairsRes.status,symbols:out};})()";
    const result=await cdp(socket,"Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
    const value=result?.result?.value;
    if(!value||typeof value!=="object") throw new Error("Browser bridge returned empty payload");
    if(u.searchParams.get("summary")==="1"){
      const compact={};
      for(const [sym,row] of Object.entries(value.symbols||{})){
        compact[sym]={supported:row.supported,pair:row.pair||null,tickerStatus:row.ticker?.status||0,mainStatus:row.main?.status||0,fastStatus:row.fast?.status||0,mainRows:Array.isArray(row.main?.body)?row.main.body.length:0,fastRows:Array.isArray(row.fast?.body)?row.fast.body.length:0,last:row.ticker?.body?.ticker?.last||null,bid:row.ticker?.body?.ticker?.buy||null,ask:row.ticker?.body?.ticker?.sell||null,error:row.error||null};
      }
      return new Response(JSON.stringify({ok:true,at:new Date().toISOString(),durationMs:Date.now()-started,pairsStatus:value.pairsStatus,symbols:compact}),{headers:{"content-type":"application/json","cache-control":"no-store"}});
    }
    return new Response(JSON.stringify({ok:true,at:new Date().toISOString(),durationMs:Date.now()-started,...value}),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  }catch(e){
    return new Response(JSON.stringify({ok:false,at:new Date().toISOString(),durationMs:Date.now()-started,error:String(e&&e.message||e)}),{status:502,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }finally{
    try{if(socket)socket.close();}catch{}
    try{if(session)await BROWSER.closeSession(session);}catch{}
  }
})()));
