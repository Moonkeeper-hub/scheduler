import {planSchedule} from './planner.js';
self.onmessage=e=>{try{self.postMessage({result:planSchedule(e.data.project,e.data.settings)})}catch(error){self.postMessage({error:error.message})}};
