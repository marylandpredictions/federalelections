// Parse only named general-election candidates, never primary results or forecasts.
const entities = { amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>' };
export const plain = value => String(value).replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, code) => code[0] === '#' ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2),16) : Number(code.slice(1))) : entities[code] ?? all).replace(/\s+/g,' ').trim();
export const partyCode = label => ({D:'D',R:'R',I:'I',L:'L',G:'G',C:'C',Democratic:'D',Republican:'R',Independent:'I',Libertarian:'L',Green:'G',Constitution:'C','No party preference':'NP','No Party Affiliation':'NP',Unaffiliated:'I',Nonpartisan:'NP',Unenrolled:'I','No Political Party':'NP'})[label.split(',')[0].replace(/ Party$/, '')] || label;
function identity(name, label, text) {
  if (!name || !label || /Withdrawn|Disqualified|Deceased/i.test(text)) throw Error('Invalid general-election candidate row');
  return {name, party:partyCode(label), partyLabels:[label], ...( /\(Write-in\)/i.test(text) ? {writeIn:true}:{}), incumbent:/\(Incumbent\)/i.test(text)};
}
export function parseHouseLists(html) {
  const races=[];
  for(const chunk of html.split(/<h3[^>]*>/i).slice(1)) {
    const district=plain(chunk.split('</h3>')[0]).match(/^District (\d+)$/)?.[1];
    if(!district) continue;
    const list=chunk.match(/General election candidates[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)?.[1];
    const candidates=list ? [...list.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(m=>{
      const text=plain(m[1]), name=plain(m[1].match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]||'');
      const label=text.slice(name.length).replace(/^\s*\(Incumbent\)\s*/, '').match(/^\s*\(([^)]+)\)/)?.[1];
      return identity(name,label,text);
    }) : parseGeneralTable(chunk,/General election for U\.S\. House[^<]*<\/h5>/i);
    if(!candidates.length)throw Error('Empty general list');
    races.push({district,candidates});
  }
  return races;
}
export function parseGeneralTable(html, officePattern) {
  const segment=html.split(officePattern)[1];
  if(!segment) throw Error('General-election heading missing');
  const table=segment.match(/<table\b[^>]*class="results_table"[^>]*>([\s\S]*?)<\/table>/i)?.[1];
  if(!table) throw Error('General-election table missing');
  return [...table.matchAll(/<td\b[^>]*class="votebox-results-cell--text"[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>{
    const text=plain(m[1]),name=plain(m[1].match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]||'');
    const label=text.slice(name.length).replace(/^\s*\(Incumbent\)\s*/, '').match(/^\s*\(([^)]+)\)/)?.[1];
    return identity(name,({D:'Democratic',R:'Republican',L:'Libertarian',G:'Green',C:'Constitution'})[label]||label,text);
  });
}
export function parseDirectory(html) {
  const races=new Map();
  for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells=Object.fromEntries([...row[1].matchAll(/<td\b[^>]*data-cell="(candidate|party|office|status)"[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>[m[1],m[2]]));
    const status=plain(cells.status||'');
    if(!/^(?:On the Ballot(?: \(Write-in\))? (?:General|Round 1)|Candidacy Declared \(Write-in\) General)$/.test(status))continue;
    const office=plain(cells.office||''), name=plain(cells.candidate?.match(/<div class="widget-candidate-info">\s*<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1]||'');
    if(!office)throw Error('Missing office');
    const list=races.get(office)||[];
    list.push({...identity(name,plain(cells.party||''),plain(cells.candidate||'')+' '+status), ...(/Candidacy Declared/.test(status)?{ballotStatus:'Declared write-in; registration not verified'}:{})});
    races.set(office,list);
  }
  return races;
}
