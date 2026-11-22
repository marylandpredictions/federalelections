(function(root){
  const ratings=['Safe Democratic','Likely Democratic','Lean Democratic','Tilt Democratic','Tossup','Tilt Republican','Lean Republican','Likely Republican','Safe Republican','Safe Independent','Likely Independent','Lean Independent','Tilt Independent'];
  const defaultOffices=['house','senate','governor'];
  const stateFips={AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56'};
  const parties=new Set(['D','R','I']);

  function ratingFromParty(party){
    if(party==='D')return 'Safe Democratic';
    if(party==='R')return 'Safe Republican';
    if(party==='I')return 'Safe Independent';
    return 'Tossup';
  }

  function validUnit(id,catalogue){
    const [raceId,unit,...rest]=id.split('@');
    const race=catalogue.find(r=>r.id===raceId);
    if(!race||rest.length||!unit)return false;
    if(/^ward-\d{1,2}$/i.test(unit))return race.type==='mayor'&&(race.detailMode==='wards'||race.subdivisionKind==='wards');
    if(/^district-\d{1,2}$/i.test(unit))return race.type==='mayor'&&(race.detailMode==='council'||race.subdivisionKind==='council'||race.detailMode==='city');
    if(/^tract-\d{6}$/i.test(unit))return race.type==='mayor'&&(race.detailMode==='tracts'||race.subdivisionKind==='tracts');
    if(/^\d{5}(\d{5})?$/.test(unit))return unit.startsWith(stateFips[race.state]||'__');
    return false;
  }

  function cleanCandidates(value,ids){
    const out={};
    if(value===undefined)return out;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid candidates.');
    for(const [raceId,list] of Object.entries(value)){
      if(!ids.has(raceId)||!Array.isArray(list)||list.length>20)throw Error('Unknown race candidates.');
      out[raceId]=list.map((c,i)=>{
        if(!c||typeof c!=='object'||typeof c.name!=='string'||!c.name.trim()||c.name.length>80||!parties.has(c.party))throw Error('Invalid candidate.');
        return {id:String(c.id||`c${i+1}`).slice(0,40),name:c.name.trim(),party:c.party};
      });
    }
    return out;
  }

  function cleanWinners(value,ids,candidates){
    const out={};
    if(value===undefined)return out;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid winners.');
    for(const [raceId,winnerId] of Object.entries(value)){
      if(!ids.has(raceId)||typeof winnerId!=='string')throw Error('Unknown winner.');
      const roster=candidates[raceId]||[];
      if(!roster.some(c=>c.id===winnerId))throw Error('Winner must be a candidate in that race.');
      out[raceId]=winnerId;
    }
    return out;
  }

  function validate(value, catalogue, options={}){
    const offices=options.offices||defaultOffices;
    const schemaVersion=value?.schemaVersion===2?2:1;
    if(!value||![1,2].includes(value.schemaVersion)||!offices.includes(value.office)||typeof value.title!=='string'||value.title.length>80||!value.ratings||Array.isArray(value.ratings)||typeof value.ratings!=='object')throw Error('This is not a supported FEA scenario file.');
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
    const candidates=schemaVersion===2?cleanCandidates(value.candidates,ids):{};
    const winners=schemaVersion===2?cleanWinners(value.winners,ids,candidates):{};
    const tickets=cleanTickets(value.tickets);
    return {schemaVersion,title:value.title,office:value.office,ratings:clean,countyRatings,candidates,winners,tickets};
  }

  function cleanTickets(value){
    const out={D:'Democratic',R:'Republican'};
    if(value===undefined)return out;
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid tickets.');
    for(const party of ['D','R']){
      if(value[party]===undefined)continue;
      if(typeof value[party]!=='string'||!value[party].trim()||value[party].length>40)throw Error('Invalid ticket name.');
      out[party]=value[party].trim();
    }
    return out;
  }

  function electoralKey(race){
    if(!race)return '';
    if(race.evUnit)return String(race.evUnit);
    const state=String(race.state||'').toUpperCase();
    if((state==='ME'||state==='NE')&&race.district!=null&&String(race.district)!==''){
      const d=String(race.district).toUpperCase();
      return d==='AL'||d==='0'?`${state}-AL`:`${state}-${Number(d)||d}`;
    }
    return state;
  }

  class Scenario {
    constructor(catalogue,state,options={}){
      this.catalogue=catalogue;
      this.ids=new Set(catalogue.map(r=>r.id));
      this.offices=options.offices||defaultOffices;
      this.heldSeats=options.heldSeats||{house:{D:0,R:0,I:0},senate:{D:34,R:31,I:0},governor:{D:6,R:8,I:0}};
      this.electoralVotes=options.electoralVotes||null;
      this.defaultTitle=options.defaultTitle||'My election map';
      this.defaultOffice=options.defaultOffice||this.offices[0];
      this.state=state?validate(state,catalogue,{offices:this.offices}):{
        schemaVersion:options.schemaVersion||1,
        title:this.defaultTitle,
        office:this.defaultOffice,
        ratings:{},
        countyRatings:{},
        candidates:{},
        winners:{},
        tickets:{D:'Democratic',R:'Republican'}
      };
      if(!this.state.candidates)this.state.candidates={};
      if(!this.state.winners)this.state.winners={};
      if(!this.state.tickets)this.state.tickets={D:'Democratic',R:'Republican'};
      this.past=[];
      this.future=[];
    }
    ticket(party){return this.state.tickets?.[party]||(party==='D'?'Democratic':'Republican');}
    setTickets(next){
      const cleaned=cleanTickets(next);
      const before={tickets:{...this.state.tickets}};
      this.state.tickets=cleaned;
      this.state.schemaVersion=Math.max(this.state.schemaVersion||1,2);
      this.past.push({type:'meta',before:{...before,candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}},after:{tickets:{...cleaned},candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}}});
      if(this.past.length>100)this.past.shift();
      this.future=[];
      return true;
    }
    rating(id){return (id.includes('@')?this.state.countyRatings:this.state.ratings)[id]||'Tossup';}
    candidates(raceId){return this.state.candidates[raceId]||[];}
    winner(raceId){return this.state.winners[raceId]||null;}
    winnerCandidate(raceId){const id=this.winner(raceId);return this.candidates(raceId).find(c=>c.id===id)||null;}
    setCandidates(raceId,list){
      if(!this.ids.has(raceId))throw Error('Unknown race.');
      const before={candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}};
      const cleaned=cleanCandidates({[raceId]:list},this.ids)[raceId]||[];
      if(cleaned.length)this.state.candidates[raceId]=cleaned;else delete this.state.candidates[raceId];
      if(this.state.winners[raceId]&&!cleaned.some(c=>c.id===this.state.winners[raceId])){
        delete this.state.winners[raceId];
        delete this.state.ratings[raceId];
      }
      this.state.schemaVersion=2;
      this.past.push({type:'meta',before,after:{candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}}});
      if(this.past.length>100)this.past.shift();
      this.future=[];
      return true;
    }
    setWinner(raceId,candidateId){
      if(!this.ids.has(raceId))throw Error('Unknown race.');
      const roster=this.candidates(raceId);
      const before={candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}};
      if(!candidateId){
        delete this.state.winners[raceId];
        delete this.state.ratings[raceId];
      }else{
        const cand=roster.find(c=>c.id===candidateId);
        if(!cand)throw Error('Winner must be a candidate in that race.');
        this.state.winners[raceId]=candidateId;
        this.state.ratings[raceId]=ratingFromParty(cand.party);
      }
      this.state.schemaVersion=2;
      this.past.push({type:'meta',before,after:{candidates:structuredClone(this.state.candidates),winners:structuredClone(this.state.winners),ratings:{...this.state.ratings}}});
      if(this.past.length>100)this.past.shift();
      this.future=[];
      return true;
    }
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
    undo(){
      const entry=this.past.pop();
      if(!entry)return false;
      if(entry.type==='meta'){
        this.state.candidates=entry.before.candidates;
        this.state.winners=entry.before.winners;
        this.state.ratings=entry.before.ratings;
        if(entry.before.tickets)this.state.tickets=entry.before.tickets;
        this.future.push(entry);
        return true;
      }
      for(const [id,before] of entry)this.assign(id,before);
      this.future.push(entry);
      return true;
    }
    redo(){
      const entry=this.future.pop();
      if(!entry)return false;
      if(entry.type==='meta'){
        this.state.candidates=entry.after.candidates;
        this.state.winners=entry.after.winners;
        this.state.ratings=entry.after.ratings;
        if(entry.after.tickets)this.state.tickets=entry.after.tickets;
        this.past.push(entry);
        return true;
      }
      for(const [id,,after] of entry)this.assign(id,after);
      this.past.push(entry);
      return true;
    }
    counts(office){
      const counts={D:0,R:0,I:0,T:0};
      for(const r of this.catalogue.filter(r=>r.type===office)){
        const rating=this.rating(r.id);
        counts[rating.endsWith('Democratic')?'D':rating.endsWith('Republican')?'R':rating.endsWith('Independent')?'I':'T']++;
      }
      return counts;
    }
    totalCounts(office){
      const counts=this.counts(office);
      for(const party of ['D','R','I'])counts[party]+=this.heldSeats[office]?.[party]||0;
      return counts;
    }
    electoralVotesFor(race){
      if(!this.electoralVotes||!race)return 0;
      const key=electoralKey(race);
      return Number(this.electoralVotes[key]??this.electoralVotes[race.state])||0;
    }
    electoralCounts(){
      const counts={D:0,R:0,I:0,T:0};
      if(!this.electoralVotes)return counts;
      for(const r of this.catalogue.filter(r=>r.type==='president')){
        const ev=this.electoralVotesFor(r);
        const rating=this.rating(r.id);
        const key=rating.endsWith('Democratic')?'D':rating.endsWith('Republican')?'R':rating.endsWith('Independent')?'I':'T';
        counts[key]+=ev;
      }
      return counts;
    }
  }

  const api={ratings,offices:defaultOffices,heldSeats:{house:{D:0,R:0,I:0},senate:{D:34,R:31,I:0},governor:{D:6,R:8,I:0}},stateFips,validUnit,validate,ratingFromParty,electoralKey,cleanTickets,Scenario};
  root.FEAScenario=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
