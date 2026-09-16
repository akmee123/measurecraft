const fs=require('fs'),vm=require('vm');
const code=fs.readFileSync('public/js/modules/boq-parity.js','utf8');
const ctx={window:{},console}; vm.createContext(ctx); vm.runInContext(code,ctx);
const calc=ctx.window.MCBOQParity.calculate;
const elements=[
 {id:'w1',type:'wall',isLine:true,p1:{x:0,y:0},p2:{x:100,y:0},w:100,h:10,thickness:.225,zHeight:3,accepted:true},
 {id:'d1',type:'door',x:20,y:-5,w:20,h:20,zHeight:2.1,accepted:true,parentId:'w1'},
 {id:'s1',type:'slab',x:0,y:0,w:100,h:100,zHeight:.15,accepted:true},
 {id:'c1',type:'column',x:40,y:-5,w:10,h:10,zHeight:3,accepted:true}
];
const opts={defaults:{wallHeight:3,wallThickness:.225,slabThickness:.15,columnHeight:3,beamWidth:.2,beamDepth:.45,doorH:2.1,windowH:1.2,skirtingHeight:.1,cubeM3:2.83168},concrete:{bagsPerM3:18/2.83168,sandM3PerM3:.5,aggM3PerM3:.88},brick:{100:{bricksPerM2:59.2,cementBagsPerM2:.14,sandCubesPerM2:.01},225:{bricksPerM2:117.33,cementBagsPerM2:.32,sandCubesPerM2:.02}},block:{100:{blocksPerM2:12.06,cementBagsPerM2:.04,sandCubesPerM2:.003},150:{blocksPerM2:12.06,cementBagsPerM2:.07,sandCubesPerM2:.01},200:{blocksPerM2:12.06,cementBagsPerM2:.08,sandCubesPerM2:.01}},plaster:{thickness:.01,dryFactor:1.33},tiling:{tileArea:.36,wastage:.05,adhesiveBagsPerM2:.25},painting:{coverage:14,coats:2,bothFaces:true}};
const a=calc(elements,.01,opts),b=calc(JSON.parse(JSON.stringify(elements)),.01,opts);
if(JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Parity calculator is not deterministic');
if(a.materials.find(x=>x.material==='Cement').qty<=0) throw new Error('Cement quantity missing');
if(a.materials.find(x=>x.material==='Brick').qty<=0) throw new Error('Brick quantity missing');
console.log('BOQ parity tests passed');
