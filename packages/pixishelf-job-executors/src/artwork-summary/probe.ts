import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { summaryFeatureSchema, type SummaryFeature } from '@pixishelf/job-contracts'

export interface SummaryProbeResult { sourceKey: string | null; feature: SummaryFeature | null; failureCode: string | null }
export interface SummaryProbe { analyze(root: string, path: string, cached: SummaryProbeResult | null, signal: AbortSignal): Promise<SummaryProbeResult> }

// All filesystem work and native decoding live in the killable child, including NFS stat/open.
const script = String.raw`
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const sharp = require(process.argv[1]);
sharp.cache(false); sharp.concurrency(1);
const MAX_BYTES = 64 * 1024 * 1024;
const key = (name, s) => JSON.stringify([name,s.size,s.mtimeMs,s.ctimeMs,s.dev,s.ino].map(String));
function hash(pixels) {
  const gray = Array.from({length:1024}, (_, i) => pixels[i*3]*.299+pixels[i*3+1]*.587+pixels[i*3+2]*.114);
  const cos = Array.from({length:8},(_,u)=>Array.from({length:32},(_,x)=>Math.cos((2*x+1)*u*Math.PI/64)));
  const intermediate = Array.from({length:8},(_,u)=>Array.from({length:32},(_,y)=>{
    let sum=0; for(let x=0;x<32;x++) sum+=gray[y*32+x]*cos[u][x]; return sum;
  }));
  const coefficients=[];
  for(let v=0;v<8;v++) for(let u=0;u<8;u++) {
    let sum=0; for(let y=0;y<32;y++) sum+=intermediate[u][y]*cos[v][y]; coefficients.push(sum);
  }
  const median=coefficients.slice(1).sort((a,b)=>a-b)[31];
  let bits=0n; coefficients.forEach((value,i)=>{if(i!==0 && value>median) bits|=1n<<BigInt(i)});
  return bits.toString(16).padStart(16,'0');
}
async function analyze(input) {
  const name=input.path;
  const relative=name.replace(/\\/g,'/').replace(/^\/+/, '');
  const parts=relative.split('/');
  if(!relative || parts.some(p=>!p || p==='.' || p==='..')) throw Error('UNSAFE_PATH');
  const root=await fs.realpath(input.root);
  let file=root;
  for(const part of parts) { file=path.join(file,part); if((await fs.lstat(file)).isSymbolicLink()) throw Error('UNSAFE_PATH'); }
  const handle=await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before=await handle.stat({bigint:true});
    if(!before.isFile()) throw Error('NOT_REGULAR');
    const sourceKey=key(name,before);
    if(before.size>BigInt(MAX_BYTES)) return {sourceKey,feature:null,failureCode:'FILE_LIMIT'};
    if(input.cached && input.cached.sourceKey===sourceKey && input.cached.feature) {
      const located=await fs.lstat(file,{bigint:true});
      if(located.isSymbolicLink() || key(name,located)!==sourceKey) throw Error('SOURCE_CHANGED');
      return input.cached;
    }
    const size=Number(before.size);
    const buffer=Buffer.alloc(size+1); let offset=0;
    while(offset<buffer.length) { const r=await handle.read(buffer,offset,buffer.length-offset,offset); if(!r.bytesRead) break; offset+=r.bytesRead; }
    if(offset!==size) throw Error('SOURCE_CHANGED');
    const bytes=buffer.subarray(0,size);
    // libvips may report only the first frame for APNG stored with a .png extension.
    if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      let offset=8;
      while(offset+12<=bytes.length) {
        const length=bytes.readUInt32BE(offset);
        if(length>bytes.length-offset-12) throw Error('INVALID_PNG');
        const type=bytes.toString('ascii',offset+4,offset+8);
        if(type==='acTL') return {sourceKey,feature:null,failureCode:'NON_STATIC'};
        offset+=length+12;
        if(type==='IEND') break;
      }
    }
    const metadata=await sharp(bytes,{limitInputPixels:40000000,pages:1}).metadata();
    if((metadata.pages||1)>1 || !['jpeg','png','webp','avif','tiff'].includes(metadata.format)) return {sourceKey,feature:null,failureCode:'NON_STATIC'};
    if(!metadata.width || !metadata.height || metadata.width*metadata.height>40000000) return {sourceKey,feature:null,failureCode:'PIXEL_LIMIT'};
    const pixels=await sharp(bytes,{limitInputPixels:40000000,pages:1,sequentialRead:true}).rotate().flatten({background:'#ffffff'}).toColourspace('srgb').removeAlpha().resize(32,32,{fit:'fill'}).raw().toBuffer();
    const colors=[];
    for(let y=0;y<8;y++) for(let x=0;x<8;x++) for(let c=0;c<3;c++) {
      let sum=0; for(let dy=0;dy<4;dy++) for(let dx=0;dx<4;dx++) sum+=pixels[((y*4+dy)*32+x*4+dx)*3+c]; colors.push(Math.round(sum/16));
    }
    const after=await handle.stat({bigint:true});
    const located=await fs.lstat(file,{bigint:true});
    if(located.isSymbolicLink() || key(name,after)!==sourceKey || key(name,located)!==sourceKey) throw Error('SOURCE_CHANGED');
    const rotated=metadata.orientation>=5 && metadata.orientation<=8;
    return {sourceKey,feature:{hash:hash(pixels),colors,aspect:rotated?metadata.height/metadata.width:metadata.width/metadata.height},failureCode:null};
  } finally {await handle.close()}
}
process.on('disconnect',()=>process.exit(0));
process.on('message',async input=>{
  try {process.send(await analyze(input))}
  catch(error) {process.send({sourceKey:null,feature:null,failureCode:['UNSAFE_PATH','NOT_REGULAR','SOURCE_CHANGED'].includes(error.message)?error.message:'ANALYSIS_FAILED'})}
});
`

// Resolve from both the host entrypoint and cwd: Worker ships as CJS, while tests and Next consume ESM.
function resolveSharpModule() {
  const entry = path.resolve(process.argv[1] ?? 'package.json')
  return createRequire(entry).resolve('sharp', { paths: [path.dirname(entry), process.cwd()] })
}

export class IsolatedSummaryProbe implements SummaryProbe {
  private child: ChildProcess | null = null
  private poisoned = false
  private busy = false
  constructor(private readonly options: { timeoutMs?: number; spawnProcess?: typeof spawn } = {}) {}
  async analyze(root: string, path: string, cached: SummaryProbeResult | null, signal: AbortSignal): Promise<SummaryProbeResult> {
    if (this.poisoned || this.busy) throw new Error('SUMMARY_CHILD_UNAVAILABLE')
    if (signal.aborted) throw new Error('SUMMARY_CANCELLED')
    if (!this.child) {
      const created = (this.options.spawnProcess ?? spawn)(process.execPath, ['-e', script, resolveSharpModule()], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, VIPS_CONCURRENCY: '1' }
    })
      this.child = created
      created.once('exit', () => { if (this.child === created) { this.child = null; this.poisoned = false } })
      created.on('error', () => { /* Per-request listener handles rejection; keep idle failures contained. */ })
    }
    const child = this.child
    this.busy = true
    return new Promise((resolve, reject) => {
      let settled = false
      let terminating = false
      const cleanup = () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        child.removeListener('message', message); child.removeListener('error', error); child.removeListener('exit', exit)
        this.busy = false
      }
      const finish = (result: SummaryProbeResult | Error) => {
        if (settled) return
        settled = true; cleanup()
        if (result instanceof Error) reject(result); else resolve(result)
      }
      const terminate = (reason: string) => {
        if (settled || terminating) return
        terminating = true
        this.poisoned = true
        clearTimeout(timer)
        child.removeListener('exit', exit)
        // A deadline is recoverable only after the old native/NFS process actually exits.
        const grace = setTimeout(() => finish(new Error('SUMMARY_CHILD_UNAVAILABLE')), 500)
        child.once('exit', () => { clearTimeout(grace); finish(new Error(reason)) })
        child.kill('SIGKILL')
      }
      const abort = () => terminate('SUMMARY_CANCELLED')
      const timer = setTimeout(() => terminate('SUMMARY_TIMEOUT'), this.options.timeoutMs ?? 10_000)
      const error = () => terminate('SUMMARY_CHILD_UNAVAILABLE')
      const exit = () => { this.child = null; finish(new Error('SUMMARY_CHILD_UNAVAILABLE')) }
      const message = (value: unknown) => {
        if (terminating) return
        const result = value as SummaryProbeResult
        if (!result || (result.feature && !summaryFeatureSchema.safeParse(result.feature).success)) return terminate('SUMMARY_INVALID_RESPONSE')
        finish(result)
      }
      signal.addEventListener('abort', abort, { once: true })
      child.once('message', message); child.once('error', error); child.once('exit', exit)
      child.send({ root, path, cached }, (failure) => { if (failure) error() })
    })
  }
  close() { if (this.child) { this.poisoned = true; this.child.kill('SIGKILL') } }
}
