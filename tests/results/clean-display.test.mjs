import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),display=require('../../assets/clean-display.js'),T=require('../../assets/desk-theme.js');
test('Clean display rejects malformed, oversized and unordered protocol values',()=>{
 const frame={type:'frame',sequence:1,html:'<svg></svg>',bodyClass:'results-board',bodyStyle:'',styles:[]};
 assert.equal(display.validFrame(frame),true);
 for(const invalid of [{...frame,type:'call'},{...frame,sequence:NaN},{...frame,sequence:0},{...frame,sequence:1.5},{...frame,html:'x'.repeat(display.MAX_BYTES+1)},{...frame,styles:Array(30).fill('x')},{...frame,bodyStyle:'x'.repeat(20000)},null])assert.equal(display.validFrame(invalid),false);
});
test('Clean display is isolated from feed polling and local preferences; page integrations use one shared receiver',()=>{
 const code=readFileSync('assets/clean-display.js','utf8');
 assert.doesNotMatch(code,/fetch\(|localStorage|sessionStorage|\/api\//);
 assert.match(code,/x.sequence<=received/);assert.match(code,/pending=x/);assert.match(code,/setTimeout\(capture,350\)/);
 assert.match(code,/script,iframe,object,embed/);assert.match(code,/observer\?\.disconnect/);
 for(const page of ['features/map-maker.html','results.html','election-night.html'])assert.equal((readFileSync(page,'utf8').match(/src="\/assets\/clean-display.js/g)||[]).length,1);
});
test('NBC slate surfaces are readable, coordinated, and migrate only untouched built-in tokens',()=>{
 const theme=T.presets.find(t=>t.id==='nbc-big-board'),resolved=T.resolve(theme);
 assert.deepEqual(resolved.warnings,[]);
 for(const surface of ['panel-bg','control-bg','tooltip-bg','projection-bg','poll-bg','tray-bg','pin-bg','race-window-bg'])assert.ok(T.contrast(resolved.tokens['text-primary'],resolved.tokens[surface])>=4.5,surface);
 const old={...theme,advanced:{'panel-bg':'#ffffff','panel-raised':'#eef3f9','text-primary':'#102b50','text-secondary':'#3d526c','tooltip-bg':'#123456'}};
 const read=current=>T.read({getItem:()=>JSON.stringify({schemaVersion:1,current,saved:[]})}).current;
 const migrated=read(old);assert.equal(migrated.advanced['panel-bg'],'#20334a');assert.equal(migrated.advanced['tooltip-bg'],'#123456');assert.equal(migrated.advanced['projection-bg'],'#20334a');
 assert.equal(read({...old,id:'saved-custom'}).advanced['panel-bg'],'#ffffff');
});
