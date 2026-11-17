import template from './excel-template.js';
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const attrs=o=>Object.entries(o).map(([k,v])=>` ${k}="${xml(v)}"`).join('');
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s};
export function scheduleXML(p){
 const cell=(r,c,value,style)=>`<c r="${col(c)}${r}" s="${style||0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
 const rows=[];const add=(r,meta,values)=>rows.push(`<row r="${r}"${meta.height?` ht="${meta.height}" customHeight="1"`:''}>${Array.from({length:43},(_,c)=>cell(r,c,values[c]||'',meta.cells[col(c)]??meta.cells.AP)).join('')}</row>`);
 add(1,template.rows[0],Object.fromEntries(['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'].map((d,i)=>[1+i*7,d])));
 add(2,template.rows[1],Object.fromEntries(Array.from({length:42},(_,i)=>[i+1,i%7+1])));
 p.teachers.forEach((t,i)=>{
  const top={0:t.name},bottom={0:t.position};
  for(let d=0;d<6;d++)for(let pair=1;pair<=7;pair++){
   const list=p.assignments.filter(a=>a.teacher===t.id&&a.day===d&&a.pair===pair).sort((a,b)=>String(a.week).localeCompare(String(b.week)));
   const label=a=>a.week==='both'?'':` (${a.week})`;
   top[1+d*7+pair-1]=list.map(a=>{const g=p.groups.find(g=>g.id===a.group);return `${g?.code||'?'}${g?.split?' '+a.sub+' п/г':''}${label(a)}`}).join(' / ');
   bottom[1+d*7+pair-1]=list.map(a=>(p.rooms.find(r=>r.id===a.room)?.name||'—')+label(a)).join(' / ');
  }
  const index=2+i*2;add(3+i*2,template.rows[index]||template.rows[4],top);add(4+i*2,template.rows[index+1]||template.rows[5],bottom);
 });
 const cols=template.cols.map(c=>`<col${attrs(c)}/>`).join('')+'<col min="43" max="43" width="11.33" customWidth="1"/>';
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AQ${Math.max(2,p.teachers.length*2+2)}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr${attrs(template.sheetFormat)}/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="6">${Array.from({length:6},(_,d)=>`<mergeCell ref="${col(1+d*7)}1:${col(7+d*7)}1"/>`).join('')}</mergeCells><pageMargins${attrs(template.pageMargins)}/><pageSetup orientation="landscape"/></worksheet>`;
}
export function applyScheduleLayout(X,bytes,p,sheetNumber){
 const C=X.CFB,zip=C.read(Array.from(new Uint8Array(bytes)),{type:'array'}),enc=new TextEncoder();
 for(const [path,value]of [[`xl/worksheets/sheet${sheetNumber}.xml`,scheduleXML(p)],['xl/styles.xml',template.styles],['xl/theme/theme1.xml',template.theme]]){const index=zip.FullPaths.indexOf('Root Entry/'+path);if(index<0)throw Error('В Excel отсутствует '+path);const content=enc.encode(value);zip.FileIndex[index].content=content;zip.FileIndex[index].size=content.length;}
 return C.write(zip,{type:'array',fileType:'zip',compression:true});
}
