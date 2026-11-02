/* Read-only presentation math; ratings and held-seat counts remain authoritative. */
(function(root){
 function segments(races,rating,held){
   const counts=new Map();for(const race of races){const label=rating(race.id);counts.set(label,(counts.get(label)||0)+1);}
   for(const [party,name] of [['D','Democratic'],['R','Republican'],['I','Independent']])if(held[party]){const label='Safe '+name;counts.set(label,(counts.get(label)||0)+held[party]);}
   const order=['Safe Republican','Likely Republican','Lean Republican','Tilt Republican','Tossup','Tilt Independent','Lean Independent','Likely Independent','Safe Independent','Tilt Democratic','Lean Democratic','Likely Democratic','Safe Democratic'];
   const total=[...counts.values()].reduce((n,v)=>n+v,0);let offset=0;
   return order.filter(label=>counts.get(label)).map(label=>{const count=counts.get(label),part={label,count,total,start:offset/total,fraction:count/total};offset+=count;return part;});
 }
 function color(T,rating,surface){
   if(rating==='Tossup')return T.resolved.tokens[T.current.presentation==='yapms'?'tossup':'map-neutral'];
   const party=rating.includes('Democratic')?'D':rating.includes('Republican')?'R':'I';
   if(T.current.presentation==='yapms'){
     const scales={D:['#2c54bc','#4f73d1','#7694e2','#a0b6ef'],R:['#b5312f','#cb5452','#dd7a78','#eba3a2']},scale=scales[party];
     if(scale&&T.candidateColor({party})===scale[0])return scale[['Safe','Likely','Lean','Tilt'].findIndex(level=>rating.startsWith(level))];
   }
   const tint=rating.startsWith('Safe')?0:rating.startsWith('Likely')?.2:rating.startsWith('Lean')?.4:.65;
   return T.mix(T.candidateColor({party}),T.current.presentation==='yapms'?'#ffffff':surface,tint);
 }
 const api={segments,color};root.FEAMakerTheme=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
