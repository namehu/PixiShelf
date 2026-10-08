"""Run only the known local lab controls; export each group before reports rotate out."""
import os, subprocess, sys, time, re, json
from pathlib import Path
DEVICE=os.environ.get('ANDROID_SERIAL')
if not DEVICE: raise SystemExit('Set ANDROID_SERIAL to the authorized test device')
if len(sys.argv)!=3 or sys.argv[1]!='production': raise SystemExit('Usage: phone-batch.py production OUTPUT_DIR')
ROOT=Path(__file__).resolve().parent
OUT=Path(sys.argv[2]);OUT.mkdir(parents=True,exist_ok=True)
def adb(*args):return subprocess.check_output(['adb','-s',DEVICE,*args],text=True,timeout=30)
def ui(mode,label=None):return subprocess.check_output([sys.executable,str(ROOT/'phone-ui.py'),mode,*([label] if label else [])],text=True,timeout=30)
def pause(seconds):
    for _ in range(seconds):time.sleep(1)
def top():
    adb('shell','input','swipe','650','650','650','1950','350');pause(2)
def export(name):
    before=set(adb('shell', 'ls /sdcard/Download/webp-experiment-*.json 2>/dev/null || true').splitlines())
    top();ui('tap','下载报告');pause(2)
    state=ui('status')
    if '确定' not in state:
        ui('tap','下载报告');pause(2)
    ui('tap','确定');pause(3)
    paths=adb('shell','ls -t /sdcard/Download/webp-experiment-*.json').splitlines()
    paths=[path for path in paths if path not in before]
    if not paths:raise RuntimeError('No new exported report; do not begin another group')
    target=OUT/name
    adb('pull',paths[0],str(target))
    data=json.loads(target.read_text())
    print('SAVED',target,'reports',len(data['results']),flush=True)
    return data
kind=sys.argv[1]
for iteration in range(1,2):
    top()
    button='生产路径 × 3'
    ui('tap',button)
    print('START',kind,iteration,flush=True)
    pause(75)
    for attempt in range(8):
        state=ui('status')
        final='production：completed'
        if final in state:break
        if '：error' in state or '：aborted' in state:raise RuntimeError('Group did not complete: '+state[:1000])
        print('WAIT',kind,iteration,flush=True);pause(20)
    else:raise RuntimeError('Group timed out; preserve page')
    data=export(f'{kind}-via-round{iteration}.json')
    rows=[r for r in data['results'] if r['testCase']=='production']
    expected=3
    recent=rows[-expected:]
    if len(recent)!=expected or any(r['outcome']!='completed' for r in recent):raise RuntimeError('Incomplete export')
    if any(r.get('preview',{}).get('mode')!='uncovered' for r in recent):raise RuntimeError('Unexpected preview state')
    print('RESULT',json.dumps([{'case':r['testCase'],'ms':r.get('playbackWallMs',r.get('elapsedMs')),'frames':r.get('frames',r.get('drawnFrames'))}for r in recent]),flush=True)
