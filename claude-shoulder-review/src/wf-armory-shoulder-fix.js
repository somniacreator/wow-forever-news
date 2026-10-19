/* Parent wow.export shoulder meshes written at the scene origin to their shoulder joints at the confirmed attachment point. */
(() => {
  const mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  };
  const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const tr = p => [1,0,0,0,0,1,0,0,0,0,1,0,p[0],p[1],p[2],1];
  const local = n => {
    if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix;
    const [x=0,y=0,z=0,w=1]=n.rotation||[],[sx=1,sy=1,sz=1]=n.scale||[],[tx=0,ty=0,tz=0]=n.translation||[];
    const x2=x+x,y2=y+y,z2=z+z,xx=x*x2,xy=x*y2,xz=x*z2,yy=y*y2,yz=y*z2,zz=z*z2,wx=w*x2,wy=w*y2,wz=w*z2;
    return [(1-yy-zz)*sx,(xy+wz)*sx,(xz-wy)*sx,0,(xy-wz)*sy,(1-xx-zz)*sy,(yz+wx)*sy,0,(xz+wy)*sz,(yz-wx)*sz,(1-xx-yy)*sz,0,tx,ty,tz,1];
  };
  const inv = a => {
    const o=new Array(16),a00=a[0],a01=a[1],a02=a[2],a03=a[3],a10=a[4],a11=a[5],a12=a[6],a13=a[7],a20=a[8],a21=a[9],a22=a[10],a23=a[11],a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    const b00=a00*a11-a01*a10,b01=a00*a12-a02*a10,b02=a00*a13-a03*a10,b03=a01*a12-a02*a11,b04=a01*a13-a03*a11,b05=a02*a13-a03*a12,b06=a20*a31-a21*a30,b07=a20*a32-a22*a30,b08=a20*a33-a23*a30,b09=a21*a32-a22*a31,b10=a21*a33-a23*a31,b11=a22*a33-a23*a32;
    let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(!Number.isFinite(d)||Math.abs(d)<1e-12)return null;d=1/d;
    o[0]=(a11*b11-a12*b10+a13*b09)*d;o[1]=(a02*b10-a01*b11-a03*b09)*d;o[2]=(a31*b05-a32*b04+a33*b03)*d;o[3]=(a22*b04-a21*b05-a23*b03)*d;
    o[4]=(a12*b08-a10*b11-a13*b07)*d;o[5]=(a00*b11-a02*b08+a03*b07)*d;o[6]=(a32*b02-a30*b05-a33*b01)*d;o[7]=(a20*b05-a22*b02+a23*b01)*d;
    o[8]=(a10*b10-a11*b08+a13*b06)*d;o[9]=(a01*b08-a00*b10-a03*b06)*d;o[10]=(a30*b04-a31*b02+a33*b00)*d;o[11]=(a21*b02-a20*b04-a23*b00)*d;
    o[12]=(a11*b07-a10*b09-a12*b06)*d;o[13]=(a00*b09-a01*b07+a02*b06)*d;o[14]=(a31*b01-a30*b03-a32*b00)*d;o[15]=(a20*b03-a21*b01+a22*b00)*d;return o;
  };
  window.WFArmoryImport.attachDetachedShoulders = async (file, attachments = {}) => {
    if (!file || file.size < 20) return { blob:file, attached:0, missing:[] };
    const head=new Uint8Array(await file.slice(0,20).arrayBuffer()),hv=new DataView(head.buffer,head.byteOffset,head.byteLength);
    if(hv.getUint32(0,true)!==0x46546c67||hv.getUint32(4,true)!==2)return {blob:file,attached:0,missing:[]};
    const len=hv.getUint32(12,true);if(hv.getUint32(16,true)!==0x4e4f534a||len<2||len>100*1024*1024||20+len>file.size)return {blob:file,attached:0,missing:[]};
    const g=JSON.parse(await file.slice(20,20+len).text()),nodes=Array.isArray(g.nodes)?g.nodes:[],skins=Array.isArray(g.skins)?g.skins:[],parents=new Map();
    nodes.forEach((n,p)=>(n.children||[]).forEach(c=>parents.set(c,p)));
    const jointNames=new Set(skins.flatMap(s=>(s.joints||[]).map(i=>nodes[i]?.name))),named=new Map(nodes.map((n,i)=>[n.name,i])),cache=new Map();
    const world=(i,seen=new Set())=>{if(cache.has(i))return cache.get(i);if(seen.has(i))throw Error('Цикл в GLB');seen.add(i);const p=parents.get(i),m=p===undefined?local(nodes[i]):mul(world(p,seen),local(nodes[i]));seen.delete(i);cache.set(i,m);return m;};
    const missing=[];let count=0;
    for(let i=0;i<nodes.length;i++){
      const n=nodes[i];if(n.mesh===undefined||n.skin!==undefined)continue;
      const name=String(n.name||'').toLowerCase(),side=/shoulder\s*\(?\s*l\s*\)?|shoulder.*left/.test(name)?'L':/shoulder\s*\(?\s*r\s*\)?|shoulder.*right/.test(name)?'R':'';
      if(!side)continue;const bi=named.get(`bone_Shoulder${side}`);if(bi===undefined||!jointNames.has(`bone_Shoulder${side}`)||parents.get(i)===bi)continue;
      const pos=attachments?.[side]?.position;
      if(!Array.isArray(pos)||pos.length!==3||!pos.every(Number.isFinite)){if(!missing.includes(side))missing.push(side);continue;}
      const skin=skins.find(s=>(s.joints||[]).includes(bi)),modelWorld=skin?.skeleton!==undefined?world(skin.skeleton):I;
      const boneInverse=inv(world(bi));if(!boneInverse)continue;
      const pi=parents.get(i);if(pi!==undefined)nodes[pi].children=(nodes[pi].children||[]).filter(c=>c!==i);
      else for(const scene of g.scenes||[])scene.nodes=(scene.nodes||[]).filter(c=>c!==i);
      nodes[bi].children=nodes[bi].children||[];if(!nodes[bi].children.includes(i))nodes[bi].children.push(i);
      const m=mul(boneInverse,mul(modelWorld,mul(tr(pos),local(n))));
      delete n.translation;delete n.rotation;delete n.scale;n.matrix=m;parents.set(i,bi);cache.clear();count++;
    }
    if(!count)return {blob:file,attached:0,missing};
    const bytes=new TextEncoder().encode(JSON.stringify(g)),padded=(bytes.length+3)&~3,out=new Uint8Array(20+padded),total=out.length+file.size-(20+len),v=new DataView(out.buffer);
    v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,total,true);v.setUint32(12,padded,true);v.setUint32(16,0x4e4f534a,true);out.fill(0x20,20,20+padded);out.set(bytes,20);
    return {blob:new Blob([out,file.slice(20+len)],{type:'model/gltf-binary'}),attached:count,missing};
  };
})();
