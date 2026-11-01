/* Independent reader for YAPms SavedMap JSON. Revision dates are map versions,
   not election years: the 2026 Senate/Governor maps use 2024312. */
(function(root){
  function read(value,catalogue,partyMap={}){
    const office={house:'house',senate:'senate',governors:'governor',governor:'governor'}[value?.map?.type];
    const revision=String(value?.map?.year||''),variant=value?.map?.variant;
    if(value?.map?.country!=='usa'||!office||!['blank',undefined].includes(variant)||!(/^(2026\d{0,3})$/.test(revision)||(['senate','governor'].includes(office)&&revision==='2024312')||(office==='house'&&/^(2024312|2025\d{3})$/.test(revision))))throw Error('Choose a YAPms 2026 USA House, Senate or governor blank-map save. Results and other election cycles are not supported.');
    if(!Array.isArray(value.regions)||value.regions.length>600||!Array.isArray(value.candidates)||value.candidates.length>30||!value.tossup||typeof value.tossup.id!=='string')throw Error('Incomplete YAPms saved map.');
    const parties=new Map([[value.tossup.id,'T']]),unknown=[];
    for(const c of value.candidates){
      if(!c||typeof c.id!=='string'||typeof c.name!=='string'||parties.has(c.id)||!Array.isArray(c.margins)||!c.margins.length)throw Error('Invalid or duplicate YAPms candidate.');
      const name=c.name.trim().toLowerCase(),p=partyMap[c.id]||(/^(democrats?|democratic|d)$/.test(name)?'D':/^(republicans?|gop|r)$/.test(name)?'R':/^(independents?|i)$/.test(name)?'I':null);
      if(!['D','R','I','T'].includes(p))unknown.push({id:c.id,name:c.name.slice(0,100)});else parties.set(c.id,p);
    }
    if(unknown.length)return {office,unknown};
    const expected=catalogue.filter(r=>r.type===office),ids=new Set(expected.map(r=>r.id)),seen=new Set(),entries=[],notes=[];
    for(const region of value.regions){
      if(!region||typeof region.id!=='string'||typeof region.disabled!=='boolean'||!Array.isArray(region.candidates))throw Error('Invalid YAPms region.');
      let suffix=region.id.toUpperCase();
      // Confirmed upstream SVG typo: revision 2026253 has region="TN-"
      // with short-name="TN-2" and long-name="Tennessee's 2nd".
      if(office==='house'&&revision==='2026253'&&suffix==='TN-')suffix='TN-2';
      if(office==='house'&&suffix==='DC-AL'&&region.disabled)continue;
      if(office==='house'){const match=/^([A-Z]{2})-(\d{1,2}|AL)$/.exec(suffix);if(!match)throw Error('Unknown House district: '+suffix);suffix=match[1]+'-'+(['0','00','AL'].includes(match[2])?'AL':match[2].padStart(2,'0'));}
      else suffix=suffix.replace(/-S$/,'');
      const houseRace=office==='house'?expected.find(r=>r.state===suffix.slice(0,2)&&(['AL','0'].includes(String(r.district).toUpperCase())?'AL':String(r.district).padStart(2,'0'))===suffix.slice(3)):null;
      const id=houseRace?.id||office+'-'+suffix;
      if(region.disabled){if(ids.has(id))throw Error('A 2026 contest is disabled in this save: '+suffix);continue;}
      if(!ids.has(id)||seen.has(id))throw Error('This map does not match the 2026 ballot: '+suffix);seen.add(id);
      const cs=region.candidates,unique=new Set();
      for(const c of cs){if(!parties.has(c.id)||unique.has(c.id)||!Number.isFinite(c.count)||c.count<0||!Number.isInteger(c.margin)||c.margin<0||c.margin>3)throw Error('Invalid candidate allocation in '+suffix);unique.add(c.id);}
      const max=Math.max(0,...cs.map(c=>c.count)),leaders=cs.filter(c=>c.count===max&&max>0),winner=leaders.length===1?leaders[0]:null,p=winner?parties.get(winner.id):'T';
      if(leaders.length>1)notes.push(suffix+' split allocation → Tossup');
      entries.push([id,p==='T'?'Tossup':['Safe','Likely','Lean','Tilt'][winner.margin]+' '+{D:'Democratic',R:'Republican',I:'Independent'}[p]]);
    }
    if(seen.size!==expected.length)throw Error('The save is missing '+(expected.length-seen.size)+' races on the 2026 ballot. No ratings were changed.');
    if(office==='house'&&revision!=='2026153')notes.push('District IDs imported; displayed boundaries use FEA’s current 2026 map.');
    return {office,entries,notes,unknown:[]};
  }
  const api={read};root.FEAYapms=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
