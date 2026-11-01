(function(root){
  const ratings=['Safe Democratic','Likely Democratic','Lean Democratic','Tilt Democratic','Tossup','Tilt Republican','Lean Republican','Likely Republican','Safe Republican','Safe Independent','Likely Independent','Lean Independent','Tilt Independent'];
  const offices=['house','senate','governor'];
  function validate(value, catalogue){
    if(!value||value.schemaVersion!==1||!offices.includes(value.office)||typeof value.title!=='string'||value.title.length>80||!value.ratings||Array.isArray(value.ratings)||typeof value.ratings!=='object')throw Error('This is not a supported FEA scenario file.');
    const ids=new Set(catalogue.map(r=>r.id)),clean={};
    if(Object.keys(value.ratings).length>catalogue.length)throw Error('Too many races in this file.');
    for(const [id,rating] of Object.entries(value.ratings)){
      if(!ids.has(id)||!ratings.includes(rating))throw Error('This file contains an unknown race or rating.');
      if(rating!=='Tossup')clean[id]=rating;
    }
    return {schemaVersion:1,title:value.title,office:value.office,ratings:clean};
  }
  class Scenario {
    constructor(catalogue,state){this.catalogue=catalogue;this.ids=new Set(catalogue.map(r=>r.id));this.state=state?validate(state,catalogue):{schemaVersion:1,title:'My 2026 election map',office:'house',ratings:{}};this.past=[];this.future=[];}
    rating(id){return this.state.ratings[id]||'Tossup';}
    apply(entries){
      const changes=[];
      for(const [id,rating] of new Map(entries)){
        if(!this.ids.has(id)||!ratings.includes(rating))throw Error('Unknown race or rating.');
        if(this.rating(id)!==rating)changes.push([id,this.rating(id),rating]);
      }
      if(!changes.length)return false;
      for(const [id,,rating] of changes)this.assign(id,rating);
      this.past.push(changes);if(this.past.length>100)this.past.shift();this.future=[];return true;
    }
    assign(id,rating){if(rating==='Tossup')delete this.state.ratings[id];else this.state.ratings[id]=rating;}
    undo(){const changes=this.past.pop();if(!changes)return false;for(const [id,before] of changes)this.assign(id,before);this.future.push(changes);return true;}
    redo(){const changes=this.future.pop();if(!changes)return false;for(const [id,,after] of changes)this.assign(id,after);this.past.push(changes);return true;}
    counts(office){const counts={D:0,R:0,I:0,T:0};for(const r of this.catalogue.filter(r=>r.type===office)){const rating=this.rating(r.id);counts[rating.endsWith('Democratic')?'D':rating.endsWith('Republican')?'R':rating.endsWith('Independent')?'I':'T']++;}return counts;}
  }
  const api={ratings,offices,validate,Scenario};root.FEAScenario=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
