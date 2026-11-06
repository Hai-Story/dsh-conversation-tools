import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const files=['dist/index.js','dist/client.js','dist/protocol/host.js','dist/protocol/remote.js']
const before=await Promise.all(files.map(async file=>createHash('sha256').update(await readFile(file)).digest('hex')))
execFileSync(process.execPath,['scripts/build.mjs'],{stdio:'inherit'})
const after=await Promise.all(files.map(async file=>createHash('sha256').update(await readFile(file)).digest('hex')))
if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Committed distribution is stale: '+files.filter((_,i)=>before[i]!==after[i]).join(', '))
console.log('Distribution matches source.')
