import {planSchedule} from './planner.js';
self.onmessage=e=>{try{self.postMessage({result:planSchedule(e.data.project,e.data.settings,progress=>self.postMessage({progress}))})}catch(error){self.postMessage({error:error.message})}};
