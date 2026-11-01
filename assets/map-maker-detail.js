/* Optional, static-data-only race explorer. No live-result or call endpoints. */
(function(root){
  function unitId(feature){const p=feature.properties||{};return String(p.localType==='municipality'?(p.localId||p.GEOID||''):(p.countyFips||(p.STATEFP&&p.COUNTYFP?String(p.STATEFP).padStart(2,'0')+String(p.COUNTYFP).padStart(3,'0'):p.GEOID||feature.id||'')));}
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const label=source=>source.id.startsWith('pres-')?source.id.slice(5)+' President':source.id==='house-2024'?'2024 House':source.id==='senate-last'?'Previous Senate election':'Previous governor election';
  function create({model,brush,edited,title}){
    const $=id=>document.getElementById(id),dialog=$('maker-detail'),cache=new Map(),datasets=new Map();
    let race,unit='',features=[],sources=[],active='ratings',sequence=0,geography,manifest,countyData,districtData;
    async function json(file){if(!file)throw Error('Data unavailable');if(!cache.has(file)){if(cache.size>24)cache.delete(cache.keys().next().value);cache.set(file,fetch('/'+file.replace(/^\//,'')).then(r=>{if(!r.ok)throw Error('Data unavailable');return r.json();}).catch(e=>{cache.delete(file);throw e;}));}return cache.get(file);}
    const snapshot=(source,id=unit)=>FEAResultsUI.historicalSnapshot(race,source,datasets,id||null);
    function color(f){if(active!=='history')return FeaPredictionMaps.colors[model.rating(race.id+'@'+unitId(f))];const s=sources.find(s=>s.id===$('maker-history-source').value),row=s&&snapshot(s,unitId(f));if(!row)return FEADeskTheme.resolved.tokens['map-neutral'];const party=row.margin>=0?'D':'R',base=FEADeskTheme.candidateColor({party});return FEADeskTheme.mix(base,FEADeskTheme.resolved.tokens['panel-bg'],Math.max(0,.65-Math.abs(row.margin)/40));}
    function refresh(){
      if(!race||!dialog.open)return;
      for(const path of $('maker-county-map').querySelectorAll('[data-unit]')){const f=features.find(f=>unitId(f)===path.dataset.unit);path.setAttribute('fill',color(f));path.classList.toggle('is-selected',path.dataset.unit===unit);path.setAttribute('aria-label',`${path.dataset.name}: ${active==='history'?'past election':model.rating(race.id+'@'+path.dataset.unit)}`);}
      const f=features.find(f=>unitId(f)===unit),name=f?(f.properties.countyName||f.properties.NAME||f.properties.name||unit):title(race);
      $('maker-detail-location').textContent=name;
      $('maker-detail-rating').textContent=unit?`Your rating: ${model.rating(race.id+'@'+unit)}`:'Select a county to rate it or inspect its history.';
      $('maker-county-apply').disabled=!unit;
      if(active==='history')history();if(active==='demographics')demographics();
    }
    function history(){
      $('maker-detail-history').innerHTML='<p class="desk-hint">Published past elections only. No 2026 results or projected shift.</p>'+(race.type==='house'&&unit?'<p class="desk-hint">Whole-county reference; not votes within this district’s portion.</p>':'')+'<div class="comparison-matrix">'+sources.map(s=>{
        const row=snapshot(s),lead=row&&FEAResultsUI.candidateLead(row.candidates,row.total);
        return `<section class="comparison-column"><h3>${esc(label(s))}</h3>${row?`<strong class="maker-past-lead" style="color:${FEADeskTheme.candidateColor({party:lead?.party})}">${esc(lead?.party||'')} +${lead?.margin.toFixed(1)||'0.0'}</strong>`+FEAResultsUI.historicalTooltip(row,{name:row.name||title(race),label:row.round==='first-choice'?'First-choice returns':'Published returns',color:FEADeskTheme.candidateColor}):'<p class="desk-hint">—<br>No verified comparable result</p>'}</section>`;
      }).join('')+'</div>';
    }
    async function demographics(){
      const token=sequence,selected=unit;$('maker-detail-demographics').textContent='Loading Census estimates…';
      try{
        manifest||=await json('data/results/demographics.json');countyData||=await json(manifest.file);
        if(race.type==='house'&&!selected)districtData||=await json(manifest.districtFile);
        if(token!==sequence||selected!==unit||active!=='demographics')return;
        const district=race.type==='house'&&!selected,row=selected?countyData.counties?.[selected]:district?districtData.districts?.[FEAResultsUI.districtId(race)]:countyData.states?.[FEAScenario.stateFips[race.state]];
        if(!row){$('maker-detail-demographics').textContent='No Census profile for this reporting unit. Choose Race-wide for the available state or district profile.';return;}
        const bars=[['White, non-Hispanic',row.whiteNH],['Black alone',row.black],['Hispanic / Latino',row.hispanic],['Asian alone',row.asian],['Age 65+',row.age65],['Bachelor’s degree+',row.bachelors]];
        $('maker-detail-demographics').innerHTML=`<h3>${esc(row.name)}</h3><p class="demographic-source">2024 ACS ${district?'1-year · 119th Congress':'5-year'} estimates · U.S. Census Bureau</p>${row.boundaryStatus==='historical-boundaries'?'<p class="demographic-boundary-warning">Earlier district boundaries; this profile does not describe the redrawn 2026 district.</p>':''}<dl class="race-facts"><dt>Population</dt><dd>${Number(row.population).toLocaleString('en-US')}</dd><dt>Median household income</dt><dd>${row.income===null?'Unavailable':'$'+Number(row.income).toLocaleString('en-US')}</dd></dl><div class="demographic-bars">${bars.filter(([,v])=>Number.isFinite(v)).map(([l,v])=>`<div><span>${l}</span><strong>${v.toFixed(1)}%</strong><i style="--bar:${Math.min(100,v)}%"></i></div>`).join('')}</div><p class="desk-hint">Residents, not voters or party registration. Race and ethnicity overlap. Education covers adults 25+.${race.type==='house'&&selected?' Whole-county estimates, not the district portion.':''}</p>`;
      }catch{if(token===sequence)$('maker-detail-demographics').textContent='Census data could not load. Select this tab again to retry.';}
    }
    function tab(value){active=value;for(const b of dialog.querySelectorAll('[data-detail-tab]'))b.setAttribute('aria-selected',String(b.dataset.detailTab===value));for(const section of dialog.querySelectorAll('[data-detail-content]'))section.hidden=section.dataset.detailContent!==value;$('maker-history-options').hidden=value!=='history';refresh();}
    function draw(collection){
      features=collection.features.filter(f=>/^\d{5}(\d{5})?$/.test(unitId(f)));
      const svg=d3.select($('maker-county-map')).append('svg').attr('viewBox','0 0 900 620').attr('role','group').attr('aria-label','County ratings and historical map'),g=svg.append('g');
      // fitExtent with a planar reflected projection avoids d3 spherical winding
      // interpreting a county polygon as the complement of the United States.
      const projection=d3.geoIdentity().reflectY(true).fitExtent([[24,24],[876,596]],{type:'FeatureCollection',features}),path=d3.geoPath(projection);
      g.selectAll('path').data(features).join('path').attr('d',path).attr('data-unit',unitId).attr('data-name',f=>f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f)).attr('role','button').attr('tabindex',0).on('click',(event,f)=>{unit=unitId(f);if(active==='ratings'){model.apply([[race.id+'@'+unit,brush()]]);edited(`${event.currentTarget.dataset.name} · ${brush()}`);}refresh();}).on('keydown',(event,f)=>{if(['Enter',' '].includes(event.key)){event.preventDefault();unit=unitId(f);refresh();}}).append('title').text(f=>(f.properties.countyName||f.properties.NAME||f.properties.name||unitId(f)));
      const zoom=d3.zoom().scaleExtent([1,12]).on('zoom',e=>g.attr('transform',e.transform));svg.call(zoom).on('dblclick.zoom',null);
      $('maker-county-reset').onclick=()=>svg.call(zoom.transform,d3.zoomIdentity);
      refresh();
    }
    async function open(value){
      race={...value};unit='';active='ratings';const token=++sequence;
      $('maker-detail-title').textContent=title(race);$('maker-county-map').replaceChildren();$('maker-detail-note').textContent='Loading geography and past elections…';$('maker-detail-history').textContent='Loading past elections…';
      if(!dialog.open)dialog.showModal();tab('ratings');
      try{
        const [assets,comparisons,geo]=await Promise.all([json('data/results/map-assets.json'),json('data/result-comparison-baselines.json'),json('data/results/district-geography.json')]);
        if(token!==sequence)return;geography=geo.districts?.[FEAResultsUI.districtId(race)];race.geometryId=geography?.geometryId;
        const fips=FEAScenario.stateFips[race.state],house=race.type==='house',exact=house&&geography?.currentComparable;
        // No fallback pretending an old district outline is a current district.
        const geometry=await json(exact?geography.geometryFile:assets.counties[fips]);
        sources=comparisons.sources.filter(s=>s.id!=='live'&&s.status==='available'&&s.appliesTo?.includes(race.type));
        await Promise.all(sources.flatMap(s=>['state','county',...(house?['district']:[])].map(async scope=>{try{if(s[scope+'File'])datasets.set(s.id+':'+scope,await json(s[scope+'File']));}catch{datasets.delete(s.id+':'+scope);}})));
        if(token!==sequence)return;
        $('maker-detail-note').textContent=house?(exact?'County portions within this district. Past county returns and Census estimates describe the whole county.':'Statewide county context. Verified current district/county intersections are unavailable; no older district boundary is substituted.'):'Click a county to paint your rating. Choose Past elections to explore published returns.';
        $('maker-history-source').replaceChildren(...sources.map(s=>new Option(label(s),s.id)));
        draw(geometry);tab(active);
      }catch{if(token===sequence)$('maker-detail-note').textContent='Detail data could not load. Close and reopen to retry; your map is unchanged.';}
    }
    $('maker-detail-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{sequence++;race=null;features=[];$('maker-county-map').replaceChildren();});
    dialog.querySelectorAll('[data-detail-tab]').forEach(b=>b.onclick=()=>tab(b.dataset.detailTab));
    $('maker-race-wide').onclick=()=>{unit='';refresh();};$('maker-history-source').onchange=refresh;
    $('maker-county-apply').onclick=()=>{if(unit){model.apply([[race.id+'@'+unit,brush()]]);edited('County rating updated.');refresh();}};
    return {open,refresh};
  }
  const api={unitId,create};root.FEAMakerDetail=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
