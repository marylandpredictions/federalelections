/* Same-origin, read-only presentation window. This is not AirPlay mirroring.
   Only rendered public board content is sent; no application/runtime storage. */
(function(root){
  const MAX_BYTES=6000000,SESSION=/^[a-f0-9]{32}$/;
  function validFrame(x){return !!x&&x.type==='frame'&&Number.isSafeInteger(x.sequence)&&x.sequence>0&&typeof x.html==='string'&&x.html.length<=MAX_BYTES&&typeof x.bodyClass==='string'&&x.bodyClass.length<500&&typeof x.bodyStyle==='string'&&x.bodyStyle.length<20000&&Array.isArray(x.styles)&&x.styles.length<30;}
  const api={validFrame,MAX_BYTES};if(typeof module!=='undefined')module.exports=api;
  if(typeof document==='undefined')return;
  const receiver=location.pathname==='/clean-display'||location.pathname==='/clean-display.html';
  const session=new URLSearchParams(location.search).get('session');
  let heartbeat,watchdog,lastReceiver=0,lastHeard=Date.now(),channel,observer,timer=0,last='',sequence=0,pending,frame=0,received=0;
  function feedback(text){let p=document.getElementById('clean-display-feedback');if(!p){p=document.createElement('p');p.id='clean-display-feedback';p.setAttribute('role','status');document.getElementById('board-menu')?.append(p);}p.textContent=text;}
  function scrub(tree){
    tree.querySelectorAll('script,iframe,object,embed,base,meta,link,style,dialog,#board-menu,.desk-appearance,#clean-display-feedback').forEach(n=>n.remove());
    for(const n of tree.querySelectorAll('*'))for(const a of [...n.attributes]){
      if(/^on/i.test(a.name)||['srcdoc','autofocus','contenteditable'].includes(a.name))n.removeAttribute(a.name);
      if(['href','src','xlink:href','action','formaction'].includes(a.name)&&!a.value.startsWith('#')){
        try{const u=new URL(a.value,location.origin);if(u.origin!==location.origin||!['http:','https:'].includes(u.protocol))n.removeAttribute(a.name);else n.setAttribute(a.name,u.href);}catch{n.removeAttribute(a.name);}
      }
    }
    return tree;
  }
  function capture(){
    timer=0;if(!channel||Date.now()-lastReceiver>20000)return;
    const copy=document.body.cloneNode(true);
    const originals=document.body.querySelectorAll('*'),copies=copy.querySelectorAll('*');
    for(let i=0;i<originals.length;i++)if(originals[i].scrollTop||originals[i].scrollLeft){copies[i].setAttribute('data-display-scroll',originals[i].scrollLeft+','+originals[i].scrollTop);}
    scrub(copy);
    const html=copy.innerHTML;if(html.length>MAX_BYTES){feedback('This view is too large to send. Close extra detail and try again.');return;}
    const styles=[...document.querySelectorAll('link[rel="stylesheet"]')].map(n=>new URL(n.href,location.href)).filter(u=>u.origin===location.origin&&u.pathname.startsWith('/assets/')).map(u=>u.href);
    const data={html,bodyClass:document.body.className,bodyStyle:document.body.getAttribute('style')||'',presentation:document.body.dataset.presentation||'',theme:document.documentElement.dataset.theme||'',styles};
    const signature=JSON.stringify(data);if(signature===last)return;last=signature;
    channel.postMessage({...data,type:'frame',sequence:++sequence});
  }
  function schedule(){if(!timer)timer=setTimeout(capture,350);}
  function open(){
    if(!root.BroadcastChannel){feedback('Separate display windows are unavailable in this browser.');return;}
    if(!channel){const bytes=crypto.getRandomValues(new Uint8Array(16)),id=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');channel=new BroadcastChannel('fea-display-'+id);channel.displayId=id;channel.onmessage=e=>{if(['hello','ready'].includes(e.data?.type))lastReceiver=Date.now();if(e.data?.type==='hello'){last='';capture();}};
      heartbeat=setInterval(()=>channel?.postMessage({type:'alive'}),5000);
      observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,attributes:true,childList:true,characterData:true});
      document.addEventListener('scroll',schedule,true);
    }
    const display=root.open('/clean-display?session='+channel.displayId,'fea-clean-'+channel.displayId);
    if(!display){feedback('Allow this site to open a window, then choose Open clean display again.');return;}
    feedback('Clean display opened. Move that window to your second screen. AirPlay mirroring still shows the same screen.');capture();
  }
  // Patch existing nodes instead of replacing the whole board: projection cards
  // retain their animation lifecycle and the SVG tree stays bounded.
  function patch(target,source,attributes=true){
    if(attributes){
    for(const a of [...target.attributes])if(!source.hasAttribute(a.name))target.removeAttribute(a.name);
    for(const a of source.attributes)if(target.getAttribute(a.name)!==a.value)target.setAttribute(a.name,a.value);
    }
    for(let i=0;i<source.childNodes.length;i++){
      const next=source.childNodes[i],old=target.childNodes[i];
      if(!old){target.append(next.cloneNode(true));continue;}
      if(old.nodeType!==next.nodeType||old.nodeName!==next.nodeName||(old.id||'')!==(next.id||'')){target.replaceChild(next.cloneNode(true),old);continue;}
      if(next.nodeType===1)patch(old,next);else if(old.nodeValue!==next.nodeValue)old.nodeValue=next.nodeValue;
    }
    while(target.childNodes.length>source.childNodes.length)target.lastChild.remove();
  }
  function alignInk(){
    const ink=document.getElementById('maker-ink'),source=document.querySelector('#maker-detail-map:not([hidden]) svg')||document.querySelector('#maker-map:not([hidden]) svg');
    if(!ink||!source)return;const r=source.getBoundingClientRect(),p=ink.parentElement.getBoundingClientRect();Object.assign(ink.style,{left:r.left-p.left+'px',top:r.top-p.top+'px',width:r.width+'px',height:r.height+'px'});
  }
  function paint(){
    frame=0;const x=pending;pending=null;if(!x)return;
    const doc=new DOMParser().parseFromString(x.html,'text/html'),safe=scrub(doc.body);
    document.body.className=x.bodyClass;document.body.setAttribute('style',x.bodyStyle);document.body.dataset.presentation=['standard','broadcast','editorial','contrast','studio'].includes(x.presentation)?x.presentation:'standard';document.documentElement.dataset.theme=x.theme==='light'?'light':'dark';
    patch(document.getElementById('clean-display-content'),safe,false);
    for(const href of x.styles){try{const u=new URL(href);if(u.origin!==location.origin||!u.pathname.startsWith('/assets/')||!u.pathname.endsWith('.css'))continue;if(![...document.querySelectorAll('link')].some(n=>n.href===u.href)){const link=document.createElement('link');link.rel='stylesheet';link.href=u.href;document.head.insertBefore(link,document.getElementById('clean-display-style'));}}catch{}}
    document.getElementById('clean-display-wait').hidden=true;
    for(const n of document.querySelectorAll('[data-display-scroll]')){const [left,top]=n.dataset.displayScroll.split(',').map(Number);if(Number.isFinite(top)&&Number.isFinite(left)){n.scrollTop=top;n.scrollLeft=left;}}
    requestAnimationFrame(alignInk);
  }
  if(receiver){
    document.documentElement.dataset.cleanDisplay='';
    if(!SESSION.test(session||'')||!root.BroadcastChannel){document.getElementById('clean-display-wait').textContent='Open a clean display from the map maker or results menu in the same browser.';return;}
    channel=new BroadcastChannel('fea-display-'+session);
    channel.onmessage=e=>{const x=e.data;if(x?.type==='alive')channel.postMessage({type:'ready'});if(x?.type==='alive'||validFrame(x)){lastHeard=Date.now();document.getElementById('clean-display-health').hidden=true;}if(!validFrame(x)||x.sequence<=received)return;received=x.sequence;pending=x;if(!frame)frame=requestAnimationFrame(paint);};
    channel.postMessage({type:'hello'});root.addEventListener('resize',alignInk);
    watchdog=setInterval(()=>{if(Date.now()-lastHeard>25000)document.getElementById('clean-display-health').hidden=false;},5000);
    // No public feed polling here. Retain the last received frame if sender closes.
  }else{
    const menu=document.getElementById('board-menu');if(!menu)return;
    const button=document.createElement('button');button.type='button';button.textContent='Open clean display';button.id='open-clean-display';button.onclick=open;menu.append(button);
  }
  root.addEventListener('pagehide',e=>{if(e.persisted)return;observer?.disconnect();clearTimeout(timer);clearInterval(heartbeat);clearInterval(watchdog);if(frame)cancelAnimationFrame(frame);channel?.close();});
})(globalThis);
