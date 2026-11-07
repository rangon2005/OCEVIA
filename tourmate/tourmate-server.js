/*
 TourMate: offline nearby chat for travellers. No internet and no install needed, only Node.js.

 HOW TO USE
 1. One person runs this file on a laptop, or on an Android phone with Termux:  node tourmate-server.js
 2. That device turns on its Wi-Fi hotspot (or everyone joins the same Wi-Fi router). Internet is not needed.
 3. Everyone else connects to that hotspot, opens the address printed below in their browser, and joins.
    If no address is printed, look up the hotspot device's IP in its Wi-Fi settings and open http://IP:3000
 4. People on the same hotspot appear in the list. Tap a name for a private chat, or use Everyone nearby.

 LIMITS: range is the hotspot's Wi-Fi range. Messages are not encrypted and are lost when the server stops.
 Anyone who can join the hotspot can chat, so use a hotspot password.
*/
const http=require('http'),os=require('os');
const PORT=process.env.PORT||3000;
const users=new Map();
const send=(res,ev,d)=>res.write('event: '+ev+'\ndata: '+JSON.stringify(d)+'\n\n');
const bcast=()=>{const l=[...users].map(([id,u])=>({id,name:u.name,tag:u.tag}));users.forEach(u=>send(u.res,'users',l))};

const PAGE=String.raw`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TourMate</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.4 system-ui,sans-serif;background:#eaf4f3;color:#06283d;height:100vh;display:flex;flex-direction:column}
#join{max-width:420px;margin:12vh auto;padding:20px;display:grid;gap:10px}h1{margin:0}
input,button{padding:11px;border:1px solid #06283d;border-radius:8px;font:inherit}button{background:#06283d;color:#fff;cursor:pointer}
#app{flex:1;display:grid;grid-template-columns:240px 1fr;min-height:0}#side{overflow:auto;border-right:1px solid #cfe0de;padding:10px}
#ul button{display:block;width:100%;text-align:left;background:#fff;color:#06283d;border-color:#cfe0de;margin-top:6px;position:relative}
#ul button.on{border-color:#0e7c86;box-shadow:0 0 0 2px #0e7c86}#ul small{display:block;opacity:.7}
#ul span{position:absolute;right:8px;top:8px;background:#d1432f;color:#fff;border-radius:10px;padding:0 7px;font-size:12px}
#chat{display:flex;flex-direction:column;min-height:0}#hd{padding:10px;font-weight:700;border-bottom:1px solid #cfe0de}
#msgs{flex:1;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
.m{max-width:80%;background:#fff;border-radius:10px;padding:6px 10px;align-self:flex-start}.m.me{align-self:flex-end;background:#cdeee9}.m p{margin:0;overflow-wrap:anywhere}.m small{opacity:.65}
#f{display:flex;gap:6px;padding:10px;border-top:1px solid #cfe0de}#f input{flex:1}
@media(max-width:640px){#app{grid-template-columns:1fr;grid-template-rows:150px 1fr}#side{border-right:0;border-bottom:1px solid #cfe0de}}
</style></head><body>
<div id="join"><h1>TourMate</h1><p>Chat with travellers on this hotspot. No internet needed.</p>
<input id="nm" placeholder="Your name" maxlength="24"><input id="tg" placeholder="Where are you going? (optional)" maxlength="60"><button id="go">Join</button></div>
<div id="app" hidden><div id="side"><b>Nearby travellers</b> <small id="cnt"></small><div id="ul"></div><small id="st"></small></div>
<div id="chat"><div id="hd"></div><div id="msgs"></div><form id="f"><input id="tx" maxlength="500" placeholder="Type a message" autocomplete="off"><button>Send</button></form></div></div>
<script>
var $=function(i){return document.getElementById(i)};
var me=sessionStorage.getItem('tm');if(!me){me=Math.random().toString(36).slice(2,10);sessionStorage.setItem('tm',me)}
var users=[],conv={},cur='all',unread={};
function nameOf(id){if(id==='all')return 'Everyone nearby';for(var i=0;i<users.length;i++)if(users[i].id===id)return users[i].name;return 'Traveller (left)'}
function drawU(){
 var u=$('ul');u.textContent='';
 var items=[{id:'all',name:'Everyone nearby',tag:'Group chat'}].concat(users.filter(function(x){return x.id!==me}));
 items.forEach(function(x){
  var b=document.createElement('button');b.className=x.id===cur?'on':'';
  var n=document.createElement('b');n.textContent=x.name;var t=document.createElement('small');t.textContent=x.tag||'';
  b.appendChild(n);b.appendChild(t);
  if(unread[x.id]){var c=document.createElement('span');c.textContent=unread[x.id];b.appendChild(c)}
  b.onclick=function(){cur=x.id;unread[x.id]=0;drawU();drawM()};u.appendChild(b)});
 $('cnt').textContent='('+Math.max(0,users.length-1)+' nearby)';$('hd').textContent=nameOf(cur);
}
function drawM(){
 var m=$('msgs');m.textContent='';
 (conv[cur]||[]).forEach(function(x){
  var d=document.createElement('div');d.className='m'+(x.from===me?' me':'');
  var s=document.createElement('small');s.textContent=(x.from===me?'You':x.name)+' '+new Date(x.t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  var p=document.createElement('p');p.textContent=x.text;d.appendChild(s);d.appendChild(p);m.appendChild(d)});
 m.scrollTop=m.scrollHeight;$('hd').textContent=nameOf(cur);
}
$('go').onclick=function(){
 $('join').hidden=true;$('app').hidden=false;
 var es=new EventSource('/events?id='+me+'&name='+encodeURIComponent($('nm').value.trim()||'Traveller')+'&tag='+encodeURIComponent($('tg').value.trim()));
 es.onopen=function(){$('st').textContent='Connected'};es.onerror=function(){$('st').textContent='Reconnecting...'};
 es.addEventListener('users',function(e){users=JSON.parse(e.data);drawU()});
 es.addEventListener('msg',function(e){var m=JSON.parse(e.data);var k=m.to==='all'?'all':(m.from===me?m.to:m.from);
  (conv[k]=conv[k]||[]).push(m);if(k!==cur)unread[k]=(unread[k]||0)+1;drawU();if(k===cur)drawM()});
};
$('f').onsubmit=function(e){e.preventDefault();var v=$('tx').value.trim();if(!v)return;$('tx').value='';
 fetch('/send',{method:'POST',body:JSON.stringify({id:me,to:cur,text:v})})};
</script></body></html>`;

http.createServer((req,res)=>{
 const url=new URL(req.url,'http://x');
 if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,service:'ocevia-tourmate'}))}
 if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(PAGE)}
 if(url.pathname==='/events'){
  const id=(url.searchParams.get('id')||'').slice(0,16);
  if(!id){res.writeHead(400);return res.end()}
  const name=(url.searchParams.get('name')||'Traveller').slice(0,24),tag=(url.searchParams.get('tag')||'').slice(0,60);
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'});
  res.write(':ok\n\n');users.set(id,{name,tag,res});bcast();
  const ka=setInterval(()=>res.write(':ka\n\n'),20000);
  req.on('close',()=>{clearInterval(ka);const u=users.get(id);if(u&&u.res===res){users.delete(id);bcast()}});
  return;
 }
 if(url.pathname==='/send'&&req.method==='POST'){
  let b='';req.on('data',c=>{b+=c;if(b.length>4000)req.destroy()});
  req.on('end',()=>{try{
   const m=JSON.parse(b),u=users.get(m.id);if(!u||!m.text)throw 0;
   const msg={from:m.id,name:u.name,to:m.to||'all',text:String(m.text).slice(0,500),t:Date.now()};
   if(msg.to==='all')users.forEach(x=>send(x.res,'msg',msg));
   else{const t=users.get(msg.to);if(t)send(t.res,'msg',msg);send(u.res,'msg',msg)}
   res.writeHead(204);res.end();
  }catch(e){res.writeHead(400);res.end()}});
  return;
 }
 res.writeHead(404);res.end();
}).listen(PORT,'0.0.0.0',()=>{
 console.log('TourMate is running. Share one of these addresses with people on the same hotspot or Wi-Fi:');
 let found=false;
 try{for(const l of Object.values(os.networkInterfaces()))for(const a of l||[])if(a.family==='IPv4'&&!a.internal){found=true;console.log('  http://'+a.address+':'+PORT)}}catch(e){}
 if(!found)console.log('  Could not detect the address. Check this device\'s hotspot or Wi-Fi settings for its IP, then open http://IP:'+PORT);
});
