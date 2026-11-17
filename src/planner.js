import {compactSchedule} from './planner-compact.js';
import {uid,groupReady,slotReady,check,load,slotBundle,validate,intersects} from './engine.js';

const key=a=>`${a.group}|${a.slot}|${a.sub}`;
const popcount=Array.from({length:128},(_,n)=>n.toString(2).replaceAll('0','').length);
function teacherMetrics(assignments){const masks=Array(12).fill(0),halfMasks=Array(12).fill(0);for(const a of assignments){if(a.week!=='II')masks[a.day]|=1<<(a.pair-1);if(a.week!=='I')masks[6+a.day]|=1<<(a.pair-1);if(a.week==='I')halfMasks[a.day]|=1<<(a.pair-1);if(a.week==='II')halfMasks[6+a.day]|=1<<(a.pair-1)}let gaps=0,visits=0,shortDays=0;const days=[0,0];for(let i=0;i<12;i++){const mask=masks[i];if(!mask)continue;visits++;days[Math.floor(i/6)]++;const count=popcount[mask];if(count<=2)shortDays++;const first=31-Math.clz32(mask&-mask),last=31-Math.clz32(mask);gaps+=last-first+1-count}let pairedAlternating=0,unpairedAlternating=0;for(let day=0;day<6;day++){pairedAlternating+=popcount[halfMasks[day]&halfMasks[6+day]];unpairedAlternating+=popcount[halfMasks[day]^halfMasks[6+day]]}return{gaps,visits,shortDays,maxDays:Math.max(...days),days,pairedAlternating,unpairedAlternating}}
export function scheduleMetrics(p){const teachers=new Map(p.teachers.map(t=>[t.id,[]]));for(const a of p.assignments)teachers.get(a.teacher)?.push(a);const total={gaps:0,visits:0,shortDays:0,maxDays:0,pairedAlternating:0,unpairedAlternating:0};for(const assignments of teachers.values()){const m=teacherMetrics(assignments);total.gaps+=m.gaps;total.visits+=m.visits;total.shortDays+=m.shortDays;total.maxDays=Math.max(total.maxDays,m.maxDays);total.pairedAlternating+=m.pairedAlternating;total.unpairedAlternating+=m.unpairedAlternating}return total}
function teacherScore(t,assignments,options){const m=teacherMetrics(assignments);let score=m.gaps*240+m.visits*110+m.shortDays*70+m.unpairedAlternating*90-m.pairedAlternating*20;for(const days of m.days)score+=Math.max(0,days-options.maxDays)**2*240;let workload=0;for(const a of assignments){workload+=a.week==='both'?1:.5;if(t.avoid.includes(`${a.day}:${a.pair}`))score+=45;if(t.wants?.includes(options.groups.get(a.group)?.code))score-=15;if(!a.room)score+=3;const old=options.previous?.get(key(a));if(old&&(old.teacher!==a.teacher||old.day!==a.day||old.pair!==a.pair))score+=20}if(t.target!=null)score+=Math.max(0,workload-t.target)*500;return score}
function scoreIndex(p,options,cache){let index=cache.get(p);if(index)return index;const assignments=new Map(p.teachers.map(t=>[t.id,[]])),scores=new Map();for(const a of p.assignments)assignments.get(a.teacher)?.push(a);let total=0;for(const t of p.teachers){const score=teacherScore(t,assignments.get(t.id),options);scores.set(t.id,score);total+=score}index={assignments,scores,total};cache.set(p,index);return index}
export function planSchedule(project,settings={},onProgress=()=>{}){
 validate(project);const options={days:[0,1,2,3,4,5],mode:'fill',group:'',teacher:'',maxDays:4,respectTarget:true,timeLimit:4000,beamWidth:5,...settings};
 if(!options.days.length||options.days.some(d=>!Number.isInteger(d)||d<0||d>5))throw Error('Выберите дни Пн–Сб');
 if(!Number.isFinite(options.timeLimit))throw Error('Неверный лимит поиска');if(!['fill','repair','compact'].includes(options.mode)||!Number.isInteger(options.maxDays)||options.maxDays<1||options.maxDays>6)throw Error('Неверные параметры мастера');
 onProgress({stage:'prepare',processed:0,total:0});const start=Date.now(),base=structuredClone(project),oldByKey=new Map(project.assignments.map(a=>[key(a),a]));
 const inScope=a=>options.days.includes(a.day)&&(!options.group||a.group===options.group)&&(!options.teacher||a.teacher===options.teacher);
 const protectedGroups=new Set(project.assignments.filter(a=>a.locked).map(a=>a.group));
 // Preserve the entire group when any of its appointments is pinned.
 if(options.mode==='repair')base.assignments=base.assignments.filter(a=>!inScope(a)||protectedGroups.has(a.group));
 options.previous=oldByKey;options.groups=new Map(base.groups.map(g=>[g.id,g]));const scores=new WeakMap();const quality=p=>scoreIndex(p,options,scores).total;for(const a of base.assignments){const c=check(base,a,a.id);if(c.errors.length)throw Error('Сначала исправьте сохранённые конфликты или выберите перерасстановку: '+c.errors.join(' · '))}const tasks=[],incomplete=[];
 for(const g of base.groups){if(options.mode==='compact')break;if(options.group&&g.id!==options.group)continue;if(options.teacher&&!project.assignments.some(a=>a.group===g.id&&a.teacher===options.teacher))continue;
  if(!groupReady(g)){const missing=[];if(!Number.isInteger(g.count)||g.count<1)missing.push('численность');if(g.split&&(!Number.isInteger(g.size1)||g.size1<1||g.size1>=g.count))missing.push('размеры подгрупп');if(!g.slots.length)missing.push('занятия');else if(!g.slots.every(slotReady))missing.push('день, пара или тип недели');incomplete.push({group:g.id,reason:'Уточните в карточке: '+missing.join(', '),kind:'incomplete'});continue}
  const seen=new Set();for(const s of g.slots){const choices=s.options.filter(o=>options.days.includes(o.day)).map(o=>slotBundle(g,s.id,o));if(!choices.length)continue;
   // Only combine a pair when the bundle is identical for every option in both directions.
   const canonical=choices[0].map(a=>a.slot).sort().join('|');
   const atomic=choices.every(b=>b.map(a=>a.slot).sort().join('|')===canonical)&&choices[0].every(a=>g.slots.find(s=>s.id===a.slot).options.every(o=>slotBundle(g,a.slot,o).map(x=>x.slot).sort().join('|')===canonical));
   const bundles=atomic?choices:s.options.filter(o=>options.days.includes(o.day)).map(o=>[{slot:s.id,...o}]);
   const slots=atomic?choices[0].map(a=>a.slot):[s.id];const taskKey=slots.slice().sort().join('|');if(seen.has(taskKey))continue;seen.add(taskKey);
   for(let sub=1;sub<=(g.split?2:1);sub++){
    const missing=slots.filter(slot=>!base.assignments.some(a=>a.group===g.id&&a.slot===slot&&a.sub===sub));if(!missing.length)continue;
    tasks.push({g,s,sub,choices:bundles.map(b=>b.filter(a=>missing.includes(a.slot))),size:missing.length});
   }
  }
 }
 function candidates(state,task,limit=10,diagnostic=false){const {g,s,sub}=task,reasons=new Set(),results=[];const index=diagnostic?null:scoreIndex(state,options,scores);
  const same=state.assignments.filter(a=>a.group===g.id&&a.sub===sub),teachers=base.teachers.filter(t=>!same.length||same.every(a=>a.teacher===t.id));
  if(!base.teachers.length)reasons.add('Нет преподавателей');if(same.length&&!teachers.length)reasons.add('У подгруппы уже разные преподаватели: согласуйте закрепление');
  for(const teacher of teachers)for(const choice of task.choices){const temp={...state,assignments:state.assignments.slice()},batch=[];let valid=true;
   if(teacher.forbiddenGroups?.includes(g.code)){reasons.add('Группа запрещена преподавателю');continue}
   if(state.assignments.some(a=>a.group===g.id&&a.sub!==sub&&a.teacher===teacher.id)){reasons.add('Другую подгруппу ведёт тот же преподаватель');continue}
   for(const o of choice){const old=oldByKey.get(key({group:g.id,slot:o.slot,sub})),a={id:old?.id||uid(),group:g.id,slot:o.slot,sub,teacher:teacher.id,room:'',day:o.day,pair:o.pair,week:g.slots.find(s=>s.id===o.slot).week};
    const c=check(temp,a);if(c.errors.length){c.errors.forEach(e=>reasons.add(e));valid=false;break}
    if(options.respectTarget&&teacher.target!=null&&load(temp,teacher.id)+(a.week==='both'?1:.5)>teacher.target){reasons.add('Достигнута норма нагрузки');valid=false;break}
    const size=g.split?(sub===1?g.size1:g.count-g.size1):g.count;
    const rooms=base.rooms.filter(r=>r.capacity==null||r.capacity>=size).sort((a,b)=>Number(b.id===batch[0]?.room)-Number(a.id===batch[0]?.room)||(a.capacity??1e6)-(b.capacity??1e6));
    const room=rooms.find(r=>!temp.assignments.some(b=>b.room===r.id&&intersects(a,b)));if(room)a.room=room.id;
    batch.push(a);temp.assignments.push(a);
   }
   if(valid){if(diagnostic)return{results:[{batch}],reasons:[...reasons]};results.push({batch,score:index.total-index.scores.get(teacher.id)+teacherScore(teacher,index.assignments.get(teacher.id).concat(batch),options)})}
  }
  results.sort((a,b)=>a.score-b.score);return{results:results.slice(0,limit),reasons:[...reasons]};
 }
 // Schedule scarce choices first; both subgroups remain coupled through conflict checks.
 for(const task of tasks)task.scarcity=base.teachers.filter(t=>!t.forbiddenGroups?.includes(task.g.code)&&(!options.respectTarget||t.target==null||t.target>=task.size*(task.s.week==='both'?1:.5))&&task.choices.some(b=>b.every(o=>!t.blocked.includes(`${o.day}:${o.pair}`)))).length*task.choices.length;
 tasks.sort((a,b)=>a.scarcity-b.scarcity||b.size-a.size||a.g.id.localeCompare(b.g.id)||a.sub-b.sub);
 onProgress({stage:'search',processed:0,total:tasks.length});let lastProgress=Date.now();
 let beam=[{p:base,missing:0,score:quality(base)}],processed=0,timedOut=false;
 for(const task of tasks){if(Date.now()-start>options.timeLimit*.75){timedOut=true;break}const next=[];
  for(const state of beam){const {results}=candidates(state.p,task);for(const c of results)next.push({p:{...state.p,assignments:state.p.assignments.concat(c.batch)},missing:state.missing,score:c.score});next.push({...state,missing:state.missing+task.size})}
  next.sort((a,b)=>a.missing-b.missing||a.score-b.score);beam=next.slice(0,options.beamWidth);processed++;if(Date.now()-lastProgress>=150){onProgress({stage:'search',processed,total:tasks.length});lastProgress=Date.now()}
 }
 onProgress({stage:'finish',processed,total:tasks.length});let result=beam[0].p;if(options.mode==='repair'&&project.assignments.length>=result.assignments.length&&project.assignments.every(a=>!check(project,a,a.id).errors.length)&&(!options.respectTarget||project.teachers.every(t=>t.target==null||load(project,t.id)<=t.target))&&(project.assignments.length>result.assignments.length||quality(project)<quality(result)))result=structuredClone(project);
 const movableIds=new Set(result.assignments.filter(a=>!protectedGroups.has(a.group)&&inScope(oldByKey.get(key(a))||a)&&(options.mode!=='fill'||!oldByKey.has(key(a)))).map(a=>a.id));
 onProgress({stage:'compact',processed,total:tasks.length,moves:0});const compacted=compactSchedule(result,{movableIds,deadline:start+options.timeLimit,respectTarget:options.respectTarget,onProgress:p=>onProgress({...p,processed,total:tasks.length})},(t,aa)=>teacherScore(t,aa,options),teacherMetrics);result=compacted.project;
 onProgress({stage:'finish',processed,total:tasks.length});validate(result);
 const unresolved=[...incomplete];for(const task of tasks){const missing=task.choices[0].filter(o=>!result.assignments.some(a=>a.group===task.g.id&&a.slot===o.slot&&a.sub===task.sub));if(!missing.length)continue;
  if(timedOut&&tasks.indexOf(task)>=processed){unresolved.push({group:task.g.id,sub:task.sub,kind:'timeout',reason:'Поиск не дошёл до этого занятия: достигнут лимит времени. Примените частичный результат и продолжите.'});continue}const c=candidates(result,task,1,true);unresolved.push({group:task.g.id,sub:task.sub,reason:c.results.length?'Не выбрано в пределах поиска; попробуйте другой день или расширьте перерасстановку':c.reasons.join(' · ')||'Нет допустимых вариантов'})}
 const oldIds=new Map(project.assignments.map(a=>[key(a),a])),newIds=new Map(result.assignments.map(a=>[key(a),a]));
 const added=result.assignments.filter(a=>!oldIds.has(key(a))),changed=result.assignments.filter(a=>{const old=oldIds.get(key(a));return old&&JSON.stringify(old)!==JSON.stringify(a)}),removed=project.assignments.filter(a=>!newIds.has(key(a)));
 return{project:result,mode:options.mode,compaction:{moves:compacted.moves,freedVisits:compacted.freedVisits,limited:compacted.limited},added,changed,removed,unresolved,before:scheduleMetrics(project),after:scheduleMetrics(result),timedOut,processed,total:tasks.length,warnings:result.assignments.flatMap(a=>check(result,a,a.id).warnings.filter(w=>w!=='Преподаватель просил эту группу').map(w=>({group:a.group,text:w}))) };
}
