/* One projection presentation for the public desk and broadcast browser source. */
(function(root){
  const names=Object.fromEntries('AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming'.split('|').map(s=>s.split(':')));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const source=call=>call?.provider==='NBC'||/^nbc-/i.test(call?.source||'')?'NBC':'FEA';
  const title=race=>root.FEAResultsUI.raceLabel({...race,stateName:names[race.state]||race.state});
  const accent=event=>{
    const c=event.race?.candidates?.find(c=>c.name===event.call?.candidate);
    return c?root.FEADeskTheme.candidateColor(c,event.race.candidates):root.FEADeskTheme.resolved.tokens.warning;
  };
  function content(event,{interactive=true}={}){
    return `${interactive?'<button class="toast-dismiss" aria-label="Dismiss projection notification">×</button>':''}<small>${event.correction?'PROJECTION UPDATE':source(event.call)+' PROJECTS'}</small><h3>${esc(title(event.race))}</h3><strong>${esc(event.call?.candidate||'Previous projection withdrawn')}</strong>${interactive?'<button class="toast-view" type="button">View race</button>':''}`;
  }
  const api={esc,source,title,accent,content};root.FEAProjectionCard=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
