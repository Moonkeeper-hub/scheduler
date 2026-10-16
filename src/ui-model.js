import {complete,groupReady,load,slotBundle} from './engine.js';
export const normalizeSearch=s=>String(s??'').toLocaleLowerCase('ru').replace(/ё/g,'е').trim();
const alphabet=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
export function sortedDirectory(items,kind){return [...items].sort((a,b)=>{
 if(kind==='teachers'){const chief=x=>/^чернова\b/iu.test(normalizeSearch(x.name))||normalizeSearch(x.name).split(/\s+/)[0]==='чернова';const delta=Number(chief(b))-Number(chief(a));if(delta)return delta}
 return alphabet.compare(a.name||a.code,b.name||b.code);
})}
export function directoryItems(p,kind,{query='',filter='',day='',week=''}={}){
 const q=normalizeSearch(query);
 return sortedDirectory(p[kind],kind).filter(x=>{
  if(q&&!normalizeSearch([x.name,x.code,x.position].filter(Boolean).join(' ')).includes(q))return false;
  if(kind==='groups'){
   if(filter==='pending'&&complete(p,x)||filter==='complete'&&!complete(p,x)||filter==='split'&&!x.split||filter==='incomplete'&&groupReady(x))return false;
   if((day!==''||week!=='')&&!x.slots.some(s=>(week===''||s.week===week||s.week==='both')&&(day===''||s.options.some(o=>o.day===Number(day)))))return false;
  }else if(kind==='teachers'){
   if(filter==='missing'&&x.target!=null&&x.rate!=null&&x.position)return false;
   if(filter==='overload'&&(x.target==null||load(p,x.id)<=x.target))return false;
   if(filter==='available'&&(x.target==null||load(p,x.id)>=x.target))return false;
  }else if(filter==='missing'&&x.capacity!=null||filter==='large'&&(x.capacity==null||x.capacity<25))return false;
  return true;
 });
}
export function bundleFor(g,a){return a.week==='I'||a.week==='II'?slotBundle(g,a.slot,{day:a.day,pair:a.pair}):[{slot:a.slot,day:a.day,pair:a.pair}]}
export function groupMeetings(g){
 const meetings=[],seen=new Set();
 for(const s of g.slots)for(const o of s.options){if(o.day==null||o.pair==null)continue;const bundle=s.week==='I'||s.week==='II'?slotBundle(g,s.id,o):[{slot:s.id,...o}],key=s.week+':'+bundle.map(x=>`${x.slot}:${x.day}:${x.pair}`).join('|');if(seen.has(key))continue;seen.add(key);meetings.push({week:s.week,slots:bundle,paired:bundle.length===2})}
 return meetings;
}
export function dragScrollSpeed(y,top,bottom,edge=64){const zone=Math.min(edge,(bottom-top)/3);if(y<top||y>bottom||zone<=0)return 0;if(y<top+zone)return -Math.ceil(18*(top+zone-y)/zone);if(y>bottom-zone)return Math.ceil(18*(y-bottom+zone)/zone);return 0}
