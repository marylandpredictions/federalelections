import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const ui = require('../../assets/results-ui.js');
const themes = require('../../assets/desk-theme.js');
const source = {id:'pres-2024', label:'2024 presidential shift', status:'available', appliesTo:['senate','house'], countyCompatible:true};
const state = {marginBasis:'all-votes', states:[{state:'OH',demVotes:55,repVotes:40,totalVotes:100}]};
test('Past margins identify the historical election and calculate an all-vote margin', () => {
  const rows = ui.pastMargins({type:'senate',state:'OH'},[source],new Map([['pres-2024:state',state]]));
  assert.deepEqual(rows,[{id:'pres-2024',label:'2024 presidential margin',margin:15}]);
});
test('Past margins stay blank for unverified, redrawn or absent House geography, never using statewide returns', () => {
  const race = {type:'house',state:'OH',district:1,geometryId:'current'};
  const district = {marginBasis:'all-votes',districts:[{id:'OH-01',geometryId:'old',geographyVerified:true,demVotes:60,repVotes:40,totalVotes:100}]};
  const data = new Map([['pres-2024:state',state],['pres-2024:district',district]]);
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,null);
  district.districts[0].geometryId='current';
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,20);
  district.districts[0].geographyVerified=false;
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,null);
});
test('Locked counties require one exact valid local match, without state or House fallback', () => {
  const data = new Map([['pres-2024:state',state],['pres-2024:county',{marginBasis:'all-votes',rows:[{fips:'39001',demVotes:30,repVotes:65,totalVotes:100}]}]]);
  const race = {type:'senate',state:'OH'};
  assert.equal(ui.pastMargins(race,[source],data,'39001')[0].margin,-35);
  assert.equal(ui.pastMargins(race,[source],data,'39003')[0].margin,null);
  assert.equal(ui.pastMargins({...race,type:'house'},[source],data,'39001')[0].margin,null);
  data.get('pres-2024:county').rows.push({...data.get('pres-2024:county').rows[0]});
  assert.equal(ui.pastMargins(race,[source],data,'39001')[0].margin,null);
});
test('Unavailable comparisons remain blank even if a historical dataset exists', () => {
  assert.equal(ui.pastMargins({type:'senate',state:'OH'},[{...source,status:'unavailable'}],new Map([['pres-2024:state',state]]))[0].margin,null);
});
test('Appearance profiles migrate old presets and survive custom duplication, export and local restore', () => {
  for (const [id,profile] of [['nbc-big-board','broadcast'],['nyt-results','editorial'],['fea-light','standard'],['high-contrast','contrast'],['california-inspired','studio']]) {
    const preset = themes.presets.find(p=>p.id===id);
    const legacy = {...preset}; delete legacy.presentation;
    assert.equal(themes.validate(legacy).presentation,profile);
    const custom = themes.validate({...preset,id:'custom-copy'});
    const storage = {getItem:()=>JSON.stringify({schemaVersion:1,current:custom,saved:[custom]})};
    assert.equal(themes.read(storage).current.presentation,profile);
    assert.equal(themes.validate(JSON.parse(JSON.stringify(custom))).presentation,profile);
  }
  assert.throws(()=>themes.validate({...themes.presets[0],presentation:'url(evil)'}),/appearance style/);
});
