import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'aux4-no-tools-'));
const marker=path.join(root,'mcp-started');
let payload;
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 payload=JSON.parse(body);
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({id:'plain',object:'chat.completion',created:1,model:'mock',choices:[{index:0,message:{role:'assistant',content:'plain answer'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const model={type:'openai',config:{model:'mock',apiKey:'fixture-key',configuration:{baseURL:`http://127.0.0.1:${server.address().port}/v1`}}};
try{
 await fs.writeFile(path.join(root,'mcp.json'),JSON.stringify({mcpServers:{probe:{command:process.execPath,args:['-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'started')`]}}}));
 await fs.writeFile(path.join(root,'instructions.md'),'Answer directly.');
 const directArgs=['ask','',path.join(root,'instructions.md'),'user','','','hello','','false',JSON.stringify(model),'','false','false','{}','{}','{}','{}','','','','{}','','{}','none'];
 const command=process.argv[2] ? process.execPath : 'aux4';
 const args=process.argv[2] ? [path.resolve(process.argv[2]),...directArgs] : ['ai','agent','ask','--model',JSON.stringify(model),'--tools','none','--instructions',path.join(root,'instructions.md'),'hello'];
 await new Promise((resolve,reject)=>{
   const child=spawn(command,args,{cwd:root,env:{...process.env,AUX4_NO_DAEMON:'1'},stdio:['ignore','ignore','pipe']});
   let error='';child.stderr.on('data',x=>error+=x);
   const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('plain inference timed out'));},15000);
   child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(error));});
 });
 assert(payload,'model request absent');
 assert(!payload.tools || payload.tools.length===0,'tool schemas were advertised');
 assert.equal(payload.tool_choice,undefined);
 await assert.rejects(fs.access(marker));
 console.log('plain inference: no tools, no MCP startup');
}finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
