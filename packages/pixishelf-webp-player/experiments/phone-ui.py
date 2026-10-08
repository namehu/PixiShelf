"""Small adb helper for the user-authorized local experiment page only.
No browser configuration changes and no access to unrelated app data.
"""
import os, subprocess, sys, re, xml.etree.ElementTree as ET
DEVICE = os.environ.get('ANDROID_SERIAL')
if not DEVICE: raise SystemExit('Set ANDROID_SERIAL to the authorized test device')
def adb(*args):
    return subprocess.check_output(['adb', '-s', DEVICE, *args], text=True)
def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/Download/webp-test-ui.xml')
    root = ET.fromstring(adb('shell', 'cat', '/sdcard/Download/webp-test-ui.xml'))
    return list(root.iter('node'))
mode=sys.argv[1]
items=nodes()
if mode=='status':
    for n in items:
        text=n.get('text','')
        if text: print(text[:200],n.get('bounds'))
elif mode=='tap':
    label=sys.argv[2]
    for n in items:
        if n.get('text')==label or n.get('content-desc')==label:
            x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
            if x2>x1 and y2>y1:
                print(adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2)))
                break
    else: raise SystemExit('Visible label not found: '+label)
