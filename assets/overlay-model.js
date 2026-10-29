/* Public snapshots/deltas only. No provider-call or winner-flag inference. */
(function(root){
  class Model {
    constructor(storage){this.races=new Map();this.version=null;this.provider={};this.tracker=new root.FEADesk.CallTracker(storage,'fea-obs-call-events-v2');}
    accept(payload){
      if(typeof payload?.version!=='string'||!payload.version)throw Error('Invalid results version');
      const full=Array.isArray(payload.groups);
      const rows=full?payload.groups.flatMap(g=>g.races||[]):payload.races;
      if(!Array.isArray(rows)||(full&&!rows.length))throw Error('Snapshot unavailable');
      const ids=new Set();
      for(const r of rows){
        if(typeof r?.id!=='string'||!r.id||ids.has(r.id)||!Array.isArray(r.candidates)||!r.candidates.length||r.candidates.some(c=>!c.name||!Number.isFinite(c.votes)||c.votes<0)||!Array.isArray(r.calls)||r.calls.some(c=>!r.candidates.some(k=>k.name===c.candidate)))throw Error('Invalid public race');
        ids.add(r.id);
      }
      const next=full?new Map():new Map(this.races);
      for(const r of rows)next.set(r.id,r);
      for(const id of payload.removedRaceIds||[])next.delete(id);
      const events=this.tracker.observe([...next.values()]);
      this.races=next;this.version=payload.version;
      if(payload.provider)this.provider=payload.provider;
      return events;
    }
    filtered({race,office}={}){return [...this.races.values()].filter(r=>(!race||r.id===race)&&(!office||r.type===office));}
  }
  class ProjectionQueue {
    constructor(){this.pending=[];this.active=null;}
    add(event){
      this.pending=this.pending.filter(e=>e.race.id!==event.race.id);
      if(this.active?.race.id===event.race.id){this.active=event;return true;}
      this.pending.push(event);if(this.pending.length>600)this.pending.shift();return false;
    }
    next(){this.active=this.pending.shift()||null;return this.active;}
    retain(ids){this.pending=this.pending.filter(e=>ids.has(e.race.id));if(this.active&&!ids.has(this.active.race.id)){this.active=null;return true;}return false;}
  }
  const api={Model,ProjectionQueue};root.FEAOverlay=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
