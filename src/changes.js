import {check,validate,slotBundle,intersects} from './engine.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function reviewChanges(before,next,label){
 validate(next);const old=new Map(before.assignments.map(a=>[a.id,a])),now=new Set(next.assignments.map(a=>a.id));
 const removed=before.assignments.filter(a=>!now.has(a.id)),changed=next.assignments.filter(a=>old.has(a.id)&&!same(old.get(a.id),a));
 const warnings=next.assignments.flatMap(a=>check(next,a,a.id).warnings.filter(w=>w!=='Преподаватель просил эту группу').map(text=>({group:a.group,text})));
 return{project:next,label,removed,changed,warnings,locked:removed.concat(changed).filter(a=>old.get(a.id)?.locked).length};
}
export function reviseEntity(before,kind,item,{keepSub=1}={}){
 const next=structuredClone(before),index=next[kind].findIndex(x=>x.id===item.id);if(index<0)throw Error('Карточка не найдена');const old=next[kind][index];item=structuredClone(item);if(kind==='groups'&&item.count!=null){item.size1=item.count>1?Math.min(item.size1||Math.ceil(item.count/2),item.count-1):null;if(item.count===1)item.split=false}next[kind][index]=item;
 if(kind==='groups'){
  if(old.split&&!item.split){next.assignments=next.assignments.filter(a=>a.group!==item.id||a.sub===keepSub);next.assignments.filter(a=>a.group===item.id).forEach(a=>a.sub=1)}
  // Keep valid appointments; relocate only a changed meeting, preserving both teachers.
  for(const slot of item.slots){const aa=next.assignments.filter(a=>a.group===item.id&&a.slot===slot.id);if(!aa.length)continue;
   if(aa.every(a=>slot.week===a.week&&slot.options.some(o=>o.day===a.day&&o.pair===a.pair)))continue;
   if(slot.options.length===1&&slot.options[0].day!=null&&slot.options[0].pair!=null)aa.forEach(a=>Object.assign(a,slot.options[0],{week:slot.week}));
   else next.assignments=next.assignments.filter(a=>!aa.some(b=>b.id===a.id));
  }
  next.assignments=next.assignments.filter(a=>a.group!==item.id||item.slots.some(s=>s.id===a.slot));
 }
 // Requeue invalid appointments only, keeping source cards and unaffected appointments.
 const invalid=new Set();for(const a of next.assignments){if(a[{groups:'group',teachers:'teacher',rooms:'room'}[kind]]!==item.id)continue;if(check(next,a,a.id).errors.length)invalid.add(a.id)}
 // If one part of an alternate-week block becomes invalid, requeue that teacher's whole block.
 for(const a of next.assignments.filter(a=>invalid.has(a.id))){const g=next.groups.find(g=>g.id===a.group);const slots=slotBundle(g,a.slot,a).map(x=>x.slot);for(const b of next.assignments)if(b.group===a.group&&b.sub===a.sub&&slots.includes(b.slot))invalid.add(b.id)}
 next.assignments=next.assignments.filter(a=>!invalid.has(a.id));
 return reviewChanges(before,next,'Изменение карточки');
}
export function moveMeeting(before,id,{day,pair,teacher,approved=false}){
 const next=structuredClone(before),source=next.assignments.find(a=>a.id===id);if(!source)throw Error('Занятие не найдено');
 const g=next.groups.find(g=>g.id===source.group),bundle=slotBundle(g,source.slot,source),slots=bundle.map(o=>o.slot),delta=pair-source.pair;
 const moving=next.assignments.filter(a=>a.group===g.id&&slots.includes(a.slot));
 for(const a of moving){const dest={day,pair:a.pair+delta};if(dest.pair<1||dest.pair>7)throw Error('Блок выходит за границы дня');const s=g.slots.find(s=>s.id===a.slot);
  const option=s.options.some(o=>o.day===dest.day&&o.pair===dest.pair);
  if(!option){if(!approved)throw Error('Новое время требует согласования с УМУ');
   if((g.umu?.occupancy||[]).some(o=>!o.foreign&&!o.temporary&&intersects({...dest,week:s.week},o)))throw Error('Группа занята другой дисциплиной');
   s.options.push(dest);
  }
  Object.assign(a,dest);if(a.sub===source.sub&&teacher)a.teacher=teacher;
 }
 for(const a of moving){const c=check(next,a,a.id);if(c.errors.length)throw Error(c.errors.join(' · '))}
 return reviewChanges(before,next,'Перенос занятия');
}
export function commitReview(before,review){const next=review.project;next.changeLog=[...(before.changeLog||[]),{at:new Date().toISOString(),label:review.label,removed:review.removed.length,changed:review.changed.length}].slice(-50);return next}

// A new UMU file updates source times; the compiler's actual attendance and split remain authoritative.
export function reviseUmu(before,imported){
 let next=structuredClone(before);const cards=[];
 for(const incoming of imported){const existing=next.groups.find(g=>g.code===incoming.code);if(!existing){next.groups.push(structuredClone(incoming));cards.push({label:incoming.code,text:'Новая группа'});continue}
  const used=new Set(),mapped=incoming.slots.map(slot=>{const match=existing.slots.find(old=>!used.has(old.id)&&old.week===slot.week&&same(old.options,slot.options));if(match)used.add(match.id);return{slot,match}});
  const restOld=existing.slots.filter(s=>!used.has(s.id)),restNew=mapped.filter(s=>!s.match);
  // Reuse identity only for an unambiguous single replacement or a two-pair block.
  const paired=restOld.length===2&&restNew.length===2&&restOld.every(s=>s.week===restOld[0].week&&s.options.length===1)&&restNew.every(x=>x.slot.week===restNew[0].slot.week&&x.slot.options.length===1)&&Math.abs(restOld[0].options[0].pair-restOld[1].options[0].pair)===1&&Math.abs(restNew[0].slot.options[0].pair-restNew[1].slot.options[0].pair)===1;
  if(restOld.length===1&&restNew.length===1)restNew[0].match=restOld[0];
  else if(paired){restOld.sort((a,b)=>a.options[0].pair-b.options[0].pair);restNew.sort((a,b)=>a.slot.options[0].pair-b.slot.options[0].pair);restNew.forEach((x,i)=>x.match=restOld[i])}
  const item={...existing,umu:structuredClone(incoming.umu),slots:mapped.map(({slot,match})=>({...structuredClone(slot),id:match?.id||slot.id}))};
  const r=reviseEntity(next,'groups',item);next=r.project;cards.push({label:incoming.code,text:`Обновлены слоты УМУ. Фактическая численность ${existing.count??'—'} и деление ${existing.split?'на две подгруппы':'на целую группу'} сохранены.`});
 }
 return{...reviewChanges(before,next,'Обновление расписания УМУ'),cards};
}
