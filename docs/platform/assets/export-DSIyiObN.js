/*! TPMS Explorer | MIT License | (c) 2026 zhaoliuxin926-ux | https://github.com/zhaoliuxin926-ux/tpms-explorer/blob/main/LICENSE */
import{a as e,d as t,n,o as r,r as i,s as a,t as o,u as s}from"./index-CFptBU14.js";import{compileGcode as c,sliceMesh as l}from"./gcode-slicer-G4Zy2weM.js";function u(e,t,n=1,r){let i=t.length/3,a=new ArrayBuffer(84+i*50),o=new DataView(a);for(let e=0;e<74&&e<80;e++)o.setUint8(e,`TPMS Explorer binary STL; units=mm; scale=uniform (cellSize or normalized)`.charCodeAt(e));o.setUint32(80,i,!0);let s=f(e,t),c=84;for(let t=0;t<i;t++){let r=s[t*3]*3,i=s[t*3+1]*3,a=s[t*3+2]*3,l=e[i]-e[r],u=e[i+1]-e[r+1],d=e[i+2]-e[r+2],f=e[a]-e[r],p=e[a+1]-e[r+1],m=e[a+2]-e[r+2],h=u*m-d*p,g=d*f-l*m,_=l*p-u*f,v=Math.sqrt(h*h+g*g+_*_)||1;o.setFloat32(c,h/v,!0),c+=4,o.setFloat32(c,g/v,!0),c+=4,o.setFloat32(c,_/v,!0),c+=4,o.setFloat32(c,e[r]*n,!0),c+=4,o.setFloat32(c,e[r+1]*n,!0),c+=4,o.setFloat32(c,e[r+2]*n,!0),c+=4,o.setFloat32(c,e[i]*n,!0),c+=4,o.setFloat32(c,e[i+1]*n,!0),c+=4,o.setFloat32(c,e[i+2]*n,!0),c+=4,o.setFloat32(c,e[a]*n,!0),c+=4,o.setFloat32(c,e[a+1]*n,!0),c+=4,o.setFloat32(c,e[a+2]*n,!0),c+=4,o.setUint16(c,0,!0),c+=2}return a}function d(e,t,n,r=1,i){let a=u(e,t,r,i);o(new Blob([a],{type:`model/stl`}),n)}function f(e,t){let n=t.length/3,r=t.slice();if(n===0)return r;let i=e.length/3,a=new Map;for(let e=0;e<n;e++)for(let n=0;n<3;n++){let r=t[e*3+n],o=t[e*3+(n+1)%3];if(r===o)continue;let s=r>o,c=s?o*i+r:r*i+o,l=a.get(c);l||(l=[],a.set(c,l)),l.length<2&&l.push({t:e,rev:s})}let o=new Int8Array(n).fill(-1),s=new Int32Array(n);for(let e=0;e<n;e++){if(o[e]!==-1)continue;o[e]=0;let n=0,r=0;for(s[r++]=e;n<r;){let e=s[n++];for(let n=0;n<3;n++){let c=t[e*3+n],l=t[e*3+(n+1)%3];if(c===l)continue;let u=c>l?l*i+c:c*i+l,d=a.get(u);if(!d||d.length!==2)continue;let f=d[0].t===e?d[1]:d[0];o[f.t]===-1&&(o[f.t]=f.rev===c>l?o[e]^1:o[e],s[r++]=f.t)}}}for(let e=0;e<n;e++)if(o[e]===1){let t=r[e*3+1];r[e*3+1]=r[e*3+2],r[e*3+2]=t}let c=0;for(let t=0;t<n;t++){let n=r[t*3]*3,i=r[t*3+1]*3,a=r[t*3+2]*3;c+=e[n]*(e[i+1]*e[a+2]-e[i+2]*e[a+1])+e[n+1]*(e[i+2]*e[a]-e[i]*e[a+2])+e[n+2]*(e[i]*e[a+1]-e[i+1]*e[a])}if(c<0)for(let e=0;e<n;e++){let t=r[e*3+1];r[e*3+1]=r[e*3+2],r[e*3+2]=t}return r}var p=[`inlet`,`outlet`,`sides`,`wall`];function m(e,t,n=1,r){let i=t.length/3,a=1/0,o=-1/0,s=1/0,c=-1/0,l=1/0,u=-1/0;for(let t=0;t<e.length;t+=3){let r=e[t]*n,i=e[t+1]*n,d=e[t+2]*n;r<a&&(a=r),r>o&&(o=r),i<s&&(s=i),i>c&&(c=i),d<l&&(l=d),d>u&&(u=d)}let d=Math.max((o-a)*.01,n*.001),m=Math.max((c-s)*.01,n*.001),h=Math.max((u-l)*.01,n*.001),g={inlet:[],outlet:[],sides:[],wall:[]},_=e=>e.toFixed(6),v=f(e,t);for(let t=0;t<i;t++){let r=v[t*3]*3,i=v[t*3+1]*3,f=v[t*3+2]*3,p=e[i]-e[r],y=e[i+1]-e[r+1],b=e[i+2]-e[r+2],x=e[f]-e[r],S=e[f+1]-e[r+1],C=e[f+2]-e[r+2],w=y*C-b*S,T=b*x-p*C,E=p*S-y*x,D=Math.sqrt(w*w+T*T+E*E)||1,O=w/D,k=T/D,A=E/D,j=(e[r]+e[i]+e[f])/3*n,M=(e[r+1]+e[i+1]+e[f+1])/3*n,N=(e[r+2]+e[i+2]+e[f+2])/3*n,P=`wall`;N<=l+h&&A<-.7?P=`inlet`:N>=u-h&&A>.7?P=`outlet`:(j<=a+d||j>=o-d||M<=s+m||M>=c-m)&&(P=`sides`),g[P].push(` facet normal ${_(O)} ${_(k)} ${_(A)}\n`,`  outer loop
`,`   vertex ${_(e[r]*n)} ${_(e[r+1]*n)} ${_(e[r+2]*n)}\n`,`   vertex ${_(e[i]*n)} ${_(e[i+1]*n)} ${_(e[i+2]*n)}\n`,`   vertex ${_(e[f]*n)} ${_(e[f+1]*n)} ${_(e[f+2]*n)}\n`,`  endloop
`,` endfacet
`)}let y=``;for(let e of p)y+=`solid ${e}\n${g[e].join(``)}endsolid ${e}\n`;return y}function h(e,t,n,r=1,i){let a=m(e,t,r,i);o(new Blob([a],{type:`model/stl`}),n)}function g(e){return e+3&-4}function _(e){let t=e.scale??1,n=e.positions.length/3,r=!!e.colors&&e.colors.length===n*3,i=new Float32Array(e.positions.length);for(let n=0;n<e.positions.length;n++)i[n]=e.positions[n]*t;let a=[1/0,1/0,1/0],o=[-1/0,-1/0,-1/0];for(let e=0;e<i.length;e+=3)for(let t=0;t<3;t++){let n=i[e+t];n<a[t]&&(a[t]=n),n>o[t]&&(o[t]=n)}let s=[],c=0,l=e=>{let t=c;return c+=g(e),s.push({offset:t,length:e}),s.length-1},u=l(i.byteLength),d=e.normals?l(e.normals.byteLength):-1,f=r?l(e.colors.byteLength):-1,p=l(e.indices.byteLength),m=new ArrayBuffer(c),h=new Uint8Array(m);h.set(new Uint8Array(i.buffer,i.byteOffset,i.byteLength),s[u].offset),e.normals&&d>=0&&h.set(new Uint8Array(e.normals.buffer,e.normals.byteOffset,e.normals.byteLength),s[d].offset),r&&f>=0&&h.set(new Uint8Array(e.colors.buffer,e.colors.byteOffset,e.colors.byteLength),s[f].offset),h.set(new Uint8Array(e.indices.buffer,e.indices.byteOffset,e.indices.byteLength),s[p].offset);let _=[],v=[{name:`tpms`,primitives:[{attributes:{POSITION:0,...e.normals?{NORMAL:1}:{},...r?{COLOR_0:2}:{}},indices:r?3:2,mode:4,material:0}]}];_.push({bufferView:u,componentType:5126,count:n,type:`VEC3`,min:a,max:o}),e.normals&&_.push({bufferView:d,componentType:5126,count:n,type:`VEC3`}),r&&_.push({bufferView:f,componentType:5126,count:n,type:`VEC3`}),_.push({bufferView:p,componentType:5125,count:e.indices.length,type:`SCALAR`});let y={asset:{version:`2.0`,generator:`TPMS Explorer (glb-exporter.ts)`,extras:{units:`millimeter`,...e.meta??{}}},scene:0,scenes:[{nodes:[0]}],nodes:[{name:`TPMS`,mesh:0}],meshes:v,materials:[{name:`tpms-material`,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:.1,roughnessFactor:.6},...r?{vertexColors:!0}:{},doubleSided:!1}],accessors:_,bufferViews:s.map(e=>({buffer:0,byteOffset:e.offset,byteLength:e.length})),buffers:[{byteLength:c}]},b=JSON.stringify(y);for(;b.length%4!=0;)b+=` `;let x=new TextEncoder().encode(b),S=g(x.length)-x.length,C=20+x.length+S+8+c,w=new ArrayBuffer(C),T=new DataView(w),E=new Uint8Array(w);T.setUint32(0,1179937895,!0),T.setUint32(4,2,!0),T.setUint32(8,C,!0),T.setUint32(12,x.length+S,!0),T.setUint32(16,1313821514,!0),E.set(x,20);for(let e=0;e<S;e++)E[20+x.length+e]=32;let D=20+x.length+S;return T.setUint32(D,c,!0),T.setUint32(D+4,5130562,!0),E.set(h,D+8),w}function v(e,t,n,r,i,a=1,s){let c=_({positions:e,normals:t,indices:n,colors:r,scale:a,meta:s});o(new Blob([c],{type:`model/gltf-binary`}),i)}var y=(()=>{let e=new Uint32Array(256);for(let t=0;t<256;t++){let n=t;for(let e=0;e<8;e++)n=n&1?3988292384^n>>>1:n>>>1;e[t]=n>>>0}return e})();function b(e){let t=4294967295;for(let n=0;n<e.length;n++)t=y[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function x(e){return e.replace(/&/g,`&amp;`).replace(/</g,`&lt;`).replace(/>/g,`&gt;`).replace(/"/g,`&quot;`)}function S(e,t,n,r){let i=e=>(Math.round(e*1e6)/1e6).toString(),a=e.length/3,o=t.length/3,s=r.endplateMm>0?`<metadata name="TPMS:EndplateMm">${r.endplateMm}</metadata>\n`:``,c=[];c.push(`<?xml version="1.0" encoding="UTF-8"?>
`),c.push(`<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
`),c.push(`<metadata name="Title">${x(`TPMS ${r.configName}`)}</metadata>\n`),c.push(`<metadata name="Designer">TPMS Explorer</metadata>
`),c.push(`<metadata name="Description">${x(`Triply-Periodic Minimal Surface lattice; mode=${r.structureMode}; target porosity=${r.porosity}%${r.endplateMm>0?`; solid endplates ${r.endplateMm} mm`:``}`)}</metadata>\n`),c.push(`<metadata name="TPMS:Config">${x(r.configName)}</metadata>\n`),c.push(`<metadata name="TPMS:PorosityPct">${r.porosity}</metadata>\n`),c.push(s),c.push(`<resources>
<object id="1" type="model"><mesh>
<vertices>
`);for(let t=0;t<e.length;t+=3)c.push(`<vertex x="${i(e[t]*n)}" y="${i(e[t+1]*n)}" z="${i(e[t+2]*n)}"/>\n`);c.push(`</vertices>
<triangles>
`);for(let e=0;e<t.length;e+=3)c.push(`<triangle v1="${t[e]}" v2="${t[e+1]}" v3="${t[e+2]}"/>\n`);c.push(`</triangles>
</mesh></object>
</resources>
<build><item objectid="1"/></build>
</model>
`);let l=c.join(``),u=(l.match(/<vertex /g)||[]).length,d=(l.match(/<triangle /g)||[]).length;if(u!==a||d!==o)throw Error(`3MF 守恒校验失败：vertices ${u}/${a}, triangles ${d}/${o}`);let f=new TextEncoder,p=[],m=f.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`),h=f.encode(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`),g=f.encode(l);for(let[e,t]of[[`[Content_Types].xml`,m],[`_rels/.rels`,h],[`3D/3dmodel.model`,g]])p.push({nameBytes:f.encode(e),data:t,crc:b(t),offset:0});let _=0,v=[],y=[];for(let e of p){let t=new ArrayBuffer(30+e.nameBytes.length),n=new DataView(t);n.setUint32(0,67324752,!0),n.setUint16(4,20,!0),n.setUint16(6,0,!0),n.setUint16(8,0,!0),n.setUint16(10,0,!0),n.setUint16(12,0,!0),n.setUint32(14,e.crc,!0),n.setUint32(18,e.data.length,!0),n.setUint32(22,e.data.length,!0),n.setUint16(26,e.nameBytes.length,!0),n.setUint16(28,0,!0);let r=new Uint8Array(t);r.set(e.nameBytes,30),e.offset=_,v.push(r,e.data),_+=t.byteLength+e.data.length;let i=new ArrayBuffer(46+e.nameBytes.length),a=new DataView(i);a.setUint32(0,33639248,!0),a.setUint16(4,20,!0),a.setUint16(6,20,!0),a.setUint16(8,0,!0),a.setUint16(10,0,!0),a.setUint16(12,0,!0),a.setUint16(14,0,!0),a.setUint32(16,e.crc,!0),a.setUint32(20,e.data.length,!0),a.setUint32(24,e.data.length,!0),a.setUint16(28,e.nameBytes.length,!0),a.setUint32(42,e.offset,!0),new Uint8Array(i).set(e.nameBytes,46),y.push(new Uint8Array(i))}let S=y.reduce((e,t)=>e+t.length,0),C=new ArrayBuffer(22),w=new DataView(C);w.setUint32(0,101010256,!0),w.setUint16(8,p.length,!0),w.setUint16(10,p.length,!0),w.setUint32(12,S,!0),w.setUint32(16,_,!0);let T=_+S+22,E=new Uint8Array(T),D=0;for(let e of v)E.set(e,D),D+=e.length;for(let e of y)E.set(e,D),D+=e.length;return E.set(new Uint8Array(C),D),E.buffer}function C(e,t,n,r,i){let a=S(e,t,r,i);o(new Blob([a],{type:`model/3mf`}),n)}function w(e,t,n=1,r){let i=e.length/3,a=t.length/3,o=[`# vtk DataFile Version 3.0
`,`TPMS Structure; units=mm; uniform scale (cellSize or normalized domain mm)
`,`ASCII
`,`DATASET POLYDATA
`,`POINTS ${i} float\n`],s=Array(i);for(let t=0;t<i;t++){let r=t*3;s[t]=`${(e[r]*n).toFixed(6)} ${(e[r+1]*n).toFixed(6)} ${(e[r+2]*n).toFixed(6)}\n`}o.push(s.join(``)),o.push(`POLYGONS ${a} ${a*4}\n`);let c=Array(a);for(let n=0;n<a;n++){let i=t[n*3],a=t[n*3+1],o=t[n*3+2];if(r){let t=r[i*3]+r[a*3]+r[o*3],n=r[i*3+1]+r[a*3+1]+r[o*3+1],s=r[i*3+2]+r[a*3+2]+r[o*3+2],c=e[a*3]-e[i*3],l=e[a*3+1]-e[i*3+1],u=e[a*3+2]-e[i*3+2],d=e[o*3]-e[i*3],f=e[o*3+1]-e[i*3+1],p=e[o*3+2]-e[i*3+2];if(t*(l*p-u*f)+n*(u*d-c*p)+s*(c*f-l*d)<0){let e=a;a=o,o=e}}c[n]=`3 ${i} ${a} ${o}\n`}return o.push(c.join(``)),o.join(``)}function T(e,t,n,r=1,i){o(new Blob([w(e,t,r,i)],{type:`application/vnd.vtk`}),n)}function E(e,t,n){let[r,i,a]=t,o=r*i*a,s=n?.cellSizeMm??1,c=(-s/2).toFixed(6),l=(s/(r-1)).toFixed(6),u=[`<?xml version="1.0"?>
`,`<VTKFile type="ImageData" version="1.0" byte_order="LittleEndian">
`];if(n){let e=n.structureMode===`shell`||n.structureMode===`gradient_shell`;u.push(`  <ImageData WholeExtent="0 ${r-1} 0 ${i-1} 0 ${a-1}" Origin="${c} ${c} ${c}" Spacing="${l} ${l} ${l}">\n`,`    <!-- tpmsType=${n.type} structureMode=${n.structureMode} cellSizeMm=${s} isoUsed=${n.isoUsed??`NaN`} -->\n`,`    <!-- re-contour: ${e?`此场为裸 TPMS 场 V；shell/gradient_shell 需先变换 F=(V)^2-(t/2)^2 再 contour 0（t/2=isoUsed）`:`solid_network 直接 contour at isoUsed`} -->\n`,`    <FieldData>
`,`      <DataArray type="Float64" Name="isoUsed" NumberOfTuples="1" format="ascii">${n.isoUsed??`NaN`}</DataArray>\n`,`      <DataArray type="Float64" Name="cellSizeMm" NumberOfTuples="1" format="ascii">${s}</DataArray>\n`,`    </FieldData>
`,`    <Piece Extent="0 ${r-1} 0 ${i-1} 0 ${a-1}">\n`,`      <PointData Scalars="tpms">
`,`        <DataArray type="Float32" Name="tpms" format="ascii">
`)}else u.push(`  <ImageData WholeExtent="0 ${r-1} 0 ${i-1} 0 ${a-1}" Origin="${c} ${c} ${c}" Spacing="${l} ${l} ${l}">\n`,`    <Piece Extent="0 ${r-1} 0 ${i-1} 0 ${a-1}">\n`,`      <PointData Scalars="tpms">
`,`        <DataArray type="Float32" Name="tpms" format="ascii">
`);let d=Array(o);for(let t=0;t<o;t++)d[t]=t>0&&t%6==0?`\n${e[t].toFixed(4)} `:`${e[t].toFixed(4)} `;return u.push(d.join(``)),u.push(`
`),u.push(`        </DataArray>
`),u.push(`      </PointData>
`),u.push(`    </Piece>
`),u.push(`  </ImageData>
`),u.push(`</VTKFile>`),u.join(``)}function D(e,t,n,r){o(new Blob([E(e,t,r)],{type:`application/xml`}),n)}function O(e){return e.model===`solid`?`${-((e.thickness-1)*.12)}`:`0.0`}function k(e){return e.customFormula.trim()?s(e.customFormula).toPython(e=>`kk*${e.toUpperCase()}`):`0.0  # 非自定义模式：此分支不执行`}function A(e){return e.customFormula.trim()?s(e.customFormula).toMatlab(e=>`kk*${e.toUpperCase()}`):`0.0; % 非自定义模式：此分支不执行`}function j(e){return typeof e==`string`?e.replace(/[^A-Za-z0-9_-]/g,`_`):String(e)}function M(e){return N(e)}function N(e){return`# TPMS 参数化重建脚本 (PyVista)
# Generated by TPMS Explorer
# 本脚本与平台逐点对齐：相同参数下等值面位置一致（算法差异仅剩 MC vs Surface Nets 的网格化误差）。
# 运行: pip install numpy pyvista

import numpy as np
import pyvista as pv

# 参数配置
tpms_type = '${j(e.type)}'
porosity = ${e.porosity}
cell_size = ${e.cellSize}      # 周期数 k（1 period = 1 mm，模型总宽 = cell_size mm）
thickness = ${e.thickness}
weights = [${e.weights.join(`, `)}]
structure_mode = '${j(e.structureMode)}'
container = '${j(e.containerShape)}'
gradient_dir = '${j(e.gradientDir)}'
endplate_mm = ${e.endplateMm}   # 实心加载端板单侧厚度 mm（0=关；生效值钳制至 0.4*L）
# 【阶段 IV】应力场引导（与 core/stress-driven-field.ts 同源；none = 关闭）
stress_preset = '${j(e.stress.preset)}'
stress_strength = ${e.stress.strength}
stress_anisotropy = ${e.stress.anisotropy}

kk = cell_size  # 频率倍率：平台顶点域恒 [-pi, pi]，周期数编码在频率上
# 倍频曲面（I-WP/F-RD 含 cos2kx 项）特征频率 2k，分辨率密度加倍补偿弦切误差
fk = 28 if (tpms_type in ('iwp', 'frd', 'neovius') or (structure_mode == 'gradient_shell' and gradient_dir != 'z')) else 14
# A2 密度保优：触 96 上限后预算让渡给每周期密度（与平台 units.hdResolution 同源）
r_lin = 19 + cell_size * fk
R = int(r_lin) if r_lin <= 96 else int(min(96, np.ceil(cell_size * fk)))
N = R + 1

# 生成坐标网格（弧度域 [-pi, pi]，公式频率乘 kk）
x = np.linspace(-np.pi, np.pi, N)
y = np.linspace(-np.pi, np.pi, N)
z = np.linspace(-np.pi, np.pi, N)
X, Y, Z = np.meshgrid(x, y, z, indexing='ij')

# 【G4 2026-10-11】strut 桁架场：与 core/strut-bcc.ts / strut-octet.ts 同源
# （cell=2π=一周期、r=w0·半胞、octet 角↔面心 FCC 逐轴 |Δ|≤½cell 判定 + 面心对角）。
# 归约坐标 u = mx − cell·floor(mx/cell) ∈ [0,cell)，27 邻域在归约系平铺——天然周期。
def _segdist(P, A, B):
    AB = B - A
    tt = np.clip(((P - A) * AB).sum(-1) / (AB * AB).sum(-1), 0.0, 1.0)
    return np.sqrt(((P - (A + tt[..., None] * AB)) ** 2).sum(-1))

def strut_field(X, Y, Z, w0, octet):
    cell = 2.0 * np.pi
    r = w0 * cell / 2.0
    ci = np.floor(X / cell); cj = np.floor(Y / cell); ck = np.floor(Z / cell)
    U = np.stack([X - ci * cell, Y - cj * cell, Z - ck * cell], axis=-1)
    corners = [[vi, vj, vl] for vi in (0, 1) for vj in (0, 1) for vl in (0, 1)]
    faces = []
    for fx, fy, fz in ((0.5, 0.5, 0), (0.5, 0, 0.5), (0, 0.5, 0.5)):
        faces.append([fx, fy, fz]); faces.append([1 - fx, 1 - fy, 1 - fz])
    rods = []
    if not octet:
        bc = [0.5, 0.5, 0.5]
        for c in corners:
            rods.append((np.array(c, float) * cell, np.array(bc, float) * cell))
    else:
        for c in corners:
            for f in faces:
                if all(abs(f[a] - c[a]) <= 0.501 for a in range(3)):
                    rods.append((np.array(c, float) * cell, np.array(f, float) * cell))
        for a in range(len(faces)):
            for b in range(a + 1, len(faces)):
                d2 = sum((faces[a][q] - faces[b][q]) ** 2 for q in range(3))
                if abs(d2 - 0.5) < 1e-6:
                    rods.append((np.array(faces[a], float) * cell, np.array(faces[b], float) * cell))
    D = np.full(X.shape, np.inf)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for dk in (-1, 0, 1):
                off = np.array([di, dj, dk], float) * cell
                for A, B in rods:
                    D = np.minimum(D, _segdist(U, A + off, B + off))
    return D - r

# 隐函数场（与平台 core/tpms-functions.ts 逐项一致）
def tpms_field(X, Y, Z, w, tpms_type_override=None):
    t = tpms_type_override if tpms_type_override is not None else tpms_type
    if t == 'gyroid':
        return w[0]*np.sin(kk*X)*np.cos(kk*Y) + w[1]*np.sin(kk*Y)*np.cos(kk*Z) + w[2]*np.sin(kk*Z)*np.cos(kk*X)
    elif t == 'diamond':
        return (w[0]*np.sin(kk*X)*np.sin(kk*Y)*np.sin(kk*Z)
                + w[1]*np.sin(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)
                + w[2]*np.cos(kk*X)*np.sin(kk*Y)*np.cos(kk*Z)
                + w[3]*np.cos(kk*X)*np.cos(kk*Y)*np.sin(kk*Z))
    elif t == 'schwarz':
        return w[0]*np.cos(kk*X) + w[1]*np.cos(kk*Y) + w[2]*np.cos(kk*Z)
    elif t == 'neovius':
        return 3*w[0]*(np.cos(kk*X) + np.cos(kk*Y) + np.cos(kk*Z)) + 4*w[1]*np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)
    elif t == 'iwp':
        return (2*w[0]*(np.cos(kk*X)*np.cos(kk*Y) + np.cos(kk*Y)*np.cos(kk*Z) + np.cos(kk*Z)*np.cos(kk*X))
                - w[1]*(np.cos(2*kk*X) + np.cos(2*kk*Y) + np.cos(2*kk*Z)))
    elif t == 'frd':
        return (4*w[0]*np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)
                - w[1]*(np.cos(2*kk*X)*np.cos(2*kk*Y) + np.cos(2*kk*Y)*np.cos(2*kk*Z) + np.cos(2*kk*Z)*np.cos(2*kk*X)))
    elif t == 'lidinoid':
        return (0.5 * w[0] * (2*np.sin(kk*X)*np.cos(kk*X)*np.cos(kk*Y)*np.sin(kk*Z)
                              + 2*np.sin(kk*Y)*np.cos(kk*Y)*np.cos(kk*Z)*np.sin(kk*X)
                              + 2*np.sin(kk*Z)*np.cos(kk*Z)*np.cos(kk*X)*np.sin(kk*Y))
                - 0.5 * w[1] * (np.cos(2*kk*X)*np.cos(2*kk*Y) + np.cos(2*kk*Y)*np.cos(2*kk*Z) + np.cos(2*kk*Z)*np.cos(2*kk*X))
                + 0.15)
    elif t == 'splitp':
        return (1.1 * w[0] * (2*np.sin(kk*X)*np.cos(kk*X)*np.cos(kk*Y)*np.sin(kk*Z)
                              + 2*np.sin(kk*X)*np.sin(kk*Y)*np.cos(kk*Y)*np.cos(kk*Z)
                              + 2*np.cos(kk*X)*np.sin(kk*Y)*np.sin(kk*Z)*np.cos(kk*Z))
                - 0.2 * w[1] * (np.cos(2*kk*X)*np.cos(2*kk*Y) + np.cos(2*kk*Y)*np.cos(2*kk*Z) + np.cos(2*kk*Z)*np.cos(2*kk*X))
                - 0.4 * w[2] * (np.cos(2*kk*X) + np.cos(2*kk*Y) + np.cos(2*kk*Z)))
    elif t == 'octo':
        return (0.6 * w[0] * (np.cos(kk*X)*np.cos(kk*Y) + np.cos(kk*Y)*np.cos(kk*Z) + np.cos(kk*Z)*np.cos(kk*X))
                - 0.4 * w[1] * (np.cos(kk*X) + np.cos(kk*Y) + np.cos(kk*Z)) + 0.25)
    elif t == 'karcher':
        return (0.3 * w[0] * (np.cos(kk*X) + np.cos(kk*Y) + np.cos(kk*Z))
                + 0.3 * w[1] * (np.cos(kk*X)*np.cos(kk*Y) + np.cos(kk*Y)*np.cos(kk*Z) + np.cos(kk*Z)*np.cos(kk*X))
                - 0.4 * w[2] * (np.cos(2*kk*X) + np.cos(2*kk*Y) + np.cos(2*kk*Z)) + 0.2)
    elif t == 'fks':
        return (w[0]*np.cos(2*kk*X)*np.sin(kk*Y)*np.cos(kk*Z)
                + w[1]*np.cos(kk*X)*np.cos(2*kk*Y)*np.sin(kk*Z)
                + w[2]*np.sin(kk*X)*np.cos(kk*Y)*np.cos(2*kk*Z))
    elif t == 'fky':
        return (w[0]*(np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z) + np.sin(kk*X)*np.sin(kk*Y)*np.sin(kk*Z))
                + w[1]*(np.sin(2*kk*X)*np.sin(kk*Y) + np.sin(2*kk*Y)*np.sin(kk*Z) + np.sin(kk*X)*np.sin(2*kk*Z)
                        + np.sin(2*kk*X)*np.cos(kk*Z) + np.cos(kk*X)*np.sin(2*kk*Y) + np.cos(kk*Y)*np.sin(2*kk*Z)))
    elif t == 'fcks':
        S2x, S2y, S2z = np.sin(2*kk*X), np.sin(2*kk*Y), np.sin(2*kk*Z)
        C2x, C2y, C2z = np.cos(2*kk*X), np.cos(2*kk*Y), np.cos(2*kk*Z)
        S3x, S3y, S3z = np.sin(3*kk*X), np.sin(3*kk*Y), np.sin(3*kk*Z)
        C3x, C3y, C3z = np.cos(3*kk*X), np.cos(3*kk*Y), np.cos(3*kk*Z)
        return (w[0]*(C2x + C2y + C2z
                + 2*(S3x*S2y*np.cos(kk*Z) + np.cos(kk*X)*S3y*S2z + S2x*np.cos(kk*Y)*S3z)
                + 2*(S2x*C3y*np.sin(kk*Z) + np.sin(kk*X)*S2y*C3z + C3x*np.sin(kk*Y)*S2z)))
    elif t == 'gprime':
        return (w[0]*(np.sin(2*kk*X)*np.cos(kk*Y)*np.sin(kk*Z)
                      + np.sin(2*kk*Y)*np.cos(kk*Z)*np.sin(kk*X)
                      + np.sin(2*kk*Z)*np.cos(kk*X)*np.sin(kk*Y)) + 0.32)
    elif t == 'dprime':
        return (w[0]*(0.5*(np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)
                           + np.cos(kk*X)*np.sin(kk*Y)*np.sin(kk*Z)
                           + np.sin(kk*X)*np.cos(kk*Y)*np.sin(kk*Z)
                           + np.sin(kk*X)*np.sin(kk*Y)*np.cos(kk*Z))
                - 0.5*(np.sin(2*kk*X)*np.sin(2*kk*Y) + np.sin(2*kk*Y)*np.sin(2*kk*Z) + np.sin(2*kk*Z)*np.sin(2*kk*X)))
                - 0.2)
    elif t == 'dp':
        return (w[0]*(0.5*(np.cos(kk*X)*np.cos(kk*Y) + np.cos(kk*Y)*np.cos(kk*Z) + np.cos(kk*Z)*np.cos(kk*X))
                + 0.2*(np.cos(2*kk*X) + np.cos(2*kk*Y) + np.cos(2*kk*Z))))
    elif t == 'dd':
        return (w[0]*(0.5*(np.sin(kk*X)*np.sin(kk*Y) + np.sin(kk*Y)*np.sin(kk*Z) + np.sin(kk*Z)*np.sin(kk*X))
                + 0.5*np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)))
    elif t == 'dg':
        return (w[0]*(2.75*(np.sin(2*kk*X)*np.sin(kk*Z)*np.cos(kk*Y)
                            + np.sin(2*kk*Y)*np.sin(kk*X)*np.cos(kk*Z)
                            + np.sin(2*kk*Z)*np.sin(kk*Y)*np.cos(kk*X))
                - 1.0*(np.cos(2*kk*X)*np.cos(2*kk*Y) + np.cos(2*kk*Y)*np.cos(2*kk*Z) + np.cos(2*kk*Z)*np.cos(2*kk*X)))
                - 0.95)
    elif t == 'fcky':
        return (-w[0]*(np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z) + np.sin(kk*X)*np.sin(kk*Y)*np.sin(kk*Z))
                + w[1]*(np.sin(2*kk*X)*np.sin(kk*Y) + np.sin(2*kk*Y)*np.sin(kk*Z) + np.sin(kk*X)*np.sin(2*kk*Z)
                        + np.sin(2*kk*X)*np.cos(kk*Z) + np.cos(kk*X)*np.sin(2*kk*Y) + np.cos(kk*Y)*np.sin(2*kk*Z)))
    elif t == 'cdd':
        C3x = np.cos(3*kk*X); S3x = np.sin(3*kk*X)
        C3y = np.cos(3*kk*Y); S3y = np.sin(3*kk*Y)
        C3z = np.cos(3*kk*Z); S3z = np.sin(3*kk*Z)
        return (w[0]*(C3x*np.cos(kk*Y)*np.cos(kk*Z) - S3x*np.sin(kk*Y)*np.cos(kk*Z)
                      - S3x*np.cos(kk*Y)*np.sin(kk*Z) + C3x*np.sin(kk*Y)*np.sin(kk*Z)
                      + np.cos(kk*X)*C3y*np.cos(kk*Z) - np.sin(kk*X)*S3y*np.cos(kk*Z)
                      + np.sin(kk*X)*C3y*np.sin(kk*Z) - np.cos(kk*X)*S3y*np.sin(kk*Z)
                      + np.cos(kk*X)*np.cos(kk*Y)*C3z + np.sin(kk*X)*np.sin(kk*Y)*C3z
                      - np.sin(kk*X)*np.cos(kk*Y)*S3z - np.cos(kk*X)*np.sin(kk*Y)*S3z))
    elif t == 'slotp':
        C2x = np.cos(2*kk*X); C2y = np.cos(2*kk*Y); C2z = np.cos(2*kk*Z)
        return (w[0]*(-2*(np.cos(kk*X)*np.cos(kk*Y) + np.cos(kk*Y)*np.cos(kk*Z) + np.cos(kk*Z)*np.cos(kk*X))
                - 2*(C2x + C2y + C2z)
                + (C2x*np.cos(kk*Y) + C2y*np.cos(kk*Z) + C2z*np.cos(kk*X))
                - (np.cos(kk*X)*C2y + np.cos(kk*Y)*C2z + np.cos(kk*Z)*C2x)))
    elif t == 'fs':
        return w[0]*np.cos(kk*X)*np.cos(kk*Y)*np.cos(kk*Z)
    elif t == 'qstar':
        cXY = np.cos(kk*X)*np.cos(kk*Y) + np.sin(kk*X)*np.sin(kk*Y)
        return (w[0]*((np.cos(kk*X) - 2*np.cos(kk*Y))*np.cos(kk*Z)
                - np.sqrt(3)*np.sin(kk*Z)*(cXY - np.cos(kk*X)) + cXY*np.cos(kk*Z)))
    elif t == 'ws':
        return (w[0]*((np.cos(2*kk*X)*np.cos(kk*Y) + np.cos(2*kk*Y)*np.cos(kk*Z) + np.cos(2*kk*Z)*np.cos(kk*X))
                - (np.cos(kk*X)*np.cos(2*kk*Y) + np.cos(kk*Y)*np.cos(2*kk*Z) + np.cos(kk*Z)*np.cos(2*kk*X))))
    elif t == 'strutbcc':
        return strut_field(kk*X, kk*Y, kk*Z, w[0], False)
    elif t == 'strutoctet':
        return strut_field(kk*X, kk*Y, kk*Z, w[0], True)
    else:
        raise ValueError(f'Unsupported type: {t}')

# 【阶段 IV】应力场引导：主轴各向异性坐标变换（q' = Rᵀ·S·R·q，S = diag(1/α,1,1)）
# σ(x) 为解析预设张量；v1 = |σ| 最大主方向（与平台 eigenSym3 选择一致）
Xs, Ys, Zs = X, Y, Z
if stress_preset != 'none':
    pxn = X / np.pi; pyn = Y / np.pi; pzn = Z / np.pi
    if stress_preset == 'bending':
        Sig_xx, Sig_xy, Sig_xz, Sig_yy, Sig_yz, Sig_zz = pzn, 0.0, 0.0, 0.0, 0.0, 0.0
    elif stress_preset == 'cantilever':
        Sig_xx = (1 - pxn) * pzn / 2
        Sig_xz = 0.25 * (1 - pxn**2) * (1 - pzn**2)
        Sig_xy, Sig_yy, Sig_yz, Sig_zz = 0.0, 0.0, 0.0, 0.0
    else:  # torsion
        Sig_xx, Sig_xy, Sig_yy, Sig_zz = 0.0, 0.0, 0.0, 0.0
        Sig_xz = -pyn / np.sqrt(2)
        Sig_yz = pxn / np.sqrt(2)
    Sigma = np.stack([np.stack([Sig_xx, Sig_xy, Sig_xz], -1),
                      np.stack([Sig_xy, Sig_yy, Sig_yz], -1),
                      np.stack([Sig_xz, Sig_yz, Sig_zz], -1)], -2)
    w_eig, v_eig = np.linalg.eigh(Sigma)
    k_max = np.argmax(np.abs(w_eig), axis=-1)
    v1 = np.take_along_axis(v_eig, k_max[..., None, None], axis=-1)[..., 0]
    ref = np.where(np.abs(v1[..., 0:1]) < 0.7,
                   np.broadcast_to(np.array([1.0, 0, 0]), v1.shape),
                   np.broadcast_to(np.array([0.0, 1.0, 0]), v1.shape))
    w0 = ref - (ref * v1).sum(-1, keepdims=True) * v1
    w0 = w0 / np.linalg.norm(w0, axis=-1, keepdims=True)
    v2 = np.cross(v1, w0)
    u1 = v1[..., 0] * X + v1[..., 1] * Y + v1[..., 2] * Z
    u2 = w0[..., 0] * X + w0[..., 1] * Y + w0[..., 2] * Z
    u3 = v2[..., 0] * X + v2[..., 1] * Y + v2[..., 2] * Z
    Xs, Ys, Zs = u1 / stress_anisotropy, u2, u3

# von Mises 应力（归一化 [0,1]；壳壁厚自适应与应力云图共用）
if stress_preset == 'bending':
    vm = np.abs(Z / np.pi)
elif stress_preset == 'cantilever':
    sxx_c = (1 - X / np.pi) * (Z / np.pi) / 2
    txz_c = 0.25 * (1 - (X / np.pi)**2) * (1 - (Z / np.pi)**2)
    vm = np.minimum(1.0, np.sqrt(sxx_c**2 + 3 * txz_c**2))
elif stress_preset == 'torsion':
    vm = np.minimum(1.0, np.sqrt(3 * ((Y / np.pi)**2 + (X / np.pi)**2) / 2))
else:
    vm = np.zeros_like(X)

if tpms_type == 'custom':
    # 【阶段 I】自定义公式 AST→NumPy 向量化翻译（沙箱坐标 x/y/z 为弧度域 = kk·X）
    # 注：custom + stress 组合暂为各向同性回退（变换未应用于表达式），与平台一致
    iso_base = ${O(e)}   # 基准等值（公式参数 iso 的语义源，与平台 baseIso 同源）
    V = ${k(e)}
else:
    V = tpms_field(Xs, Ys, Zs, weights)

# 异构混合模式（与 core/hybrid-functions.ts 对齐：px→+1 侧为 A 主导）
blend_function = '${j(e.hybrid.blendFunction)}'
blend_axis = '${j(e.hybrid.axis??`x`)}'
if ${e.hybrid.enabled?`True`:`False`}:
    type_b = '${j(e.hybrid.typeB)}'
    weights_b = [${e.weights.join(`, `)}]  # 与平台同源（平台 B 场复用主权重，非默认权重）
    if type_b == 'custom':
        # 【阶段 I】B 侧自定义公式翻译（与 A 侧同一公式串，与平台 createHybridField 同源）
        V_b = ${k(e)}
    else:
        V_b = tpms_field(Xs, Ys, Zs, weights_b, type_b)  # 与 A 侧同坐标（应力×hybrid 组合 B 侧漏传变换坐标，红队 B F1）
    blend_center = ${j(e.hybrid.blendCenter)}
    blend_width = ${j(e.hybrid.blendWidth)}
    # 波前投影（与平台 hybrid-functions wavefrontCoord 同源）：radial=球面半径
    px_ = X / np.pi; py_ = Y / np.pi; pz_ = Z / np.pi
    t_wave = {'x': px_, 'y': py_, 'z': pz_}.get(blend_axis, np.sqrt(px_**2 + py_**2 + pz_**2))
    if blend_function == 'linear':
        half_w = blend_width / 2
        alpha = np.clip((t_wave - (blend_center - half_w)) / blend_width, 0.0, 1.0)
    else:  # sigmoid
        k_sig = 6.0 / max(blend_width, 0.01)
        alpha = 1 / (1 + np.exp(-k_sig * (t_wave - blend_center)))
    V = alpha * V + (1 - alpha) * V_b

# 容器边界场（SDF：外部 >= 0 = 固相包裹，与平台 max(f, bound) 一致；不用 NaN）
px = X / np.pi
py = Y / np.pi
pz = Z / np.pi
if container == 'cylinder':
    bound = np.maximum(px**2 + py**2 - 1, np.abs(pz) - 1)
else:
    bound = np.maximum(np.maximum(np.abs(px) - 1, np.abs(py) - 1), np.abs(pz) - 1)

# 模式场与孔隙率二分（与平台 surface-nets.ts 同一算法：容器内网格角点分位数）
inside = bound < 0
target_solid = max(0.02, min(0.98, 1 - porosity/100))
v_in = np.sort(V[inside])
n_in = v_in.size

if structure_mode == 'gradient_shell':
    # 二分解 t_eff（无梯度对称壳计数），再乘梯度 scale —— 与平台一致
    def count_shell(t):
        return np.searchsorted(v_in, -t/2, side='left') + (n_in - np.searchsorted(v_in, t/2, side='left'))
    lo, hi = 0.02, (v_in[-1] - v_in[0]) * 4
    for _ in range(18):
        t_eff = (lo + hi) / 2
        if count_shell(t_eff) / n_in > target_solid: lo = t_eff
        else: hi = t_eff
    t_eff = (lo + hi) / 2  # 平台无 0.05 下限，保持一致
    if gradient_dir == 'z':
        scale = 1.5 - (pz + 1) * 0.5
    elif gradient_dir == 'radial':
        scale = np.maximum(1.5 - np.minimum((px**2 + py**2) / 2, 1.4), 0.1)
    elif gradient_dir == 'spherical':
        scale = np.maximum(1.5 - np.minimum((px**2 + py**2 + pz**2) / 3, 1.4), 0.1)
    else:
        scale = 1.0
    F = (V - 0)**2 - (t_eff * scale / 2)**2
elif structure_mode == 'shell':
    def count_shell(t):
        return np.searchsorted(v_in, -t/2, side='left') + (n_in - np.searchsorted(v_in, t/2, side='left'))
    lo, hi = 0.02, (v_in[-1] - v_in[0]) * 4
    for _ in range(18):
        t_eff = (lo + hi) / 2
        if count_shell(t_eff) / n_in > target_solid: lo = t_eff
        else: hi = t_eff
    t_eff = (lo + hi) / 2  # 平台无 0.05 下限，保持一致
    t_scale = np.where(stress_preset != 'none', np.maximum(0.1, 1.0 - stress_strength * vm), 1.0)  # 【阶段 IV】高应力侧孔隙板收窄（固相致密化）
    F = V**2 - (t_eff * t_scale / 2)**2
else:
    # solid_network：solid = {V < iso}（与平台一致），16 轮二分收敛到下分位数
    lo, hi = v_in[0] - 0.5, v_in[-1] + 0.5
    for _ in range(16):
        iso_bias = (lo + hi) / 2
        solid_frac = (V[inside] < iso_bias).sum() / n_in
        if solid_frac > target_solid: hi = iso_bias
        else: lo = iso_bias
    iso_bias = (lo + hi) / 2
    F = iso_bias - V

# 【2026-08-27 v2】统一封盖规则（与平台 surface-nets v2 一致）：
# 容器外(bound>=0)或网格边界层一律空气——max(F, bound) 不行：公式在圆柱角落的
# 正瓣会压过负裁剪（实测 +109%→+27% 教训），容器裁剪必须无条件覆写。
# 覆写后实体相在表面自然截断，孔口为开放边界；需要封闭实体时补面或布尔。
on_face = ((X == X.min()) | (X == X.max()) | (Y == Y.min()) | (Y == Y.max()) | (Z == Z.min()) | (Z == Z.max()))
F = np.where((bound >= 0) | on_face, -1e-6, np.maximum(F, bound))

# 【实心加载端板】(与平台 surface-nets endplateMm 同源)：z 带内侧向界内强制实体；
# z 向最外层豁免保持收口，x/y 出侧壁不生效
if endplate_mm > 0:
    t_pl = min(endplate_mm, 0.4 * cell_size)
    z_band = np.abs(pz) >= (1 - 2 * t_pl / cell_size)
    z_face = (Z == Z.min()) | (Z == Z.max())
    if container == 'cylinder':
        side_in = (px**2 + py**2 - 1) < 0
    else:
        side_in = np.maximum(np.abs(px) - 1, np.abs(py) - 1) < 0
    F = np.where(z_band & side_in & ~z_face, 1.0, F)

# Marching Cubes 提取等值面（F = 0；坐标为 mm，1 period = 1 mm）
# pyvista >= 0.44：UniformGrid 已改名 ImageData（旧名 0.48 起移除）；场是网格点值 → point_data
# （旧写法 cell_data + dimensions=N+1 依赖已移除的自动转换，且引入半格偏移）
grid = pv.ImageData(dimensions=V.shape, origin=(-cell_size/2, -cell_size/2, -cell_size/2), spacing=(cell_size/(N-1),)*3)
grid.point_data['values'] = F.flatten(order='F')
iso = 0.0

mesh = grid.contour([iso])

# 【阶段 IV/v4.0】非欧度规映射（与 core/manifold-mapping.ts 逐式同源；identity 跳过）
# 单位：mesh.points 为 mm；warp 在弧度域进行（rad = mm·2π/cellSize），R0 同尺度换算
manifold_kind = '${j(e.manifold.kind)}'
if manifold_kind != 'identity':
    K2R = 2 * np.pi / cell_size
    P = mesh.points * K2R
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    if manifold_kind == 'poincare':
        # 庞加莱双曲度规：r' = 2R0²r/(R0²−r²)，径向截断 0.95·R0 线性延拓保单射
        R0 = ${e.manifold.radius} * K2R
        r = np.sqrt(x**2 + y**2 + z**2)
        r = np.maximum(r, 1e-12)
        rC = 0.95 * R0
        f = lambda rr: 2 * R0**2 * rr / (R0**2 - rr**2)
        fpc = f(min(rC, 0.999 * R0))
        fpC = 2 * R0**2 * (R0**2 + rC**2) / (R0**2 - rC**2)**2  # f'(rC) 真导数（2026-09-05 C¹ 根治）
        rp = np.where(r <= rC, f(np.minimum(r, rC)), fpc + fpC * (r - rC))
        sc = rp / r
        P[:, 0] *= sc; P[:, 1] *= sc; P[:, 2] *= sc
    elif manifold_kind == 'hyperbolic':
        R0 = ${e.manifold.radius} * K2R
        r = np.sqrt(x**2 + y**2 + z**2)
        r = np.maximum(r, 1e-12)
        sc = R0 * np.tan(r / R0 * np.pi / 4) / r
        P[:, 0] *= sc; P[:, 1] *= sc; P[:, 2] *= sc
    elif manifold_kind == 'cylinder':
        half = np.pi * cell_size * K2R   # 平台 ctx.half 口径（π·cellSize 弧度）
        R0 = ${e.manifold.radius}
        theta = (x + half) / (2 * half) * 2 * np.pi
        rad = R0 + y
        P[:, 0] = rad * np.sin(theta); P[:, 1] = rad * np.cos(theta)
    elif manifold_kind == 'torus':
        half = np.pi * cell_size * K2R
        R0 = ${e.manifold.radius}; R2 = R0 * 0.4
        u = (x + half) / (2 * half) * 2 * np.pi
        v = (y + half) / (2 * half) * 2 * np.pi
        tube = R2 + z; ring = R0 + tube * np.cos(v)
        P[:, 0] = ring * np.cos(u); P[:, 1] = ring * np.sin(u); P[:, 2] = tube * np.sin(v)
    elif manifold_kind == 'metric':
        sc = ${e.manifold.scale}
        ax = '${j(e.manifold.axis)}'
        c = P[:, 0] if ax == 'x' else P[:, 1] if ax == 'y' else P[:, 2]
        add = (sc - 1) * c
        if ax == 'x': P[:, 0] += add
        elif ax == 'y': P[:, 1] += add
        else: P[:, 2] += add
    mesh.points = P / K2R

mesh.save('tpms_reconstructed.vtk')
print(f'重建完成: {mesh.n_points} 顶点, {mesh.n_cells} 面片; iso_bias={iso_bias if structure_mode == "solid_network" else 0:.6f}, t_eff={t_eff if structure_mode != "solid_network" else 0:.6f}')

# ── 三向几何迂曲度（与平台 physics/tortuosity.ts 同源口径）──────
# 流体空间 = F <= 0 的体素（排除最外一圈收口壳层）；26 连通 Dijkstra
# 欧氏最短路；τ = L_path / L0。无贯通方向返回 inf。
import heapq as _hq

def _tortuosity_axis(F, axis):
    n = F.shape[axis]
    src_layer, dst_layer = 1, n - 2          # 排除最外收口壳层
    src = np.take(F, src_layer, axis=axis) <= 0
    NEIGH = [(dx, dy, dz) for dx in (-1,0,1) for dy in (-1,0,1) for dz in (-1,0,1)
             if (dx,dy,dz) != (0,0,0)]
    L = [np.sqrt(dx*dx+dy*dy+dz*dz) for dx,dy,dz in NEIGH]
    dist = np.full(F.shape, np.inf)
    heap = []
    for i in range(n):
        for j in range(n):
            idx = [0,0,0]; idx[axis] = src_layer
            idx[(axis+1)%3] = i; idx[(axis+2)%3] = j
            # np.take(F, ·, axis) 摘除了 axis 维：src 是 2D 切片，须用去维后的坐标对
            # （旧版 src[tuple(idx)] 以 3 元组索引 2D 数组 = IndexError，所有导出脚本必崩）
            if src[tuple(idx[:axis] + idx[axis+1:])]:
                dist[tuple(idx)] = 0.0
                _hq.heappush(heap, (0.0, tuple(idx)))
    while heap:
        d, cur = _hq.heappop(heap)
        if d > dist[cur]:
            continue
        ci = [cur[0], cur[1], cur[2]]
        if ci[axis] == dst_layer:
            return d / (n - 3)
        for (dx,dy,dz), Lk in zip(NEIGH, L):
            nb = (cur[0]+dx, cur[1]+dy, cur[2]+dz)
            if min(nb) < 1 or max(nb) >= n - 1:
                continue
            if F[nb] > 0:
                continue
            nd = d + Lk
            if nd < dist[nb]:
                dist[nb] = nd
                _hq.heappush(heap, (nd, nb))
    return float('inf')

taus = [_tortuosity_axis(F, a) for a in range(3)]
print('三向几何迂曲度 τx/τy/τz =', ['未贯通' if not np.isfinite(t) else f'{t:.3f}' for t in taus])
`}function P(e,t){o(new Blob([M(e)],{type:`text/plain`}),t)}function F(e){return`% TPMS 参数化重建脚本 (MATLAB)
% Generated by TPMS Explorer
% 本脚本与平台逐点对齐：相同参数下等值面位置一致（算法差异仅剩 MC vs Surface Nets 的网格化误差）。

tpms_type = '${j(e.type)}';
porosity = ${e.porosity};
cell_size = ${e.cellSize};      % 周期数 k（1 period = 1 mm，模型总宽 = cell_size mm）
thickness = ${e.thickness};
weights = [${e.weights.join(`, `)}];
structure_mode = '${j(e.structureMode)}';
container = '${j(e.containerShape)}';
gradient_dir = '${j(e.gradientDir)}';
endplate_mm = ${e.endplateMm};   % 实心加载端板单侧厚度 mm（0=关；生效值钳制至 0.4*L）
% 【阶段 IV】应力场引导（与 core/stress-driven-field.ts 同源；'none' = 关闭）
stress_preset = '${j(e.stress.preset)}';
stress_strength = ${e.stress.strength};
stress_anisotropy = ${e.stress.anisotropy};

kk = cell_size;  % 频率倍率：平台顶点域恒 [-pi, pi]，周期数编码在频率上
% 倍频曲面（I-WP/F-RD 含 cos2kx 项）特征频率 2k，分辨率密度加倍补偿弦切误差
if any(strcmp(tpms_type, {'iwp', 'frd', 'neovius'})) || strcmp(structure_mode, 'gradient_shell') && ~strcmp(gradient_dir, 'z')
    fk = 28;
else
    fk = 14;
end
% A2 密度保优：触 96 上限后预算让渡给每周期密度（与平台 units.hdResolution 同源）
r_lin = 19 + cell_size * fk;
if r_lin <= 96
    R = round(r_lin);
else
    R = min(96, ceil(cell_size * fk));
end
N = R + 1;
x = linspace(-pi, pi, N);
y = linspace(-pi, pi, N);
z = linspace(-pi, pi, N);
[X, Y, Z] = meshgrid(x, y, z);

% 【阶段 IV】应力场引导：主轴各向异性坐标变换（逐点 eig，参考脚本以正确性优先）
% custom + stress 组合暂为各向同性回退（与平台一致）
Xs = X; Ys = Y; Zs = Z;
if ~strcmp(stress_preset, 'none')
    pxn = X / pi; pyn = Y / pi; pzn = Z / pi;
    Sig = zeros([size(X), 3, 3]);
    if strcmp(stress_preset, 'bending')
        Sig(:,:,1,1) = pzn;
    elseif strcmp(stress_preset, 'cantilever')
        Sig(:,:,1,1) = (1 - pxn) .* pzn / 2;
        Sig(:,:,1,3) = 0.25 * (1 - pxn.^2) .* (1 - pzn.^2);
        Sig(:,:,3,1) = Sig(:,:,1,3);
    else  % torsion
        Sig(:,:,1,3) = -pyn / sqrt(2);
        Sig(:,:,3,1) = Sig(:,:,1,3);
        Sig(:,:,2,3) = pxn / sqrt(2);
        Sig(:,:,3,2) = Sig(:,:,2,3);
    end
    idx = cell(size(X));
    for iz = 1:size(X, 3)
        for iy = 1:size(X, 2)
            for ix = 1:size(X, 1)
                [V0, D0] = eig(squeeze(Sig(ix, iy, iz, :)));
                vals = diag(D0);
                [~, kk2] = max(abs(vals));
                v1 = V0(:, kk2);
                u1 = v1' * [X(ix, iy, iz); Y(ix, iy, iz); Z(ix, iy, iz)];
                if abs(v1(1)) < 0.7, r0 = [1; 0; 0]; else, r0 = [0; 1; 0]; end
                w0 = r0 - (r0' * v1) * v1; w0 = w0 / norm(w0);
                u2 = w0' * [X(ix, iy, iz); Y(ix, iy, iz); Z(ix, iy, iz)];
                v2 = cross(v1, w0);
                u3 = v2' * [X(ix, iy, iz); Y(ix, iy, iz); Z(ix, iy, iz)];
                Xs(ix, iy, iz) = u1 / stress_anisotropy; Ys(ix, iy, iz) = u2; Zs(ix, iy, iz) = u3;
            end
        end
    end
    clear idx
end

% von Mises 应力（归一化；壳壁厚调制用）——用原始坐标，不被应力变换污染
px = X / pi; py = Y / pi; pz = Z / pi;
if strcmp(stress_preset, 'bending')
    vm = abs(pz);
elseif strcmp(stress_preset, 'cantilever')
    vm = min(1, sqrt(((1 - px) .* pz / 2).^2 + 3 * (0.25 * (1 - px.^2) .* (1 - pz.^2)).^2));
elseif strcmp(stress_preset, 'torsion')
    vm = min(1, sqrt(3 * (py.^2 + px.^2) / 2));
else
    vm = zeros(size(X));
end

% 应力变换后坐标就地替换（红队 A MAJOR：此前 Xs/Ys/Zs 算完未被曲面分支读取，
% Python 侧正确传 Xs/Ys/Zs——两侧几何不一致；现统一为替换后 kk*X 语义。
% 原始坐标保留给波前/容器 SDF：平台语义中两者都在物理空间取点，不经应力变换）
X0 = X; Y0 = Y; Z0 = Z;
X = Xs; Y = Ys; Z = Zs;

% 隐函数场（与平台 core/tpms-functions.ts 逐项一致）
if strcmp(tpms_type, 'custom')
    % 【阶段 I】自定义公式 AST→MATLAB 向量化翻译（沙箱坐标 x/y/z 为弧度域 = kk·X）
    iso_base = ${O(e)};  % 基准等值（公式参数 iso 的语义源，与平台 baseIso 同源）
    V = ${A(e)};
elseif strcmp(tpms_type, 'gyroid')
    V = weights(1)*sin(kk*X).*cos(kk*Y) + weights(2)*sin(kk*Y).*cos(kk*Z) + weights(3)*sin(kk*Z).*cos(kk*X);
elseif strcmp(tpms_type, 'diamond')
    V = weights(1)*sin(kk*X).*sin(kk*Y).*sin(kk*Z) ...
      + weights(2)*sin(kk*X).*cos(kk*Y).*cos(kk*Z) ...
      + weights(3)*cos(kk*X).*sin(kk*Y).*cos(kk*Z) ...
      + weights(4)*cos(kk*X).*cos(kk*Y).*sin(kk*Z);
elseif strcmp(tpms_type, 'schwarz')
    V = weights(1)*cos(kk*X) + weights(2)*cos(kk*Y) + weights(3)*cos(kk*Z);
elseif strcmp(tpms_type, 'neovius')
    V = 3*weights(1)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) + 4*weights(2)*cos(kk*X).*cos(kk*Y).*cos(kk*Z);
elseif strcmp(tpms_type, 'iwp')
    V = 2*weights(1)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
      - weights(2)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z));
elseif strcmp(tpms_type, 'frd')
    V = 4*weights(1)*cos(kk*X).*cos(kk*Y).*cos(kk*Z) ...
      - weights(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X));
elseif strcmp(tpms_type, 'lidinoid')
    V = 0.5*weights(1)*(2*sin(kk*X).*cos(kk*X).*cos(kk*Y).*sin(kk*Z) ...
            + 2*sin(kk*Y).*cos(kk*Y).*cos(kk*Z).*sin(kk*X) ...
            + 2*sin(kk*Z).*cos(kk*Z).*cos(kk*X).*sin(kk*Y)) ...
        - 0.5*weights(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X)) ...
        + 0.15;
elseif strcmp(tpms_type, 'splitp')
    V = 1.1*weights(1)*(2*sin(kk*X).*cos(kk*X).*cos(kk*Y).*sin(kk*Z) ...
            + 2*sin(kk*X).*sin(kk*Y).*cos(kk*Y).*cos(kk*Z) ...
            + 2*cos(kk*X).*sin(kk*Y).*sin(kk*Z).*cos(kk*Z)) ...
        - 0.2*weights(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X)) ...
        - 0.4*weights(3)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z));
elseif strcmp(tpms_type, 'octo')
    V = 0.6*weights(1)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
      - 0.4*weights(2)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) + 0.25;
elseif strcmp(tpms_type, 'karcher')
    V = 0.3*weights(1)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) ...
      + 0.3*weights(2)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
      - 0.4*weights(3)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z)) + 0.2;
elseif strcmp(tpms_type, 'fks')
    V = weights(1)*cos(2*kk*X).*sin(kk*Y).*cos(kk*Z) ...
      + weights(2)*cos(kk*X).*cos(2*kk*Y).*sin(kk*Z) ...
      + weights(3)*sin(kk*X).*cos(kk*Y).*cos(2*kk*Z);
elseif strcmp(tpms_type, 'fky')
    V = weights(1)*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) + sin(kk*X).*sin(kk*Y).*sin(kk*Z)) ...
      + weights(2)*(sin(2*kk*X).*sin(kk*Y) + sin(2*kk*Y).*sin(kk*Z) + sin(kk*X).*sin(2*kk*Z) ...
                    + sin(2*kk*X).*cos(kk*Z) + cos(kk*X).*sin(2*kk*Y) + cos(kk*Y).*sin(2*kk*Z));
elseif strcmp(tpms_type, 'fcks')
    S2x_ = sin(2*kk*X); S2y_ = sin(2*kk*Y); S2z_ = sin(2*kk*Z);
    C2x_ = cos(2*kk*X); C2y_ = cos(2*kk*Y); C2z_ = cos(2*kk*Z);
    S3x_ = sin(3*kk*X); S3y_ = sin(3*kk*Y); S3z_ = sin(3*kk*Z);
    C3x_ = cos(3*kk*X); C3y_ = cos(3*kk*Y); C3z_ = cos(3*kk*Z);
    V = weights(1)*(C2x_ + C2y_ + C2z_ ...
        + 2*(S3x_.*S2y_.*cos(kk*Z) + cos(kk*X).*S3y_.*S2z_ + S2x_.*cos(kk*Y).*S3z_) ...
        + 2*(S2x_.*C3y_.*sin(kk*Z) + sin(kk*X).*S2y_.*C3z_ + C3x_.*sin(kk*Y).*S2z_));
elseif strcmp(tpms_type, 'gprime')
    V = weights(1)*(sin(2*kk*X).*cos(kk*Y).*sin(kk*Z) ...
                    + sin(2*kk*Y).*cos(kk*Z).*sin(kk*X) ...
                    + sin(2*kk*Z).*cos(kk*X).*sin(kk*Y)) + 0.32;
elseif strcmp(tpms_type, 'dprime')
    V = weights(1)*(0.5*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) ...
                         + cos(kk*X).*sin(kk*Y).*sin(kk*Z) ...
                         + sin(kk*X).*cos(kk*Y).*sin(kk*Z) ...
                         + sin(kk*X).*sin(kk*Y).*cos(kk*Z)) ...
              - 0.5*(sin(2*kk*X).*sin(2*kk*Y) + sin(2*kk*Y).*sin(2*kk*Z) + sin(2*kk*Z).*sin(2*kk*X))) - 0.2;
elseif strcmp(tpms_type, 'dp')
    V = weights(1)*(0.5*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
              + 0.2*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z)));
elseif strcmp(tpms_type, 'dd')
    V = weights(1)*(0.5*(sin(kk*X).*sin(kk*Y) + sin(kk*Y).*sin(kk*Z) + sin(kk*Z).*sin(kk*X)) ...
              + 0.5*cos(kk*X).*cos(kk*Y).*cos(kk*Z));
elseif strcmp(tpms_type, 'dg')
    V = weights(1)*(2.75*(sin(2*kk*X).*sin(kk*Z).*cos(kk*Y) ...
                          + sin(2*kk*Y).*sin(kk*X).*cos(kk*Z) ...
                          + sin(2*kk*Z).*sin(kk*Y).*cos(kk*X)) ...
              - 1.0*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X))) - 0.95;
elseif strcmp(tpms_type, 'fcky')
    V = -weights(1)*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) + sin(kk*X).*sin(kk*Y).*sin(kk*Z)) ...
      + weights(2)*(sin(2*kk*X).*sin(kk*Y) + sin(2*kk*Y).*sin(kk*Z) + sin(kk*X).*sin(2*kk*Z) ...
                    + sin(2*kk*X).*cos(kk*Z) + cos(kk*X).*sin(2*kk*Y) + cos(kk*Y).*sin(2*kk*Z));
elseif strcmp(tpms_type, 'cdd')
    C3x_ = cos(3*kk*X); S3x_ = sin(3*kk*X);
    C3y_ = cos(3*kk*Y); S3y_ = sin(3*kk*Y);
    C3z_ = cos(3*kk*Z); S3z_ = sin(3*kk*Z);
    V = weights(1)*(C3x_.*cos(kk*Y).*cos(kk*Z) - S3x_.*sin(kk*Y).*cos(kk*Z) ...
                  - S3x_.*cos(kk*Y).*sin(kk*Z) + C3x_.*sin(kk*Y).*sin(kk*Z) ...
                  + cos(kk*X).*C3y_.*cos(kk*Z) - sin(kk*X).*S3y_.*cos(kk*Z) ...
                  + sin(kk*X).*C3y_.*sin(kk*Z) - cos(kk*X).*S3y_.*sin(kk*Z) ...
                  + cos(kk*X).*cos(kk*Y).*C3z_ + sin(kk*X).*sin(kk*Y).*C3z_ ...
                  - sin(kk*X).*cos(kk*Y).*S3z_ - cos(kk*X).*sin(kk*Y).*S3z_);
elseif strcmp(tpms_type, 'slotp')
    C2x_ = cos(2*kk*X); C2y_ = cos(2*kk*Y); C2z_ = cos(2*kk*Z);
    V = weights(1)*(-2*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
        - 2*(C2x_ + C2y_ + C2z_) ...
        + (C2x_.*cos(kk*Y) + C2y_.*cos(kk*Z) + C2z_.*cos(kk*X)) ...
        - (cos(kk*X).*C2y_ + cos(kk*Y).*C2z_ + cos(kk*Z).*C2x_));
elseif strcmp(tpms_type, 'fs')
    V = weights(1)*cos(kk*X).*cos(kk*Y).*cos(kk*Z);
elseif strcmp(tpms_type, 'qstar')
    cXY_ = cos(kk*X).*cos(kk*Y) + sin(kk*X).*sin(kk*Y);
    V = weights(1)*((cos(kk*X) - 2*cos(kk*Y)).*cos(kk*Z) - sqrt(3)*sin(kk*Z).*(cXY_ - cos(kk*X)) + cXY_.*cos(kk*Z));
elseif strcmp(tpms_type, 'ws')
    V = weights(1)*((cos(2*kk*X).*cos(kk*Y) + cos(2*kk*Y).*cos(kk*Z) + cos(2*kk*Z).*cos(kk*X)) ...
        - (cos(kk*X).*cos(2*kk*Y) + cos(kk*Y).*cos(2*kk*Z) + cos(kk*Z).*cos(2*kk*X)));
elseif strcmp(tpms_type, 'strutbcc') || strcmp(tpms_type, 'strutoctet')
    V = strut_truss_field(kk*X, kk*Y, kk*Z, weights(1), strcmp(tpms_type, 'strutoctet'));
else
    error('Unsupported TPMS type');
end

% 异构混合模式（与 core/hybrid-functions.ts 对齐：px→+1 侧为 A 主导）
blend_function = '${j(e.hybrid.blendFunction)}';
blend_axis = '${j(e.hybrid.axis??`x`)}';
if ${j(e.hybrid.enabled)}
    type_b = '${j(e.hybrid.typeB)}';
    weights_b = [${e.weights.join(`, `)}];  % 与平台同源（平台 B 场复用主权重，非默认权重）
    if strcmp(type_b, 'custom')
        % 【阶段 I】B 侧自定义公式翻译（与 A 侧同一公式串，与平台 createHybridField 同源）
        V_b = ${A(e)};
    elseif strcmp(type_b, 'gyroid')
        V_b = weights_b(1)*sin(kk*X).*cos(kk*Y) + weights_b(2)*sin(kk*Y).*cos(kk*Z) + weights_b(3)*sin(kk*Z).*cos(kk*X);
    elseif strcmp(type_b, 'diamond')
        V_b = weights_b(1)*sin(kk*X).*sin(kk*Y).*sin(kk*Z) ...
              + weights_b(2)*sin(kk*X).*cos(kk*Y).*cos(kk*Z) ...
              + weights_b(3)*cos(kk*X).*sin(kk*Y).*cos(kk*Z) ...
              + weights_b(4)*cos(kk*X).*cos(kk*Y).*sin(kk*Z);
    elseif strcmp(type_b, 'schwarz')
        V_b = weights_b(1)*cos(kk*X) + weights_b(2)*cos(kk*Y) + weights_b(3)*cos(kk*Z);
    elseif strcmp(type_b, 'neovius')
        V_b = 3*weights_b(1)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) + 4*weights_b(2)*cos(kk*X).*cos(kk*Y).*cos(kk*Z);
    elseif strcmp(type_b, 'iwp')
        V_b = 2*weights_b(1)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
              - weights_b(2)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z));
    elseif strcmp(type_b, 'frd')
        V_b = 4*weights_b(1)*cos(kk*X).*cos(kk*Y).*cos(kk*Z) ...
              - weights_b(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X));
    elseif strcmp(type_b, 'lidinoid')
        V_b = 0.5*weights_b(1)*(2*sin(kk*X).*cos(kk*X).*cos(kk*Y).*sin(kk*Z) ...
                + 2*sin(kk*Y).*cos(kk*Y).*cos(kk*Z).*sin(kk*X) ...
                + 2*sin(kk*Z).*cos(kk*Z).*cos(kk*X).*sin(kk*Y)) ...
              - 0.5*weights_b(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X)) ...
              + 0.15;
    elseif strcmp(type_b, 'splitp')
        V_b = 1.1*weights_b(1)*(2*sin(kk*X).*cos(kk*X).*cos(kk*Y).*sin(kk*Z) ...
                + 2*sin(kk*X).*sin(kk*Y).*cos(kk*Y).*cos(kk*Z) ...
                + 2*cos(kk*X).*sin(kk*Y).*sin(kk*Z).*cos(kk*Z)) ...
              - 0.2*weights_b(2)*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X)) ...
              - 0.4*weights_b(3)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z));
    elseif strcmp(type_b, 'octo')
        V_b = 0.6*weights_b(1)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
            - 0.4*weights_b(2)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) + 0.25;
    elseif strcmp(type_b, 'karcher')
        V_b = 0.3*weights_b(1)*(cos(kk*X) + cos(kk*Y) + cos(kk*Z)) ...
            + 0.3*weights_b(2)*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
            - 0.4*weights_b(3)*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z)) + 0.2;
    elseif strcmp(type_b, 'fks')
        V_b = weights_b(1)*cos(2*kk*X).*sin(kk*Y).*cos(kk*Z) ...
            + weights_b(2)*cos(kk*X).*cos(2*kk*Y).*sin(kk*Z) ...
            + weights_b(3)*sin(kk*X).*cos(kk*Y).*cos(2*kk*Z);
    elseif strcmp(type_b, 'fky')
        V_b = weights_b(1)*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) + sin(kk*X).*sin(kk*Y).*sin(kk*Z)) ...
            + weights_b(2)*(sin(2*kk*X).*sin(kk*Y) + sin(2*kk*Y).*sin(kk*Z) + sin(kk*X).*sin(2*kk*Z) ...
                            + sin(2*kk*X).*cos(kk*Z) + cos(kk*X).*sin(2*kk*Y) + cos(kk*Y).*sin(2*kk*Z));
    elseif strcmp(type_b, 'fcks')
        % C(S) 谐波 3× B 侧（2026-09-10 补齐：TS/Python 均已支持，MATLAB 分支对齐；
        % 变量加 b 后缀避免与主类型段的 S2x_ 等中间量冲突）
        S2xb = sin(2*kk*X); S2yb = sin(2*kk*Y); S2zb = sin(2*kk*Z);
        C2xb = cos(2*kk*X); C2yb = cos(2*kk*Y); C2zb = cos(2*kk*Z);
        S3xb = sin(3*kk*X); S3yb = sin(3*kk*Y); S3zb = sin(3*kk*Z);
        C3xb = cos(3*kk*X); C3yb = cos(3*kk*Y); C3zb = cos(3*kk*Z);
        V_b = weights_b(1)*(C2xb + C2yb + C2zb ...
            + 2*(S3xb.*S2yb.*cos(kk*Z) + cos(kk*X).*S3yb.*S2zb + S2xb.*cos(kk*Y).*S3zb) ...
            + 2*(S2xb.*C3yb.*sin(kk*Z) + sin(kk*X).*S2yb.*C3zb + C3xb.*sin(kk*Y).*S2zb));
    elseif strcmp(type_b, 'gprime')
        V_b = weights_b(1)*(sin(2*kk*X).*cos(kk*Y).*sin(kk*Z) ...
                            + sin(2*kk*Y).*cos(kk*Z).*sin(kk*X) ...
                            + sin(2*kk*Z).*cos(kk*X).*sin(kk*Y)) + 0.32;
    elseif strcmp(type_b, 'dprime')
        % C2 扩展第三批 B 侧（与主类型段同公式，照 fcks B 侧先例）
        V_b = weights_b(1)*(0.5*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) ...
                                 + cos(kk*X).*sin(kk*Y).*sin(kk*Z) ...
                                 + sin(kk*X).*cos(kk*Y).*sin(kk*Z) ...
                                 + sin(kk*X).*sin(kk*Y).*cos(kk*Z)) ...
                      - 0.5*(sin(2*kk*X).*sin(2*kk*Y) + sin(2*kk*Y).*sin(2*kk*Z) + sin(2*kk*Z).*sin(2*kk*X))) - 0.2;
    elseif strcmp(type_b, 'dp')
        V_b = weights_b(1)*(0.5*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
                      + 0.2*(cos(2*kk*X) + cos(2*kk*Y) + cos(2*kk*Z)));
    elseif strcmp(type_b, 'dd')
        V_b = weights_b(1)*(0.5*(sin(kk*X).*sin(kk*Y) + sin(kk*Y).*sin(kk*Z) + sin(kk*Z).*sin(kk*X)) ...
                      + 0.5*cos(kk*X).*cos(kk*Y).*cos(kk*Z));
    elseif strcmp(type_b, 'dg')
        V_b = weights_b(1)*(2.75*(sin(2*kk*X).*sin(kk*Z).*cos(kk*Y) ...
                                  + sin(2*kk*Y).*sin(kk*X).*cos(kk*Z) ...
                                  + sin(2*kk*Z).*sin(kk*Y).*cos(kk*X)) ...
                      - 1.0*(cos(2*kk*X).*cos(2*kk*Y) + cos(2*kk*Y).*cos(2*kk*Z) + cos(2*kk*Z).*cos(2*kk*X))) - 0.95;
    elseif strcmp(type_b, 'fcky')
        V_b = -weights_b(1)*(cos(kk*X).*cos(kk*Y).*cos(kk*Z) + sin(kk*X).*sin(kk*Y).*sin(kk*Z)) ...
            + weights_b(2)*(sin(2*kk*X).*sin(kk*Y) + sin(2*kk*Y).*sin(kk*Z) + sin(kk*X).*sin(2*kk*Z) ...
                            + sin(2*kk*X).*cos(kk*Z) + cos(kk*X).*sin(2*kk*Y) + cos(kk*Y).*sin(2*kk*Z));
    elseif strcmp(type_b, 'cdd')
        C3xb2 = cos(3*kk*X); S3xb2 = sin(3*kk*X);
        C3yb2 = cos(3*kk*Y); S3yb2 = sin(3*kk*Y);
        C3zb2 = cos(3*kk*Z); S3zb2 = sin(3*kk*Z);
        V_b = weights_b(1)*(C3xb2.*cos(kk*Y).*cos(kk*Z) - S3xb2.*sin(kk*Y).*cos(kk*Z) ...
                          - S3xb2.*cos(kk*Y).*sin(kk*Z) + C3xb2.*sin(kk*Y).*sin(kk*Z) ...
                          + cos(kk*X).*C3yb2.*cos(kk*Z) - sin(kk*X).*S3yb2.*cos(kk*Z) ...
                          + sin(kk*X).*C3yb2.*sin(kk*Z) - cos(kk*X).*S3yb2.*sin(kk*Z) ...
                          + cos(kk*X).*cos(kk*Y).*C3zb2 + sin(kk*X).*sin(kk*Y).*C3zb2 ...
                          - sin(kk*X).*cos(kk*Y).*S3zb2 - cos(kk*X).*sin(kk*Y).*S3zb2);
    elseif strcmp(type_b, 'slotp')
        C2xb2 = cos(2*kk*X); C2yb2 = cos(2*kk*Y); C2zb2 = cos(2*kk*Z);
        V_b = weights_b(1)*(-2*(cos(kk*X).*cos(kk*Y) + cos(kk*Y).*cos(kk*Z) + cos(kk*Z).*cos(kk*X)) ...
            - 2*(C2xb2 + C2yb2 + C2zb2) ...
            + (C2xb2.*cos(kk*Y) + C2yb2.*cos(kk*Z) + C2zb2.*cos(kk*X)) ...
            - (cos(kk*X).*C2yb2 + cos(kk*Y).*C2zb2 + cos(kk*Z).*C2xb2));
    elseif strcmp(type_b, 'fs')
        V_b = weights_b(1)*cos(kk*X).*cos(kk*Y).*cos(kk*Z);
    elseif strcmp(type_b, 'qstar')
        cXYb2 = cos(kk*X).*cos(kk*Y) + sin(kk*X).*sin(kk*Y);
        V_b = weights_b(1)*((cos(kk*X) - 2*cos(kk*Y)).*cos(kk*Z) - sqrt(3)*sin(kk*Z).*(cXYb2 - cos(kk*X)) + cXYb2.*cos(kk*Z));
    elseif strcmp(type_b, 'ws')
        V_b = weights_b(1)*((cos(2*kk*X).*cos(kk*Y) + cos(2*kk*Y).*cos(kk*Z) + cos(2*kk*Z).*cos(kk*X)) ...
            - (cos(kk*X).*cos(2*kk*Y) + cos(kk*Y).*cos(2*kk*Z) + cos(kk*Z).*cos(2*kk*X)));
    else
        error('Unsupported hybrid TPMS type');
    end
    blend_center = ${j(e.hybrid.blendCenter)};
    blend_width = ${j(e.hybrid.blendWidth)};
    % 波前在物理空间取点（与平台 wavefrontCoord 同源），不经应力变换
    px_ = X0 / pi; py_ = Y0 / pi; pz_ = Z0 / pi;
    switch blend_axis
        case 'y', t_wave = py_;
        case 'z', t_wave = pz_;
        case 'radial', t_wave = sqrt(px_.^2 + py_.^2 + pz_.^2);
        otherwise, t_wave = px_;
    end
    if strcmp(blend_function, 'linear')
        half_w = blend_width / 2;
        alpha = min(max((t_wave - (blend_center - half_w)) / blend_width, 0), 1);
    else  % sigmoid
        k_sig = 6.0 / max(blend_width, 0.01);
        alpha = 1 ./ (1 + exp(-k_sig * (t_wave - blend_center)));
    end
    V = alpha .* V + (1 - alpha) .* V_b;
end

% 容器边界场（SDF：外部 >= 0 = 固相包裹，与平台 max(f, bound) 一致；不用 NaN）
% 容器在物理空间取点，不经应力变换（X0/Y0/Z0 为替换前原始坐标）
px = X0 / pi;
py = Y0 / pi;
pz = Z0 / pi;
if strcmp(container, 'cylinder')
    bound = max(px.^2 + py.^2 - 1, abs(pz) - 1);
else
    bound = max(max(abs(px) - 1, abs(py) - 1), abs(pz) - 1);
end

% 模式场与孔隙率二分（与平台 surface-nets.ts 同一算法：容器内网格角点分位数）
inside = bound < 0;
target_solid = max(0.02, min(0.98, 1 - porosity/100));
v_in = sort(V(inside));
n_in = numel(v_in);

if strcmp(structure_mode, 'gradient_shell')
    lo = 0.02; hi = (v_in(end) - v_in(1)) * 4;
    for iter = 1:18
        t_eff = (lo + hi) / 2;
        cnt = sum(v_in < -t_eff/2) + (n_in - sum(v_in < t_eff/2));
        if cnt / n_in > target_solid, lo = t_eff; else, hi = t_eff; end
    end
    t_eff = (lo + hi) / 2;  % 平台无 0.05 下限，保持一致
    if strcmp(gradient_dir, 'z')
        scale = 1.5 - (pz + 1) * 0.5;
    elseif strcmp(gradient_dir, 'radial')
        scale = max(1.5 - min((px.^2 + py.^2) / 2, 1.4), 0.1);
    elseif strcmp(gradient_dir, 'spherical')
        scale = max(1.5 - min((px.^2 + py.^2 + pz.^2) / 3, 1.4), 0.1);
    else
        scale = 1.0;
    end
    F = (V - 0).^2 - (t_eff .* scale / 2).^2;
elseif strcmp(structure_mode, 'shell')
    lo = 0.02; hi = (v_in(end) - v_in(1)) * 4;
    for iter = 1:18
        t_eff = (lo + hi) / 2;
        cnt = sum(v_in < -t_eff/2) + (n_in - sum(v_in < t_eff/2));
        if cnt / n_in > target_solid, lo = t_eff; else, hi = t_eff; end
    end
    t_eff = (lo + hi) / 2;  % 平台无 0.05 下限，保持一致
    t_scale = ones(size(V)); if ~strcmp(stress_preset, 'none'), t_scale = max(0.1, 1.0 - stress_strength * vm); end  % 【阶段 IV】高应力侧孔隙板收窄
    F = V.^2 - (t_eff .* t_scale / 2).^2;
else
    % solid_network：solid = {V < iso}（与平台一致），16 轮二分收敛到下分位数
    lo = v_in(1) - 0.5; hi = v_in(end) + 0.5;
    for iter = 1:16
        iso_bias = (lo + hi) / 2;
        solid_frac = sum(v_in < iso_bias) / n_in;
        if solid_frac > target_solid, hi = iso_bias; else, lo = iso_bias; end
    end
    iso_bias = (lo + hi) / 2;
    F = iso_bias - V;
end

F = max(F, bound);
% 【2026-08-27 v2】统一封盖规则（与平台 surface-nets v2 一致）：
% 容器外(bound>=0)或网格边界层一律空气——max 裁剪会被公式正瓣压过（实测教训）。
on_face = (X == min(X(:))) | (X == max(X(:))) | (Y == min(Y(:))) | (Y == max(Y(:))) | (Z == min(Z(:))) | (Z == max(Z(:)));
F(bound >= 0 | on_face) = -1e-6;

% 【实心加载端板】(与平台 surface-nets endplateMm 同源)
if endplate_mm > 0
    t_pl = min(endplate_mm, 0.4 * cell_size);
    z_band = abs(pz) >= (1 - 2 * t_pl / cell_size);
    z_face = (Z == min(Z(:))) | (Z == max(Z(:)));
    if strcmp(container, 'cylinder')
        side_in = (px.^2 + py.^2 - 1) < 0;
    else
        side_in = max(abs(px) - 1, abs(py) - 1) < 0;
    end
    F(z_band & side_in & ~z_face) = 1.0;
end
iso = 0;

% mm 坐标（1 period = 1 mm）
Xm = (px / 2) * cell_size;
Ym = (py / 2) * cell_size;
Zm = (pz / 2) * cell_size;

% 【阶段 IV/v4.0】非欧度规映射（与 core/manifold-mapping.ts 同源；'identity' 跳过；
% 径向族 poincare/hyperbolic 向量化，cylinder/torus/metric 见平台/Python 脚本）
manifold_kind = '${j(e.manifold.kind)}';
if ~strcmp(manifold_kind, 'identity') && (strcmp(manifold_kind, 'poincare') || strcmp(manifold_kind, 'hyperbolic'))
    K2R = 2 * pi / cell_size;
    Xr = Xm * K2R; Yr = Ym * K2R; Zr = Zm * K2R;
    r = sqrt(Xr.^2 + Yr.^2 + Zr.^2); r = max(r, 1e-12);
    if strcmp(manifold_kind, 'poincare')
        R0 = ${e.manifold.radius} * K2R;
        rC = 0.95 * R0;
        rcEff = min(rC, 0.999 * R0);
        fpc = 2 * R0^2 * rcEff / (R0^2 - rcEff^2);
        fpC = 2 * R0^2 * (R0^2 + rC^2) / (R0^2 - rC^2)^2; % f'(rC) 真导数（2026-09-05 C¹ 根治）
        rp = (r <= rC) .* (2 * R0^2 * r ./ max(R0^2 - r.^2, 1e-9)) + (r > rC) .* (fpc + fpC * (r - rC));
        sc = rp ./ r;
    else
        R0 = ${e.manifold.radius} * K2R;
        sc = (R0 * tan(r / R0 * pi / 4)) ./ r;
    end
    Xm = (Xr .* sc) / K2R; Ym = (Yr .* sc) / K2R; Zm = (Zr .* sc) / K2R;
end

figure;
p = patch(isosurface(Xm, Ym, Zm, F, iso));
% 【2026-09-15 真机实测修复】isonormals 内部 interp3 假设 separable 网格
% （各维坐标独立）；poincare/hyperbolic 径向映射逐点变形破坏该假设，
% MATLAB R2025a 实测直接报错——非欧映射分支跳过法线插值（flat 光照）
if strcmp(manifold_kind, 'identity')
    isonormals(Xm, Ym, Zm, F, p);
end
p.FaceColor = 'red';
p.EdgeColor = 'none';
daspect([1 1 1]);
view(3);
camlight;
if strcmp(manifold_kind, 'identity')
    lighting gouraud;
else
    lighting flat;
end

% 【G4 2026-10-11】strut 桁架场（与 core/strut-bcc.ts / strut-octet.ts 同源）：
% cell=2π=一周期、r=w0·半胞、octet 角↔面心 FCC 逐轴 |Δ|≤½cell 判定 + 面心对角；
% 归约坐标 27 邻域（周期场，无需全局 cell 枚举）
function D = strut_truss_field(MX, MY, MZ, w0, octet)
    cellE = 2*pi;
    r = w0 * cellE / 2;
    ci = floor(MX / cellE); cj = floor(MY / cellE); ck = floor(MZ / cellE);
    UX = MX - ci*cellE; UY = MY - cj*cellE; UZ = MZ - ck*cellE;
    cList = [];
    for vi = [0 1], for vj = [0 1], for vl = [0 1]
        cList = [cList; vi vj vl]; %#ok<AGROW>
    end, end, end
    fList = [];
    fc = [0.5 0.5 0; 0.5 0 0.5; 0 0.5 0.5];
    for q = 1:3
        fList = [fList; fc(q,:)]; %#ok<AGROW>
        fList = [fList; 1-fc(q,:)]; %#ok<AGROW>
    end
    A = []; B = [];
    if ~octet
        for p = 1:size(cList,1)
            A = [A; cList(p,:)]; %#ok<AGROW>
            B = [B; 0.5 0.5 0.5]; %#ok<AGROW>
        end
    else
        for p = 1:size(cList,1)
            for q = 1:size(fList,1)
                if all(abs(fList(q,:) - cList(p,:)) <= 0.501)
                    A = [A; cList(p,:)]; %#ok<AGROW>
                    B = [B; fList(q,:)]; %#ok<AGROW>
                end
            end
        end
        for a = 1:size(fList,1)
            for b = a+1:size(fList,1)
                if abs(sum((fList(a,:) - fList(b,:)).^2) - 0.5) < 1e-6
                    A = [A; fList(a,:)]; %#ok<AGROW>
                    B = [B; fList(b,:)]; %#ok<AGROW>
                end
            end
        end
    end
    A = A * cellE; B = B * cellE;
    D = inf(size(MX));
    for di = -1:1, for dj = -1:1, for dk = -1:1
        for p = 1:size(A,1)
            a = A(p,:) + [di dj dk]*cellE;
            b = B(p,:) + [di dj dk]*cellE;
            ab = b - a;
            L2 = ab * ab';
            tt = max(0, min(1, ((UX-a(1))*ab(1) + (UY-a(2))*ab(2) + (UZ-a(3))*ab(3)) / L2));
            D = min(D, sqrt((UX-(a(1)+tt.*ab(1))).^2 + (UY-(a(2)+tt.*ab(2))).^2 + (UZ-(a(3)+tt.*ab(3))).^2));
        end
    end, end, end
    D = D - r;
end
`}function I(e,t){o(new Blob([F(e)],{type:`text/plain`}),t)}var L={gyroid:`10.1016/j.ijsolstr.2017.02.015`,diamond:`10.1016/j.actbio.2018.04.011`,schwarz:`10.1016/j.addma.2017.03.019`,"i-wp":`10.1016/j.mechmat.2022.104504`,"f-rd":``,neovius:`10.1016/j.eml.2020.100688`,lidinoid:`10.1039/FT9908600769`,splitp:``,octo:``,karcher:``,fks:``,fky:``,gprime:``,fcks:``,dprime:``,dp:``,dd:``,dg:``,fcky:``,cdd:``,custom:``,slotp:``,fs:``,qstar:``,ws:``};function R(e){return e===`iwp`?`i-wp`:e===`frd`?`f-rd`:e}function z(e){return e.replace(/%/g,`\\%`).replace(/&/g,`\\&`).replace(/_/g,`\\_`).replace(/#/g,`\\#`)}function B(e,t,n,r){let i=new Date().toISOString(),a=n.replace(/[^a-zA-Z0-9]/g,``).substring(0,8)||`unnamed`,o=L[R(e.type)]||``,s=o?`  doi = {https://doi.org/${o}},\n`:``,c=r??window.location.href,l=z(`TPMS ${e.type} Scaffold: Porosity ${e.porosity}% | Cell Size ${e.cellSize} mm`),u=``;return t&&(u=` Sv=${t.svRatio.toFixed(3)} mm$^{-1}$, E*/Es=${t.gibsonAshbyE.toFixed(4)}, C1=${t.C1.toFixed(2)}, K=${(t.permeability*1e6).toFixed(2)} um$^2$. Mean pore: ${t.poreStats.meanDiameter.toFixed(3)} mm.`),`@misc{tpms_explorer_${a},
  title = {${l}},
  author = {TPMS Explorer Platform},
  year = {${new Date().getFullYear()}},
${s}  keywords = {TPMS, ${e.type}, scaffold, porosity, additive manufacturing, bone tissue engineering},
  note = {Generated on ${i}. Structure: ${z(e.structureMode)}, Container: ${z(e.containerShape)}.${u} Reproducible via: \\url{${c}}},
  url = {\\url{${c}}}
}`}function V(e,t,n,r,i){return JSON.stringify({version:`2.2`,generatedAt:new Date().toISOString(),parameters:{type:e.type,porosity:e.porosity,cellSize:e.cellSize,thickness:e.thickness,weights:e.weights,structureMode:e.structureMode,containerShape:e.containerShape,material:e.material,gradientDir:e.gradientDir,hybrid:e.hybrid,customFormula:e.customFormula,endplateMm:e.endplateMm,isoGrad:e.isoGrad,manifold:e.manifold,stress:e.stress,hierarchical:e.hierarchical,neural:e.neural},build:{resolution:r?.resolution??null,isoUsed:r?.isoUsed??null},metrics:t?{surfaceArea:t.surfaceArea,envelopeVolume:t.envelopeVolume,svRatio:t.svRatio,gibsonAshbyE:t.gibsonAshbyE,youngsModulusGPa:t.youngsModulusGPa,yieldStrengthMPa:t.yieldStrengthMPa,gibsonAshbySigma:t.gibsonAshbySigma,C1:t.C1,permeability_mm2:t.permeability,permeability_um2:t.permeability*1e6,poreMeanDiameter_mm:t.poreStats.meanDiameter,poreMinDiameter_mm:t.poreStats.minDiameter,poreMaxDiameter_mm:t.poreStats.maxDiameter,tortuosity:t.poreStats.tortuosity}:null,meshHash:n,reproducibility:{platform:`TPMS Explorer v1.2.0`,url:i??window.location.href}},null,2)}function H(e,n){let o=n,s=e.periods,c=2*Math.PI,l=c/n,u=e.weights,d=t(e.type,e.customFormula,{k:s,t:e.thickness,iso:e.iso}),f=e=>-Math.PI+(e+.5)/n*c,p=e.containerSdf,m=(e,t,r)=>{let i=(e/Math.PI+1)/2*n,a=(t/Math.PI+1)/2*n,o=(r/Math.PI+1)/2*n,s=Math.min(n-1,Math.max(0,Math.floor(i))),c=Math.min(n-1,Math.max(0,Math.floor(a))),l=Math.min(n-1,Math.max(0,Math.floor(o))),u=Math.min(1,Math.max(0,i-s)),d=Math.min(1,Math.max(0,a-c)),f=Math.min(1,Math.max(0,o-l)),m=Math.min(n,s+1),h=Math.min(n,c+1),g=Math.min(n,l+1),_=(e,t,r)=>p[(r*(n+1)+t)*(n+1)+e],v=_(s,c,l)*(1-u)+_(m,c,l)*u,y=_(s,h,l)*(1-u)+_(m,h,l)*u,b=_(s,c,g)*(1-u)+_(m,c,g)*u,x=_(s,h,g)*(1-u)+_(m,h,g)*u;return(v*(1-d)+y*d)*(1-f)+(b*(1-d)+x*d)*f},h=(t,n,r)=>e.containerShape===`cylinder`?Math.max(t*t+n*n-1,Math.abs(r)-1):Math.max(Math.abs(t)-1,Math.max(Math.abs(n)-1,Math.abs(r)-1)),g=new Float64Array(o*o*o),_=new Uint8Array(o*o*o),v=0,y=1/0,b=-1/0;for(let t=0;t<o;t++)for(let n=0;n<o;n++)for(let r=0;r<o;r++){let i=f(r),c=f(n),l=f(t),x=r+n*o+t*o*o;(p?m(i,c,l):h(i/Math.PI,c/Math.PI,l/Math.PI))<0&&(_[x]=1,v++);let S=e.stress&&e.stress.preset!==`none`?d(...a(e.stress,i*s,c*s,l*s),u):d(i*s,c*s,l*s,u);g[x]=S,_[x]&&(S<y&&(y=S),S>b&&(b=S))}if(!Number.isFinite(y)||b-y<1e-9)throw Error(`曲面场退化为常数，无法构建体素模型`);let x=e.iso,S=Math.max(.05,e.thickness*1.5);{let t=[];for(let e=0;e<o*o*o;e++)_[e]&&t.push(g[e]);t.sort((e,t)=>e-t);let n=t.length,r=e=>{let r=0,i=n;for(;r<i;){let n=r+i>>1;t[n]<e?r=n+1:i=n}return r},a=Math.max(.02,Math.min(.98,1-e.targetPorosity));if(e.structureMode===`solid_network`)if(e.type===`strutbcc`||e.type===`strutoctet`)x=i(d,e.targetPorosity,u,null,`vox:${e.type}:k${s}`).iso;else{let e=y-.5,t=b+.5;for(let i=0;i<24;i++){let i=(e+t)/2;r(i)/n>a?t=i:e=i}x=(e+t)/2}else{let e=e=>r(-e/2)+(n-r(e/2)),t=.02,i=(b-y)*4;for(let r=0;r<24;r++){let r=(t+i)/2;e(r)/n>a?t=r:i=r}S=(t+i)/2}}let C=new Uint8Array(o*o*o),w=0;for(let t=0;t<o;t++)for(let n=0;n<o;n++)for(let i=0;i<o;i++){let a=i+n*o+t*o*o;if(!_[a])continue;let s=g[a]-x,c=e.stress&&e.stress.preset!==`none`&&e.structureMode!==`solid_network`?r(e.stress,f(i),f(n),f(t)):1,l=S*c;(e.structureMode===`solid_network`?x-g[a]:s*s-l/2*(l/2))>0&&(C[a]=1,w++)}return{R:n,hWc:l,solid:C,solidCount:w,insideCount:v,inside:_,V:g,isoUsed:e.structureMode===`solid_network`?x:S/2}}function U(e){let{R:t,V:n}=e,r=2*Math.PI,i=e=>(e+Math.PI)/r*t-.5;return(e,r,a)=>{let o=i(e),s=i(r),c=i(a),l=Math.min(t-1,Math.max(0,Math.floor(o))),u=Math.min(t-1,Math.max(0,Math.floor(s))),d=Math.min(t-1,Math.max(0,Math.floor(c))),f=Math.min(1,Math.max(0,o-l)),p=Math.min(1,Math.max(0,s-u)),m=Math.min(1,Math.max(0,c-d)),h=Math.min(t-1,l+1),g=Math.min(t-1,u+1),_=Math.min(t-1,d+1),v=(e,r,i)=>n[(i*t+r)*t+e],y=v(l,u,d)*(1-f)+v(h,u,d)*f,b=v(l,g,d)*(1-f)+v(h,g,d)*f,x=v(l,u,_)*(1-f)+v(h,u,_)*f,S=v(l,g,_)*(1-f)+v(h,g,_)*f;return(y*(1-p)+b*p)*(1-m)+(x*(1-p)+S*p)*m}}function W(e,t){let n=[],r=0,i=0;for(;r<e.length&&i<t.length;){let a=Math.max(e[r][0],t[i][0]),o=Math.min(e[r][1],t[i][1]);o>a&&n.push([a,o]),e[r][1]<t[i][1]?r++:i++}return n}function G(e,t,n,r={}){let{R:i}=e,a=e.isoUsed,o=n/(2*Math.PI),s=2*Math.PI,c=U(e),l=i,u=s/l,d=s/t,f=r.containerShape??`cube`,p=(e,t,n)=>{let a=r.containerSdf,o=(e/Math.PI+1)/2*i,s=(t/Math.PI+1)/2*i,c=(n/Math.PI+1)/2*i,l=Math.min(i-1,Math.max(0,Math.floor(o))),u=Math.min(i-1,Math.max(0,Math.floor(s))),d=Math.min(i-1,Math.max(0,Math.floor(c))),f=Math.min(1,Math.max(0,o-l)),p=Math.min(1,Math.max(0,s-u)),m=Math.min(1,Math.max(0,c-d)),h=Math.min(i,l+1),g=Math.min(i,u+1),_=Math.min(i,d+1),v=(e,t,n)=>a[(n*(i+1)+t)*(i+1)+e],y=v(l,u,d)*(1-f)+v(h,u,d)*f,b=v(l,g,d)*(1-f)+v(h,g,d)*f,x=v(l,u,_)*(1-f)+v(h,u,_)*f,S=v(l,g,_)*(1-f)+v(h,g,_)*f;return(y*(1-p)+b*p)*(1-m)+(x*(1-p)+S*p)*m};if(f===`mesh`&&!r.containerSdf)throw Error(`containerShape=mesh 需要 containerSdf（computeMeshSDF 的 sdf）——fail-closed`);let m=(e,t)=>{if(f===`cube`)return null;let n=e=>(e+Math.PI)/s*l;if(f===`cylinder`){let r=e/Math.PI,i=t/Math.PI;if(Math.abs(i)>=1||Math.abs(r)>=1)return[];let a=Math.PI*Math.sqrt(1-r*r),o=n(-a),s=n(a),c=[];return s>o&&c.push([o,s]),c}let r=[];for(let n=0;n<=l;n++)r.push(p(-Math.PI+n/l*s,e,t));let i=[],a=r[0]<0?0:-1;for(let e=1;e<=l;e++){let t=r[e-1]<0,n=r[e]<0;n&&!t?a=e-1+r[e-1]/(r[e-1]-r[e]):!n&&t&&a>=0&&(i.push([a,e-1+(0-r[e-1])/(r[e]-r[e-1])]),a=-1)}return a>=0&&i.push([a,l]),i},h=[],g=0;for(let e=0;e<t;e++){let t=-Math.PI+(e+.5)*d,n=[],r=0;for(let e=0;e<l;e++){let i=-Math.PI+(e+.5)*u,d=[];for(let e=0;e<=l;e++)d.push(c(-Math.PI+e/l*s,i,t));let f=[],p=d[0]<a?0:-1,h=e=>d[e];for(let e=1;e<=l;e++){let t=h(e-1)<a,n=h(e)<a;if(n&&!t){let t=(h(e-1)-a)/(h(e-1)-h(e));p=e-1+t}else if(!n&&t&&p>=0){let t=(a-h(e-1))/(h(e)-h(e-1));f.push([p,e-1+t]),p=-1}}p>=0&&f.push([p,l]);let _=m(i,t);_!==null&&(f=W(f,_));let v=0;for(let[e,t]of f)v+=t-e;r+=v*u*u*o*o,g+=f.length,f.length&&n.push({y:e,iv:f})}h.push({z:t*o,nRows:l,rows:n,netArea:r})}let _=d*o;return{layers:h,layerHeightMm:_,volumeMm3:h.reduce((e,t)=>e+t.netArea,0)*_,totalIntervals:g}}function K(e,t){let n=`-1 -1 ${t+2} ${t+2}`,r=t/2,i=e.layers.map((e,n)=>{let i=t/e.nRows,a=[],o=[];for(let{y:n,iv:s}of e.rows){let c=-r+n*i;for(let[n,l]of s){let s=-r+n/e.nRows*t,u=-r+l/e.nRows*t;a.push(`M ${s.toFixed(4)} ${c.toFixed(4)} H ${u.toFixed(4)} V ${(c+i).toFixed(4)} H ${s.toFixed(4)} Z`),o.push(`M ${s.toFixed(4)} ${(c+i/2).toFixed(4)} H ${u.toFixed(4)}`)}}return`  <g id="layer-${n}" data-z="${e.z.toFixed(4)}" data-net-area="${e.netArea.toFixed(4)}">\n    <path d="${a.join(` `)}" fill="#cbd5e1" stroke="none"/>\n    <path d="${o.join(` `)}" fill="none" stroke="#1e293b" stroke-width="${Math.min(.06,i/8).toFixed(3)}"/>\n  </g>`}).join(`
`);return`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n}" width="${t+2}mm" height="${t+2}mm">\n<metadata>{"layers":${e.layers.length},"layerHeightMm":${e.layerHeightMm.toFixed(6)},"volumeMm3":${e.volumeMm3.toFixed(6)},"totalIntervals":${e.totalIntervals}}</metadata>\n${i}\n</svg>\n`}function q(e,t){let n=t/2,r=[];r.push(`$$HEADER`),r.push(`$$UNITS/1`),r.push(`$$VERSION/201`),r.push(`$$LABEL/TPMS Explorer direct slice, layers=${e.layers.length}, layerHeight=${e.layerHeightMm.toFixed(6)}mm`);for(let i=0;i<e.layers.length;i++){let a=e.layers[i];r.push(`$$LAYER/${a.z.toFixed(4)}`);let o=t/a.nRows,s=[],c=0;for(let{y:e,iv:r}of a.rows){let i=-n+(e+.5)*o;for(let[e,o]of r){let r=-n+e/a.nRows*t,l=-n+o/a.nRows*t;s.push(0,+r.toFixed(4),+i.toFixed(4),+l.toFixed(4),+i.toFixed(4)),c++}}r.push(`$$HATCHES/1 ${c} `+s.join(` `))}return r.push(`$$ENDOFFILE`),r.join(`
`)+`
`}function J(t,n){let{R:r,solid:i,hWc:a}=t,o=e(n.specimenSizeMm),s=a*o,c=r+1,l=(e,t,n)=>e+t*c+n*c*c,u=new Uint8Array(c*c*c);for(let e=0;e<r;e++)for(let t=0;t<r;t++)for(let n=0;n<r;n++)i[n+t*r+e*r*r]&&(u[l(n,t,e)]=1,u[l(n+1,t,e)]=1,u[l(n,t+1,e)]=1,u[l(n+1,t+1,e)]=1,u[l(n,t,e+1)]=1,u[l(n+1,t,e+1)]=1,u[l(n,t+1,e+1)]=1,u[l(n+1,t+1,e+1)]=1);let d=new Int32Array(c*c*c),f=[],p=0;for(let e=0;e<c*c*c;e++)u[e]&&(p++,d[e]=p,f.push(e));let m=[],h=e=>m.push(e);h(`*HEADING`),h(`TPMS lattice volumetric mesh (C3D8 voxel) - TPMS Explorer v1.2.0`),h(`** solid voxels: voxels classified by implicit field (solid fraction ${(t.solidCount/(r*r*r)).toFixed(4)})`),h(`** units: mm, N, MPa; specimen size ${n.specimenSizeMm.toFixed(3)} mm; voxel h = ${s.toExponential(4)} mm`),h(`**`),h(`*NODE`);for(let e of f){let t=Math.floor(e/(c*c)),n=Math.floor(e%(c*c)/c),r=e%c;h(`${d[e]}, ${(r*a-Math.PI)*o}, ${(n*a-Math.PI)*o}, ${(t*a-Math.PI)*o}`)}h(`*ELEMENT, TYPE=C3D8, ELSET=ESOLID`);let g=0,_={BOTTOM:[],TOP:[],PBC_X0:[],PBC_X1:[],PBC_Y0:[],PBC_Y1:[],PBC_Z0:[],PBC_Z1:[]};for(let e=0;e<r;e++)for(let t=0;t<r;t++)for(let n=0;n<r;n++){if(!i[n+t*r+e*r*r])continue;g++;let a=d[l(n,t,e)],o=d[l(n+1,t,e)],s=d[l(n+1,t+1,e)],c=d[l(n,t+1,e)],u=d[l(n,t,e+1)],f=d[l(n+1,t,e+1)],p=d[l(n+1,t+1,e+1)],m=d[l(n,t+1,e+1)];h(`${g}, ${a}, ${o}, ${s}, ${c}, ${u}, ${f}, ${p}, ${m}`)}for(let e of f){let t=Math.floor(e/(c*c)),n=Math.floor(e%(c*c)/c),i=e%c;t===0&&_.BOTTOM.push(d[e]),t===r&&_.TOP.push(d[e]),i===0&&_.PBC_X0.push(d[e]),i===r&&_.PBC_X1.push(d[e]),n===0&&_.PBC_Y0.push(d[e]),n===r&&_.PBC_Y1.push(d[e]),t===0&&_.PBC_Z0.push(d[e]),t===r&&_.PBC_Z1.push(d[e])}for(let[e,t]of Object.entries(_))if(t.length!==0){h(`*NSET, NSET=NSET_${e}`);for(let e=0;e<t.length;e+=8)h(t.slice(e,e+8).join(`, `))}h(`**`),h(`** PBC usage: couple NSET_PBC_X0/X1 (and Y/Z) with *EQUATION or a submodel of periodic MPC; edge/corner masters need dedicated sets in production workflows.`),h(`*SOLID SECTION, ELSET=ESOLID, MATERIAL=TPMS_MATRIX`),h(`*MATERIAL, NAME=TPMS_MATRIX`),h(`*ELASTIC`),h(`${n.youngModulusMPa}, ${n.poisson}`),h(`**`),h(`** Uniaxial compression along Z (bottom fixed, top displaced)`);let v=-(n.nominalStrain*n.specimenSizeMm);return h(`*STEP`),h(`*STATIC`),h(`*BOUNDARY`),h(`NSET_BOTTOM, 3, 3, 0.0`),h(`NSET_TOP, 3, 3, `+v.toFixed(6)),h(`*OUTPUT, FIELD`),h(`*ELEMENT OUTPUT`),h(`S, E`),h(`*NODE OUTPUT`),h(`U`),h(`*OUTPUT, HISTORY`),h(`*NODE OUTPUT, NSET=NSET_TOP`),h(`RF, U`),h(`*END STEP`),{text:m.join(`
`)+`
`,nodeCount:p,elemCount:g}}function Y(e,t,r){let{text:i}=J(e,t);n(i,r,`text/plain`)}var ee=(()=>{let e=new Uint32Array(256);for(let t=0;t<256;t++){let n=t;for(let e=0;e<8;e++)n=n&1?3988292384^n>>>1:n>>>1;e[t]=n>>>0}return e})();function te(e){let t=4294967295;for(let n=0;n<e.length;n++)t=ee[(t^e[n])&255]^t>>>8;return(t^4294967295)>>>0}function X(e){let t=new TextEncoder,n=[],r=[],i=0;for(let a of e){let e=t.encode(a.name),o=te(a.data),s=a.data.length,c=new Uint8Array(30+e.length),l=new DataView(c.buffer);l.setUint32(0,67324752,!0),l.setUint16(4,20,!0),l.setUint16(6,0,!0),l.setUint16(8,0,!0),l.setUint16(10,0,!0),l.setUint16(12,0,!0),l.setUint32(14,o,!0),l.setUint32(18,s,!0),l.setUint32(22,s,!0),l.setUint16(26,e.length,!0),l.setUint16(28,0,!0),c.set(e,30),n.push(c,a.data);let u=new Uint8Array(46+e.length),d=new DataView(u.buffer);d.setUint32(0,33639248,!0),d.setUint16(4,20,!0),d.setUint16(6,20,!0),d.setUint16(8,0,!0),d.setUint16(10,0,!0),d.setUint16(12,0,!0),d.setUint16(14,0,!0),d.setUint32(16,o,!0),d.setUint32(20,s,!0),d.setUint32(24,s,!0),d.setUint16(28,e.length,!0),d.setUint32(42,i,!0),u.set(e,46),r.push(u),i+=c.length+s}let a=r.reduce((e,t)=>e+t.length,0),o=new Uint8Array(22),s=new DataView(o.buffer);s.setUint32(0,101010256,!0),s.setUint16(8,e.length,!0),s.setUint16(10,e.length,!0),s.setUint32(12,a,!0),s.setUint32(16,i,!0);let c=[...n,...r,o],l=c.reduce((e,t)=>e+t.length,0),u=new Uint8Array(l),d=0;for(let e of c)u.set(e,d),d+=e.length;return u}var Z=(e,t)=>`FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${e};\n    object      ${t};\n}\n`;function Q(e,t,n={}){let{R:r,solid:i,hWc:a}=e,o=a*(t/(2*Math.PI)),s=n.fourPatch===!0;if(s&&(n.flowAxis===void 0||![0,1,2].includes(n.flowAxis)))throw Error(`fourPatch 模式必须提供 flowAxis（0=x/1=y/2=z）——任意流形流向自动识别 ill-posed，fail-closed`);let c=(t,n,a)=>{let o=t+n*r+a*r*r;return i[o]?1:e.inside&&!e.inside[o]?2:0},l=new Int32Array(r*r*r).fill(-1),u=0,d=new Int32Array(r*r*r);for(let e=0;e<r*r*r;e++)c(e%r,Math.floor(e%(r*r)/r),Math.floor(e/(r*r)))===0&&(l[e]=u,d[u++]=e);let f=e=>{let t=Math.floor(e/(r*r)),n=Math.floor(e%(r*r)/r);return[e%r,n,t]},p=[],m=(e,t,n)=>e>=0&&e<r&&t>=0&&t<r&&n>=0&&n<r,h=(e,t,n)=>l[e+t*r+n*r*r],g=e=>{let[t,n,r]=f(d[e]);return[t+.5,n+.5,r+.5]};for(let e=0;e<3;e++){let[t,i]=e===0?[1,2]:e===1?[0,2]:[0,1];for(let a=0;a<=r;a++)for(let o=0;o<r;o++)for(let l=0;l<r;l++){let u=[0,0,0],d=[0,0,0];u[e]=a-1,d[e]=a,u[t]=l,u[i]=o,d[t]=l,d[i]=o;let f=m(u[0],u[1],u[2]),_=m(d[0],d[1],d[2]),v=f?c(u[0],u[1],u[2]):2,y=_?c(d[0],d[1],d[2]):2,b=f&&v===0,x=_&&y===0;if(!b&&!x)continue;let S=[],C=e=>S.push(e);e===0?(C([a,l,o]),C([a,l+1,o]),C([a,l+1,o+1]),C([a,l,o+1])):e===1?(C([l,a,o]),C([l,a,o+1]),C([l+1,a,o+1]),C([l+1,a,o])):(C([l,o,a]),C([l+1,o,a]),C([l+1,o+1,a]),C([l,o+1,a]));let w=[(S[0][0]+S[1][0]+S[2][0]+S[3][0])/4,(S[0][1]+S[1][1]+S[2][1]+S[3][1])/4,(S[0][2]+S[1][2]+S[2][2]+S[3][2])/4],T=[S[1][0]-S[0][0],S[1][1]-S[0][1],S[1][2]-S[0][2]],E=[S[2][0]-S[0][0],S[2][1]-S[0][1],S[2][2]-S[0][2]],D=[T[1]*E[2]-T[2]*E[1],T[2]*E[0]-T[0]*E[2],T[0]*E[1]-T[1]*E[0]],O=b?h(u[0],u[1],u[2]):h(d[0],d[1],d[2]),k=b&&x?h(d[0],d[1],d[2]):-1,A=g(O),j=(w[0]-A[0])*D[0]+(w[1]-A[1])*D[1]+(w[2]-A[2])*D[2]>=0?S:[S[0],S[3],S[2],S[1]],M=2;b&&x||(s?M=(b?y:v)===1?3:e===n.flowAxis&&(a===0||a===r)?+!!b:2:e===2&&a===0?M=0:e===2&&a===r&&(M=1)),p.push({pts:j,owner:O,neighbour:k,patch:M})}}let _=p.filter(e=>e.neighbour>=0),v=p.filter(e=>e.neighbour<0&&e.patch===0),y=p.filter(e=>e.neighbour<0&&e.patch===1),b=p.filter(e=>e.neighbour<0&&e.patch===2),x=s?p.filter(e=>e.neighbour<0&&e.patch===3):[],S=[..._,...v,...y,...b,...x],C=new Map,w=[],T=e=>{let t=`${e[0]},${e[1]},${e[2]}`,n=C.get(t);return n===void 0&&(n=w.length,w.push([(e[0]-r/2)*o,(e[1]-r/2)*o,(e[2]-r/2)*o]),C.set(t,n)),n},E=[],D=[],O=[],k=0,A=s?[`flow_inlet`,`flow_outlet`,`casing_wall`,`tpms_scaffold_wetted`]:[`inlet`,`outlet`,`wall`],j=Object.fromEntries(A.map(e=>[e,{start:-1,n:0}]));S.forEach((e,t)=>{if(E.push(`(${e.pts.map(T).join(` `)})`),D.push(String(e.owner)),e.neighbour>=0)O.push(String(e.neighbour)),k++;else{let n=A[e.patch];j[n].start<0&&(j[n].start=t),j[n].n++}});let M={};M[`constant/polyMesh/points`]=Z(`vectorField`,`points`)+`\n${w.length}\n(\n`+w.map(e=>`(${e.map(e=>e.toFixed(6)).join(` `)})`).join(`
`)+`
)
`,M[`constant/polyMesh/faces`]=Z(`faceList`,`faces`)+`\n${S.length}\n(\n`+E.join(`
`)+`
)
`,M[`constant/polyMesh/owner`]=Z(`labelList`,`owner`)+`\n${S.length}\n(\n`+D.join(`
`)+`
)
`,M[`constant/polyMesh/neighbour`]=Z(`labelList`,`neighbour`)+`\n${k}\n(\n`+O.join(`
`)+`
)
`;let N=A.map(e=>{let t=k,n=j[e];return t+=n.n,`    ${e}\n    {\n        type            ${s&&(e===`casing_wall`||e===`tpms_scaffold_wetted`)?`wall`:`patch`};\n        nFaces          ${n.n};\n        startFace       ${n.n>0?n.start:t};\n    }`}).join(`
`);return M[`constant/polyMesh/boundary`]=Z(`polyBoundaryMesh`,`boundary`)+`\n${A.length}\n(\n${N}\n)\n`,{files:M,stats:{points:w.length,faces:S.length,internalFaces:k,boundaryFaces:S.length-k,cells:u,patches:Object.fromEntries(A.map(e=>[e,j[e].n]))}}}function ne(e,t,n,r){let i=Q(e,t),a=new TextEncoder,o=X(Object.entries(i.files).map(([e,t])=>({name:e,data:a.encode(t)})));r(new Blob([o],{type:`application/zip`}),n)}var re=String.raw`# -*- coding: utf-8 -*-
"""Abaqus no-GUI 准静态压缩求解与后处理（TPMS Explorer v1.2.0 验证包）

用法（Abaqus 命令行环境）:
    abaqus cae noGUI=abaqus_auto_runner.py -- --inp tpms-gyroid-voxel.inp --out result.csv

流程:
    1. JobFromInputFile 导入平台导出的 .inp（C3D8 体网格 + NSET_BOTTOM/TOP）
    2. 施加刚性压盘位移载荷（eps = 0 ~ 0.3，10 个增量步）
    3. 提取顶部反力 RF 与位移 U3 → 反力-位移曲线 result.csv
    4. 自动计算 E_FEM（0~5% 应变线性拟合）、sigma_peak（峰值）、sigma_pl（5~25% 平台均值）
"""
import sys
import os

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def _arg(name, default):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default

INP = _arg('--inp', 'tpms-voxel.inp')
OUT = _arg('--out', 'result.csv')
EPS_MAX = float(_arg('--eps', '0.3'))
L_MM = float(_arg('--specimen', '1.0'))
A_MM2 = L_MM * L_MM

from abaqus import *
from abaqusConstants import *
import job

job_name = os.path.splitext(os.path.basename(INP))[0]
myJob = mdb.JobFromInputFile(name=job_name, inputFileName=INP,
                             numCpus=1, resultsFormat=ODB)
myJob.submit()
myJob.waitForCompletion()

from odbAccess import openOdb
odb = openOdb(job_name + '.odb')
step = odb.steps.values()[-1]

N_EIncrements = 10
disp = []
force = []
for fr in step.frames:
    if fr.frameId == 0:
        continue
    u = fr.fieldOutputs['U'].getSubset(region=odb.rootAssembly.nodeSets['NSET_TOP']).values[0].data3
    rf_sum = 0.0
    rv = fr.fieldOutputs['RF'].getSubset(region=odb.rootAssembly.nodeSets['NSET_TOP']).values
    for v in rv:
        rf_sum += v.data3
    disp.append(-u)
    force.append(rf_sum)
odb.close()

# 应力-应变曲线（名义）
strain = [d / L_MM for d in disp]
stress = [f / A_MM2 for f in force]

def _linear_fit(xs, ys):
    n = len(xs)
    sx = sum(xs); sy = sum(ys)
    sxx = sum(x * x for x in xs); sxy = sum(x * y for x, y in zip(xs, ys))
    k = (n * sxy - sx * sy) / (n * sxx - sx * sx) if n * sxx != sx * sx else 0.0
    return k

# E_FEM：0~5% 应变段线性拟合斜率
lin_x = [e for e in strain if e <= 0.05 * EPS_MAX]
lin_y = stress[:len(lin_x)]
e_fem = _linear_fit(lin_x, lin_y)
# sigma_pl：5%~25% 应变平台均值
pl_y = [s for e, s in zip(strain, stress) if 0.05 * EPS_MAX <= e <= 0.25 * EPS_MAX]
sigma_pl = sum(pl_y) / len(pl_y) if pl_y else 0.0
sigma_peak = max(stress) if stress else 0.0

with open(OUT, 'w') as fp:
    fp.write('strain,stress_MPa\n')
    for e, s in zip(strain, stress):
        fp.write('%.6f,%.4f\n' % (e, s))
    fp.write('\n# E_FEM_MPa=%.4f\n# sigma_peak_MPa=%.4f\n# sigma_pl_MPa=%.4f\n'
             % (e_fem, sigma_peak, sigma_pl))
print('TPMS verification: E_FEM=%.4f MPa, sigma_peak=%.4f, sigma_pl=%.4f -> %s'
      % (e_fem, sigma_peak, sigma_pl, OUT))
`,ie=String.raw`# -*- coding: utf-8 -*-
"""OpenFOAM 达西渗流自动化求解与后处理（TPMS Explorer v1.2.0 验证包）

用法（OpenFOAM 环境，python3）:
    python3 openfoam_auto_runner.py --case tpms-polymesh-case --out permeability.csv

流程:
    1. 在导出的 constant/polyMesh 之上构建 simpleFoam 算例（system/ + 0/）
       inlet 固定压力 p_in、outlet 固定 p_out（Delta_p），壁面 noSlip
    2. checkMesh + simpleFoam 求解至收敛
    3. flowRatePatch(inlet) 提取体积流量 Q
    4. Darcy 渗透率 kappa = Q * mu * L / (A * Delta_p)；壁面剪切应力 WSS 均值
"""
import argparse
import os
import shutil
import subprocess

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', default='tpms-polymesh-case')
    ap.add_argument('--out', default='permeability.csv')
    ap.add_argument('--nu', type=float, default=1e-6)          # 运动粘度 m^2/s（水）
    ap.add_argument('--dp', type=float, default=1.0)           # 压差 Pa（rho=1 时 p 量纲 m^2/s^2）
    ap.add_argument('--L', type=float, default=1e-3)           # 试样长度 m
    ap.add_argument('--A', type=float, default=1e-6)           # 截面积 m^2
    args = ap.parse_args()

    case = args.case
    os.makedirs(os.path.join(case, 'system'), exist_ok=True)
    os.makedirs(os.path.join(case, '0'), exist_ok=True)

    with open(os.path.join(case, 'system', 'controlDict'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object controlDict; }
application     simpleFoam;
startFrom       latestTime;
endTime         2000;
deltaT          1;
writeInterval   500;
writeControl    timeStep;
maxCo           0.5;

functions
{
    flowIn
    {
        type            flowRatePatch;
        patches         (inlet);
        writeControl    timeStep;
        writeInterval   100;
    }
    wss
    {
        type            wallShearStress;
        patches         (wall);
        writeControl    timeStep;
        writeInterval   500;
    }
}
""")

    with open(os.path.join(case, 'system', 'fvSchemes'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; }
divSchemes { default none; div(phi,U) bounded Gauss linearUpwind grad(U); }
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
""")

    with open(os.path.join(case, 'system', 'fvSolution'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }
solvers { p { solver GAMG; tolerance 1e-7; relTol 0.01; } U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.01; } }
SIMPLE { nNonOrthogonalCorrectors 1; pRefCell 0; pRefValue 0; }
relaxationFactors { fields { p 0.4; } equations { U 0.5; } }
""")

    with open(os.path.join(case, '0', 'U'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class volVectorField; object U; }
dimensions [0 1 -1 0 0 0 0];
internalField uniform (0 0 0);
boundaryField
{
    inlet  { type fixedValue; value uniform (0 0 0); }
    outlet { type fixedValue; value uniform (0 0 0); }
    wall   { type noSlip; }
}
""")

    with open(os.path.join(case, '0', 'p'), 'w') as f:
        f.write("""FoamFile { version 2.0; format ascii; class volScalarField; object p; }
dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField
{
    inlet  { type fixedValue; value uniform %g; }
    outlet { type fixedValue; value uniform 0; }
    wall   { type zeroGradient; }
}
""" % args.dp)

    def _run(cmd):
        ret = subprocess.call(cmd, shell=True, cwd=case)
        if ret != 0:
            raise SystemExit('command failed: ' + cmd)

    _run('checkMesh')
    _run('simpleFoam > log.simpleFoam 2>&1')
    _run('postProcess -func flowIn -latestTime > log.flow 2>&1')
    _run('postProcess -func wss -latestTime > log.wss 2>&1')

    # 提取 Q（inlet 流量，符号修正为正值体积流量）
    q = 0.0
    log = open(os.path.join(case, 'postProcessing', 'flowIn', str(max(os.listdir(os.path.join(case, 'postProcessing', 'flowIn')))), 'surfaceFieldValue.dat')).read()
    for ln in log.strip().splitlines():
        if not ln.startswith('#') and ln.strip():
            parts = ln.split()
            q = abs(float(parts[-1]))

    # WSS 均值（volume-averaged 于 wall patch）
    wss = 0.0
    wdir = os.path.join(case, 'postProcessing', 'wss')
    if os.path.isdir(wdir):
        sub = max(os.listdir(wdir))
        wfile = os.path.join(wdir, sub, 'wallShearStressPatchAvg(wall).dat')
        if os.path.isfile(wfile):
            for ln in open(wfile).read().strip().splitlines():
                if not ln.startswith('#') and ln.strip():
                    wss = abs(float(ln.split()[-1]))

    mu = args.nu * 1000.0     # 动力粘度（rho=1000 kg/m3 缺省）
    kappa = q * mu * args.L / (args.A * args.dp)
    with open(args.out, 'w') as f:
        f.write('Q_m3_s,kappa_m2,wss_Pa\n')
        f.write('%.6e,%.6e,%.4f\n' % (q, kappa, wss))
    print('TPMS verification: kappa=%.4e m2, Q=%.4e m3/s, WSS=%.4f Pa -> %s' % (kappa, q, wss, args.out))

if __name__ == '__main__':
    main()
`,ae=`#!/bin/bash
# TPMS Explorer v1.2.0 —— Abaqus 验证一键脚本
# 用法: ./run_abaqus.sh tpms-gyroid-voxel.inp 1.0
set -e
INP=\${1:-tpms-voxel.inp}
SPEC=\${2:-1.0}
abaqus cae noGUI=abaqus_auto_runner.py -- --inp "$INP" --out abaqus_result.csv --specimen "$SPEC"
echo "完成: abaqus_result.csv（E_FEM / sigma_peak / sigma_pl）"
`,oe=`#!/bin/bash
# TPMS Explorer v1.2.0 —— OpenFOAM 达西渗流一键脚本
# 用法: ./run_openfoam.sh tpms-polymesh-case
set -e
CASE=\${1:-tpms-polymesh-case}
python3 openfoam_auto_runner.py --case "$CASE" --out permeability.csv
echo "完成: permeability.csv（kappa / Q / WSS）"
`,se=`metric,unit,theory_prediction,cae_simulation,rel_error,verdict
E_FEM,MPa,,,
sigma_peak,MPa,,,
sigma_pl,MPa,,,
kappa,m2,,,
wss_avg,Pa,,,
sea,J/g,,,
f1_Hz,Hz,,,
# theory_prediction 来源：平台物理面板（Gibson-Ashby/Kozeny-Carman/impact-energy.ts）
# cae_simulation 来源：abaqus_auto_runner.py / openfoam_auto_runner.py 输出 CSV
# rel_error = |theory - cae| / |theory|；verdict: PASS <= 15% (解析代理口径), REVIEW > 15%
`;function $(e){let t={};return t[`abaqus_auto_runner.py`]=re,t[`openfoam_auto_runner.py`]=ie,t[`run_abaqus.sh`]=ae,t[`run_openfoam.sh`]=oe,t[`comparison_template.csv`]=se,t[`README.md`]=`# TPMS Explorer v1.2.0 CAE 验证脚本包

目标模型：${e.type}（固相体素 ${e.solidCount} / 流体体素 ${e.voidCount}）

## Abaqus 准静态压缩
1. 将平台导出的 .inp 与 abaqus_auto_runner.py 放同一目录
2. bash run_abaqus.sh <inp 文件名> <试样宽度 mm>
3. 输出 abaqus_result.csv（反力-位移曲线 + E_FEM/sigma_peak/sigma_pl）

## OpenFOAM 达西渗流
1. 将平台导出的 polymesh.zip 解压为算例目录（内含 constant/polyMesh）
2. bash run_openfoam.sh <算例目录>
3. 输出 permeability.csv（kappa/Q/WSS）

## 对比矩阵
把两个 CSV 的数值填入 comparison_template.csv，与平台物理面板理论预估对齐，
rel_error ≤ 15% 视为解析代理口径 PASS（>15% 请核对单位与试样尺寸换算）。
`,t}function ce(e,t,n){let r=$(e),i=new TextEncoder,a=X(Object.entries(r).map(([e,t])=>({name:e,data:i.encode(t)})));n(new Blob([a],{type:`application/zip`}),t)}export{S as build3MF,J as buildAbaqusInp,q as buildCliFormat,_ as buildGLB,m as buildMultiSolidSTL,Q as buildOpenfoamPolyMesh,K as buildSliceSvg,X as buildStoredZip,E as buildVTI,w as buildVTK,$ as buildVerificationSuite,H as buildVoxelModel,c as compileGcode,G as directSlice,C as export3MF,Y as exportAbaqusInp,d as exportBinarySTL,v as exportGLB,I as exportMatlabScript,h as exportMultiSolidSTL,ne as exportOpenfoamPolyMesh,P as exportPythonScript,D as exportVTI,T as exportVTK,ce as exportVerificationSuite,B as generateBibTeX,V as generateJSONSidecar,l as sliceMesh};
//# sourceMappingURL=export-DSIyiObN.js.map