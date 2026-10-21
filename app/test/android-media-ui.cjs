'use strict';
// Tests the production Android web bundle through a mock native message bridge.
// System camera, PDF rendering and document-provider behavior remain device tests.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express'),{_electron}=require('playwright');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'essay-media-ui-'));
let electron,server,page;
(async()=>{
 const app=express();app.use(express.static(path.resolve(__dirname,'../mobile-dist')));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const main=path.join(tmp,'main.cjs');
 fs.writeFileSync(main,"const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>new BrowserWindow({show:false,width:430,height:932,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true}}).loadURL('about:blank'));app.on('window-all-closed',()=>app.quit());");
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 electron=await _electron.launch({executablePath:require('electron'),args:['--disable-gpu',main],env});
 page=await electron.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>{
  window.__nativeCalls=[];window.__captureMode='ok';window.__saveCanceled=false;
  const pending=new Map();let serial=0;window.__nativeListeners={};
  window.Capacitor={PluginHeaders:[
   {name:'EssayNative',methods:['readState','writeState','seal','unseal','http','startTask','endTask','minimizeApp','checkNetwork','capturePhoto','saveFile','shareFile','exportPdf'].map(name=>({name,rtype:'promise'}))},
   {name:'App',methods:[{name:'addListener',rtype:'callback'},{name:'removeListener',rtype:'callback'},{name:'exitApp',rtype:'promise'}]}
  ],nativePromise(pluginId,methodName,options){return new Promise((resolve,reject)=>{const callbackId=String(++serial);pending.set(callbackId,{resolve,reject});window.androidBridge.postMessage(JSON.stringify({pluginId,methodName,options,callbackId}));});},
  nativeCallback(pluginId,methodName,options,callback){
   if(methodName==='addListener'){
    window.__nativeListeners[options.eventName]=callback;
    if(options.eventName==='appRestoredResult'){
     const restored=localStorage.getItem('fixture_restore');
     if(restored){localStorage.removeItem('fixture_restore');queueMicrotask(()=>callback(JSON.parse(restored)));}
    }
   }
   return String(++serial);
  },
  fromNative(result){const p=pending.get(result.callbackId);if(!p)return;pending.delete(result.callbackId);result.success?p.resolve(result.data):p.reject(new Error(result.error.message));}};
  window.androidBridge={postMessage(raw){
   const call=JSON.parse(raw);window.__nativeCalls.push(call);
   const respond=(data,success=true,errorMessage='相机不可用')=>queueMicrotask(()=>window.Capacitor.fromNative({callbackId:call.callbackId,pluginId:call.pluginId,methodName:call.methodName,success,data,...(!success?{error:{message:errorMessage}}:{})}));
   if(call.pluginId==='App'){respond({});return;}
   const o=call.options||{};
   switch(call.methodName){
    case 'readState':respond({value:localStorage.getItem('fixture_state')});break;
    case 'writeState':if(window.__failWrite){window.__failWrite=false;respond({},false,'本机保存失败');}else{localStorage.setItem('fixture_state',o.value);respond({});}break;
    case 'seal':respond({value:btoa(o.value)});break;
    case 'unseal':respond({value:atob(o.value)});break;
    case 'capturePhoto':{
     if(window.__captureMode==='error'){respond({},false);break;}
     const canceled=window.__captureMode==='cancel';const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
     respond({token:o.token,canceled,...(!canceled?{data:canvas.toDataURL('image/jpeg').split(',')[1]}:{})});break;
    }
    case 'saveFile':case 'exportPdf':respond({canceled:!o.share&&window.__saveCanceled});break;
    case 'shareFile':respond({});break;
    case 'startTask':case 'endTask':case 'minimizeApp':respond({});break;
    case 'checkNetwork':if(window.__probeFail)respond({},false,'无法解析服务商域名（域名解析）');else respond({message:'网络检查收到 HTTP 405：仅表示连通，不验证密钥'});break;
    default:respond({},false);
   }
  }};
 });
 const base='http://127.0.0.1:'+server.address().port;await page.goto(base);
 await page.getByRole('heading',{name:/我的作文/}).waitFor();
 await page.getByRole('button',{name:'提交作文',exact:true}).click();
 await page.getByPlaceholder('给这篇作文起个标题').fill('媒体功能测试');
 await page.getByRole('button',{name:'拍照',exact:true}).click();
 await page.locator('.photo-preview').waitFor();assert.equal(await page.locator('.photo-preview').count(),1);
 assert.ok(await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fixture_state'));return s.submissions.some(x=>x.title==='媒体功能测试')}),'draft saved before camera');
 await page.evaluate(()=>window.__captureMode='cancel');await page.getByRole('button',{name:'拍照',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('button:disabled')?.textContent?.includes('拍摄'));assert.equal(await page.locator('.photo-preview').count(),1);
 await page.evaluate(()=>window.__captureMode='error');await page.getByRole('button',{name:'拍照',exact:true}).click();
 await page.getByText('相机不可用',{exact:true}).waitFor();assert.equal(await page.locator('.photo-preview').count(),1);
 await page.evaluate(()=>window.__captureMode='ok');
 for(let i=1;i<4;i++){await page.getByRole('button',{name:'拍照',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.photo-preview').length===n,i+1);}
 const capturesBefore=await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='capturePhoto').length);
 await page.getByRole('button',{name:'拍照',exact:true}).click();await page.getByText('最多4张图片，请先删除一张再拍摄',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='capturePhoto').length),capturesBefore);
 // A camera result can arrive before React finishes loading after process recreation.
 await page.evaluate(()=>{
  const state=JSON.parse(localStorage.getItem('fixture_state')),canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
  localStorage.setItem('eg_capture_ticket',JSON.stringify({owner:state.currentUserId,draftId:state.submissions[0].id,token:'restore-ticket'}));
  localStorage.setItem('fixture_restore',JSON.stringify({pluginId:'EssayNative',methodName:'capturePhoto',success:true,data:{token:'restore-ticket',data:canvas.toDataURL('image/jpeg').split(',')[1]}}));
 });
 await page.reload();await page.getByText('已恢复拍摄照片与文字草稿；其他未识别图片如有缺失请重新选择',{exact:true}).waitFor();
 await page.locator('.photo-preview').waitFor();
 assert.equal(await page.locator('.photo-preview').count(),1);assert.equal(await page.getByPlaceholder('给这篇作文起个标题').inputValue(),'媒体功能测试');
 // Populate a completed report, then reload the native runtime.
 await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fixture_state'));const d=s.submissions[0];d.status='done';d.essayText='A test essay.';d.result={score:21,summary:'中文测试总评',dimensions:{plot:{score:9,comment:'情节'}},errors:[],uncertainIssues:[],improvements:[],highlights:['表达亮点'],polished:'Improved essay.'};localStorage.setItem('fixture_state',JSON.stringify(s));});
 await page.reload();await page.getByRole('heading',{name:/我的作文/}).waitFor();await page.locator('.essay-row').first().click();
 await page.getByRole('button',{name:'导出这份批改',exact:true}).click();
 await page.getByRole('button',{name:/导出 PDF/}).click();
 await page.getByText('批改结果已导出',{exact:true}).waitFor();
 const pdf=await page.evaluate(()=>window.__nativeCalls.find(c=>c.methodName==='exportPdf').options);
 assert.equal(pdf.share,false);assert.equal(pdf.report.title,'媒体功能测试');assert.ok(JSON.stringify(pdf.report).includes('中文测试总评'));
 await page.getByRole('button',{name:'导出这份批改',exact:true}).click();
 await page.evaluate(()=>window.__saveCanceled=true);await page.getByRole('button',{name:/导出 PDF/}).click();
 await page.waitForTimeout(200);assert.equal(await page.getByRole('button',{name:/导出 PDF/}).count(),1,'cancel keeps export sheet');
 await page.getByRole('button',{name:/分享 PDF/}).click();await page.getByText('已打开分享面板',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='exportPdf').at(-1).options.share),true);
 await page.evaluate(()=>window.__saveCanceled=false);
 await page.getByRole('button',{name:'导出这份批改',exact:true}).click();
 await page.getByRole('button',{name:/导出长图/}).click();await page.getByText('批改结果已导出',{exact:true}).waitFor();
 const image=await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='saveFile').at(-1).options);
 assert.equal(image.mime,'image/png');assert.ok(image.data.startsWith('iVBORw0KGgo'),'PNG content is passed to document picker');
 await page.getByRole('button',{name:'返回我的作文',exact:true}).click();
 await page.getByRole('button',{name:'打开侧边导航',exact:true}).click();await page.locator('.drawer nav').getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:/导出备份/}).click();await page.getByText('已导出当前用户作文，不含密钥和会话',{exact:true}).waitFor();
 const backup=await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='saveFile').at(-1).options);
 assert.equal(backup.mime,'application/json');assert.ok(!Buffer.from(backup.data,'base64').toString().includes('credential'));
 await page.getByRole('button',{name:/模型配置/}).click();
 const form=page.locator('.simple-model-form'),key=form.locator('.model-input input');
 assert.equal(await form.locator('select').first().locator('option[value=deepseek]').textContent(),'DeepSeek（推荐）');
 await key.fill('fixture-settings-key-12345');await page.getByText('新 Key 尚未保存。',{exact:true}).waitFor();
 await form.getByRole('button',{name:'保存配置',exact:true}).click();
 await page.getByText('已加密保存，尚未测试连接。',{exact:true}).waitFor();
 assert.equal(await key.inputValue(),'');assert.ok((await key.getAttribute('placeholder')).includes('已保存'));
 const credential=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_state')).settings.ai.grade.credential);assert.ok(credential);
 await form.getByRole('button',{name:'保存配置',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.simple-model-form fieldset').disabled);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_state')).settings.ai.grade.credential),credential,'empty save preserves key');
 await key.fill('fixture-new-key-not-saved');await page.evaluate(()=>window.__failWrite=true);
 await form.getByRole('button',{name:'保存配置',exact:true}).click();await page.getByText('本机保存失败',{exact:true}).waitFor();
 assert.equal(await key.inputValue(),'fixture-new-key-not-saved','failed save retains input');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture_state')).settings.ai.grade.credential),credential,'failed write preserves original key');
 await page.reload();await page.getByRole('heading',{name:/我的作文/}).waitFor();
 await page.getByRole('button',{name:'打开侧边导航',exact:true}).click();await page.locator('.drawer nav').getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/模型配置/}).click();
 await page.getByText('留空保留，输入新 Key 可替换。',{exact:true}).waitFor();
 await form.getByRole('button',{name:'显示 API Key',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#model-api-key').type==='text');
 assert.equal(await key.inputValue(),'fixture-settings-key-12345','explicit reveal reads actual saved key');
 await form.getByRole('button',{name:'隐藏 API Key',exact:true}).click();assert.equal(await key.inputValue(),'');assert.equal(await key.getAttribute('type'),'password');
 await form.getByRole('button',{name:'显示 API Key',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#model-api-key').type==='text');
 await page.evaluate(()=>window.dispatchEvent(new Event('essay-background')));assert.equal(await key.inputValue(),'');assert.equal(await key.getAttribute('type'),'password');
 const previewRoot=path.resolve(__dirname,'../../artifacts/previews-0.1.8');fs.mkdirSync(previewRoot,{recursive:true});
 await page.waitForTimeout(450);await page.screenshot({path:path.join(previewRoot,'model-settings.png')});
 for(const width of [320,430]){
  await page.setViewportSize({width,height:932});await page.evaluate(()=>document.documentElement.style.fontSize='130%');
  const box=await form.locator('.key-visibility').boundingBox();assert.ok(box.width>=64&&box.height>=48);
  assert.ok(await form.locator('.model-input').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'key row does not overflow');
  assert.equal(await form.locator('.model-input button').count(),1,'network action outside key row');
 }
 await page.screenshot({path:path.join(previewRoot,'model-settings-large-font.png')});
 await page.evaluate(()=>document.querySelector('.app-shell').classList.add('dark'));await page.screenshot({path:path.join(previewRoot,'model-settings-dark.png')});
 await page.evaluate(()=>{document.querySelector('.app-shell').classList.remove('dark');document.documentElement.style.fontSize='100%';});
 await page.locator('.model-advanced summary').click();
 await page.getByRole('button',{name:'检查网络（不调用模型）',exact:true}).click();await page.getByText('网络检查收到 HTTP 405：仅表示连通，不验证密钥',{exact:true}).waitFor();
 assert.deepEqual(Object.keys(await page.evaluate(()=>window.__nativeCalls.filter(c=>c.methodName==='checkNetwork').at(-1).options)),['url']);
 await page.evaluate(()=>window.__probeFail=true);await page.getByRole('button',{name:'检查网络（不调用模型）',exact:true}).click();await page.getByText('无法解析服务商域名（域名解析）',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: Android production bundle: capture success/cancel/error/limit, draft durability, early restored result and matching draft, PDF payload/save cancel/share, PNG and JSON save-file payloads, no runtime errors');
})().catch(async e=>{console.error(e);if(page)console.error(await page.evaluate(()=>({body:document.body.innerText.slice(0,1000),calls:window.__nativeCalls?.map(c=>c.pluginId+':'+c.methodName).slice(-15)})));process.exitCode=1}).finally(async()=>{if(electron)await electron.close();if(server)server.close();});
