# Usage: fixglb.py in.glb out.glb "AnimName" [--keep-all]
# Keeps only the named animation; adds node rest translation to translation keys (wow.export writes M2 deltas).
import json,struct,sys
src,dst,name=sys.argv[1:4]
with open(src,'rb') as f:
    f.read(12); l,t=struct.unpack('<II',f.read(8)); j=json.loads(f.read(l)); bl,bt=struct.unpack('<II',f.read(8)); b=bytearray(f.read(bl))
acc=j['accessors'];bv=j['bufferViews'];nodes=j['nodes']
anims=[a for a in j['animations'] if a['name']==name]
assert anims, 'no anim'
a=anims[0]
newbin=bytearray();views=[];accs=[]
def addview(data,target=None):
    while len(newbin)%4: newbin.append(0)
    v={'buffer':0,'byteOffset':len(newbin),'byteLength':len(data)}
    if target: v['target']=target
    newbin.extend(data);views.append(v);return len(views)-1
# remap non-animation accessors/bufferViews: copy everything referenced except animation-only accessors
animacc=set()
for x in j['animations']:
    for s in x['samplers']: animacc.add(s['input']); animacc.add(s['output'])
keepacc=[i for i in range(len(acc)) if i not in animacc]
vmap={}
def mapview(vi):
    if vi not in vmap:
        v=bv[vi];d=b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        nv=addview(d,v.get('target'));
        if 'byteStride' in v: views[nv]['byteStride']=v['byteStride']
        vmap[vi]=nv
    return vmap[vi]
amap={}
for i in keepacc:
    x=dict(acc[i])
    if 'bufferView' in x: x['bufferView']=mapview(x['bufferView'])
    amap[i]=len(accs);accs.append(x)
for im in j.get('images',[]):
    if 'bufferView' in im: im['bufferView']=mapview(im['bufferView'])
def readf(ai):
    x=acc[ai];v=bv[x['bufferView']];n={'SCALAR':1,'VEC3':3,'VEC4':4}[x['type']]
    off=v.get('byteOffset',0)+x.get('byteOffset',0)
    return list(struct.unpack_from('<%df'%(n*x['count']),b,off)),n
def addacc(vals,n,typ,minmax=False):
    data=struct.pack('<%df'%len(vals),*vals)
    vi=addview(data)
    x={'bufferView':vi,'componentType':5126,'count':len(vals)//n,'type':typ}
    if minmax: x['min']=[min(vals[k::n]) for k in range(n)];x['max']=[max(vals[k::n]) for k in range(n)]
    accs.append(x);return len(accs)-1
samplers=[];chs=[]
# bones whose animated translation is far outside a pivot delta: wow.export data for them is unusable
BAD=set()
for ch in a['channels']:
    if ch['target']['path']=='translation':
        o,_=readf(a['samplers'][ch['sampler']]['output'])
        if max(abs(v) for v in o)>0.3: BAD.add(nodes[ch['target']['node']].get('name'))
print('dropped bones',sorted(BAD))
for ch in a['channels']:
    s=a['samplers'][ch['sampler']];node=nodes[ch['target']['node']];path=ch['target']['path']
    tin,_=readf(s['input']);out,n=readf(s['output'])
    if node.get('name') in BAD:
        continue
    if path=='translation':
        r=node.get('translation',[0,0,0])
        out=[out[k]+r[k%3] for k in range(len(out))]
    ii=addacc(tin,1,'SCALAR',True);oi=addacc(out,n,acc[s['output']]['type'])
    samplers.append({'input':ii,'output':oi,'interpolation':s.get('interpolation','LINEAR')})
    chs.append({'sampler':len(samplers)-1,'target':ch['target']})
# remap accessor refs in meshes/skins
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes']={k:amap[v] for k,v in p['attributes'].items()}
        if 'indices' in p: p['indices']=amap[p['indices']]
for sk in j.get('skins',[]):
    if 'inverseBindMatrices' in sk: sk['inverseBindMatrices']=amap[sk['inverseBindMatrices']]
j['animations']=[{'name':'Stand','samplers':samplers,'channels':chs}]
j['accessors']=accs;j['bufferViews']=views
while len(newbin)%4: newbin.append(0)
j['buffers']=[{'byteLength':len(newbin)}]
js=json.dumps(j,separators=(',',':')).encode()
while len(js)%4: js+=b' '
with open(dst,'wb') as f:
    f.write(struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(newbin)))
    f.write(struct.pack('<II',len(js),0x4E4F534A));f.write(js)
    f.write(struct.pack('<II',len(newbin),0x004E4942));f.write(newbin)
print('written',dst,round((12+16+len(js)+len(newbin))/1e6,2),'MB')
