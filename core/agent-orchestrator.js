'use strict';
/**
 * MeasureCraft Agent Orchestrator v1.6
 * Deterministic orchestration around vision proposals.
 * The model proposes; this module normalizes, validates, scores and stages.
 */
const crypto = require('crypto');
const intelligence = require('./drawing-intelligence');

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}
function hash(v) { return crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12); }
function safeBox(b) {
  if (!b || typeof b !== 'object') return null;
  const x=Number(b.x),y=Number(b.y),w=Number(b.w),h=Number(b.h);
  if (![x,y,w,h].every(Number.isFinite) || w<=1 || h<=1) return null;
  return {x,y,w,h};
}
function center(b) { return {x:b.x+b.w/2,y:b.y+b.h/2}; }
function near(a,b,pad=0) {
  return a.x-pad < b.x+b.w && a.x+a.w+pad > b.x && a.y-pad < b.y+b.h && a.y+a.h+pad > b.y;
}
function sourceMeta(room, kind, index) {
  return { method:'ai_vision', actor:'ai_agent', confidence:clamp01(room.confidence), evidence:room.evidence||[], uncertainty:room.uncertainty||[], roomName:room.name, detectionIndex:index, kind };
}
function elementFromBox(type, b, room, i) {
  const box=safeBox(b); if(!box) return null;
  const id='ai-'+type+'-'+hash([room.id||room.name,i,box]);
  const line = type==='wall' || type==='beam';
  const length = line ? Math.max(box.w,box.h) : null;
  return {
    id,type,x:box.x,y:box.y,w:box.w,h:box.h,
    label:`AI ${type} · ${room.name}`,
    ai:true,source:'AI',method:'ai_vision',accepted:false,reviewStatus:'AI_GENERATED',
    confidence:clamp01(room.confidence),locked:false,hidden:false,
    isLine:line,length,
    quantityBasis: line ? 'length' : (type==='floor' || type==='slab' ? 'area' : 'count'),
    roomName:room.name, roomId:room.id || null,
    intelligence:{...sourceMeta(room,type,i)},
    provenance:{method:'ai_vision',actor:'ai_agent',createdAt:new Date().toISOString(),source:'drawing',geometry:{x:box.x,y:box.y,w:box.w,h:box.h},confidence:clamp01(room.confidence),editCount:0}
  };
}

function buildProposals(intel) {
  const elements=[];
  for (const room of intel.rooms || []) {
    const floor = elementFromBox('floor', room.floor, room, 0);
    if (floor) elements.push(floor);
    for (const type of ['wall','door','window','column']) {
      const arr=Array.isArray(room[type+'s']) ? room[type+'s'] : [];
      arr.forEach((b,i)=>{ const e=elementFromBox(type,b,room,i); if(e) elements.push(e); });
    }
  }
  return elements;
}

function relationshipChecks(elements) {
  const issues=[];
  const walls=elements.filter(e=>e.type==='wall');
  const rooms=elements.filter(e=>e.type==='floor');
  for (const e of elements) {
    if (!Number.isFinite(e.confidence) || e.confidence < .7) issues.push({severity:'warning',code:'low_confidence',elementId:e.id,message:'AI confidence below 0.70.'});
    if ((e.type==='door'||e.type==='window') && walls.length) {
      const c=center(e); let best=Infinity;
      for(const w of walls){ const wc=center(w); best=Math.min(best,Math.hypot(c.x-wc.x,c.y-wc.y)); }
      if(best > Math.max(e.w,e.h)*4) issues.push({severity:'warning',code:'opening_unhosted',elementId:e.id,message:'Opening is not near a detected wall.'});
    }
    if (e.type==='floor' && rooms.length>1) {
      const overlaps=rooms.filter(r=>r.id!==e.id && near(e,r,-1)).length;
      if(overlaps) issues.push({severity:'warning',code:'room_overlap',elementId:e.id,message:'Floor candidate overlaps another room candidate.'});
    }
  }
  return issues;
}

function orchestrate(parsed, meta={}) {
  const intel=intelligence.analyze(parsed,meta);
  const proposals=buildProposals(intel);
  const checks=relationshipChecks(proposals);
  const highRisk=new Set(checks.filter(x=>x.severity!=='info').map(x=>x.elementId));
  proposals.forEach(e=>{
    const reasons=[];
    if(e.confidence<.7) reasons.push('low confidence');
    if(highRisk.has(e.id)) reasons.push('relationship validation issue');
    e.reviewPriority = reasons.length ? 'high' : (e.confidence<.9 ? 'medium' : 'low');
    e.intelligence.validation = reasons.length ? reasons : ['passed deterministic preflight'];
  });
  const reviewQueue=proposals.filter(e=>e.reviewPriority!=='low').map(e=>({elementId:e.id,type:e.type,room:e.roomName,priority:e.reviewPriority,reasons:e.intelligence.validation}));
  return {
    version:'1.6',
    mode:'proposal_only',
    summary:intel.summary,
    intelligence:intel,
    proposals,
    preflight:{valid:checks.every(x=>x.severity!=='error'),issues:checks},
    reviewQueue,
    nextActions:[
      ...(meta.calibrated===false?[{type:'calibrate',priority:'high'}]:[]),
      ...(proposals.length?[{type:'qs_review',priority:'high',count:proposals.length}]:[{type:'retry_analysis',priority:'high'}]),
      ...(reviewQueue.length?[{type:'inspect_flagged',priority:'medium',count:reviewQueue.length}]:[])
    ]
  };
}

module.exports={orchestrate,buildProposals,relationshipChecks};
