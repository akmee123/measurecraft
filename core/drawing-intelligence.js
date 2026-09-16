'use strict';

/**
 * MeasureCraft Drawing Intelligence v1
 * Deterministic post-processing around vision/agent proposals.
 * No network, no DOM. Converts room-centric AI output into an auditable graph.
 */
const crypto = require('crypto');

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}
function clamp01(v) {
  const x = n(v, 0.5);
  return Math.max(0, Math.min(1, x > 1 ? x / 100 : x));
}
function box(b) {
  if (!b || typeof b !== 'object') return null;
  const x=n(b.x), y=n(b.y), w=n(b.w), h=n(b.h);
  if (![x,y,w,h].every(Number.isFinite) || w <= 1 || h <= 1) return null;
  return {x,y,w,h};
}
function center(b) { return {x:b.x+b.w/2,y:b.y+b.h/2}; }
function intersects(a,b,pad=0) {
  return a.x-pad < b.x+b.w && a.x+a.w+pad > b.x && a.y-pad < b.y+b.h && a.y+a.h+pad > b.y;
}
function distancePointToBox(p,b) {
  const dx = Math.max(b.x-p.x, 0, p.x-(b.x+b.w));
  const dy = Math.max(b.y-p.y, 0, p.y-(b.y+b.h));
  return Math.hypot(dx,dy);
}
function id(prefix, seed) {
  return prefix + '-' + crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0,10);
}
function dedupeBoxes(list, iouThreshold=0.8) {
  const out=[];
  for (const item of list || []) {
    const b=box(item); if (!b) continue;
    const dup=out.some(o=>{
      const ix=Math.max(0,Math.min(b.x+b.w,o.x+o.w)-Math.max(b.x,o.x));
      const iy=Math.max(0,Math.min(b.y+b.h,o.y+o.h)-Math.max(b.y,o.y));
      const inter=ix*iy, union=b.w*b.h+o.w*o.h-inter;
      return union>0 && inter/union>=iouThreshold;
    });
    if (!dup) out.push(b);
  }
  return out;
}

function buildGraph(rooms) {
  const nodes=[]; const edges=[];
  (rooms||[]).forEach((r,ri)=>{
    const rid=id('room', `${ri}:${r.name}:${JSON.stringify(r.floor)}`);
    nodes.push({id:rid,type:'room',name:r.name,confidence:clamp01(r.confidence),geometry:r.floor||null});
    const groups=[['wall',r.walls],['door',r.doors],['window',r.windows],['column',r.columns]];
    for (const [type,arr] of groups) {
      (arr||[]).forEach((b,ii)=>{
        const bid=id(type, `${rid}:${ii}:${JSON.stringify(b)}`);
        nodes.push({id:bid,type,geometry:b,confidence:clamp01(r.confidence),roomId:rid});
        edges.push({from:rid,to:bid,relation:'contains'});
      });
    }
  });
  // Opening -> nearest wall relationship; column -> containing room relationship.
  const walls=nodes.filter(n=>n.type==='wall'), openings=nodes.filter(n=>n.type==='door'||n.type==='window');
  for (const o of openings) {
    if (!o.geometry) continue;
    const p=center(o.geometry); let best=null,bd=Infinity;
    for (const w of walls) { if(!w.geometry) continue; const d=distancePointToBox(p,w.geometry); if(d<bd){bd=d;best=w;} }
    if(best && bd <= Math.max(o.geometry.w,o.geometry.h)*2.5) edges.push({from:o.id,to:best.id,relation:'hosted_by',distance:bd});
  }
  return {nodes,edges};
}

function normalizeRooms(parsed, pixelW, pixelH) {
  const roomsIn=Array.isArray(parsed?.rooms)?parsed.rooms:[];
  const rooms=[];
  roomsIn.slice(0,100).forEach((r,i)=>{
    const floor=box(r.floor);
    const clean={
      id:id('room',`${i}:${r.name}:${JSON.stringify(floor)}`),
      name:(typeof r.name==='string'&&r.name.trim()?r.name.trim():`Room ${i+1}`).slice(0,80),
      floor,
      walls:dedupeBoxes(r.walls), doors:dedupeBoxes(r.doors), windows:dedupeBoxes(r.windows), columns:dedupeBoxes(r.columns),
      confidence:clamp01(r.confidence),
      evidence:Array.isArray(r.evidence)?r.evidence.slice(0,8).map(String):[],
      uncertainty:Array.isArray(r.uncertainty)?r.uncertainty.slice(0,8).map(String):[],
    };
    if (floor && pixelW && pixelH) {
      const cx=floor.x+floor.w/2, cy=floor.y+floor.h/2;
      if(cx<0||cy<0||cx>pixelW||cy>pixelH) clean.uncertainty.push('room centroid outside drawing bounds');
    }
    if (!clean.floor && !clean.walls.length && !clean.doors.length) return;
    rooms.push(clean);
  });
  return rooms;
}

function analyze(parsed, meta={}) {
  const rooms=normalizeRooms(parsed, n(meta.pixelW), n(meta.pixelH));
  const graph=buildGraph(rooms);
  const counts={rooms:rooms.length,walls:0,doors:0,windows:0,columns:0};
  rooms.forEach(r=>{counts.walls+=r.walls.length;counts.doors+=r.doors.length;counts.windows+=r.windows.length;counts.columns+=r.columns.length;});
  const avg=rooms.length?rooms.reduce((s,r)=>s+r.confidence,0)/rooms.length:0;
  return {
    version:'1.0',
    summary: parsed?.summary || `Drawing intelligence found ${counts.rooms} rooms and ${counts.walls} wall runs.`,
    counts,
    confidence:{average:Math.round(avg*1000)/1000,band:avg>=.9?'high':avg>=.7?'review':'check'},
    rooms, graph,
    reviewQueue: rooms.flatMap(r=>r.uncertainty.map(reason=>({roomId:r.id,room:r.name,reason,priority:'medium'}))),
    assumptions:[
      'Bounding boxes are proposals, not surveyed quantities.',
      'Room floor boxes are treated as usable floor-area candidates and require QS verification.',
      'Opening-to-wall links are proximity-based unless the source model provides explicit topology.',
      'No unlabelled height or material is inferred as fact.'
    ]
  };
}

function createAgentPlan(document, goal='') {
  const elements=Array.isArray(document?.elements)?document.elements:[];
  const ai=elements.filter(e=>e && (e.source==='AI'||e.source==='AGENT'||e.method==='ai_detect'||e.method==='ai_agent'));
  const pending=ai.filter(e=>e.accepted!==true && e.reviewStatus!=='QS_REVIEWED' && e.reviewStatus!=='FINAL');
  const low=ai.filter(e=>clamp01(e.confidence||0)<.7);
  const actions=[];
  if (!document?.calibration?.factor && !(document?.calibrationFactor>0)) actions.push({type:'calibrate',priority:'high',reason:'Scale is not calibrated.'});
  if (pending.length) actions.push({type:'review_ai',priority:'high',count:pending.length,reason:'AI proposals require QS sign-off.'});
  if (low.length) actions.push({type:'inspect_low_confidence',priority:'medium',ids:low.slice(0,30).map(e=>e.id),reason:'Low-confidence proposals need inspection.'});
  if (!elements.length) actions.push({type:'analyze_drawing',priority:'high',reason:'No takeoff elements exist yet.'});
  if (goal) actions.push({type:'goal_check',priority:'low',goal:String(goal).slice(0,500),reason:'Verify generated takeoff covers the estimator goal.'});
  return {version:'1.0',goal:String(goal||''),readOnly:true,actions,stats:{elements:elements.length,ai:ai.length,pending:pending.length,lowConfidence:low.length}};
}

module.exports={box,normalizeRooms,buildGraph,analyze,createAgentPlan};
