import {uid} from './engine.js';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const foreign=v=>/иностранный\s+язык/iu.test(v);
const groupCode=/^[А-ЯЁA-Z]+-\d+-\d+$/u;
const dayNames=['понедельник','вторник','среда','четверг','пятница','суббота'];
function address(r,c){let s='';for(c++;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s+(r+1)}
export function isUmuSheet(sheet){return Object.values(sheet).some(c=>c&&typeof c==='object'&&clean(c.v)==='Дисциплина')&&Object.values(sheet).some(c=>c&&typeof c==='object'&&groupCode.test(clean(c.v)))}
// Read merged cells only inside their actual ranges; never fill arbitrary blanks.
export function parseUmu(sheet,{filename='',sheetName=''}={}){
 const errors=[],warnings=[],groups=[],cells=new Map(),merged=new Map();let maxRow=0,maxCol=0;
 for(const [key,cell]of Object.entries(sheet)){const m=/^([A-Z]+)(\d+)$/.exec(key);if(!m)continue;let c=0;for(const ch of m[1])c=c*26+ch.charCodeAt(0)-64;const r=+m[2]-1;c--;cells.set(`${r}:${c}`,clean(cell.v));maxRow=Math.max(maxRow,r);maxCol=Math.max(maxCol,c)}
 if(maxRow>10000||maxCol>1000)return{groups,items:groups,errors:['Слишком большой лист для профиля УМУ'],warnings};
 for(const m of sheet['!merges']||[])for(let r=m.s.r;r<=m.e.r;r++)for(let c=m.s.c;c<=m.e.c;c++)merged.set(`${r}:${c}`,`${m.s.r}:${m.s.c}`);
 const value=(r,c)=>cells.get(merged.get(`${r}:${c}`)||`${r}:${c}`)||'';
 const source=(r,c)=>({file:filename,sheet:sheetName,cell:address(r,c),text:sheet[address(r,c)]?.v??value(r,c)});
 const headerRows=[];for(let r=0;r<=Math.min(maxRow,30);r++)if(Array.from({length:maxCol+1},(_,c)=>value(r,c)).includes('Дисциплина'))headerRows.push(r);
 if(!headerRows.length)return{groups,items:groups,errors:['Не найдена строка заголовков расписания УМУ'],warnings};
 const h=headerRows[0];
 for(let c=0;c<=maxCol;c++){
  if(value(h,c)!=='Дисциплина')continue;
  let code='';for(let r=h-1;r>=0;r--)if(groupCode.test(value(r,c))){code=value(r,c);break}if(!code)continue;
  let weekCol=c-1;while(weekCol>=0&&value(h,weekCol)!=='Неделя')weekCol--;
  if(weekCol<4){errors.push(`${code}: не найдены колонки дня, пары и недели`);continue}
  if(groups.some(g=>g.code===code)){errors.push(`${code}: повторный блок группы`);continue}
  const countText=value(h-1,c+3),count=/^\d+$/.test(countText)&&+countText>0?+countText:null;
  const g={id:uid(),code,count,split:false,size1:count>1?Math.ceil(count/2):null,slots:[],umu:{file:filename,sheet:sheetName,count,exceptions:[],occupancy:[],warnings:[]}};
  const records=[];
  for(let r=h+1;r<=maxRow;r++){
   const text=value(r,c);if(!text)continue;
   const day=dayNames.indexOf(value(r,weekCol-4).toLowerCase()),pair=Number(value(r,weekCol-3)),week=value(r,weekCol);
   if(day<0||!Number.isInteger(pair)||pair<1||pair>7||!['I','II'].includes(week)){
    if(foreign(text)){errors.push(`${code}, ${address(r,c)}: не распознаны день, пара или неделя`)}continue;
   }
   const src=source(r,c),isForeign=foreign(text);
   const excluded=[...text.matchAll(/(?:кр\.?|кроме)\s*([\d\s,–—-]+)\s*н(?:\.|ед)/giu)].flatMap(m=>m[1].split(',').flatMap(part=>{const ns=part.trim().split(/[–—-]/).map(Number);return ns.length===2&&ns[1]>=ns[0]&&ns[1]-ns[0]<60?Array.from({length:ns[1]-ns[0]+1},(_,i)=>ns[0]+i):ns})).filter(n=>Number.isInteger(n)&&n>0&&n<=60);
   const temporary=/(?:^|\s)(?:на\s+)?\d+(?:\s*[,–-]\s*\d+)*\s*н(?:\.|ед)/iu.test(text.replace(/(?:кр\.?|кроме)\s*[\d\s,–—-]+\s*н(?:\.|ед\w*)/giu,''));
   g.umu.occupancy.push({day,pair,week,subject:text,foreign:isForeign,temporary,source:src});
   if(!isForeign)continue;
   if(excluded.length)g.umu.exceptions.push({day,pair,week,weeks:[...new Set(excluded)],kind:'excluded',source:src});
   if(temporary){g.umu.exceptions.push({day,pair,week,kind:'temporary',source:src});g.umu.warnings.push(`${src.cell}: разовое занятие не включено в регулярную сетку`);continue}
   if(/2\s*п\s*\/?\s*г/iu.test(text))g.split=true;
   else if((text.match(/иностранный\s+язык/giu)||[]).length>1){g.umu.warnings.push(`${src.cell}: повтор дисциплины без номеров подгрупп — проверьте деление`)}
   records.push({day,pair,week,source:src});
  }
  // I and II at the same time describe one weekly lesson. Exceptions stay in the profile.
  for(const a of records){let s=g.slots.find(s=>s.options[0].day===a.day&&s.options[0].pair===a.pair);if(!s){s={id:uid(),week:a.week,options:[{day:a.day,pair:a.pair}],source:a.source,sources:[a.source]};g.slots.push(s)}else{if(s.week!==a.week)s.week='both';s.sources.push(a.source)}}
  if(!g.slots.length)g.umu.warnings.push('Регулярные занятия иностранного языка не найдены');
  if(count==null)g.umu.warnings.push('Не распознана численность; заполните её в карточке');
  warnings.push(...g.umu.warnings.map(w=>`${code}: ${w}`));groups.push(g);
 }
 if(!groups.length)errors.push('Не найдены группы под заголовками дисциплин');
 return{groups,items:groups,errors,warnings};
}
