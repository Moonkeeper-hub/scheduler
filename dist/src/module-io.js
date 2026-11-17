import {uid,validate,check} from './engine.js';
import {optionalNumber} from './io.js';
export const moduleNames={teachers:'Преподаватели',groups:'Группы',rooms:'Аудитории'};
const headers={teachers:['ID','ФИО','Должность','Ставка','Норма','Запреты','Нежелательные пары','Желаемые группы','Запрещённые группы'],rooms:['ID','Аудитория','Вместимость'],groups:['ID','Группа','Численность','Подгрупп','Первая подгруппа']};
export function exportModule(p,kind){
 const X=window.XLSX,w=X.utils.book_new();if(!moduleNames[kind])throw Error('Неизвестный раздел');
 const add=(name,rows,header)=>{const s=X.utils.json_to_sheet(rows,{header});s['!cols']=header.map(()=>({wch:25}));X.utils.book_append_sheet(w,s,name)};
 add(moduleNames[kind],p[kind].map(x=>kind==='teachers'?{'ID':x.id,'ФИО':x.name,'Должность':x.position,'Ставка':x.rate,'Норма':x.target,'Запреты':x.blocked.join(', '),'Нежелательные пары':x.avoid.join(', '),'Желаемые группы':(x.wants||[]).join(', '),'Запрещённые группы':(x.forbiddenGroups||[]).join(', ')}:kind==='rooms'?{'ID':x.id,'Аудитория':x.name,'Вместимость':x.capacity}:{'ID':x.id,'Группа':x.code,'Численность':x.count,'Подгрупп':x.split?2:1,'Первая подгруппа':x.size1}),headers[kind]);
 if(kind==='groups')add('Занятия',p.groups.flatMap(g=>g.slots.flatMap(s=>s.options.map(o=>({'ID группы':g.id,'ID занятия':s.id,'Неделя':s.week??'','День':o.day==null?'':o.day+1,'Пара':o.pair??''})))),['ID группы','ID занятия','Неделя','День','Пара']);
 add('_MODULE',[{kind,version:1}],['kind','version']);w.Workbook={Sheets:w.SheetNames.map(name=>({name,Hidden:name==='_MODULE'?2:0}))};
 return X.write(w,{type:'array',bookType:'xlsx'});
}
const list=v=>String(v??'').split(',').map(x=>x.trim()).filter(Boolean);
const text=v=>String(v??'').trim();
export function parseModule(book){
 const X=window.XLSX,meta=X.utils.sheet_to_json(book.Sheets._MODULE||{})[0];if(!meta||meta.version!==1||!moduleNames[meta.kind])throw Error('Неизвестный формат модульного файла');
 const kind=meta.kind,sheet=book.Sheets[moduleNames[kind]];if(!sheet)throw Error('Отсутствует лист '+moduleNames[kind]);
 const rows=X.utils.sheet_to_json(sheet,{defval:''}),items=[],errors=[],seen=new Set();
 for(const [i,r]of rows.entries())try{
  const id=text(r.ID)||uid();if(seen.has(id))throw Error('Повтор ID');seen.add(id);
  const n=(key,min=0,integer=false)=>optionalNumber(r[key],key,{min,integer});
  const x=kind==='teachers'?{id,name:text(r.ФИО),position:text(r.Должность),rate:n('Ставка',0.01),target:n('Норма'),blocked:list(r.Запреты),avoid:list(r['Нежелательные пары']),wants:list(r['Желаемые группы','Запрещённые группы'])}:kind==='rooms'?{id,name:text(r.Аудитория),capacity:n('Вместимость',1,true)}:{id,code:text(r.Группа),count:n('Численность',1,true),split:String(r.Подгрупп)==='2',size1:n('Первая подгруппа',1,true),slots:[]};
  if(kind==='groups'&&!['1','2'].includes(String(r.Подгрупп)))throw Error('Подгрупп: 1 или 2');
  if(kind==='teachers'&&[...x.blocked,...x.avoid].some(v=>!/^([0-5]):([1-7])$/.test(v)))throw Error('Ограничения: день 0–5 и пара 1–7, например 0:1');
  validate({schema:1,teachers:kind==='teachers'?[x]:[],rooms:kind==='rooms'?[x]:[],groups:kind==='groups'?[x]:[],assignments:[]});items.push(x);
 }catch(e){errors.push(`Строка ${i+2}: ${e.message}`)}
 if(kind==='groups'){
  if(!book.Sheets['Занятия'])errors.push('Отсутствует лист «Занятия»');
  const slots=X.utils.sheet_to_json(book.Sheets['Занятия']||{},{defval:''});
  for(const [i,r]of slots.entries())try{
   const g=items.find(g=>g.id===text(r['ID группы']));if(!g)throw Error('Не найдена группа по ID');
   const id=text(r['ID занятия']);if(!id)throw Error('Укажите ID занятия; для новой пары используйте новый ID');
   const week=text(r.Неделя)||null;if(week!=null&&!['I','II','both'].includes(week))throw Error('Неделя: I, II или both');
   const day=optionalNumber(r.День,'День',{min:1,integer:true}),pair=optionalNumber(r.Пара,'Пара',{min:1,integer:true});if(day>6||pair>7)throw Error('День: 1–6; пара: 1–7');
   let s=g.slots.find(s=>s.id===id);if(!s){s={id,week,options:[]};g.slots.push(s)}if(s.week!==week)throw Error('Разные недели у вариантов одного занятия');s.options.push({day:day==null?null:day-1,pair});
  }catch(e){errors.push(`Занятия, строка ${i+2}: ${e.message}`)}
 }
 const names=new Set();for(const x of items){const name=x.name||x.code;if(names.has(name))errors.push('Повтор имени / шифра: '+name);names.add(name)}
 return{kind,items,errors};
}
export function mergeModule(p,module){
 if(module.errors.length)throw Error(module.errors.join(' · '));const next=structuredClone(p),kind=module.kind;
 for(const item of module.items){const i=next[kind].findIndex(x=>x.id===item.id);if(i<0){if(next[kind].some(x=>(x.name||x.code)===(item.name||item.code)))throw Error('Имя уже существует с другим ID: '+(item.name||item.code));next[kind].push(structuredClone(item));continue}
  const old=next[kind][i],updated={...old,...structuredClone(item)};
  if(kind==='groups')updated.slots=updated.slots.map(s=>({...old.slots.find(a=>a.id===s.id),...s}));next[kind][i]=updated;
 }
 validate(next);
 for(const a of next.assignments){const before=check(p,a,a.id).errors,after=check(next,a,a.id).errors.filter(e=>!before.includes(e));if(after.length)throw Error('Изменение нарушает существующее назначение: '+after.join(' · ')+'. Сначала исправьте или снимите назначение в редакторе.')}
 return next;
}
