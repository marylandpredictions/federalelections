/* Optional, static-data-only race explorer. No live-result or call endpoints. */
(function(root){
  function unitId(feature){const p=feature.properties||{};return String(p.localType==='municipality'?(p.localId||p.GEOID||''):(p.countyFips||(p.STATEFP&&p.COUNTYFP?String(p.STATEFP).padStart(2,'0')+String(p.COUNTYFP).padStart(3,'0'):p.GEOID||feature.id||'')));}
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=source=>source.id.startsWith('pres-')?source.id.slice(5)+' President':source.id==='house-2024'?'2024 House':source.id==='senate-last'?'Previous Senate election':'Previous governor election';
  function create({model,brush,edited,title,onContext=()=>{}}){
    const $=id=>document.getElementById(id),panel=$('focused-race-panel'),cache=new Map(),datasets=new Map();
    let race,unit='',features=[],sources=[],active='ratings',sequence=0,geography,manifest,countyData,districtData,roster=[];
    async function json(file){if(!file)throw Error('Data unavailable');if(!cache.has(file)){if(cache.size>24)cache.delete(cache.keys().next().value);cache.set(file,fetch('/'+file.replace(/^\//,'')).then(r=>{if(!r.ok)throw Error('Data unavailable');return r.json();}).catch(e=>{cache.delete(file);throw e;}));}return cache.get(file);}
    const snapshot=(source,id=unit)=>FEAResultsUI.historicalSnapshot(race,source,datasets,id||null);
    function color(f){if(active!=='history')return FeaPredictionMaps.colors[model.rating(race.id+'@'+unitId(f))];const s=sources.find(s=>s.id===$('maker-history-source').value),row=s&&snapshot(s,unitId(f));if(!row)return FEADeskTheme.resolved.tokens['map-neutral'];const party=row.margin>=0?'D':'R',base=FEADeskTheme.candidateColor({party});return FEADeskTheme.mix(base,FEADeskTheme.resolved.tokens['panel-bg'],Math.max(0,.65-Math.abs(row.margin)/40));}
    function refresh(){
      if(!race||panel.hidden)return;
      for(const path of $('maker-county-map').querySelectorAll('[data-unit]')){const f=features.find(f=>unitId(f)===path.dataset.unit);path.setAttribute('fill',color(f));path.classList.toggle('is-selected',path.dataset.unit===unit);path.setAttribute('aria-label',`${path.dataset.name}: ${active==='history'?'past election':model.rating(race.id+'@'+path.dataset.unit)}`);}
      const f=features.find(f=>unitId(f)===unit),name=f?(f.properties.countyName||f.properties.NAME||f.properties.name||unit):title(race);
      $('maker-detail-location').textContent=name;
      $('focused-race-title').textContent=unit?name:title(race);
      $('focused-race-rating').textContent=`Your rating · ${model.rating(race.id)}`;
      $('maker-race-rating').value=model.rating(race.id);
      $('maker-detail-rating').textContent=unit?`Your rating: ${model.rating(race.id+'@'+unit)}`:'Select a county to rate it or inspect its history.';
      $('maker-county-apply').disabled=!unit;
      $('maker-county-undo').disabled=!model.past.length;$('maker-county-redo').disabled=!model.future.length;
      if(active==='history')history();if(active==='demographics')demographics();
      if(active==='counties'){
        const list=$('maker-counties-list'),scroll=list.scrollTop;
        list.innerHTML=features.map(f=>`<button type="button" data-select-unit="${unitId(f)}" aria-pressed="${unit===unitId(f)}"><span>${esc(f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f))}</span><strong>${esc(model.rating(race.id+'@'+unitId(f)).replace(' Democratic',' D').replace(' Republican',' R').replace(' Independent',' I'))}</strong></button>`).join('');list.scrollTop=scroll;
      }
    }
    function history(){
      const source=sources.find(s=>s.id===$('maker-history-source').value),row=source&&snapshot(source);
      $('maker-detail-history').innerHTML=`<section id="desk-past-margins"><header class="comparison-heading"><div><small>PAST ELECTIONS</small><strong>${esc($('maker-detail-location').textContent)}</strong></div></header><div class="comparison-workspace"><div class="comparison-matrix" style="--comparison-columns:1">${source?FEAResultsUI.comparisonColumn(row?.year||source.id.match(/20\d{2}/)?.[0]||'Last',row?.label||label(source),row,FEADeskTheme):'<p class="desk-hint">No verified historical result.</p>'}</div><nav class="comparison-rail" aria-label="Historical map election">${sources.map(s=>`<button type="button" data-maker-history="${esc(s.id)}" aria-pressed="${source?.id===s.id}">${esc(s.id.match(/20\d{2}/)?.[0]||'Last')}<span>${s.id.startsWith('pres-')?'PRES':race.type.toUpperCase()}</span></button>`).join('')}</nav></div><p class="comparison-context">Published historical returns. Blank means no verified result for these boundaries.${race.type==='house'&&unit?' Whole-county reference, not the district portion.':''}</p></section>`;
    }
    async function demographics(){
      const token=sequence,selected=unit;$('maker-detail-demographics').textContent='Loading Census estimates…';
      try{
        manifest||=await json('data/results/demographics.json');countyData||=await json(manifest.file);
        if(race.type==='house'&&!selected)districtData||=await json(manifest.districtFile);
        if(token!==sequence||selected!==unit||active!=='demographics')return;
        const district=race.type==='house'&&!selected,row=selected?countyData.counties?.[selected]:district?districtData.districts?.[FEAResultsUI.districtId(race)]:countyData.states?.[FEAScenario.stateFips[race.state]];
        if(!row){$('maker-detail-demographics').textContent='No Census profile for this reporting unit. Choose Race-wide for the available state or district profile.';return;}
        $('maker-detail-demographics').innerHTML=FEAResultsUI.demographicProfile(row,{district,house:race.type==='house',county:!!selected});
      }catch{if(token===sequence)$('maker-detail-demographics').textContent='Census data could not load. Select this tab again to retry.';}
    }
    function tab(value){active=value;for(const b of panel.querySelectorAll('[data-detail-tab]'))b.setAttribute('aria-selected',String(b.dataset.detailTab===value));for(const section of panel.querySelectorAll('[data-detail-content]'))section.hidden=section.dataset.detailContent!==value;panel.querySelector('.maker-detail-actions').hidden=!['ratings','counties'].includes(value);$('maker-detail-note').hidden=!!race&&race.type!=='house'&&['history','demographics'].includes(value);refresh();}
    function draw(collection){
      const rewind=geometry=>{const polygon=rings=>d3.geoArea({type:'Polygon',coordinates:rings})>Math.PI*2?rings.map(r=>[...r].reverse()):rings;return geometry.type==='Polygon'?{...geometry,coordinates:polygon(geometry.coordinates)}:geometry.type==='MultiPolygon'?{...geometry,coordinates:geometry.coordinates.map(polygon)}:geometry;};
      features=collection.features.filter(f=>/^\d{5}(\d{5})?$/.test(unitId(f))).map(f=>({...f,geometry:rewind(f.geometry)}));
      const svg=d3.select($('maker-county-map')).append('svg').attr('viewBox','0 0 900 620').attr('role','group').attr('aria-label','County ratings and historical map'),g=svg.append('g');
      // Identical projection/fitting routine to /results. Correct GeoJSON ring
      // orientation first so a county cannot fill the projection's clip box.
      const projection=FEANight.fitRenderedGeometry(d3.geoAlbersUsa(),[[34,34],[866,586]],{type:'FeatureCollection',features}),path=d3.geoPath(projection);
      g.selectAll('path').data(features).join('path').attr('class','county-result-shape').attr('d',path).attr('data-unit',unitId).attr('data-name',f=>f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f)).attr('role','button').attr('tabindex',0).on('click',(event,f)=>{unit=unitId(f);if(active==='counties'){model.apply([[race.id+'@'+unit,brush()]]);edited(`${event.currentTarget.dataset.name} · ${brush()}`);}if(active==='ratings')tab('counties');refresh();}).on('keydown',(event,f)=>{if(['Enter',' '].includes(event.key)){event.preventDefault();unit=unitId(f);if(active==='ratings')tab('counties');refresh();}}).append('title').text(f=>(f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f)));
      const zoom=d3.zoom().scaleExtent([1,12]).on('zoom',e=>g.attr('transform',e.transform));svg.call(zoom).on('dblclick.zoom',null);
      $('maker-county-reset').onclick=()=>svg.call(zoom.transform,d3.zoomIdentity);
      refresh();onContext();
    }
    async function open(value){
      race={...value};unit='';features=[];sources=[];active='ratings';const token=++sequence;
      $('focused-race-title').textContent=title(race);$('maker-county-map').replaceChildren();$('maker-detail-note').textContent='Loading geography and past elections…';$('maker-detail-history').textContent='Loading past elections…';$('maker-detail-roster').textContent='Loading reviewed ballot roster…';
      panel.hidden=false;$('maker-map').hidden=true;$('maker-detail-map').hidden=false;document.body.classList.add('maker-detail-open');tab('ratings');
      $('maker-detail-close').focus({preventScroll:true});
      try{
        const [assets,comparisons,geo,catalogue]=await Promise.all([json('data/results/map-assets.json'),json('data/result-comparison-baselines.json'),json('data/results/district-geography.json'),json('data/election-night-races.json')]);
        if(token!==sequence)return;geography=geo.districts?.[FEAResultsUI.districtId(race)];race.geometryId=geography?.geometryId;
        roster=catalogue.races.find(r=>r.id===race.id)?.candidates||[];
        $('maker-detail-roster').innerHTML=`<p class="desk-preelection">Reviewed 2026 ballot roster · Your scenario has no vote totals or calls.</p><table class="selected-race-table"><thead><tr><th>Candidate</th><th>Votes</th><th>Vote %</th></tr></thead><tbody>${roster.map(c=>{const color=FEADeskTheme.candidateColor(c,roster);return `<tr style="--candidate-color:${color};--candidate-ink:${FEADeskTheme.foreground(color)}"><td><span class="selected-party-rail" style="background:${color}"></span><strong>${esc(c.name)}</strong><small>${esc(c.partyLabels?.join(' / ')||c.party)}</small></td><td>—</td><td>—</td></tr>`;}).join('')}</tbody></table>`;
        const fips=FEAScenario.stateFips[race.state],house=race.type==='house',exact=house&&geography?.currentComparable;
        // No fallback pretending an old district outline is a current district.
        const geometry=await json(exact?geography.geometryFile:!house&&assets.municipalities?.[fips]?.path||assets.counties[fips]);
        if(token!==sequence)return;
        panel.querySelector('[data-detail-tab="counties"]').textContent=geometry.features[0]?.properties?.localType==='municipality'?'Towns / cities':'Counties';
        sources=comparisons.sources.filter(s=>s.id!=='live'&&s.status==='available'&&s.appliesTo?.includes(race.type));
        await Promise.all(sources.flatMap(s=>['state','county',...(house?['district']:[])].map(async scope=>{try{if(s[scope+'File'])datasets.set(s.id+':'+scope,await json(s[scope+'File']));}catch{datasets.delete(s.id+':'+scope);}})));
        if(token!==sequence)return;
        $('maker-detail-note').textContent=house?(exact?'County portions within this district. Past county returns and Census estimates describe the whole county.':'Statewide county context. Verified current district/county intersections are unavailable; no older district boundary is substituted.'):'Click a county to paint your rating. Choose Past elections to explore published returns.';
        $('maker-history-source').replaceChildren(...sources.map(s=>new Option(label(s),s.id)));
        draw(geometry);tab(active);
      }catch{if(token===sequence)$('maker-detail-note').textContent='Detail data could not load. Close and reopen to retry; your map is unchanged.';}
    }
    function close(){if(panel.hidden)return;const id=race?.id;sequence++;race=null;features=[];$('maker-county-map').replaceChildren();panel.hidden=true;$('maker-detail-map').hidden=true;$('maker-map').hidden=false;document.body.classList.remove('maker-detail-open');document.querySelector(`[data-race-id="${id}"]`)?.focus({preventScroll:true});onContext();}
    $('maker-detail-close').onclick=close;
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]'))close();});
    panel.querySelectorAll('[data-detail-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.detailTab));
    $('maker-race-wide').onclick=()=>{unit='';refresh();};$('maker-history-source').onchange=refresh;
    panel.addEventListener('click',e=>{const historyButton=e.target.closest('[data-maker-history]'),countyButton=e.target.closest('[data-select-unit]');if(historyButton){$('maker-history-source').value=historyButton.dataset.makerHistory;refresh();}if(countyButton){unit=countyButton.dataset.selectUnit;refresh();}});
    $('maker-rate-race').onclick=()=>{model.apply([[race.id,$('maker-race-rating').value]]);edited('Race rating updated.');};
    $('maker-county-undo').onclick=()=>{if(model.undo())edited('Last rating change undone.');};$('maker-county-redo').onclick=()=>{if(model.redo())edited('Rating change restored.');};
    $('maker-county-apply').onclick=()=>{if(unit){model.apply([[race.id+'@'+unit,brush()]]);edited('County rating updated.');refresh();}};
    return {open,close,refresh,get raceId(){return race?.id;}};
  }
  const api={unitId,create};root.FEAMakerDetail=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
