(function (root) {
  'use strict';

  // Canonical BOQ contract shared by Simple and Professional modes.
  // Both modes MUST use this calculator for material quantities so the same
  // drawing + calibration + element set cannot produce different BOQs.
  function num(v, d) { return Number.isFinite(Number(v)) ? Number(v) : (d || 0); }
  function positive(v, d) { var n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }
  function sameId(a, b) { return a != null && b != null && String(a) === String(b); }
  function accepted(el) {
    if (!el || el.hidden) return false;
    var source = String(el.source || '').toUpperCase();
    var ai = source === 'AI' || source === 'AI_EDITED' || el.ai === true;
    if (ai) return el.accepted === true || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL';
    return el.accepted !== false;
  }
  function bounds(el, cf) {
    if (!el) return null;
    if (el.isLine && el.p1 && el.p2) {
      var x1=num(el.p1.x), y1=num(el.p1.y), x2=num(el.p2.x), y2=num(el.p2.y);
      if (![x1,y1,x2,y2].every(Number.isFinite)) return null;
      var half = 0;
      if (Number(el.thickness) > 0 && cf > 0) half = Number(el.thickness)/(2*cf);
      else half = Math.max(num(el.w), num(el.h))/2 || 4;
      return {minX:Math.min(x1,x2)-half,maxX:Math.max(x1,x2)+half,minY:Math.min(y1,y2)-half,maxY:Math.max(y1,y2)+half};
    }
    var x=num(el.x), y=num(el.y), w=num(el.w), h=num(el.h);
    if (!(w>0 && h>0)) return null;
    return {minX:x,maxX:x+w,minY:y,maxY:y+h};
  }
  function overlap(a,b) {
    if (!a || !b) return false;
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }
  function overlapArea(a,b) {
    if (!overlap(a,b)) return 0;
    return Math.max(0, Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX)) *
           Math.max(0, Math.min(a.maxY,b.maxY)-Math.max(a.minY,b.minY));
  }
  function lineLenDraw(el) {
    if (el && el.isLine && el.p1 && el.p2) return Math.hypot(num(el.p2.x)-num(el.p1.x), num(el.p2.y)-num(el.p1.y));
    if (Number(el && el.length) > 0) return Number(el.length);
    return Math.max(num(el && el.w), num(el && el.h));
  }
  function widthAlongLine(wall, o, cf) {
    if (!wall || !wall.p1 || !wall.p2 || !o) return Math.max(num(o.w),num(o.h));
    var x1=num(wall.p1.x),y1=num(wall.p1.y),x2=num(wall.p2.x),y2=num(wall.p2.y);
    var len=Math.hypot(x2-x1,y2-y1); if (!(len>1e-9)) return Math.max(num(o.w),num(o.h));
    var ux=(x2-x1)/len, uy=(y2-y1)/len, ob=bounds(o,cf); if (!ob) return Math.max(num(o.w),num(o.h));
    var pts=[[ob.minX,ob.minY],[ob.maxX,ob.minY],[ob.minX,ob.maxY],[ob.maxX,ob.maxY]], lo=Infinity,hi=-Infinity;
    pts.forEach(function(p){var t=(p[0]-x1)*ux+(p[1]-y1)*uy;lo=Math.min(lo,t);hi=Math.max(hi,t);});
    lo=Math.max(0,Math.min(len,lo)); hi=Math.max(0,Math.min(len,hi));
    return hi-lo>1e-6 ? hi-lo : Math.max(num(o.w),num(o.h));
  }
  function openingHeight(o, defaults) {
    if (Number(o && o.zHeight)>0) return Number(o.zHeight);
    if (Number(o && o.height)>0) return Number(o.height);
    var t=String(o && o.type || '').toLowerCase();
    return t==='window' ? positive(defaults.windowH,1.2) : positive(defaults.doorH,2.1);
  }
  function wallHeight(w, defaults) { return positive(w && w.zHeight, positive(w && w.height, positive(defaults.wallHeight,3))); }
  function wallDeduction(w, all, cf, defaults) {
    var wb=bounds(w,cf), wh=wallHeight(w,defaults), line=!!(w.isLine&&w.p1&&w.p2), total=0;
    (all||[]).forEach(function(o){
      if(!accepted(o)) return;
      var isOpen=o.type==='door'||o.type==='window'||o.type==='opening'||o.isDeduction||o.type==='cutout';
      if(!isOpen) return;
      var ob=bounds(o,cf), linked=sameId(o.parentId,w.id);
      if(!linked && !(wb&&ob&&overlap(wb,ob))) return;
      var wd=line?widthAlongLine(w,o,cf):Math.max(num(o.w),num(o.h));
      total += (wd*Math.max(0,cf))*Math.min(wh,Math.max(.01,openingHeight(o,defaults)));
    });
    (all||[]).forEach(function(c){
      if(!accepted(c)||c.type!=='column'||c.skipWallDeduction) return;
      var linked=sameId(c.parentId,w.id)||(Array.isArray(c.deductFromWallIds)&&c.deductFromWallIds.some(function(id){return sameId(id,w.id);}));
      var cb=bounds(c,cf); if(!linked && !(wb&&cb&&overlap(wb,cb))) return;
      var wd=line?widthAlongLine(w,c,cf):Math.max(num(c.w),num(c.h));
      var ch=positive(c.zHeight,positive(c.height,positive(defaults.columnHeight,3)));
      total += (wd*Math.max(0,cf))*Math.min(wh,Math.max(.01,ch));
    });
    return Math.max(0,total);
  }
  function slabCutArea(s, all, cf) {
    var sb=bounds(s,cf), cut=0, m2=cf*cf;
    if(!sb) return 0;
    (all||[]).forEach(function(o){
      if(!accepted(o)) return;
      var isOpen=o.type==='door'||o.type==='window'||o.type==='opening'||o.isDeduction||o.type==='cutout';
      var isStruct=o.type==='wall'||o.type==='column';
      if(!isOpen&&!isStruct) return;
      var ob=bounds(o,cf); if(ob&&overlap(sb,ob)) cut += overlapArea(sb,ob)*m2;
      else if(isOpen && sameId(o.parentId,s.id)) cut += Math.max(0,num(o.w))*Math.max(0,num(o.h))*m2;
    });
    return Math.max(0,cut);
  }
  function classifyWall(w, defaults) {
    var wt=String(w&&w.wallType||'').toLowerCase(), mat=String(w&&w.material||'').toLowerCase();
    var thk=positive(w&&w.thickness,positive(defaults.wallThickness,.225)), mm=thk*1000;
    if(wt.indexOf('110')>=0 || wt==='110mm brick' || wt==='brick 110') return {kind:'brick',mm:110};
    if(wt.indexOf('225')>=0 || wt==='225mm brick' || wt==='brick 225') return {kind:'brick',mm:225};
    if(wt.indexOf('100')>=0&&wt.indexOf('block')>=0) return {kind:'block',mm:100};
    if(wt.indexOf('150')>=0&&wt.indexOf('block')>=0) return {kind:'block',mm:150};
    if(wt.indexOf('200')>=0&&wt.indexOf('block')>=0) return {kind:'block',mm:200};
    if(mat.indexOf('brick')>=0&&mat.indexOf('block')<0) return {kind:'brick',mm:Math.round(mm)};
    if(mat.indexOf('200')>=0) return {kind:'block',mm:200};
    if(mat.indexOf('150')>=0) return {kind:'block',mm:150};
    if(mat.indexOf('100')>=0) return {kind:'block',mm:100};
    if(mat.indexOf('block')>=0) { var near=[100,150,200].reduce(function(a,b){return Math.abs(b-mm)<Math.abs(a-mm)?b:a;},100); return {kind:'block',mm:near}; }
    if(thk>=.20&&thk<=.24) return {kind:'brick',mm:225};
    if(thk>=.10&&thk<=.12) return {kind:'brick',mm:110};
    if(thk>=.175) return {kind:'block',mm:200};
    if(thk>=.125) return {kind:'block',mm:150};
    if(thk>=.09&&thk<=.12) return {kind:'block',mm:100};
    return {kind:'brick',mm:Math.round(mm)};
  }
  function calculate(elements, cf, opts) {
    opts=opts||{}; cf=positive(cf,1);
    var d=Object.assign({wallHeight:3,wallThickness:.225,slabThickness:.15,columnHeight:3,beamWidth:.20,beamDepth:.45,doorH:2.1,windowH:1.2,skirtingHeight:.10,cubeM3:2.83168},opts.defaults||{});
    var concrete=Object.assign({bagsPerM3:18/d.cubeM3,sandM3PerM3:.50,aggM3PerM3:.88},opts.concrete||{});
    var brick=Object.assign({100:{bricksPerM2:59.20,cementBagsPerM2:.14,sandCubesPerM2:.01},225:{bricksPerM2:117.33,cementBagsPerM2:.32,sandCubesPerM2:.02}},opts.brick||{});
    var block=Object.assign({100:{blocksPerM2:12.06,cementBagsPerM2:.04,sandCubesPerM2:.003},150:{blocksPerM2:12.06,cementBagsPerM2:.07,sandCubesPerM2:.01},200:{blocksPerM2:12.06,cementBagsPerM2:.08,sandCubesPerM2:.01}},opts.block||{});
    var plaster=Object.assign({thickness:.010,dryFactor:1.33,cementDensity:1440},opts.plaster||{});
    var tiling=Object.assign({tileArea:.36,wastage:.05,adhesiveBagsPerM2:.25},opts.tiling||{});
    var painting=Object.assign({coverage:14,coats:2,bothFaces:true},opts.painting||{});
    var els=(elements||[]).filter(accepted), walls=els.filter(function(e){return e.type==='wall';}), slabs=els.filter(function(e){return e.type==='slab';});
    var wallFace=0,wallVol=0,slabArea=0,slabVol=0,colVol=0,beamVol=0,wallFp=0,wallLen=0,doors=0,windows=0,other=0;
    walls.forEach(function(w){var len=lineLenDraw(w)*cf,h=wallHeight(w,d),gross=len*h,ded=wallDeduction(w,els,cf,d),net=Math.max(0,gross-ded),thk=positive(w.thickness,d.wallThickness);wallFace+=net;wallVol+=net*thk;wallFp+=len*thk;wallLen+=len;});
    slabs.forEach(function(s){var area=Math.max(0,num(s.w)*num(s.h))*cf*cf,thk=positive(s.zHeight,positive((Number(s.height)>=.08&&Number(s.height)<=.40)?s.height:null,d.slabThickness)),cut=slabCutArea(s,els,cf),net=Math.max(0,area-cut);slabArea+=net;slabVol+=net*thk;});
    els.filter(function(e){return e.type==='column';}).forEach(function(c){var area=Math.max(0,num(c.w)*num(c.h))*cf*cf,h=positive(c.zHeight,positive(c.height,d.columnHeight));colVol+=area*h;});
    els.filter(function(e){return e.type==='beam';}).forEach(function(b){var len=lineLenDraw(b)*cf,w=positive(b.thickness,d.beamWidth),h=positive(b.zHeight,positive(b.height,d.beamDepth));beamVol+=len*w*h;});
    els.forEach(function(e){if(e.type==='door')doors++;else if(e.type==='window')windows++;else if(e.type==='opening'||e.type==='cutout'||e.isDeduction) {var ot=e.openingType||e.type;if(ot==='door')doors++;else if(ot==='window')windows++;else other++;}});
    var concreteVol=slabVol+colVol+beamVol;
    var concBags=concreteVol*concrete.bagsPerM3, concSand=concreteVol*concrete.sandM3PerM3, concAgg=concreteVol*concrete.aggM3PerM3;
    var plasterDry=wallFace*plaster.thickness*plaster.dryFactor, plasterBags=(plasterDry/6)/.035, plasterSand=plasterDry*5/6;
    var bf={100:0,225:0}, blf={100:0,150:0,200:0};
    walls.forEach(function(w){var len=lineLenDraw(w)*cf, gross=len*wallHeight(w,d),net=Math.max(0,gross-wallDeduction(w,els,cf,d)),c=classifyWall(w,d);if(c.kind==='block'&&blf[c.mm]!=null)blf[c.mm]+=net;else bf[c.mm>=90&&c.mm<=120?100:225]+=net;});
    function mbrick(area,mm){var r=brick[mm]||brick[225],a=Math.max(0,area);return {nos:Math.ceil(a*r.bricksPerM2),cement:a*r.cementBagsPerM2,sand:a*r.sandCubesPerM2*d.cubeM3};}
    function mblock(area,mm){var r=block[mm]||block[100],a=Math.max(0,area);return {nos:Math.ceil(a*r.blocksPerM2),cement:a*r.cementBagsPerM2,sand:a*r.sandCubesPerM2*d.cubeM3};}
    var b100=mbrick(bf[100],100),b225=mbrick(bf[225],225),bl100=mblock(blf[100],100),bl150=mblock(blf[150],150),bl200=mblock(blf[200],200);
    var masonryC=b100.cement+b225.cement+bl100.cement+bl150.cement+bl200.cement, masonryS=b100.sand+b225.sand+bl100.sand+bl150.sand+bl200.sand;
    var cement=Math.ceil((concBags+plasterBags+masonryC)*10)/10, sand=Math.round((concSand+plasterSand+masonryS)*1000)/1000, agg=Math.round(concAgg*1000)/1000;
    var floor=Math.max(0,slabArea-wallFp)+wallLen*d.skirtingHeight, tiles=Math.ceil((floor/tiling.tileArea)*(1+tiling.wastage)), adhesive=Math.round(floor*tiling.adhesiveBagsPerM2*100)/100;
    var paint=Math.ceil(((wallFace*(painting.bothFaces!==false?2:1)*(painting.coats||2))/(painting.coverage||14))*10)/10;
    function mat(name,qty,unit,source){var r=opts.rates&&opts.rates[name],price=(r!=null&&r!=='')?Number(r):null;return {material:name,qty:qty,unit:unit,price:Number.isFinite(price)?price:null,source:source};}
    var materials=[mat('Cement',cement,'bag (50kg)','Canonical Simple/Pro BOQ · concrete + plaster + masonry'),mat('Sand',sand,'m³','Canonical Simple/Pro BOQ · concrete + plaster + masonry'),mat('Aggregate',agg,'m³','Canonical Simple/Pro BOQ · concrete mix'),mat('Brick',b100.nos+b225.nos,'Nr','Canonical Simple/Pro BOQ · net wall face'),mat('Block 100mm',bl100.nos,'Nr','Canonical Simple/Pro BOQ · net wall face'),mat('Block 150mm',bl150.nos,'Nr','Canonical Simple/Pro BOQ · net wall face'),mat('Block 200mm',bl200.nos,'Nr','Canonical Simple/Pro BOQ · net wall face'),mat('Adhesive',adhesive,'bag (25kg)','Canonical Simple/Pro BOQ · floor finish area'),mat('Tiles (600x600mm)',tiles,'Nr','Canonical Simple/Pro BOQ · floor finish area + 5% waste'),mat('Paint',paint,'L','Canonical Simple/Pro BOQ · wall face, 2 faces × 2 coats')];
    materials.forEach(function(m){m.total=(m.price!=null&&m.qty>0)?m.qty*m.price:null;});
    var elementQty=[{element:'Column',qty:Math.round(colVol*1000)/1000,unit:'m³'},{element:'Beam',qty:Math.round(beamVol*1000)/1000,unit:'m³'},{element:'Slab',qty:Math.round(slabVol*1000)/1000,unit:'m³'},{element:'Wall',qty:Math.round(wallFace*100)/100,unit:'m²'},{element:'Wall (volume)',qty:Math.round(wallVol*1000)/1000,unit:'m³'},{element:'Floor / tiling area',qty:Math.round(floor*100)/100,unit:'m²'},{element:'Skirting area',qty:Math.round(wallLen*d.skirtingHeight*100)/100,unit:'m²'},{element:'Doors',qty:doors,unit:'Nr'},{element:'Windows',qty:windows,unit:'Nr'},{element:'Openings (other)',qty:other,unit:'Nr'}];
    var total=materials.reduce(function(s,m){return s+(m.total||0);},0), pct=Number(opts.contingencyPct!=null?opts.contingencyPct:.15), cont=total*pct;
    return {materials:materials,elementQty:elementQty,materialsTotal:total,contingencyPct:pct,contingency:cont,grandTotal:total+cont,meta:{concreteVol:concreteVol,wallFaceM2:wallFace,slabArea:slabArea,slabVol:slabVol,colVol:colVol,beamVol:beamVol,brickNos:b100.nos+b225.nos,cementBags:concBags+plasterBags+masonryC,sandM3:concSand+plasterSand+masonryS,aggM3:concAgg,wallFootprintTotalM2:wallFp,wallLengthTotalM:wallLen,skirtingAreaM2:wallLen*d.skirtingHeight,floorFinishAreaM2:floor}};
  }
  root.MCBOQParity={calculate:calculate};
})(window);
