import {uid,groupReady,check,load,slotBundle,validate} from './engine.js';

export function scheduleMetrics(p){
 let gaps=0,visits=0,shortDays=0,maxDays=0;
 for(const t of p.teachers)for(const week of ['I','II']){let count=0;for(let day=0;day<6;day++){
  const pairs=[...new Set(p.assignments.filter(a=>a.teacher===t.id&&a.day===day&&(a.week===week||a.week==='both')).map(a=>a.pair))].sort((a,b)=>a-b);
  if(!pairs.length)continue;count++;visits++;if(pairs.length<=2)shortDays++;gaps+=pairs.at(-1)-pairs[0]+1-pairs.length;
 }maxDays=Math.max(maxDays,count)}return{gaps,visits,shortDays,maxDays};
}
const key=a=>`${a.group}|${a.slot}|${a.sub}`;
function quality(p,options){const m=scheduleMetrics(p);let score=m.gaps*180+m.visits*65+m.shortDays*35;
 for(const t of p.teachers){const assignments=p.assignments.filter(a=>a.teacher===t.id);score+=assignments.filter(a=>t.avoid.includes(`${a.day}:${a.pair}`)).length*45;for(const w of ['I','II']){const days=new Set(assignments.filter(a=>a.week==='both'||a.week===w).map(a=>a.day)).size;score+=Math.max(0,days-options.maxDays)**2*240}if(t.target!=null)score+=Math.max(0,load(p,t.id)-t.target)*500}
 for(const a of p.assignments){const g=p.groups.find(g=>g.id===a.group);if(p.teachers.find(t=>t.id===a.teacher)?.wants?.includes(g.code))score-=15;if(!a.room)score+=3;const old=options.previous?.get(key(a));if(old&&(old.teacher!==a.teacher||old.day!==a.day||old.pair!==a.pair))score+=20}return score;
}
export function planSchedule(project,settings={}){
 validate(project);const options={days:[0,1,2,3,4,5],mode:'fill',group:'',teacher:'',maxDays:4,respectTarget:true,timeLimit:4000,beamWidth:5,...settings};
 if(!options.days.length||options.days.some(d=>!Number.isInteger(d)||d<0||d>5))throw Error('Выберите дни Пн–Сб');
 if(!['fill','repair'].includes(options.mode)||!Number.isInteger(options.maxDays)||options.maxDays<1||options.maxDays>6)throw Error('Неверные параметры мастера');
 const start=Date.now(),base=structuredClone(project),oldByKey=new Map(project.assignments.map(a=>[key(a),a]));
 const inScope=a=>options.days.includes(a.day)&&(!options.group||a.group===options.group)&&(!options.teacher||a.teacher===options.teacher);
 const protectedGroups=new Set(project.assignments.filter(a=>a.locked).map(a=>a.group));
 // Preserve the entire group when any of its appointments is pinned.
 if(options.mode==='repair')base.assignments=base.assignments.filter(a=>!inScope(a)||protectedGroups.has(a.group));
 options.previous=oldByKey;for(const a of base.assignments){const c=check(base,a,a.id);if(c.errors.length)throw Error('Сначала исправьте сохранённые конфликты или выберите перерасстановку: '+c.errors.join(' · '))}const tasks=[],incomplete=[];
 for(const g of base.groups){if(options.group&&g.id!==options.group)continue;if(options.teacher&&!project.assignments.some(a=>a.group===g.id&&a.teacher===options.teacher))continue;
  if(!groupReady(g)){incomplete.push({group:g.id,reason:'Заполните численность, размеры подгрупп и допустимое время'});continue}
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
 function candidates(state,task,limit=10,collect=false){const {g,s,sub}=task,reasons=new Set(),results=[];
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
    const room=rooms.find(r=>!check(temp,{...a,room:r.id}).errors.length);if(room)a.room=room.id;
    batch.push(a);temp.assignments.push(a);
   }
   if(valid)results.push({batch,score:quality(temp,options)});
  }
  results.sort((a,b)=>a.score-b.score);return{results:collect?results:results.slice(0,limit),reasons:[...reasons]};
 }
 // Schedule scarce choices first; both subgroups remain coupled through conflict checks.
 for(const task of tasks)task.scarcity=candidates(base,task,1).results.length?task.choices.length*base.teachers.filter(t=>!task.choices.every(b=>b.some(o=>t.blocked.includes(`${o.day}:${o.pair}`)))).length:0;
 tasks.sort((a,b)=>a.scarcity-b.scarcity||b.size-a.size||a.g.id.localeCompare(b.g.id)||a.sub-b.sub);
 let beam=[{p:base,missing:0,score:quality(base,options)}],processed=0,timedOut=false;
 for(const task of tasks){if(Date.now()-start>options.timeLimit){timedOut=true;break}const next=[];
  for(const state of beam){const {results}=candidates(state.p,task);for(const c of results)next.push({p:{...state.p,assignments:state.p.assignments.concat(c.batch)},missing:state.missing,score:c.score});next.push({...state,missing:state.missing+task.size})}
  next.sort((a,b)=>a.missing-b.missing||a.score-b.score);beam=next.slice(0,options.beamWidth);processed++;
 }
 let result=beam[0].p;if(options.mode==='repair'&&project.assignments.length===result.assignments.length&&project.assignments.every(a=>!check(project,a,a.id).errors.length)&&(!options.respectTarget||project.teachers.every(t=>t.target==null||load(project,t.id)<=t.target))&&quality(project,options)<quality(result,options))result=structuredClone(project);validate(result);
 const unresolved=[...incomplete];for(const task of tasks){const missing=task.choices[0].filter(o=>!result.assignments.some(a=>a.group===task.g.id&&a.slot===o.slot&&a.sub===task.sub));if(!missing.length)continue;
  const c=candidates(result,task,1);unresolved.push({group:task.g.id,sub:task.sub,reason:c.results.length?'Не выбрано в пределах поиска; попробуйте другой день или расширьте перерасстановку':c.reasons.join(' · ')||'Нет допустимых вариантов'})}
 const oldIds=new Map(project.assignments.map(a=>[key(a),a])),newIds=new Map(result.assignments.map(a=>[key(a),a]));
 const added=result.assignments.filter(a=>!oldIds.has(key(a))),changed=result.assignments.filter(a=>{const old=oldIds.get(key(a));return old&&JSON.stringify(old)!==JSON.stringify(a)}),removed=project.assignments.filter(a=>!newIds.has(key(a)));
 return{project:result,added,changed,removed,unresolved,before:scheduleMetrics(project),after:scheduleMetrics(result),timedOut,processed,total:tasks.length,warnings:result.assignments.flatMap(a=>check(result,a,a.id).warnings.filter(w=>w!=='Преподаватель просил эту группу').map(w=>({group:a.group,text:w}))) };
}
