/** Install and exercise the published plugin against stock npm DSH; no modified Harness checkout is used. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright'

const root=resolve(import.meta.dirname,'..')
await mkdir(join(root,'.artifacts'),{recursive:true})
const run=await mkdtemp(join(root,'.artifacts','browser-'))
const workspace=join(run,'workspace')
await mkdir(workspace)
const cli=join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js')
const env={...process.env,DSH_HOME:join(run,'home'),DSH_TELEMETRY_DISABLED:'1',DSH_CONVERSATION_TEST_REQUESTS:join(run,'requests.jsonl')}
const packed=JSON.parse(execFileSync('npm',['pack','--pack-destination',run,'--ignore-scripts','--json'],{cwd:root,env,encoding:'utf8'}))[0]
execFileSync(process.execPath,[cli,'plugin','--profile','web','add',join(run,packed.filename)],{cwd:root,env,stdio:['ignore','pipe','pipe']})
const patch=join(run,'test.patch.json')
await writeFile(patch,JSON.stringify([
  {id:'agent-default-model',config:{provider:'conversation-tools-test',model:'fixture'}},
  {id:'ui-settings-general',config:{welcomeNoticeVersion:'2026-09-28.1'}},
  {id:'session-title-llm',disabled:true},{id:'hmr',disabled:true},{id:'agent-instructions',disabled:true},
  {id:'session-telemetry-otel',disabled:true},
  {id:'workspace-controller',config:{documentsDirectory:join(workspace,'Documents')}},
  {id:'skill-filesystem',config:{dshHome:join(run,'home'),agentsHome:join(run,'agents'),bundledSkillDir:join(run,'skills'),watch:false}},
  {insert:[{id:'conversation-test-model',name:pathToFileURL(join(root,'tests/fixtures/model.mjs')).href}]},
],null,2))
let log=''
const server=spawn(process.execPath,[cli,'web','--patch',patch,'--no-open','--port','0'],{cwd:workspace,env,stdio:['ignore','pipe','pipe']})
server.stdout.on('data',chunk=>{log+=chunk.toString()})
server.stderr.on('data',chunk=>{log+=chunk.toString()})
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(check,label,timeout=30_000) {
  const limit=Date.now()+timeout
  while(Date.now()<limit) { const result=await check(); if(result)return result; await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
let browser,page
try {
  const url=await until(()=>{if((server.exitCode!==null||server.signalCode!==null))throw new Error(log);return log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/)?.[0]},'stock server startup')
  browser=await chromium.launch()
  page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-US'})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(url)
  const origin=new URL(url).origin
  const rpc=async(method,request)=>{
    const result=await page.request.post(`${origin}/api/${method}`,{data:{type:'client-request',rpcId:randomUUID(),method,payload:{args:{request}}}})
    const body=await result.json()
    if(!body.result?.ok)throw new Error(JSON.stringify(body))
    return body.result.value
  }
  const source=(await rpc('session/create',{cwd:workspace})).sessionId
  await rpc('session/prompt',{sessionId:source,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'FIRST_MESSAGE'}]})
  await until(async()=>{try{return(await readFile(env.DSH_CONVERSATION_TEST_REQUESTS,'utf8')).trim().split('\n').length>=1}catch{return false}},'first reply')
  await pause(500)
  await rpc('session/prompt',{sessionId:source,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:'SECOND_MESSAGE'}]})
  await until(async()=>(await readFile(env.DSH_CONVERSATION_TEST_REQUESTS,'utf8')).trim().split('\n').length>=2,'second reply')
  await page.reload()
  await page.getByRole('treeitem').first().waitFor()
  await page.getByRole('treeitem').first().click()
  await page.getByRole('treeitem').nth(1).click()
  await page.getByText('Reply: SECOND_MESSAGE',{exact:true}).waitFor()
  const first=page.locator('[data-chat-flow-kind="user"]').first()
  await first.hover()
  await first.getByRole('button',{name:'Star this exchange',exact:true}).click()
  await until(()=>page.getByRole('button',{name:'Remove star',exact:true}).count().then(n=>n>=2),'synchronized stars')
  await page.getByRole('img',{name:'Starred exchange',exact:true}).first().waitFor()
  await mkdir(join(root,'docs/images'),{recursive:true})
  await page.screenshot({path:join(root,'docs/images/stars.png')})
  await first.getByRole('button',{name:'Edit message',exact:true}).click()
  await page.getByRole('textbox',{name:'Edit message',exact:true}).fill('EDITED_FIRST_MESSAGE')
  await page.screenshot({path:join(root,'docs/images/edit.png')})
  await page.getByRole('button',{name:'Save and regenerate',exact:true}).click()
  await page.getByText('Reply: EDITED_FIRST_MESSAGE',{exact:true}).waitFor()
  const requests=(await readFile(env.DSH_CONVERSATION_TEST_REQUESTS,'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(requests.length,3)
  const newHistory=JSON.stringify(requests.at(-1))
  assert.match(newHistory,/EDITED_FIRST_MESSAGE/)
  assert.doesNotMatch(newHistory,/SECOND_MESSAGE/)
  assert.doesNotMatch(newHistory,/Reply: FIRST_MESSAGE/)
  const versions=page.getByRole('combobox',{name:'Conversation versions'})
  const child=await versions.inputValue()
  assert.notEqual(child,source)
  await versions.selectOption(source)
  await page.getByText('Reply: SECOND_MESSAGE',{exact:true}).waitFor()
  await versions.selectOption(child)
  await page.reload()
  await page.getByText('Reply: EDITED_FIRST_MESSAGE',{exact:true}).waitFor()
  assert.equal(await versions.inputValue(),child)
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
  await page.emulateMedia({colorScheme:'dark'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Edit message',exact:true}).click()
  await page.getByRole('textbox',{name:'Edit message',exact:true}).fill('中文多行消息\n保留历史版本')
  await page.screenshot({path:join(root,'docs/images/mobile.png')})
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.deepEqual(errors,[])
  await writeFile(join(run,'result.json'),JSON.stringify({host:'0.2.2-rc.1',source,child,requests:requests.length,passed:true},null,2))
  console.log('PASS: stock DSH installation, stars, first-message editing, excluded future context, retained versions, reload, and narrow/dark layout.')
} catch(error) {
  if(page) {await page.screenshot({path:join(run,'failure.png')}).catch(()=>{});await writeFile(join(run,'page.txt'),await page.locator('body').innerText().catch(()=>''))}
  console.error('Browser artifacts:',run)
  throw error
} finally {
  await browser?.close()
  server.kill('SIGINT')
  await until(()=>(server.exitCode!==null||server.signalCode!==null),'server shutdown',10_000).catch(()=>server.kill('SIGKILL'))
  await writeFile(join(run,'server.log'),log.replace(/token=[^\s]+/g,'token=[redacted]'))
}
