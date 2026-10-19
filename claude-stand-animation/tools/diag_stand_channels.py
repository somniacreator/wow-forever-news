import json,struct,sys,math
p=sys.argv[1]
with open(p,'rb') as f:
    f.read(12); l,t=struct.unpack('<II',f.read(8)); j=json.loads(f.read(l)); bl,bt=struct.unpack('<II',f.read(8)); b=f.read(bl)
acc=j['accessors'];bv=j['bufferViews'];nodes=j['nodes']
def read(ai):
    a=acc[ai];v=bv[a['bufferView']];n={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']]
    off=v.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<%df'%n,b,off+i*4*n) for i in range(a['count'])]
parent={}
for i,n in enumerate(nodes):
    for c in n.get('children',[]): parent[c]=i
a=j['animations'][1]
bad=[]
for ch in a['channels']:
    ni=ch['target']['node'];n=nodes[ni];path=ch['target']['path']
    o=read(a['samplers'][ch['sampler']]['output'])
    if path=='translation':
        r=n.get('translation',[0,0,0]);d=max(abs(o[0][k]-r[k]) for k in range(3))
        if d>0.05: bad.append((n['name'],path,[round(x,3) for x in r],[round(x,3) for x in o[0]],len(o), nodes[parent.get(ni)]['name'] if ni in parent else None))
    if path=='scale':
        if max(abs(x-1) for x in o[0])>0.01: bad.append((n['name'],path,None,[round(x,3) for x in o[0]],len(o),None))
for x in bad: print(x)
print(len(bad),'of',len(a['channels']))
