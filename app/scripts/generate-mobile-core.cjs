'use strict';
// Generate ESM from the desktop source of truth. Do not maintain two rubrics.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'frontend/src/native/generated');
fs.mkdirSync(out,{recursive:true});
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
for(const name of ['rubric','providers']){
 const source=read(name+'.js');
 const converted=source.replace(/module\.exports\s*=\s*\{([^}]+)\};?\s*$/, 'export {$1};');
 if(converted===source)throw new Error('Export shape changed: '+name);
 fs.writeFileSync(path.join(out,name+'.mjs'),'// Generated from '+name+'.js; do not edit.\n'+converted);
}
let core=read('grader.js');
core=core.slice(core.indexOf('function buildUserPrompt'),core.indexOf('/* ---------- 并发队列'));
core=core.replace(/function callDeepSeek\(messages, opts = \{\}\) \{[\s\S]*?\n\}/,
 'function callDeepSeek(messages, opts = {}) { return transport(messages, opts.config || configuration(opts.stage || "grade"), opts); }');
core=core.replaceAll("settings.getAIConfig(","configuration(");
const imageStart=core.indexOf('    ...imagePaths.map(p => {'),imageEnd=core.indexOf('\n    })',imageStart);
if(imageStart<0||imageEnd<0)throw new Error('OCR source shape changed');
core=core.slice(0,imageStart)+'    ...imagePaths.map(url => ({type: "image_url", image_url: {url}}))'+core.slice(imageEnd+7);
if(/\brequire\(|\bfs\.|\bsettings\./.test(core))throw new Error('Node dependency escaped core conversion');
fs.writeFileSync(path.join(out,'engine.mjs'),`// Generated from grader.js; do not edit.\nimport {SYSTEM_PROMPT,ResultValidationError,validateResult,taskFromText,essayParagraphs} from './rubric.mjs';\nexport function createEngine(configuration,transport){\nconst CALL_TIMEOUT_MS=180000,OCR_TIMEOUT_MS=240000;\n${core}\nreturn {gradeSubmission,recognizeImages,validateOcr,buildUserPrompt};\n}\n`);
fs.writeFileSync(path.join(out,'source-hashes.json'),JSON.stringify(Object.fromEntries(['rubric.js','providers.js','grader.js','store.js'].map(n=>[n,crypto.createHash('sha256').update(read(n)).digest('hex')])),null,2));
const store=read('store.js');
let backup=store.slice(store.indexOf('function importUserData('),store.indexOf('function clearUserData('));
backup=backup.slice(0,backup.indexOf('  for (const item of records)'))+'  return records;\n}\n';
backup=backup.replace('function importUserData(userId, backup)', 'export function decodeBackup(backup)');
fs.writeFileSync(path.join(out,'backup.mjs'),'// Generated from store.js; do not edit.\n'+backup);
console.log('Generated native-independent grading core from desktop sources.');
