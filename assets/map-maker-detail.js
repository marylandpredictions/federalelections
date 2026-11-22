/* Optional, static-data-only race explorer. No live-result or call endpoints. */
(function(root){
  function unitId(feature){
    const p=feature.properties||{};
    if(p.unitId)return String(p.unitId);
    if(p.ward!=null||p.WARD!=null||p.ward_id!=null){
      const n=String(p.ward??p.WARD??p.ward_id).replace(/\D/g,'');
      return `ward-${n.padStart(2,'0')}`;
    }
    if(p.TRACTCE||(p.kind==='tract'&&p.name)){
      const n=String(p.TRACTCE||String(p.name).replace(/\D/g,'')).padStart(6,'0');
      return `tract-${n}`;
    }
    for(const key of ['DISTRICT','District','district','district_num','COUNCIL']){
      if(p[key]!=null&&String(p[key]).trim()!==''){
        const n=String(p[key]).replace(/\D/g,'')||String(p[key]);
        return `district-${String(n).padStart(2,'0')}`;
      }
    }
    if(p.localType==='municipality')return String(p.localId||p.GEOID||'');
    return String(p.countyFips||(p.STATEFP&&p.COUNTYFP?String(p.STATEFP).padStart(2,'0')+String(p.COUNTYFP).padStart(3,'0'):p.GEOID||feature.id||''));
  }
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=source=>source.id.startsWith('pres-')?source.id.slice(5)+' President':source.id==='house-2024'?'2024 House':source.id==='senate-last'?'Previous Senate election':'Previous governor election';
  const unitPattern=/^(\d{5}(\d{5})?|ward-\d{2}|district-\d{2}|tract-\d{6})$/;

  function create({model,brush,edited,title,onContext=()=>{},outlineMode=false,getMap=()=>null,mayorHistory=null,nextRating=null,cycleId='2026'}){
    const paintValue=(current)=>{
      if(typeof nextRating==='function')return nextRating(current);
      return brush();
    };
    const $=id=>document.getElementById(id),panel=$('focused-race-panel'),cache=new Map(),datasets=new Map();
    let race,unit='',features=[],sources=[],active='ratings',sequence=0,geography,manifest,countyData,districtData,roster=[],contextStates=[],mayorPast=null,detailHoverRing=null;
    function announce(message){
      const status=$('maker-status');
      if(status&&message)status.textContent=message;
    }
    async function json(file){
      if(!file)throw Error('Data unavailable');
      if(!cache.has(file)){
        if(cache.size>24)cache.delete(cache.keys().next().value);
        const url='/'+file.replace(/^\//,'');
        cache.set(file,fetch(url).then(async r=>{
          if(!r.ok)throw Error('Data unavailable');
          if(String(url).includes('.json.gz')&&typeof DecompressionStream==='function'){
            const buffer=new Uint8Array(await r.clone().arrayBuffer());
            if(buffer.length>=2&&buffer[0]===0x1f&&buffer[1]===0x8b){
              return await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
            }
          }
          return r.json();
        }).catch(e=>{cache.delete(file);throw e;}));
      }
      return cache.get(file);
    }
    const snapshot=(source,id=unit)=>{
      // Mayoral wards/districts/tracts are not county FIPS; use statewide presidential.
      const lookup=race?.type==='mayor'?null:(id||null);
      return FEAResultsUI.historicalSnapshot(race,source,datasets,lookup);
    };

    function subdivisionLabel(){
      if(!race)return 'Geography';
      if(race.detailMode==='wards'||race.subdivisionKind==='wards')return 'Wards';
      if(race.detailMode==='tracts'||race.subdivisionKind==='tracts')return 'Tracts';
      if(race.type==='mayor')return 'Districts';
      return 'Counties';
    }

    function color(f){
      if(active!=='history')return FeaPredictionMaps.colors[model.rating(race.id+'@'+unitId(f))];
      const s=sources.find(s=>s.id===$('maker-history-source').value),row=s&&snapshot(s,unitId(f));
      if(!row)return FEADeskTheme.resolved.tokens['map-neutral'];
      const party=row.margin>=0?'D':'R',base=FEADeskTheme.candidateColor({party});
      return FEADeskTheme.mix(base,FEADeskTheme.resolved.tokens['panel-bg'],Math.max(0,.65-Math.abs(row.margin)/40));
    }

    function unitRating(f){
      if(active==='history')return 'Past election';
      return model.rating(race.id+'@'+unitId(f));
    }

    function partyChrome(rating){
      const normalized=FeaPredictionMaps?.normalizeRating?.(rating)||rating||'Tossup';
      const partyRaw=FeaPredictionMaps?.ratingParty?.(normalized)||'Tossup';
      const party=partyRaw==='Tossup'?'T':partyRaw;
      // Bright brand colors for panel chrome (dark rating shades disappear on YAPms/night).
      // Tossup stays cool steel — not gold (reads like a warning outline).
      const brand={D:'#3d6fd8',R:'#d14848',I:'#8a5fd4',T:'#8e9bb3'}[party];
      const brandInk=party==='T'?'#101828':'#ffffff';
      const ratingFill=party==='T'?brand:(FeaPredictionMaps?.colors?.[normalized]||brand);
      const label={D:'Democratic',R:'Republican',I:'Independent',T:'Tossup'}[party];
      return {party,brand,brandInk,accent:ratingFill,ink:brandInk,label,normalized};
    }

    function refresh(){
      if(!race||panel.hidden)return;
      for(const path of $('maker-county-map').querySelectorAll('[data-unit]')){
        const f=features.find(f=>unitId(f)===path.dataset.unit);
        const fill=color(f)||FeaPredictionMaps.colors.Tossup||'#cbcacd';
        // Keep attr + inline style in sync — .style('fill') from bind otherwise wins and freezes rating/neutral gray on Past elections.
        path.setAttribute('fill',fill);
        path.style.fill=fill;
        path.classList.toggle('is-selected',path.dataset.unit===unit);
        path.setAttribute('aria-label',`${path.dataset.name}: ${active==='history'?'past election':model.rating(race.id+'@'+path.dataset.unit)}`);
      }
      const selectedPath=unit?$('maker-county-map').querySelector(`[data-unit="${CSS.escape(unit)}"]`):null;
      detailHoverRing?.sync(selectedPath||null);
      const f=features.find(f=>unitId(f)===unit),name=f?(f.properties.countyName||f.properties.NAME||f.properties.name||unit):title(race);
      $('maker-detail-location').textContent=name;
      $('focused-race-title').textContent=unit?name:title(race);
      const raceRating=model.rating(race.id);
      const chrome=partyChrome(raceRating);
      // Panel chrome uses bright party brand — rating shade is too dark on YAPms/night.
      panel.style.setProperty('--maker-detail-accent',chrome.brand);
      panel.style.setProperty('--maker-detail-accent-ink',chrome.brandInk);
      panel.dataset.rating=chrome.normalized;
      panel.dataset.party=chrome.party;
      const detailMap=$('maker-detail-map');
      if(detailMap){
        detailMap.style.setProperty('--maker-detail-accent',chrome.brand);
        detailMap.dataset.party=chrome.party;
      }
      const partyPill=$('maker-party-pill')||panel.querySelector('.focused-card-head .focused-pill:not(#focused-race-rating)');
      if(partyPill){
        partyPill.textContent=chrome.label;
        partyPill.dataset.party=chrome.party;
        partyPill.style.background='#ffffff';
        partyPill.style.color=chrome.brand;
        partyPill.style.borderColor='#ffffff';
      }
      const ratingPill=$('focused-race-rating');
      if(ratingPill){
        ratingPill.textContent=`Your rating · ${chrome.normalized}`;
        ratingPill.dataset.party=chrome.party;
        ratingPill.style.background='color-mix(in srgb,#fff 22%,transparent)';
        ratingPill.style.color='#ffffff';
        ratingPill.style.borderColor='color-mix(in srgb,#fff 45%,transparent)';
        ratingPill.style.setProperty('--maker-detail-accent',chrome.brand);
        ratingPill.style.setProperty('--maker-detail-accent-ink',chrome.brandInk);
      }
      if($('maker-race-rating'))$('maker-race-rating').value=chrome.normalized;
      $('maker-detail-rating').textContent=unit?`Your rating: ${model.rating(race.id+'@'+unit)}`:`Select a ${subdivisionLabel().slice(0,-1).toLowerCase()} to rate it or inspect its history.`;
      $('maker-county-apply').disabled=!unit;
      $('maker-county-undo').disabled=!model.past.length;$('maker-county-redo').disabled=!model.future.length;
      if(active==='history')history();if(active==='demographics')demographics();
      if(active==='counties'){
        const list=$('maker-counties-list'),scroll=list.scrollTop;
        list.innerHTML=features.map(f=>{
          const id=unitId(f);
          const rating=model.rating(race.id+'@'+id);
          const unitChrome=partyChrome(rating);
          return `<button type="button" data-select-unit="${id}" data-party="${unitChrome.party}" aria-pressed="${unit===id}" style="--unit-rating:${unitChrome.accent}"><span>${esc(f.properties.countyName||f.properties.NAME||f.properties.name||id)}</span><strong>${esc(rating.replace(' Democratic',' D').replace(' Republican',' R').replace(' Independent',' I'))}</strong></button>`;
        }).join('');
        list.scrollTop=scroll;
      }
      renderMayorPast();
      onContext();
    }

    function renderMayorPast(){
      const host=$('maker-detail-mayor-past');
      if(!host)return;
      if(race?.type!=='mayor'||!mayorPast){host.hidden=true;host.innerHTML='';return;}
      host.hidden=false;
      const margin=mayorPast.margin==null?'—':`${Math.abs(mayorPast.margin).toFixed(1)} pt`;
      host.innerHTML=`<div class="maker-mayor-past"><small>Last mayoral</small><strong>${esc(mayorPast.year)} · ${esc(mayorPast.winner)} (${esc(mayorPast.party)})</strong><span>Margin ${esc(margin)}</span>${mayorPast.note?`<p>${esc(mayorPast.note)}</p>`:''}</div>`;
    }

    function history(){
      const source=sources.find(s=>s.id===$('maker-history-source').value),row=source&&snapshot(source);
      const mayorCard=race.type==='mayor'&&mayorPast
        ?`<div class="maker-mayor-past"><small>Last mayoral</small><strong>${esc(mayorPast.year)} · ${esc(mayorPast.winner)} (${esc(mayorPast.party)})</strong><span>Margin ${mayorPast.margin==null?'—':`${Math.abs(mayorPast.margin).toFixed(1)} pt`}</span>${mayorPast.note?`<p>${esc(mayorPast.note)}</p>`:''}</div>`
        :'';
      const contextNote=race.type==='mayor'
        ?'Statewide presidential returns for this city’s state — not prior mayoral maps or ward-level votes.'
        :race.type==='president'
          ?'Statewide presidential returns for this state.'
          :`Published historical returns. Blank means no verified result for these boundaries.${race.type==='house'&&unit?' Whole-county reference, not the district portion.':''}`;
      $('maker-detail-history').innerHTML=`${mayorCard}<section id="desk-past-margins"><header class="comparison-heading"><div><small>PAST ELECTIONS</small><strong>${esc(race.type==='mayor'?`${race.state} President`:$('maker-detail-location').textContent)}</strong></div></header><div class="comparison-workspace"><div class="comparison-matrix" style="--comparison-columns:1">${source?FEAResultsUI.comparisonColumn(row?.year||source.id.match(/20\d{2}/)?.[0]||'Last',row?.label||label(source),row,FEADeskTheme):'<p class="desk-hint">No verified historical result.</p>'}</div><nav class="comparison-rail" aria-label="Historical map election">${sources.map(s=>`<button type="button" data-maker-history="${esc(s.id)}" aria-pressed="${source?.id===s.id}">${esc(s.id.match(/20\d{2}/)?.[0]||'Last')}<span>${s.id.startsWith('pres-')?'PRES':race.type.toUpperCase()}</span></button>`).join('')}</nav></div><p class="comparison-context">${esc(contextNote)}</p></section>`;
    }

    async function demographics(){
      const token=sequence,selected=unit;$('maker-detail-demographics').textContent='Loading Census estimates…';
      try{
        manifest||=await json('data/results/demographics.json');countyData||=await json(manifest.file);
        if(race.type==='house'&&!selected)districtData||=await json(manifest.districtFile);
        if(token!==sequence||selected!==unit||active!=='demographics')return;
        const district=race.type==='house'&&!selected;
        const countyRow=selected&&countyData.counties?.[selected];
        const row=countyRow||(district?districtData.districts?.[FEAResultsUI.districtId(race)]:null)||countyData.states?.[FEAScenario.stateFips[race.state]];
        if(!row){$('maker-detail-demographics').textContent='No Census profile for this reporting unit. Choose Race-wide for the available state or district profile.';return;}
        const usingStateFallback=!!selected&&!countyRow&&!district;
        $('maker-detail-demographics').innerHTML=(usingStateFallback?`<p class="desk-hint">Showing statewide Census profile — ${subdivisionLabel().slice(0,-1).toLowerCase()}-level estimates are not available.</p>`:'')+FEAResultsUI.demographicProfile(row,{district,house:race.type==='house',county:!!countyRow});
      }catch{if(token===sequence)$('maker-detail-demographics').textContent='Census data could not load. Select this tab again to retry.';}
    }

    function tab(value){
      active=value;
      for(const b of panel.querySelectorAll('[data-detail-tab]'))b.setAttribute('aria-selected',String(b.dataset.detailTab===value));
      for(const section of panel.querySelectorAll('[data-detail-content]'))section.hidden=section.dataset.detailContent!==value;
      panel.querySelector('.maker-detail-actions').hidden=!['ratings','counties'].includes(value);
      $('maker-detail-note').hidden=!!race&&race.type!=='house'&&['history','demographics'].includes(value);
      refresh();
    }

    function enterDedicatedMap(){
      getMap()?.clearSubdivisionOverlay?.();
      getMap()?.setFocusDim?.(false);
      getMap()?.reset?.();
      $('maker-map').hidden=true;
      const board=$('maker-mayor-board');if(board)board.hidden=true;
      $('maker-detail-map').hidden=false;
      document.body.classList.add('maker-detail-open');
      document.body.classList.remove('has-focused-race');
      if(race?.type==='mayor')document.body.classList.add('maker-city-focus');
      else document.body.classList.remove('maker-city-focus');
    }

    function drawLocked(collection,{boundary=null}={}){
      const rewind=geometry=>{
        if(!geometry?.type)return geometry;
        const polygon=rings=>d3.geoArea({type:'Polygon',coordinates:rings})>Math.PI*2?rings.map(r=>[...r].reverse()):rings;
        return geometry.type==='Polygon'?{...geometry,coordinates:polygon(geometry.coordinates)}:geometry.type==='MultiPolygon'?{...geometry,coordinates:geometry.coordinates.map(polygon)}:geometry;
      };
      features=(collection.features||[])
        .filter(f=>f?.geometry?.type&&unitPattern.test(unitId(f)))
        .map(f=>({...f,geometry:rewind(f.geometry)}));
      $('maker-county-map').replaceChildren();
      const label=race?.type==='mayor'?`${subdivisionLabel()} map`:'County ratings and historical map';
      const svg=d3.select($('maker-county-map')).append('svg').attr('viewBox','0 0 900 620').attr('role','group').attr('aria-label',label).attr('class','election-map-svg maker-detail-svg'),g=svg.append('g').attr('class','election-map-viewport');
      const region=$('maker-county-map').getBoundingClientRect(),card=panel.getBoundingClientRect(),left=region.width&&card.top<region.top+70?Math.min(650,(card.width+48)/region.width*900):48;
      const fitSource=features.length?{type:'FeatureCollection',features}:boundary?.geometry?{type:'FeatureCollection',features:[boundary]}:{type:'FeatureCollection',features:[]};
      if(!fitSource.features.length){
        $('maker-detail-note').textContent=race?.type==='mayor'
          ?'City geography could not load. You can still set candidates and a winner under Results.'
          :'Geography could not load. You can still set candidates and a winner under Results.';
        refresh();
        return;
      }
      const cityFocus=race?.type==='mayor';
      const stateFips=FEAScenario.stateFips[race.state];
      // Fit to wards/districts with room for state land; do not fit to crude outlines.
      const fitExtent=cityFocus?[[left+40,48],[830,560]]:[[left,28],[872,592]];
      const projection=FEANight.fitRenderedGeometry(d3.geoAlbersUsa(),fitExtent,fitSource),path=d3.geoPath(projection);
      const backdrop=contextStates.filter(f=>f?.geometry?.type&&(!cityFocus||String(f.id||f.properties?.STATEFP).padStart(2,'0')===stateFips));
      if(backdrop.length){
        g.append('g').attr('class','election-map-context-layer').attr('aria-hidden','true').attr('pointer-events','none')
          .selectAll('path').data(backdrop.map(f=>({...f,geometry:rewind(f.geometry)}))).join('path')
          .attr('class',f=>'map-context-shape '+(String(f.id||f.properties?.STATEFP).padStart(2,'0')===stateFips?'is-selected-context':'is-dimmed-context'))
          .attr('d',path)
          .attr('stroke','none');
      }
      const baseFill=FeaPredictionMaps.colors.Tossup||'#cbcacd';
      // Soft city land plate from outline (fill only) — seals holes without inventing a shoreline stroke.
      if(cityFocus&&boundary?.geometry){
        g.append('path')
          .datum({...boundary,geometry:rewind(boundary.geometry)})
          .attr('class','maker-city-land')
          .attr('d',path)
          .attr('fill',baseFill)
          .attr('stroke','none')
          .attr('pointer-events','none')
          .attr('aria-hidden','true');
      }
      function applyUnit(f){
        unit=unitId(f);
        const key=race.id+'@'+unit;
        const next=paintValue(model.rating(key));
        if(active==='counties'||active==='ratings'){
          model.apply([[key,next]]);
          edited(`${f.properties?.countyName||f.properties?.NAME||f.properties?.name||unit} · ${next}`);
        }
        if(active==='ratings')tab('counties');
        announce(`${f.properties?.countyName||f.properties?.NAME||f.properties?.name||unit} · ${next}`);
        refresh();
      }
      detailHoverRing=typeof FeaPredictionMaps?.createHoverOutlineController==='function'
        ?FeaPredictionMaps.createHoverOutlineController(g)
        :null;
      function bindUnitPaths(layer){
        layer.selectAll('path.county-result-shape').data(features).join('path')
          .attr('class','county-result-shape election-map-shape')
          .attr('d',path)
          .attr('fill',f=>color(f)||baseFill)
          .style('fill',f=>color(f)||baseFill)
          .attr('fill-rule','nonzero')
          .attr('data-unit',unitId)
          .attr('data-name',f=>f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f))
          .attr('role','button')
          .attr('tabindex',0)
          .attr('aria-label',f=>`${f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f)}: ${unitRating(f)}`)
          .on('click',(event,f)=>{event.stopPropagation();applyUnit(f);event.currentTarget?.blur?.();})
          .on('keydown',(event,f)=>{if(['Enter',' '].includes(event.key)){event.preventDefault();applyUnit(f);}})
          .on('pointerenter focus',function(event,f){
            detailHoverRing?.sync(this);
            const tip=$('maker-detail-map-tooltip');
            if(!tip)return;
            tip.hidden=false;
            tip.innerHTML=`<strong>${esc(event.currentTarget.dataset.name)}</strong><span>${esc(unitRating(f))}</span>`;
            const host=$('maker-detail-map').getBoundingClientRect();
            tip.style.left=`${Math.min(host.width-24,Math.max(12,event.clientX-host.left+12))}px`;
            tip.style.top=`${Math.min(host.height-24,Math.max(12,event.clientY-host.top+12))}px`;
          })
          .on('pointermove',(event)=>{
            const tip=$('maker-detail-map-tooltip');
            if(!tip||tip.hidden)return;
            const host=$('maker-detail-map').getBoundingClientRect();
            tip.style.left=`${Math.min(host.width-24,Math.max(12,event.clientX-host.left+12))}px`;
            tip.style.top=`${Math.min(host.height-24,Math.max(12,event.clientY-host.top+12))}px`;
          })
          .on('pointerleave blur',()=>{
            const selected=unit?layer.select(`[data-unit="${CSS.escape(unit)}"]`).node():null;
            detailHoverRing?.sync(selected||null);
            const tip=$('maker-detail-map-tooltip');
            if(tip)tip.hidden=true;
          });
      }
      if(cityFocus&&features.length){
        // Seal ward gaps with same-color strokes — stays inside ward exteriors (no shoreline stroke).
        g.append('g').attr('class','maker-city-gapfill').attr('aria-hidden','true').attr('pointer-events','none')
          .selectAll('path').data(features).join('path')
          .attr('d',path)
          .attr('fill',baseFill)
          .attr('fill-rule','nonzero')
          .attr('stroke',baseFill)
          .attr('stroke-width',2.4)
          .attr('stroke-linejoin','round')
          .attr('stroke-linecap','round');
      }
      bindUnitPaths(g.append('g').attr('class','maker-county-layer'+(cityFocus?' is-city-layer':'')));
      detailHoverRing?.hoverOutline.raise();
      const zoom=d3.zoom().scaleExtent([1,8]).on('zoom',e=>g.attr('transform',e.transform));
      svg.call(zoom).on('dblclick.zoom',null);
      $('maker-county-reset').onclick=()=>svg.transition().duration(200).call(zoom.transform,d3.zoomIdentity);
      $('maker-county-map').classList.toggle('is-city-detail',!!cityFocus);
      refresh();
    }

    async function loadStateContext(token){
      try{
        const assets=await json('data/results/map-assets.json');
        const states=await json(assets.states);
        if(token!==sequence)return;
        contextStates=states.features||[];
      }catch{contextStates=[];}
    }

    async function loadCityBoundary(token){
      const outline=(race.outlineUrl||'').replace(/^\//,'');
      if(!outline)return null;
      try{
        const fc=await json(outline);
        if(token!==sequence)return null;
        return (fc.features||[]).find(f=>f?.geometry)||(fc.type==='Feature'?fc:null);
      }catch{return null;}
    }

    async function loadPresidentialSources(token){
      const comparisons=await json('data/result-comparison-baselines.json');
      sources=comparisons.sources.filter(s=>s.id!=='live'&&s.status==='available'&&s.id.startsWith('pres-')&&s.appliesTo?.includes('governor'));
      await Promise.all(sources.flatMap(s=>['state','county'].map(async scope=>{try{if(s[scope+'File'])datasets.set(s.id+':'+scope,await json(s[scope+'File']));}catch{datasets.delete(s.id+':'+scope);}})));
      if(token!==sequence)return;
      $('maker-history-source').replaceChildren(...sources.map(s=>new Option(label(s),s.id)));
    }

    function defaultDetailTab(){
      return features.length?'counties':'ratings';
    }

    async function open(value){
      race={...value};unit='';features=[];sources=[];active='ratings';mayorPast=null;contextStates=[];const token=++sequence;
      $('focused-race-title').textContent=title(race);$('maker-county-map').replaceChildren();$('maker-detail-note').textContent='Loading geography…';$('maker-detail-history').textContent='Loading past elections…';$('maker-detail-roster').textContent='';
      panel.hidden=false;
      enterDedicatedMap();
      panel.querySelector('[data-detail-tab="counties"]').textContent=subdivisionLabel();
      tab('ratings');
      $('maker-detail-close').focus({preventScroll:true});
      onContext();
      try{
        if(race.type==='mayor'){
          if(mayorHistory?.[race.id])mayorPast=mayorHistory[race.id];
          $('maker-detail-roster').innerHTML='<div id="maker-detail-mayor-past" hidden></div><div id="maker-detail-candidates"></div>';
          onContext();
          const subUrl=(race.subdivisionUrl||'').replace(/^\//,'');
          try{await loadPresidentialSources(token);}catch{sources=[];}
          if(token!==sequence)return;
          $('maker-detail-history').textContent=sources.length?'Choose Past elections to compare presidential returns.':'Past elections unavailable for this race.';
          const [boundary]=await Promise.all([loadCityBoundary(token),loadStateContext(token)]);
          if(token!==sequence)return;
          if(subUrl){
            const geometry=await json(subUrl);
            if(token!==sequence)return;
            features=(geometry.features||[]).filter(f=>f?.geometry?.type&&unitPattern.test(unitId(f)));
            $('maker-detail-note').textContent=race.subdivisionNote||`Click ${subdivisionLabel().toLowerCase()} to cycle ratings. Set a citywide winner under Results.`;
            drawLocked(geometry,{boundary});
            tab(defaultDetailTab());
          }else if(boundary){
            $('maker-detail-note').textContent='Set candidates and pick a winner. Subdivision paint is not available for this city.';
            features=[];
            drawLocked({type:'FeatureCollection',features:[]},{boundary});
            tab('ratings');
          }else{
            $('maker-detail-note').textContent='Set candidates and pick a winner.';
            features=[];
            tab('ratings');
          }
          return;
        }

        const assets=await json('data/results/map-assets.json');
        if(token!==sequence)return;
        let comparisons={},geo={},catalogue={races:[]};
        try{comparisons=await json('data/result-comparison-baselines.json');}catch{comparisons={sources:[]};}
        try{geo=await json('data/results/district-geography.json');}catch{geo={districts:{}};}
        // election-night-races.json is the 2026 general roster only — never reuse by race id for other cycles.
        if(String(cycleId)==='2026'){
          try{catalogue=await json('data/election-night-races.json');}catch{catalogue={races:[]};}
        }
        if(token!==sequence)return;
        geography=geo.districts?.[FEAResultsUI.districtId(race)];race.geometryId=geography?.geometryId;
        roster=catalogue.races?.find(r=>r.id===race.id)?.candidates||[];
        if(String(cycleId)==='2026'){
          $('maker-detail-roster').innerHTML='<div id="maker-detail-candidates"></div><p class="desk-preelection">Scenario roster · No vote totals or calls.</p><table class="selected-race-table"><thead><tr><th>Candidate</th><th>Votes</th><th>Vote %</th></tr></thead><tbody>'+(roster.length?roster.map(c=>{const color=FEADeskTheme.candidateColor(c,roster);return '<tr style="--candidate-color:'+color+';--candidate-ink:'+FEADeskTheme.foreground(color)+'"><td><span class="selected-party-rail" style="background:'+color+'"></span><strong>'+esc(c.name)+'</strong><small>'+esc(c.partyLabels?.join(' / ')||c.party)+'</small></td><td>—</td><td>—</td></tr>';}).join(''):'<tr><td colspan="3">No published roster for this race.</td></tr>')+'</tbody></table>';
        }else{
          roster=[];
          $('maker-detail-roster').innerHTML='<div id="maker-detail-candidates"></div><p class="desk-preelection">Declared / scenario candidates for '+esc(cycleId)+'. Add names below — the 2026 election-night roster is not used here.</p>';
        }
        onContext();
        const fips=FEAScenario.stateFips[race.state],house=race.type==='house',exact=house&&geography?.currentComparable;
        const officeKey=race.type==='president'?'governor':race.type;
        sources=(comparisons.sources||[]).filter(s=>s.id!=='live'&&s.status==='available'&&s.appliesTo?.includes(officeKey));
        await Promise.all(sources.flatMap(s=>['state','county',...(house?['district']:[])].map(async scope=>{try{if(s[scope+'File'])datasets.set(s.id+':'+scope,await json(s[scope+'File']));}catch{datasets.delete(s.id+':'+scope);}})));
        if(token!==sequence)return;
        $('maker-history-source').replaceChildren(...sources.map(s=>new Option(label(s),s.id)));
        $('maker-detail-history').textContent=sources.length?'Choose Past elections to inspect returns.':'Past elections unavailable for this race.';

        const geometryFile=exact?geography.geometryFile
          :(house?null:assets.counties[fips])||assets.municipalities?.[fips]?.path||assets.counties[fips];
        const [geometry,states]=await Promise.all([json(geometryFile||assets.counties[fips]),json(assets.states)]);
        contextStates=(states.features||[]).filter(f=>f?.geometry?.type);
        if(token!==sequence)return;
        features=(geometry.features||[]).filter(f=>f?.geometry?.type&&unitPattern.test(unitId(f)));
        panel.querySelector('[data-detail-tab="counties"]').textContent=geometry.features?.[0]?.properties?.localType==='municipality'?'Towns / cities':geometry.features?.[0]?.properties?.localType==='state-house-district'?'House districts':'Counties';
        $('maker-detail-note').textContent=features.length
          ?`Click ${panel.querySelector('[data-detail-tab="counties"]').textContent.toLowerCase()} to cycle ratings.`
          :'County geography could not load. You can still set candidates and a winner under Results.';
        drawLocked(geometry);
        tab(defaultDetailTab());
      }catch(err){console.error(err);if(token===sequence)$('maker-detail-note').textContent='Detail data could not load. Close and reopen to retry; your map is unchanged.';}
    }

    function close(){
      if(panel.hidden)return;
      const id=race?.id;sequence++;race=null;features=[];mayorPast=null;contextStates=[];detailHoverRing=null;
      panel.removeAttribute('data-party');
      $('maker-county-map').replaceChildren();
      const tip=$('maker-detail-map-tooltip');if(tip)tip.hidden=true;
      panel.hidden=true;$('maker-detail-map').hidden=true;$('maker-map').hidden=false;
      document.body.classList.remove('maker-detail-open','has-focused-race','maker-city-focus');
      getMap()?.clearSubdivisionOverlay?.();
      getMap()?.setFocusDim?.(false);
      getMap()?.setSelected?.(null);
      getMap()?.reset?.();
      document.querySelector(`[data-race-id="${id}"]`)?.focus({preventScroll:true});
      onContext();
    }

    $('maker-detail-close').onclick=close;
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&!document.querySelector('dialog[open]'))close();
      if(panel.hidden||active!=='counties'||!features.length)return;
      if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
      const list=$('maker-counties-list');
      if(!list||(!list.contains(document.activeElement)&&document.activeElement!==list))return;
      e.preventDefault();
      const ids=features.map(unitId);
      const index=Math.max(0,ids.indexOf(unit));
      const next=e.key==='ArrowDown'?Math.min(ids.length-1,index+1):Math.max(0,index-1);
      unit=ids[next];
      refresh();
      list.querySelector(`[data-select-unit="${unit}"]`)?.focus({preventScroll:true});
    });
    panel.querySelectorAll('[data-detail-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.detailTab));
    $('maker-race-wide').onclick=()=>{unit='';refresh();};$('maker-history-source').onchange=refresh;
    panel.addEventListener('click',e=>{const historyButton=e.target.closest('[data-maker-history]'),countyButton=e.target.closest('[data-select-unit]');if(historyButton){$('maker-history-source').value=historyButton.dataset.makerHistory;refresh();}if(countyButton){unit=countyButton.dataset.selectUnit;announce(`${countyButton.textContent.trim()} selected`);refresh();}});
    $('maker-counties-list')?.setAttribute('tabindex','0');
    $('maker-rate-race').onclick=()=>{model.apply([[race.id,$('maker-race-rating').value]]);edited('Race rating updated.');};
    $('maker-county-undo').onclick=()=>{if(model.undo())edited('Last rating change undone.');};$('maker-county-redo').onclick=()=>{if(model.redo())edited('Rating change restored.');};
    $('maker-county-apply').onclick=()=>{if(unit){const next=paintValue(model.rating(race.id+'@'+unit));model.apply([[race.id+'@'+unit,next]]);edited(`Unit rating · ${next}`);refresh();}};
    return {open,close,refresh,get raceId(){return race?.id;}};
  }
  const api={unitId,create};root.FEAMakerDetail=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
