const assert=require('node:assert/strict');const {test}=require('node:test');require('./register-typescript.cjs');
const {viewportDensity,currentTimePosition,centeredScrollTop,timelineTicks}=require('../src/timetableViewport.ts');
const {defaultWindowBounds}=require('../electron/window/windowSizing.ts');
const {pointerClockMinute}=require('../src/timetableViewport.ts');

test('pointer guide and resizing share one snapped clock regardless of handle grab offset',()=>{
 assert.equal(pointerClockMinute(103,100,2,720,0,1000),720);
 assert.equal(pointerClockMinute(110,100,2,720,0,1000),725);
 assert.equal(pointerClockMinute(440,-1000,2,0,100,900),720);
 assert.equal(pointerClockMinute(9999,0,1,0,0,1440),1435);
});
test('viewport holds eight hours at density without compressing a longer planning day',()=>{for(const height of [500,700,950]){const density=viewportDensity(height);assert.equal((height-76-16)/density,480);assert.ok(900*density>height-76-16);}});
test('current time position uses local wall time and planning origin',()=>{const at=Date.parse('2026-10-20T15:23Z');assert.deepEqual(currentTimePosition(at,'UTC',480,1380,1),{top:443,visible:true});assert.equal(currentTimePosition(at,'UTC',1000,1380,1).visible,false);});
test('initial/show centering clamps boundaries and does not require repeated timer recentering',()=>{assert.equal(centeredScrollTop(0,480,1380,1,676),0);assert.equal(centeredScrollTop(1440,480,1380,1,676),300);assert.equal(centeredScrollTop(923,480,1380,1,676),143);assert.deepEqual(timelineTicks(485,1375),[485,540,600,660,720,780,840,900,960,1020,1080,1140,1200,1260,1320,1375]);});
test('window default bounds stay inside workArea on small and offset displays',()=>{for(const area of [{x:0,y:0,width:1920,height:1040},{x:-1366,y:30,width:1366,height:738},{x:0,y:0,width:600,height:400}]){const b=defaultWindowBounds(area);assert.ok(b.x>=area.x&&b.y>=area.y);assert.ok(b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);assert.ok(b.minWidth<=b.width&&b.minHeight<=b.height);}});

test('only today has a current-time line; saved planning hours determine tick origin',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const Week=require('../src/components/WeekSchedule.tsx').default;
 const now=Date.parse('2026-10-20T15:23Z'),from=Date.parse('2026-10-19T00:00Z');
 const render=(start)=>renderToStaticMarkup(React.createElement(Week,{from:start,tasks:[],occurrences:[],now,timeZone:'UTC',filter:'all',planningHours:{wakeTime:'08:00',sleepTime:'23:00'},onChange:async()=>{},onSelect(){}}));
 const html=render(from);assert.equal((html.match(/class="current-time-line"/g)||[]).length,1);assert.equal((html.match(/aria-current="date"/g)||[]).length,1);assert.match(html,/data-planning-start="480"/);assert.match(html,/data-planning-end="1380"/);assert.match(html,/Current time 15:23/);assert.equal((render(from+7*86400000).match(/class="current-time-line"/g)||[]).length,0);
});

test('task details pairs current occurrence planned dates with its actual record',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Details=require('../src/components/TaskDetails.tsx').default;
 const first=Date.parse('2026-10-19T12:00Z'),current=Date.parse('2026-10-20T12:00Z');const task={id:1,title:'Study',timeZone:'UTC',origin:'user',enabled:false,scheduledStartAt:first,scheduledEndAt:first+3600000,recurrenceRule:{frequency:'daily',startTime:'12:00',endTime:'13:00',timeZone:'UTC',weekdays:[]},currentOccurrence:{scheduledStartAt:current,scheduledEndAt:current+3600000,startedAt:current+1000,endedAt:null}};
 const html=renderToStaticMarkup(React.createElement(Details,{task,now:current,revision:0,onChange:async()=>{},onClose(){},onEdit(){},onBusyChange(){}}));const label=at=>new Date(at).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});assert.ok(html.includes(label(current)));assert.ok(!html.includes(label(first)));assert.ok(html.includes('aria-valuenow="'+(current+1000)+'"'));
});
