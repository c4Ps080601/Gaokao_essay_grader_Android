'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mobile-integration-'));
process.env.EG_DATA_DIR=path.join(dir,'data');process.env.EG_SETTINGS_FILE=path.join(dir,'settings.json');
const settings=require('../settings'),store=require('../store'),{app}=require('../server');
const secret=crypto.randomBytes(32);
settings.initEncryption({isEncryptionAvailable:()=>true,encryptString(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,iv);return Buffer.concat([iv,c.update(text),c.final(),c.getAuthTag()]);},decryptString(buf){const c=crypto.createDecipheriv('aes-256-gcm',secret,buf.subarray(0,12));c.setAuthTag(buf.subarray(-16));return Buffer.concat([c.update(buf.subarray(12,-16)),c.final()]).toString();}});
test('单Key双模型：密钥加密、不回传、跨接口禁止共享、验证原子性',()=>{
 const base={provider:'qwen',model:'qwen-plus'};
 settings.updateSettings({ai:{grade:{...base,apiKey:'test-secret-12345'},ocr:{...base,model:'qwen-vl-plus',shareKeyWithGrade:true}}});
 assert.equal(settings.getAIConfig('ocr').apiKey,'test-secret-12345');assert.equal(settings.getAIConfig('ocr').model,'qwen-vl-plus');
 assert.ok(!JSON.stringify(settings.getPublicAISettings()).includes('test-secret'));assert.ok(!fs.readFileSync(process.env.EG_SETTINGS_FILE,'utf8').includes('test-secret'));
 const before=fs.readFileSync(process.env.EG_SETTINGS_FILE,'utf8');
 assert.throws(()=>settings.updateSettings({ai:{grade:{...base,apiKey:'another-secret-12345'},ocr:{provider:'deepseek',model:'x',shareKeyWithGrade:true}}}),/共用密钥/);
 assert.equal(fs.readFileSync(process.env.EG_SETTINGS_FILE,'utf8'),before);
 settings.updateSettings({ai:{grade:{...base,apiKey:'rotated-secret-12345'}}});assert.equal(settings.getAIConfig('ocr').apiKey,'rotated-secret-12345');assert.equal(settings.getAIConfig('ocr').model,'qwen-vl-plus');
 settings.updateSettings({ai:{grade:{...base,clearKey:true}}});assert.equal(settings.getAIConfig('ocr').apiKey,'');
});
test('查看密钥：本机登录、显式请求、禁止跨源、响应不缓存，普通设置仍脱敏',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const opts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage:'grade'})};
  assert.equal((await fetch(base+'/api/settings/reveal-key',opts)).status,401);
  const login=await fetch(base+'/api/enter',{...opts,body:JSON.stringify({username:'密钥查看测试'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  settings.updateSettings({ai:{grade:{provider:'qwen',model:'qwen-plus',apiKey:'fixture-reveal-only-key'}}});
  const request={...opts,headers:{...opts.headers,Cookie:cookie,Origin:base}};
  const revealed=await fetch(base+'/api/settings/reveal-key',request);assert.equal(revealed.status,200);assert.equal(revealed.headers.get('cache-control'),'no-store');assert.equal((await revealed.json()).apiKey,'fixture-reveal-only-key');
  assert.equal((await fetch(base+'/api/settings/reveal-key',{...request,headers:{...request.headers,Origin:'https://unrelated.example'}})).status,403);
  assert.equal((await fetch(base+'/api/settings/reveal-key',{...request,body:JSON.stringify({stage:'other'})})).status,400);
  assert.ok(!(await (await fetch(base+'/api/settings',{headers:{Cookie:cookie}})).text()).includes('fixture-reveal-only-key'));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
test('备份与清理：当前用户隔离、原子导入、换新ID、未完成任务不自动重试、恶意结构拒绝',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const login=async username=>{const r=await fetch(base+'/api/enter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});return r.headers.get('set-cookie').split(';')[0]};
 const request=(url,method='GET',body,cookie)=>fetch(base+url,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{
  const a=await login('移动测试甲'),b=await login('移动测试乙');const user=store.findUserByUsername('移动测试甲');
  const draft=store.createDraft({userId:user.id,clientId:'one',title:'原稿',originalText:'题目',essayText:'Words remain unchanged.'});
  const pending=store.createSubmission({userId:user.id,title:'中断任务',originalText:'题目',essayText:'Another original essay.'});
  const backup=await (await request('/api/backup','GET',null,a)).json();assert.equal(backup.submissions.length,2);assert.equal((await (await request('/api/backup','GET',null,b)).json()).submissions.length,0);assert.ok(!JSON.stringify(backup).includes('credential'));
  const invalid=structuredClone(backup);invalid.submissions.push({title:3});assert.equal((await request('/api/backup','POST',invalid,a)).status,400);assert.equal(store.listSubmissions(user).length,2);
  assert.equal((await request('/api/backup','POST',backup,a)).status,200);const records=store.listSubmissions(user);assert.equal(records.length,4);assert.equal(new Set(records.map(s=>s.id)).size,4);assert.equal(records.find(s=>s.title===pending.title&&s.id!==pending.id).status,'error');assert.equal(records.find(s=>s.title===draft.title&&s.id!==draft.id).status,'draft');
  const large=structuredClone(backup);large.submissions=Array.from({length:3},()=>({...structuredClone(backup.submissions[0]),originalText:'a'.repeat(199999),essayText:'b'.repeat(199999)}));assert.ok(JSON.stringify(large).length>1024*1024);assert.equal((await request('/api/backup','POST',large,a)).status,200);assert.equal(store.listSubmissions(user).length,7);
  await request('/api/my-data','DELETE',null,b);assert.equal(store.listSubmissions(user).length,7);await request('/api/my-data','DELETE',null,a);assert.equal(store.listSubmissions(user).length,0);assert.ok(store.findUserById(user.id));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
