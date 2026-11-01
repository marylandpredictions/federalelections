(function(root){
  const ratings=['Safe Democratic','Likely Democratic','Lean Democratic','Tilt Democratic','Tossup','Tilt Republican','Lean Republican','Likely Republican','Safe Republican','Safe Independent','Likely Independent','Lean Independent','Tilt Independent'];
  const offices=['house','senate','governor'];
  const stateFips={AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56'};
  function validUnit(id,catalogue){const [raceId,unit,...rest]=id.split('@'),race=catalogue.find(r=>r.id===raceId);return !!race&&!rest.length&&/^\d{5}(\d{5})?$/.test(unit||'')&&unit.startsWith(stateFips[race.state]);}
  function validate(value, catalogue){
    if(!value||value.schemaVersion!==1||!offices.includes(value.office)||typeof value.title!=='string'||value.title.length>80||!value.ratings||Array.isArray(value.ratings)||typeof value.ratings!=='object')throw Error('This is not a supported FEA scenario file.');
    const ids=new Set(catalogue.map(r=>r.id)),clean={};
    if(Object.keys(value.ratings).length>catalogue.length)throw Error('Too many races in this file.');
    for(const [id,rating] of Object.entries(value.ratings)){
      if(!ids.has(id)||!ratings.includes(rating))throw Error('This file contains an unknown race or rating.');
      if(rating!=='Tossup')clean[id]=rating;
    }
    const countyRatings={};
    if(value.countyRatings!==undefined){
      if(!value.countyRatings||typeof value.countyRatings!=='object'||Array.isArray(value.countyRatings)||Object.keys(value.countyRatings).length>50000)throw Error('Invalid county ratings.');
      for(const [id,rating] of Object.entries(value.countyRatings)){if(!validUnit(id,catalogue)||!ratings.includes(rating))throw Error('Unknown county or rating.');if(rating!=='Tossup')countyRatings[id]=rating;}
    }
    return {schemaVersion:1,title:value.title,office:value.office,ratings:clean,countyRatings};
  }
  class Scenario {
    constructor(catalogue,state){this.catalogue=catalogue;this.ids=new Set(catalogue.map(r=>r.id));this.state=state?validate(state,catalogue):{schemaVersion:1,title:'My 2026 election map',office:'house',ratings:{},countyRatings:{}};this.past=[];this.future=[];}
    rating(id){return (id.includes('@')?this.state.countyRatings:this.state.ratings)[id]||'Tossup';}
    apply(entries){
      const changes=[];
      for(const [id,rating] of new Map(entries)){
        if((!this.ids.has(id)&&!validUnit(id,this.catalogue))||!ratings.includes(rating))throw Error('Unknown race or rating.');
        if(this.rating(id)!==rating)changes.push([id,this.rating(id),rating]);
      }
      if(!changes.length)return false;
      for(const [id,,rating] of changes)this.assign(id,rating);
      this.past.push(changes);if(this.past.length>100)this.past.shift();this.future=[];return true;
    }
    assign(id,rating){const target=id.includes('@')?this.state.countyRatings:this.state.ratings;if(rating==='Tossup')delete target[id];else target[id]=rating;}
    undo(){const changes=this.past.pop();if(!changes)return false;for(const [id,before] of changes)this.assign(id,before);this.future.push(changes);return true;}
    redo(){const changes=this.future.pop();if(!changes)return false;for(const [id,,after] of changes)this.assign(id,after);this.past.push(changes);return true;}
    counts(office){const counts={D:0,R:0,I:0,T:0};for(const r of this.catalogue.filter(r=>r.type===office)){const rating=this.rating(r.id);counts[rating.endsWith('Democratic')?'D':rating.endsWith('Republican')?'R':rating.endsWith('Independent')?'I':'T']++;}return counts;}
  }
  const api={ratings,offices,stateFips,validUnit,validate,Scenario};root.FEAScenario=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
