const assert=require('node:assert/strict');const {test}=require('node:test');require('./register-typescript.cjs');const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const Details=require('../src/components/TaskDetails.tsx').default,Form=require('../src/components/TaskForm.tsx').default;
const start=Date.parse('2026-10-20T12:00Z'),task={id:1,title:'Compact details',category:'study',scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+3600000,timeZone:'UTC',enabled:false,origin:'user',currentOccurrence:{id:2,taskId:1,scheduledStartAt:start,scheduledEndAt:start+3600000,startedAt:start+300000,endedAt:start+1800000,recordedAt:start,legacyCompleted:false}};
test('details opens as unified read-only information with Edit switch and always-available actual controls',()=>{const html=renderToStaticMarkup(React.createElement(Details,{task,now:start,revision:0,onChange:async()=>{},onBusyChange(){},onClose(){},onSave:async()=>{}}));assert.match(html,/role="switch"[^>]*aria-label="Edit task information"/);assert.match(html,/<h3>Compact details<\/h3>/);assert.doesNotMatch(html,/aria-label="Task title"/);assert.doesNotMatch(html,/Edit planned task/);assert.match(html,/Actual start hour/);assert.match(html,/Actual end minute/);assert.equal((html.match(/role="slider"/g)||[]).length,2);assert.ok(html.indexOf('Edit task information')<html.indexOf('actual-timeline-statistics'));assert.ok(html.indexOf('Edit task information')<html.indexOf('actual-timeline-chart'));});
test('inline edit reuses planned-form validation and exposes metadata inputs without a separate dialog or duplicate actions',()=>{const html=renderToStaticMarkup(React.createElement(Form,{task,formId:'task-information',hideActions:true,onSave:async()=>{},onCancel(){}}));assert.match(html,/<form[^>]*id="task-information"/);assert.match(html,/aria-label="Task title"/);assert.match(html,/aria-label="Category"/);assert.doesNotMatch(html,/Save Task|Create Task/);});

test('visual drag area and exact selectors occupy separate layers',()=>{
 const html=renderToStaticMarkup(React.createElement(Details,{task,now:start,revision:0,onChange:async()=>{},onBusyChange(){},onClose(){}}));
 const visual=html.indexOf('aria-label="Drag to adjust"'),exact=html.indexOf('aria-label="Exact time input"');assert.ok(visual>=0&&exact>visual);
 const chart=html.slice(visual,exact),fields=html.slice(exact);
 assert.equal((chart.match(/role="slider"/g)||[]).length,2);
 assert.doesNotMatch(chart,/<select|actual-endpoint-button|Clear actual times/);
 assert.match(chart,/timeline-time-axis/);assert.match(chart,/timeline-time-marker/);
 assert.match(fields,/actual-time-selectors/);assert.match(fields,/Choose actual start time/);assert.match(fields,/Choose actual end time/);assert.match(fields,/Clear actual times/);
 assert.doesNotMatch(html,/actual-attached-endpoint/);
});

test('Exact time controls expose click menus with accessible keyboard buttons',()=>{const html=renderToStaticMarkup(React.createElement(Details,{task,now:start,revision:0,onChange:async()=>{},onBusyChange(){},onClose(){}}));assert.match(html,/aria-label="Choose actual start time" aria-haspopup="dialog"/);assert.match(html,/aria-label="Choose actual end time" aria-haspopup="dialog"/);assert.equal((html.match(/popover="auto" role="dialog"/g)||[]).length,2);});

test('details separates Timing summary and keeps Edit in the first card',()=>{
 const html=renderToStaticMarkup(React.createElement(Details,{task,now:start,revision:0,onChange:async()=>{},onBusyChange(){},onClose(){}}));
 const info=html.indexOf('aria-label="Task information"'),summary=html.indexOf('aria-label="Timing summary"'),timeline=html.indexOf('aria-label="Planned and actual timeline"');
 assert.ok(info>=0&&summary>info&&timeline>summary);
 const card=html.slice(info,summary),statistics=html.slice(summary,timeline);
 for(const text of ['Compact details','Category','Schedule','Notifications','actual-time-summary','Edit task information'])assert.ok(card.includes(text));
 assert.doesNotMatch(card,/actual-timeline-statistics/);
 assert.equal((statistics.match(/class="timing-stat/g)||[]).length,5);
 assert.doesNotMatch(statistics,/Edit task information/);
 assert.doesNotMatch(html,/history-disclosure|History · actual times/);
 assert.doesNotMatch(html,/<details[^>]* open/);
});
