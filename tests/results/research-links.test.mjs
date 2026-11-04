import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import links from '../../assets/research-links.js';
import awareness from '../../assets/night-awareness.js';

const url = path => new URL(path, 'https://fea.example');
const races = JSON.parse(readFileSync('data/features/map-maker-races.json')).races;
const ohio = races.find(race => race.id === 'senate-OH');
const maine = races.find(race => race.id === 'house-ME-2');

test('Lab, Results and Map Maker retain the exact office and race', () => {
  const lab = url(links.lab(maine, {baseline:'house-2024', unit:'2300199999'}));
  assert.equal(links.findRace(lab.searchParams, races), maine);
  assert.equal(lab.searchParams.get('baseline'), 'house-2024');
  assert.equal(lab.searchParams.get('unit'), '2300199999');
  assert.equal(lab.hash, '#analysis-workspace');
  assert.deepEqual(awareness.parseView(url(links.results(maine, '2300199999')).search),
    {office:'house', race:'house-ME-2', tab:'counties', county:'2300199999'});
  assert.equal(links.findRace(url(links.maker(maine)).searchParams, races), maine);
});

test('invalid units and mismatched or unknown race IDs fail safely', () => {
  assert.equal(links.findRace(new URLSearchParams('race=senate-OH'), races), ohio);
  assert.equal(links.findRace(new URLSearchParams('office=house&race=senate-OH'), races), undefined);
  assert.equal(links.findRace(new URLSearchParams('race=house-OH-99'), races), undefined);
  assert.equal(links.results(ohio, 'invalid'), '/results?office=senate&race=senate-OH');
});

test('research links point to the state and only supported archive context', () => {
  assert.equal(links.bias('OH'), '/features/polling-bias?state=OH#state-details');
  assert.equal(links.archive('OH','2020'), '/election-history?year=2020&state=OH');
  assert.equal(url(links.lab(ohio,{section:'lab-benchmarks'})).hash, '#lab-benchmarks');
});

test('shared Lab links restore compatible filters and decode search text', () => {
  const sources = [{id:'senate-last',appliesTo:['senate']},{id:'house-2024',appliesTo:['house']}];
  const path = url(links.lab(ohio, {baseline:'senate-last',unit:'39049'}));
  for (const [key,value] of Object.entries({metric:'swing',display:'chart',sort:'votes',find:'Brown & Moreno + Ohio'})) {
    path.searchParams.set(key,value);
  }
  assert.deepEqual(links.labView(url(path.href).searchParams,races,sources),{
    race:ohio,office:'senate',baseline:'senate-last',unit:'39049',
    metric:'swing',display:'chart',sort:'votes',find:'Brown & Moreno + Ohio'
  });
  assert.equal(path.searchParams.get('find'),'Brown & Moreno + Ohio');
});

test('incompatible shared baselines, units without a race, and invalid views fall back', () => {
  const params = new URLSearchParams('office=house&race=senate-OH&baseline=senate-last&unit=39049&metric=forecast&display=unknown&sort=invalid');
  assert.deepEqual(links.labView(params,races,[{id:'senate-last',appliesTo:['senate']}]),{
    race:undefined,office:'house',baseline:'',unit:'',metric:'margin',display:'map',sort:'race',find:''
  });
});
