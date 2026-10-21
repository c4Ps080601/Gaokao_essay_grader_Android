'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runtime=()=>import('../frontend/src/native/runtime.mjs');
function fixture(){
 let value=null,failWrite=false;const key=crypto.randomBytes(32);
 return {get value(){return value},set value(v){value=v},set failWrite(v){failWrite=v},
  async readState(){return {value}},async writeState(input){if(failWrite)throw new Error('disk full');value=input.value},
  async seal({value}){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);return {value:Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64')}},
  async unseal({value}){const b=Buffer.from(value,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return {value:Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString()}},
  async http(){throw new Error('Unexpected real network request')},
 };
}
const story='One day a little child got lost in the park. A kind student saw the child and decided to help. They walked to the entrance together. Finally the child found her mother and thanked the student. Everyone felt happy.';
const grade=messages=>{const p=JSON.parse(messages[1].content.slice(messages[1].content.indexOf('{')));return JSON.stringify({score:20,errorCount:0,title:'Mobile Grade',summary:'第四档，故事完成较好；这是模拟模型响应。',assessment:{plotStatus:'reasonable',continuationComplete:true,reason:'帮助与团聚形成完整主线。',taskNotes:[]},dimensions:{plot:{score:8,comment:'完整'},language:{score:5,comment:'清楚'},grammar:{score:4,comment:'准确'},coherence:{score:3,comment:'连贯'}},errors:[],uncertainIssues:[],improvements:[],highlights:[],suggestions:[],polishedParagraphs:p.essayParagraphs})};
async function login(r,name='测试用户'){return (await r.request('/api/enter','POST',{username:name})).user}
async function configure(r,key='fixture-api-key-123'){return r.request('/api/settings','PUT',{ai:{grade:{provider:'qwen',model:'qwen-plus',apiKey:key},ocr:{provider:'qwen',model:'qwen-vl-plus',shareKeyWithGrade:true}}})}
async function draft(r,id='draft-one'){return (await r.request('/api/drafts','POST',{clientId:id,title:'标题',originalText:'A child lost her way.',essayText:story})).submission}
async function submit(r,s){return r.request('/api/drafts/'+s.id+'/submit','POST',{...s,revision:s.draftRevision})}

test('Android: draft persistence, idempotence, blank edits, revision conflict and owner isolation',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);await assert.rejects(r.request('/api/me'),e=>e.status===401);await assert.rejects(r.request('/api/submissions'),e=>e.status===401);await assert.rejects(r.request('/api/backup'),e=>e.status===401);const u=await login(r);
 const a=await draft(r);assert.equal((await draft(r)).id,a.id);
 const edit=await r.request('/api/drafts/'+a.id,'PUT',{title:'',originalText:'',essayText:'',revision:a.draftRevision});assert.equal(edit.submission.essayText,'');
 await assert.rejects(r.request('/api/drafts/'+a.id,'PUT',{essayText:'old',revision:a.draftRevision}),e=>e.status===409);
 const reopened=createRuntime(b);assert.equal((await reopened.request('/api/me')).user.id,u.id);assert.equal((await reopened.request('/api/submissions')).submissions.length,1);
 await login(reopened,'另一用户');assert.equal((await reopened.request('/api/submissions')).submissions.length,0);await assert.rejects(reopened.request('/api/drafts/'+a.id,'PUT',{}),e=>e.status===403);
});
test('Android: failed atomic write never reports saved and restores memory',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);await login(r);const before=b.value;b.failWrite=true;
 await assert.rejects(draft(r),/disk full/);assert.equal(b.value,before);assert.equal((await r.request('/api/submissions')).submissions.length,0);
 b.failWrite=false;assert.ok((await draft(r)).id);
});
test('Android: encrypted shared credential rotation, no key in settings or backup, atomic endpoint rejection',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);await login(r);await configure(r);
 assert.ok(!b.value.includes('fixture-api-key'));assert.ok(!JSON.stringify(await r.request('/api/settings')).includes('credential'));assert.ok(!JSON.stringify(await r.request('/api/backup')).includes('fixture-api-key'));
 await r.request('/api/settings','PUT',{ai:{grade:{provider:'qwen',model:'qwen-plus',apiKey:'rotated-api-key-456'}}});
 const stored=JSON.parse(b.value);assert.equal((await b.unseal({value:stored.settings.ai.ocr.credential})).value,'rotated-api-key-456');
 const before=b.value;await assert.rejects(r.request('/api/settings','PUT',{ai:{grade:{provider:'deepseek',model:'different',apiKey:'do-not-send-key'}}}),/同时更新OCR/);assert.equal(b.value,before);
 await r.request('/api/settings','PUT',{ai:{grade:{provider:'qwen',model:'qwen-plus',clearKey:true}}});assert.equal((await r.request('/api/settings')).ai.ocr.hasKey,false);
});
test('Android: validated text grading runs once, snapshots model config and persists real result',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let calls=0,release,arrived;const gate=new Promise(r=>release=r),started=new Promise(r=>arrived=r);
 const r=createRuntime(b,{transport:async(messages,config)=>{calls++;assert.equal(config.apiKey,'fixture-api-key-123');arrived();await gate;return grade(messages)}});
 await login(r);await configure(r);const s=await draft(r);await submit(r,s);await submit(r,s);await started;
 await configure(r,'changed-after-start');release();await r.whenIdle();const done=(await r.request('/api/submissions/'+s.id)).submission;
 assert.equal(calls,1);assert.equal(done.status,'done');assert.equal(done.result.score,20);assert.equal(done.result.model,'qwen-plus');
 const reopened=createRuntime(b);assert.equal((await reopened.request('/api/submissions/'+s.id)).submission.result.score,20);
});
test('Android: deleting in-flight job and changing user cannot resurrect its result',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let release,arrived;const gate=new Promise(r=>release=r),started=new Promise(r=>arrived=r);
 const r=createRuntime(b,{transport:async messages=>{arrived();await gate;return grade(messages)}});
 await login(r);await configure(r);const s=await draft(r);await submit(r,s);await started;await r.request('/api/submissions/'+s.id,'DELETE');await login(r,'切换后用户');release();await r.whenIdle();
 assert.equal((await r.request('/api/submissions')).submissions.length,0);await login(r);assert.equal((await r.request('/api/submissions')).submissions.length,0);
});
test('Android: restart marks pending jobs interrupted without paid automatic retry; corrupt state is not erased',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);await login(r);const s=await draft(r);const stored=JSON.parse(b.value);stored.submissions[0].status='pending';b.value=JSON.stringify(stored);let calls=0;
 const reopened=createRuntime(b,{transport:()=>{calls++;throw new Error('Unexpected retry')}});const item=(await reopened.request('/api/submissions/'+s.id)).submission;assert.equal(item.status,'error');assert.equal(calls,0);assert.match(item.error,/手动/);
 b.value='{broken';const corrupt=createRuntime(b);await assert.rejects(corrupt.request('/api/me'));assert.equal(b.value,'{broken');
});
test('Android: backup import validates atomically, changes IDs and clearing preserves other users',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);await login(r);const s=await draft(r);const backup=await r.request('/api/backup');const invalid=structuredClone(backup);invalid.submissions.push({title:3});
 await assert.rejects(r.request('/api/backup','POST',invalid),/备份格式/);assert.equal((await r.request('/api/submissions')).submissions.length,1);
 await r.request('/api/backup','POST',backup);const list=(await r.request('/api/submissions')).submissions;assert.equal(new Set(list.map(s=>s.id)).size,2);assert.ok(list.find(t=>t.id!==s.id));
 await login(r,'备份测试乙');await draft(r,'other');await r.request('/api/my-data','DELETE');await login(r);assert.equal((await r.request('/api/submissions')).submissions.length,2);
});
test('Android: OCR passes images to original validation; authentication failure never retries billing',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let calls=0;
 const r=createRuntime(b,{transport:async(messages,c,opts)=>{calls++;if(opts.stage==='ocr'){assert.ok(messages[0].content[1].image_url.url.startsWith('data:image/png;base64,'));return JSON.stringify({originalText:'Source',starter1:'One day',starter2:'Finally',para1:story,para2:'',taskRequirements:'',keywords:[]})}throw Object.assign(new Error('balance'),{status:402})}});
 await login(r);await configure(r);const form=new FormData();form.append('images',new Blob(['png'],{type:'image/png'}),'test.png');assert.equal((await r.request('/api/ocr','POST',form)).fields.para1,story);
 const s=await draft(r);await submit(r,s);await r.whenIdle();assert.equal(calls,2);assert.equal((await r.request('/api/submissions/'+s.id)).submission.status,'error');
});
test('Android: background lease starts once, lasts through completion and releases',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let starts=0,ends=0,release,arrived;
 const gate=new Promise(r=>release=r),started=new Promise(r=>arrived=r);
 b.startTask=async()=>{starts++};b.endTask=async()=>{ends++};
 const r=createRuntime(b,{transport:async messages=>{arrived();await gate;return grade(messages)}});
 await login(r);await configure(r);const s=await draft(r);await submit(r,s);await submit(r,s);await started;
 assert.equal(starts,1);assert.equal(ends,0);release();await r.whenIdle();assert.equal(ends,1);assert.equal((await r.request('/api/submissions/'+s.id)).submission.status,'done');
});
test('Android: service rejection and save failure send no paid request and retain draft',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let calls=0,ends=0;b.startTask=async()=>{throw new Error('service blocked')};b.endTask=async()=>{ends++};
 const r=createRuntime(b,{transport:async()=>{calls++;return ''}});await login(r);await configure(r);const s=await draft(r);
 await assert.rejects(submit(r,s),/service blocked/);assert.equal((await r.request('/api/submissions/'+s.id)).submission.status,'draft');assert.equal(calls,0);
 b.startTask=async()=>{};b.failWrite=true;await assert.rejects(submit(r,s),/disk full/);b.failWrite=false;
 assert.equal((await r.request('/api/submissions/'+s.id)).submission.status,'draft');assert.equal(calls,0);assert.equal(ends,2);
});
test('Android: uncertain native transport failure never repeats a possibly billed request',async()=>{
 const {createRuntime}=await runtime(),b=fixture();let calls=0,ends=0;b.startTask=async()=>{};b.endTask=async()=>{ends++};b.http=async()=>{calls++;throw new Error('connection reset')};
 const r=createRuntime(b);await login(r);await configure(r);const s=await draft(r);await submit(r,s);await r.whenIdle();
 const failed=(await r.request('/api/submissions/'+s.id)).submission;assert.equal(calls,1);assert.equal(ends,1);assert.equal(failed.status,'error');assert.match(failed.error,/可能已处理并计费/);
});
test('Android: explicit key reveal requires login and valid stage; regular settings remain redacted',async()=>{
 const {createRuntime}=await runtime(),b=fixture(),r=createRuntime(b);
 await assert.rejects(r.request('/api/settings/reveal-key','POST',{stage:'grade'}),e=>e.status===401);
 await login(r);await configure(r);
 assert.equal((await r.request('/api/settings/reveal-key','POST',{stage:'grade'})).apiKey,'fixture-api-key-123');
 assert.equal((await r.request('/api/settings/reveal-key','POST',{stage:'ocr'})).apiKey,'fixture-api-key-123');
 await assert.rejects(r.request('/api/settings/reveal-key','POST',{stage:'other'}));
 assert.ok(!JSON.stringify(await r.request('/api/settings')).includes('fixture-api-key'));
 assert.ok(!b.value.includes('fixture-api-key'));
});
test('Android: generated provider requests match desktop protocols',async()=>{
 const native=await import('../frontend/src/native/generated/providers.mjs'),desktop=require('../providers');
 for(const provider of desktop.PRESETS)for(const protocol of ['chat','responses','anthropic']){
  const config={provider:provider.id,baseUrl:provider.baseUrl||'https://local.example/v1',protocol,model:'fixture-model',effort:'auto',jsonMode:'auto'};
  const messages=[{role:'system',content:'System'},{role:'user',content:'Hello'}];assert.deepEqual(native.buildRequest(messages,config),desktop.buildRequest(messages,config));
 }
});
