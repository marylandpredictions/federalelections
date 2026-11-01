import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {historicalTooltip}=createRequire(import.meta.url)('../../assets/results-ui.js');
test('Historical tooltips reuse the live title, table and footer without implying a public projection',()=>{
 const html=historicalTooltip({total:100,candidates:[{name:'Independent <name>',party:'I',votes:55},{name:'Republican',party:'R',votes:45}]},{name:'Amherst',label:'2024 presidential result',color:()=> '#123456'});
 for(const cls of ['election-map-tooltip-title','election-map-tooltip-muted','election-map-tooltip-table','election-map-tooltip-foot','tooltip-party-bar'])assert.ok(html.includes(cls));
 assert.match(html,/Independent &lt;name&gt;/);assert.match(html,/55\.0%/);assert.match(html,/Lead I \+10\.0/);assert.doesNotMatch(html,/PROJECTS|Projected winner|tooltip-call-mark/);
});
test('Historical tooltip gaps remain explicit; many candidates aggregate only the remaining raw votes',()=>{
 assert.match(historicalTooltip(null),/No verified comparable result/);
 const html=historicalTooltip({total:100,round:'first-choice',candidates:[60,25,10,3,2].map((votes,i)=>({name:'Person '+i,party:'O',votes}))});
 assert.equal((html.match(/<tr>/g)||[]).length,5);assert.match(html,/Other candidates/);assert.match(html,/>5<\/td><td>5\.0%/);assert.match(html,/First-choice historical returns/);
});
