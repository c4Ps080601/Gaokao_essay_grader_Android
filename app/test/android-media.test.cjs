const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const load=n=>import(pathToFileURL(path.join(__dirname,'../frontend/src/native',n)).href);
test('媒体恢复：取消不添加，恢复结果限定用户和拍照 ticket，拒绝异常图片',async()=>{
 const {captureFile,canRestoreCapture}=await load('media-policy.mjs');
 assert.equal(captureFile({canceled:true}),null);
 const ticket={owner:'one',token:'t',draftId:'d'};
 assert.equal(canRestoreCapture(ticket,{token:'t'},'one'),true);
 assert.equal(canRestoreCapture(ticket,{token:'t'},'two'),false);
 assert.equal(canRestoreCapture(ticket,{token:'old'},'one'),false);
 assert.equal(canRestoreCapture(null,{token:'t'},'one'),false);
 assert.throws(()=>captureFile({data:'not-an-image'}),/照片/);
 const f=captureFile({data:'/9j/2Q==',token:'t'});assert.equal(f.type,'image/jpeg');assert.equal(f.size,4);
});
test('PDF 文档：全部反馈、题目原稿与教师终评均保留，不泄漏配置且不解释 HTML',async()=>{
 const {buildPdfDocument}=await load('report-document.mjs');
 const s={title:'<script>长标题</script>',createdAt:1,originalText:'题目\nParagraph 1: Given',essayText:'Original essay',teacherScore:23,teacherNote:'教师意见',apiKey:'do-not-export',result:{score:21,summary:'总评',dimensions:{plot:{score:9,comment:'情节'}},errors:[{original:'bad',fix:'good',reason:'原因'}],uncertainIssues:[{original:'?',note:'核实',possibleFix:'核实后改'}],improvements:[{original:'fine',alternative:'better',benefit:'提升'}],highlights:['亮点'],suggestions:['练习'],assessment:{reason:'档位',taskNotes:['要求']},polished:'**Revised**'}};
 const doc=buildPdfDocument(s),text=JSON.stringify(doc);
 for(const word of ['23 / 25','21 / 25','题目','Original essay','bad','good','核实后改','better','教师意见','亮点','练习','Revised','档位','要求'])assert.ok(text.includes(word),word);
 assert.ok(!text.includes('do-not-export'));assert.ok(!text.includes('**Revised**'));
 assert.equal(doc.title,s.title);assert.ok(doc.sections.length>8);
 assert.throws(()=>buildPdfDocument({...s,result:null}),/批改/);
 const long=buildPdfDocument({...s,essayText:'x'.repeat(200000)});assert.equal(long.sections.find(x=>x.title==='学生原稿').text.length,200000);
});
