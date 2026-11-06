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
const screenshots=process.env.DSH_UPDATE_SCREENSHOTS==='1'?join(root,'docs/images'):run
await mkdir(screenshots,{recursive:true})
const workspace=join(run,'workspace')
await mkdir(workspace)
const cli=join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js')
const env={...process.env,DSH_HOME:join(run,'home'),DSH_TELEMETRY_DISABLED:'1',DSH_CONVERSATION_TEST_REQUESTS:join(run,'requests.jsonl'),DSH_CONVERSATION_TEST_EVENTS:join(run,'model-events.jsonl')}
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
  const uiWarnings=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.text().includes('Unsupported DSH UI anchors'))uiWarnings.push(message.text())})
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
  await page.screenshot({path:join(screenshots,'stars.png')})
  const nativeInput=page.locator('[data-composer-input]').last()
  await nativeInput.fill('UNSENT_DRAFT')
  await first.getByRole('button',{name:'Edit message',exact:true}).click()
  await page.locator('[data-composer-input]').last().fill('EDITED_FIRST_MESSAGE')
  const permission=page.locator('[data-slot="conversation.input.permission"]').getByRole('button').first()
  await permission.click()
  await page.getByRole('menuitem',{name:'Read Only',exact:true}).click()
  await until(async()=>(await permission.getAttribute('aria-label'))?.includes('Read Only'),'native permission selection')
  const model=page.locator('[data-slot="conversation.input.model"]').getByRole('button').first()
  await model.click()
  await page.locator('[aria-label="Model and reasoning effort"]').last().waitFor()
  const modelPage=page.getByRole('menuitem',{name:/^Model /})
  if(await modelPage.isVisible())await modelPage.click()
  await page.getByRole('menuitemradio',{name:'Alternate fixture',exact:true}).click()
  await until(async()=>(await model.getAttribute('aria-label'))?.includes('Alternate fixture'),'native model selection')
  await page.screenshot({path:join(screenshots,'edit.png')})
  await page.getByRole('button',{name:'Send message',exact:true}).click()
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
  const projections=await rpc('session/projections',{sessionId:child})
  assert.equal(projections.values.permissions.currentValue,'read-only')
  assert.equal(projections.values.modelSelection.lastUsed.model,'alternate')
  assert.equal((await readFile(env.DSH_CONVERSATION_TEST_EVENTS,'utf8')).trim().split('\n').map(JSON.parse).findLast(event=>event.prompt==='EDITED_FIRST_MESSAGE'&&event.stage==='started').model,'alternate')
  await versions.selectOption(source)
  await page.getByText('Reply: SECOND_MESSAGE',{exact:true}).waitFor()
  assert.equal(await nativeInput.innerText(),'UNSENT_DRAFT')
  await versions.selectOption(child)
  await page.getByText('Reply: EDITED_FIRST_MESSAGE',{exact:true}).waitFor()
  await page.reload()
  await page.getByText('Reply: EDITED_FIRST_MESSAGE',{exact:true}).waitFor()
  assert.equal(await versions.inputValue(),child)
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
  await page.emulateMedia({colorScheme:'dark'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'Edit message',exact:true}).click()
  await page.locator('[data-composer-input]').last().fill('中文多行消息\n保留历史版本')
  await page.screenshot({path:join(screenshots,'mobile.png')})
  await page.getByRole('button',{name:'Cancel edit',exact:true}).click()
  assert.equal((await nativeInput.innerText()).trim(),'')
  await until(()=>nativeInput.evaluate(element=>element===document.activeElement||element.contains(document.activeElement)),'composer focus after cancelling')
  // Exercise both submission gestures while the source model remains active.
  await page.setViewportSize({width:1440,height:1000})
  await page.emulateMedia({colorScheme:'light'})
  const events=async()=>JSON.parse('['+(await readFile(env.DSH_CONVERSATION_TEST_EVENTS,'utf8')).trim().split('\n').join(',')+']')
  const ticks=async prompt=>(await events()).filter(event=>event.prompt===prompt&&event.stage==='tick').length
  const assertStillRunning=async prompt=>{
    const before=await ticks(prompt)
    await until(async()=>(await ticks(prompt))>before,'source continues while drafting')
    assert.equal((await events()).some(event=>event.prompt===prompt&&event.stage==='aborted'),false)
  }
  for (const gesture of ['button','enter']) {
    const prompt=`RUNNING_${gesture.toUpperCase()}`
    const replacement=`EDITED_${gesture.toUpperCase()}`
    const activeId=(await rpc('session/create',{cwd:workspace})).sessionId
    await rpc('session/prompt',{sessionId:activeId,requestId:randomUUID(),mode:'queue',content:[{type:'text',text:prompt}]})
    await until(async()=>(await ticks(prompt))>0,'running model')
    const sidebar=page.getByRole('button',{name:'Open sidebar',exact:true})
    if(await sidebar.isVisible())await sidebar.click()
    await page.getByRole('treeitem').filter({hasText:prompt}).last().getByText(prompt,{exact:true}).click()
    await page.getByText(`Streaming: ${prompt}`,{exact:false}).waitFor()
    const inputRow=page.locator('[data-chat-flow-kind="user"]').first()
    await inputRow.hover()
    await inputRow.getByRole('button',{name:'Edit message',exact:true}).click()
    const editor=page.locator('[data-composer-input]').last()
    await permission.click()
    await page.getByRole('menuitem',{name:'Read Only',exact:true}).click()
    await until(async()=>(await permission.getAttribute('aria-label'))?.includes('Read Only'),'running edit permission selection')
    await model.click()
    await page.locator('[aria-label="Model and reasoning effort"]').last().waitFor()
    if(await modelPage.isVisible())await modelPage.click()
    await page.getByRole('menuitemradio',{name:'Fixture',exact:true}).click()
    await until(async()=>(await model.getAttribute('aria-label'))?.endsWith('current Fixture'),'running edit model selection')
    await editor.fill('Draft only')
    await assertStillRunning(prompt)
    await editor.press('Shift+Enter')
    assert.match(await editor.innerText(),/\n/)
    await editor.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229,bubbles:true})
    await assertStillRunning(prompt)
    await page.getByRole('button',{name:'Cancel edit',exact:true}).click()
    await assertStillRunning(prompt)
    // Invalid submissions also leave the source running.
    await assert.rejects(rpc('conversationTools/edit',{sessionId:activeId,messageId:'missing',requestId:randomUUID(),text:'replacement'}),/missing-message/)
    await assertStillRunning(prompt)
    await inputRow.hover()
    await inputRow.getByRole('button',{name:'Edit message',exact:true}).click()
    await editor.fill(replacement)
    assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),true)
    await assertStillRunning(prompt)
    if(gesture==='button')await page.getByRole('button',{name:'Send message',exact:true}).click()
    else await editor.press('Enter')
    await page.getByText(`Reply: ${replacement}`,{exact:true}).waitFor()
    const lifecycle=await events()
    const stopped=lifecycle.findIndex(event=>event.prompt===prompt&&event.stage==='settled')
    const restarted=lifecycle.findIndex(event=>event.prompt===replacement&&event.stage==='started')
    assert(stopped>=0&&restarted>stopped,'replacement starts only after the previous model settles')
    assert.equal(lifecycle.filter(event=>event.prompt===prompt&&event.stage==='aborted').length,1)
    assert.equal(lifecycle.filter(event=>event.prompt===replacement&&event.stage==='started').length,1)
    const editedId=await versions.inputValue()
    const editedState=await rpc('session/projections',{sessionId:editedId})
    assert.equal(editedState.values.permissions.currentValue,'read-only')
    assert.equal(editedState.values.modelSelection.lastUsed.model,'fixture')
    await versions.selectOption(activeId)
    await page.getByText(prompt,{exact:true}).waitFor()
    await versions.selectOption(editedId)
    await page.getByText(`Reply: ${replacement}`,{exact:true}).waitFor()
  }
  const chinese=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN'})
  page=chinese
  chinese.on('pageerror',error=>errors.push(error.message))
  chinese.on('console',message=>{if(message.text().includes('Unsupported DSH UI anchors'))uiWarnings.push(message.text())})
  await chinese.goto(url)
  await chinese.getByRole('treeitem').first().waitFor()
  const chineseWorkspace=chinese.getByRole('treeitem').first()
  if(await chineseWorkspace.getAttribute('aria-expanded')==='false')await chineseWorkspace.click()
  const moreSessions=chinese.getByText(/^展开其余 \d+ 个会话$/)
  if(await moreSessions.isVisible())await moreSessions.click()
  await chinese.getByRole('treeitem').filter({has:chinese.getByText('FIRST_MESSAGE',{exact:true})}).last().getByText('FIRST_MESSAGE',{exact:true}).click()
  await chinese.getByText('Reply: SECOND_MESSAGE',{exact:true}).waitFor()
  const chineseMessage=chinese.locator('[data-chat-flow-kind="user"]').first()
  await chineseMessage.hover()
  await chineseMessage.getByRole('button',{name:'编辑消息',exact:true}).click()
  await chinese.getByRole('button',{name:'取消编辑',exact:true}).click()
  await chineseMessage.getByRole('button',{name:'取消星标',exact:true}).waitFor({state:'attached'})
  await chinese.screenshot({path:join(run,'chinese.png')})
  await chinese.close()
  assert.deepEqual(errors,[])
  assert.deepEqual(uiWarnings,[])
  await writeFile(join(run,'result.json'),JSON.stringify({host:'0.2.2-rc.1',source,child,requests:(await events()).filter(event=>event.stage==='started').length,passed:true},null,2))
  console.log('PASS: stock DSH installation, stars, first-message editing, excluded future context, retained versions, reload, native composer/permission/model controls, prior draft and focus restoration, narrow/dark layout, submit-only interruption by button/Enter, Chinese UI, and no anchor warnings.')
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
