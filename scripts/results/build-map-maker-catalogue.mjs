import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

mkdirSync('data/features/map-maker', {recursive: true});

const source = 'data/election-night-races.json';
const races2026 = JSON.parse(readFileSync(source, 'utf8')).races.map(({id, type, state, district}) => ({
  id, type, state, ...(district !== undefined ? {district} : {})
}));
const payload2026 = JSON.stringify({schemaVersion: 1, cycle: 2026, source, races: races2026}) + '\n';
writeFileSync('data/features/map-maker/races-2026.json', payload2026);
writeFileSync('data/features/map-maker-races.json', payload2026);

// 2027 map maker is governors-only (KY / LA / MS). City/mayor catalogues stay on disk for reference but are not injected.
const races2027 = [
  {id: 'governor-KY', type: 'governor', state: 'KY'},
  {id: 'governor-LA', type: 'governor', state: 'LA'},
  {id: 'governor-MS', type: 'governor', state: 'MS'}
];
writeFileSync(
  'data/features/map-maker/races-2027.json',
  JSON.stringify({schemaVersion: 1, cycle: 2027, races: races2027}) + '\n'
);

// Class III Senate seats + TN Class I special (Blackburn gubernatorial vacancy) for the 2028 cycle.
const senate2028 = ['AL','AK','AZ','AR','CA','CO','CT','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','MD','MO','NV','NH','NY','NC','ND','OH','OK','OR','PA','SC','SD','TN','UT','VT','WA','WI'];
// Gubernatorial seats on the 2028 ballot.
const governor2028 = ['DE','IN','MO','MT','NH','NC','ND','UT','VT','WA','WV'];
const electoralVotes = JSON.parse(readFileSync('data/features/map-maker/cycles.json', 'utf8')).cycles['2028'].electoralVotes;
const president2028 = Object.keys(electoralVotes).map((key) => {
  if (key.includes('-')) {
    const [state, district] = key.split('-');
    return {id: `president-${key}`, type: 'president', state, district};
  }
  return {id: `president-${key}`, type: 'president', state: key};
});
const races2028 = [
  ...races2026.filter((r) => r.type === 'house'),
  ...senate2028.map((state) => ({id: `senate-${state}`, type: 'senate', state})),
  ...governor2028.map((state) => ({id: `governor-${state}`, type: 'governor', state})),
  ...president2028
];
writeFileSync(
  'data/features/map-maker/races-2028.json',
  JSON.stringify({schemaVersion: 1, cycle: 2028, races: races2028}) + '\n'
);

console.log(`Map maker catalogues: 2026=${races2026.length}, 2027=${races2027.length}, 2028=${races2028.length}`);
