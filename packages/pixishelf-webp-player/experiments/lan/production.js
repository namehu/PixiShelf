import { WebpPlayer, playerLimits } from './index.js'
const $ = s => document.querySelector(s), canvas = $('#canvas')
const manifest = await (await fetch('manifest.json')).json()
$('#version').textContent = manifest.version
let player, cancel = false, finish, busy = false
const results = []
function stop(reason='stopped') { cancel = true; finish?.('aborted',reason) }
function test() {
  return new Promise(resolve => {
    player = new WebpPlayer(canvas, {
      workerUrl:new URL('assets/worker.mjs',location.href).href,
      decoderUrl:new URL('assets/decoder.mjs',location.href).href,
      limits:playerLimits(window.innerWidth < 768),diagnostics:{resourceVersion:manifest.version+'/'+manifest.experimentVersion}
    })
    let ended = false, lastDraw = null
    const gaps = [], ctx = canvas.getContext('2d'), originalDraw = ctx.putImageData
    ctx.putImageData = function(...args) {
      const at = performance.now()
      if(lastDraw !== null && gaps.length < 4096) gaps.push(at-lastDraw)
      lastDraw = at
      return originalDraw.apply(this,args)
    }
    const timer = setTimeout(()=>finish('aborted','timeout'),120000)
    finish = (outcome,reason) => {
      if(ended)return;ended=true;clearTimeout(timer)
      ctx.putImageData = originalDraw
      const sorted = [...gaps].sort((a,b)=>a-b)
      const percentile = p => sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] ?? 0
      const drawingInterval = { count:gaps.length, p50Ms:percentile(.5), p95Ms:percentile(.95), maxMs:sorted.at(-1) ?? 0,
        note:'Canvas draw call intervals, including input waiting; not screen presentation.' }
      const report={...player.getDiagnostics(),testCase:'production',outcome,reason,drawingInterval,preview:{mode:'uncovered'}}
      results.push(report);if(results.length>10)results.shift()
      player.destroy();finish=null
      $('#results').textContent=results.map(r=>`${r.outcome} / ${r.pipeline} / ${(r.playbackWallMs/1000).toFixed(3)}s / 绘制 ${r.drawnFrames} / 解码前省略 ${r.decodeOmittedFrames}`).join('\n')
      resolve(report)
    }
    player.subscribe(e=>{if(e.type==='ended')finish?.('completed');if(e.type==='error')finish?.('error',e.error.code)})
    const load=player.load({url:new URL('sample.webp',location.href).href,resourceKey:'local-production-check',size:manifest.size,loop:false,durationMs:manifest.durationMs})
    player.play();load.catch(()=>finish?.('error','load'))
  })
}
$('#batch').onclick=async()=>{
  if(busy)return;busy=true;cancel=false;$('#batch').disabled=true
  try{for(let i=0;i<3&&!cancel;i++){ $('#status').textContent=`生产路径 ${i+1}/3`;const r=await test();if(r.outcome!=='completed')break;await new Promise(r=>setTimeout(r,600)) }}
  finally{busy=false;$('#batch').disabled=false;$('#status').textContent=cancel?'已停止':`production：${results.at(-1)?.outcome ?? 'error'}`}
}
$('#stop').onclick=()=>stop()
const text=()=>JSON.stringify({version:1,context:'production-streaming',browser:navigator.userAgent,results},null,2)
$('#download').onclick=()=>{const u=URL.createObjectURL(new Blob([text()],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=`webp-experiment-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(text())}catch{$('#fallback').hidden=false;$('#fallback').value=text();$('#fallback').select()}}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('background')})
window.addEventListener('pagehide',()=>stop('pagehide'))
