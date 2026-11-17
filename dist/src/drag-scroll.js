import {dragScrollSpeed} from './ui-model.js';
let active=false,point=null,frame=0,ghost=null,lastTime=0;
const inside=(r,x,y)=>x>=r.left&&x<=r.right&&y>=Math.max(0,r.top)&&y<=Math.min(innerHeight,r.bottom);
function tick(time){
 if(!active)return;const grid=document.querySelector('.grid-scroll');
 if(grid&&point){const r=grid.getBoundingClientRect();if(inside(r,point.x,point.y)){const speed=dragScrollSpeed(point.y,Math.max(0,r.top)+Math.min(54,r.height/5),Math.min(innerHeight,r.bottom));grid.scrollTop+=speed*Math.min(2,(time-lastTime||16.7)/16.7)}}
 lastTime=time;frame=requestAnimationFrame(tick);
}
export function beginDrag(e,html,wide=false){
 endDrag();active=true;point={x:e.clientX,y:e.clientY};
 ghost=document.createElement('div');ghost.className='drag-preview'+(wide?' double':'');ghost.innerHTML=html;document.body.append(ghost);e.dataTransfer.effectAllowed='move';e.dataTransfer.setDragImage(ghost,20,20);document.body.classList.add('dragging');frame=requestAnimationFrame(tick);
}
export function endDrag(){active=false;point=null;cancelAnimationFrame(frame);ghost?.remove();ghost=null;lastTime=0;document.body.classList.remove('dragging')}
export function installDragScroll(){
 document.addEventListener('dragover',e=>{if(active){point={x:e.clientX,y:e.clientY};const grid=document.querySelector('.grid-scroll');if(grid&&inside(grid.getBoundingClientRect(),e.clientX,e.clientY))e.preventDefault()}},true);
 document.addEventListener('wheel',e=>{if(!active)return;const grid=document.querySelector('.grid-scroll');if(!grid)return;const r=grid.getBoundingClientRect();if(!inside(r,e.clientX,e.clientY))return;e.preventDefault();const multiplier=e.deltaMode===1?20:e.deltaMode===2?grid.clientHeight:1;grid.scrollTop+=e.deltaY*multiplier;grid.scrollLeft+=e.deltaX*multiplier;point={x:e.clientX,y:e.clientY}}, {capture:true,passive:false});
 document.addEventListener('drop',endDrag);document.addEventListener('dragend',endDrag);window.addEventListener('blur',endDrag);
}
