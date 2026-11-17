import {check,intersects} from './engine.js';

// Transfers complete group/subgroup assignments; never changes their day, pair or room.
// Day evacuation may accept a neutral intermediate move, but commits only an improving transaction.
export function compactSchedule(project,{movableIds,deadline,respectTarget,onProgress=()=>{}},scoreTeacher,metricsTeacher){
 let current=project,moves=0,freedVisits=0,passes=0,limited=false;
 const teachers=new Map(project.teachers.map(t=>[t.id,t]));
 function index(p){const byTeacher=new Map(p.teachers.map(t=>[t.id,[]])),units=new Map();for(const a of p.assignments){byTeacher.get(a.teacher).push(a);const key=`${a.group}|${a.sub}`;if(!units.has(key))units.set(key,[]);units.get(key).push(a)}return{byTeacher,units}}
 function proposals(p,idx,unit,source,limit=5,allowGaps=false){const result=[],ids=new Set(unit.map(a=>a.id)),before=idx.byTeacher.get(source),remaining=before.filter(a=>!ids.has(a.id));
  if(unit.some(a=>a.teacher!==source))return result;
  const g=p.groups.find(g=>g.id===unit[0].group),weight=unit.reduce((n,a)=>n+(a.week==='both'?1:.5),0);
  for(const t of p.teachers){if(Date.now()>=deadline){limited=true;break}if(t.id===source||t.forbiddenGroups?.includes(g.code))continue;const aa=idx.byTeacher.get(t.id);
   if(respectTarget&&t.target!=null&&aa.reduce((n,a)=>n+(a.week==='both'?1:.5),0)+weight>t.target)continue;
   if(aa.some(a=>a.group===g.id&&a.sub!==unit[0].sub)||unit.some(a=>t.blocked.includes(`${a.day}:${a.pair}`)||aa.some(b=>intersects(a,b))))continue;
   const batch=unit.map(a=>({...a,teacher:t.id})),after=aa.concat(batch);
   const gapsBefore=metricsTeacher(before).gaps+metricsTeacher(aa).gaps,gapsAfter=metricsTeacher(remaining).gaps+metricsTeacher(after).gaps;
   if(!allowGaps&&gapsAfter>gapsBefore)continue;
   const delta=scoreTeacher(teachers.get(source),remaining)+scoreTeacher(t,after)-scoreTeacher(teachers.get(source),before)-scoreTeacher(t,aa);
   result.push({target:t.id,batch,delta,gapDelta:gapsAfter-gapsBefore});
  }
  return result.sort((a,b)=>a.delta-b.delta).slice(0,limit);
 }
 // A single pass is bounded by the search deadline. Repeat after improvements to unlock combinations.
 while(Date.now()<deadline&&passes<6){passes++;let improved=false;let idx=index(current);
  const unitEntries=[...idx.units.values()].filter(unit=>unit.every(a=>movableIds.has(a.id)));
  const urgency=unit=>{const aa=idx.byTeacher.get(unit[0].teacher);return aa.length+unit.length/100};unitEntries.sort((a,b)=>urgency(a)-urgency(b));
  for(const original of unitEntries){if(Date.now()>=deadline){limited=true;break}const unit=current.assignments.filter(a=>original.some(b=>a.id===b.id));const source=unit[0].teacher;
   const best=proposals(current,idx,unit,source,1)[0];if(!best||best.delta>=-0.001)continue;
   const replacements=new Map(best.batch.map(a=>[a.id,a]));current={...current,assignments:current.assignments.map(a=>replacements.get(a.id)||a)};moves+=unit.length;improved=true;idx=index(current);
  }
  // Empty a short day in one transaction, even when its first transfer has no immediate benefit.
  const attempted=new Set();outer:for(const t of current.teachers)for(const week of ['I','II'])for(let day=0;day<6;day++){
   if(Date.now()>=deadline){limited=true;break outer}const aa=idx.byTeacher.get(t.id),dayRows=aa.filter(a=>a.day===day&&(a.week===week||a.week==='both'));if(!dayRows.length||dayRows.length>2)continue;
   const keys=[...new Set(dayRows.map(a=>`${a.group}|${a.sub}`))],signature=t.id+'|'+keys.slice().sort().join(';');if(attempted.has(signature))continue;attempted.add(signature);
   const units=keys.map(key=>idx.units.get(key));if(units.some(unit=>unit.some(a=>a.teacher!==t.id||!movableIds.has(a.id))))continue;
   let states=[{p:current,delta:0,gapDelta:0}];for(const unit of units){const next=[];for(const state of states){if(Date.now()>=deadline){limited=true;break}const si=index(state.p);for(const move of proposals(state.p,si,unit,t.id,4,true)){const replacements=new Map(move.batch.map(a=>[a.id,a]));next.push({p:{...state.p,assignments:state.p.assignments.map(a=>replacements.get(a.id)||a)},delta:state.delta+move.delta,gapDelta:state.gapDelta+move.gapDelta})}}states=next.sort((a,b)=>a.delta-b.delta).slice(0,6);if(!states.length)break}
   const best=states.find(s=>s.delta<-.001&&s.gapDelta<=0);if(best){current=best.p;improved=true;moves+=units.reduce((n,u)=>n+u.length,0);idx=index(current)}
  }
  onProgress({stage:'compact',moves,passes});if(!improved||limited)break;
 }
 const before=index(project),after=index(current);for(const t of project.teachers)freedVisits+=metricsTeacher(before.byTeacher.get(t.id)).visits-metricsTeacher(after.byTeacher.get(t.id)).visits;
 // Shared validation is the final guard against accidental transfer conflicts.
 for(const a of current.assignments)if(movableIds.has(a.id)){const c=check(current,a,a.id);if(c.errors.length)throw Error('Ошибка уплотнения: '+c.errors.join(' · '))}
 const originalTeachers=new Map(project.assignments.map(a=>[a.id,a.teacher]));const changed=current.assignments.filter(a=>a.teacher!==originalTeachers.get(a.id)).length;return{project:current,moves:changed,freedVisits,passes,limited};
}
