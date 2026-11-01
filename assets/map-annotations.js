/* Session-only ink. Separate from election/scenario data and anchored to the
   map's SVG coordinate system, so marks follow its pan and zoom. */
(function(root){
  const hex=/^#[0-9a-f]{6}$/i;
  class InkStore {
    constructor(){this.strokes=[];this.version=0;}
    add(scope,color,width,points){
      if(typeof scope!=='string'||!scope||scope.length>80||!hex.test(color)||!Number.isFinite(width)||width<1||width>12||!Array.isArray(points)||!points.length||points.length>1500||points.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e7)))throw Error('Invalid drawing stroke');
      this.strokes.push({scope,color,width,points:points.map(p=>[...p])});if(this.strokes.length>100)this.strokes.shift();this.version++;
    }
    forScope(scope){return this.strokes.filter(s=>s.scope===scope);}
    undo(scope){for(let i=this.strokes.length-1;i>=0;i--)if(this.strokes[i].scope===scope){this.strokes.splice(i,1);this.version++;return true;}return false;}
    clear(scope){this.strokes=this.strokes.filter(s=>s.scope!==scope);this.version++;}
  }
  function pathData(points){return points.length?'M'+points.map(p=>p.map(n=>Math.round(n*100)/100).join(',')).join('L')+(points.length===1?'l.01,.01':''):'';}
  function create({getScope}){
    const $=id=>document.getElementById(id),svg=$('maker-ink'),ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g'),committed=document.createElementNS(ns,'g'),store=new InkStore();group.append(committed);svg.append(group);
    let enabled=false,source=null,layer=null,scope='',pending=null,frame=0,paintedVersion=-1,paintedScope='',preview=null;
    const background=getComputedStyle(document.body).getPropertyValue('--map-bg').trim();
    if(root.FEADeskTheme&&hex.test(background)&&root.FEADeskTheme.contrast($('maker-ink-color').value,background)<2)$('maker-ink-color').value=root.FEADeskTheme.foreground(background);
    const blocked=[$('maker-map'),$('maker-detail-map'),$('focused-race-panel'),document.querySelector('.maker-tools'),document.querySelector('.board-top-controls')];
    function path(stroke){const node=document.createElementNS(ns,'path');node.setAttribute('d',pathData(stroke.points));node.setAttribute('stroke',stroke.color);node.setAttribute('stroke-width',stroke.width);node.setAttribute('fill','none');node.setAttribute('stroke-linecap','round');node.setAttribute('stroke-linejoin','round');node.setAttribute('vector-effect','non-scaling-stroke');return node;}
    function render(){
      if(frame)cancelAnimationFrame(frame);frame=0;const strokes=store.forScope(scope);
      // Existing strokes remain untouched during pointer movement. Only the
      // single preview path changes, once per animation frame.
      if(paintedVersion!==store.version||paintedScope!==scope){committed.replaceChildren(...strokes.map(path));paintedVersion=store.version;paintedScope=scope;}
      if(pending){if(!preview){preview=path(pending);group.append(preview);}preview.setAttribute('d',pathData(pending.points));}else if(preview){preview.remove();preview=null;}
      svg.toggleAttribute('hidden',!enabled&&!strokes.length);$('maker-ink-undo').disabled=!strokes.length;
    }
    function align(){if(!source||!layer)return;const rect=source.getBoundingClientRect(),parent=svg.parentElement.getBoundingClientRect();Object.assign(svg.style,{left:rect.left-parent.left+'px',top:rect.top-parent.top+'px',width:rect.width+'px',height:rect.height+'px'});svg.setAttribute('viewBox',source.getAttribute('viewBox'));svg.setAttribute('preserveAspectRatio',source.getAttribute('preserveAspectRatio')||'xMidYMid meet');group.setAttribute('transform',layer.getAttribute('transform')||'');}
    const changes=new MutationObserver(align),resize=new ResizeObserver(align);resize.observe(svg.parentElement);
    function sync(){
      const next=document.querySelector('#maker-detail-map:not([hidden]) svg')||document.querySelector('#maker-map:not([hidden]) svg');
      const nextLayer=next?.querySelector('.prediction-shape-layer')||next?.querySelector('g'),nextScope=String(getScope()||'');
      if(next!==source||nextScope!==scope){if(enabled)setEnabled(false);pending=null;changes.disconnect();source=next;layer=nextLayer;scope=nextScope;if(layer)changes.observe(layer,{attributes:true,attributeFilter:['transform']});render();}
      if(source&&layer)align();return !!(source&&layer);
    }
    function setEnabled(value){
      if(value&&!sync()){$('maker-status').textContent='Wait for the map to finish loading before drawing.';return;}
      enabled=!!value;pending=null;document.body.classList.toggle('is-drawing',enabled);svg.classList.toggle('is-drawing',enabled);
      for(const node of blocked)if(node)node.inert=enabled;
      $('maker-menu-button').disabled=enabled;$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');
      $('maker-draw-button').setAttribute('aria-pressed',String(enabled));$('maker-draw-button').setAttribute('aria-label',enabled?'Stop drawing and resume map':'Draw on map');$('maker-draw-tools').hidden=!enabled;render();
    }
    function addPoint(e){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(pending.inverse),last=pending.lastClient;if(!last||Math.hypot(e.clientX-last[0],e.clientY-last[1])>1.5){if(pending.points.length<1500)pending.points.push([p.x,p.y]);else pending.points[pending.points.length-1]=[p.x,p.y];pending.lastClient=[e.clientX,e.clientY];}if(!frame)frame=requestAnimationFrame(render);}
    svg.addEventListener('pointerdown',e=>{if(!enabled||e.button!==0||pending)return;const matrix=layer?.getScreenCTM();if(!matrix)return;e.preventDefault();e.stopPropagation();svg.setPointerCapture(e.pointerId);pending={pointer:e.pointerId,color:$('maker-ink-color').value,width:Number($('maker-ink-width').value),points:[],inverse:matrix.inverse()};addPoint(e);});
    svg.addEventListener('pointermove',e=>{if(pending?.pointer===e.pointerId){e.preventDefault();addPoint(e);}});
    svg.addEventListener('pointerup',e=>{if(pending?.pointer!==e.pointerId)return;addPoint(e);if(pending.points.length)store.add(scope,pending.color,pending.width,pending.points);pending=null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);render();});
    svg.addEventListener('pointercancel',e=>{if(pending?.pointer===e.pointerId){pending=null;render();}});
    $('maker-draw-button').onclick=()=>setEnabled(!enabled);$('maker-ink-done').onclick=()=>setEnabled(false);
    document.querySelectorAll('[data-ink-color]').forEach(b=>b.onclick=()=>{$('maker-ink-color').value=b.dataset.inkColor;});
    $('maker-ink-undo').onclick=()=>{store.undo(scope);render();};$('maker-ink-clear').onclick=()=>{store.clear(scope);render();};
    document.addEventListener('keydown',e=>{if(!enabled)return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setEnabled(false);}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select')){e.preventDefault();e.stopImmediatePropagation();store.undo(scope);render();}},true);
    function appendTo(target,requestedScope){const g=document.createElementNS(ns,'g');for(const s of store.forScope(requestedScope))g.append(path(s));target.append(g);}
    return {sync,setEnabled,appendTo,get enabled(){return enabled;},get count(){return store.forScope(scope).length;}};
  }
  const api={InkStore,pathData,create};root.FEAMapInk=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
