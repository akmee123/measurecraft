/* Browser adapter for the deterministic MeasureCraft takeoff core. */
(function (root) {
  'use strict';
  function num(v, fallback) { var n = Number(v); return Number.isFinite(n) ? n : (fallback == null ? null : fallback); }
  function clamp01(v) { var n = num(v); if (n == null) return null; return Math.max(0, Math.min(1, n > 1 ? n / 100 : n)); }
  function isAi(el) { return !!el && (el.source === 'AI' || el.source === 'AGENT' || el.method === 'ai_detect' || el.method === 'ai_agent' || el.reviewStatus === 'AI_GENERATED'); }
  function costingEligible(el) { if (!el || el.hidden || el.reviewStatus === 'REJECTED' || el.accepted === false) return false; return !isAi(el) || el.accepted === true || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL'; }
  function confidenceBand(v) { var c = clamp01(v); if (c == null) return { value:null,label:'Unknown',level:'unknown' }; if(c>=.9)return{value:c,label:'High',level:'high'}; if(c>=.7)return{value:c,label:'Review',level:'medium'}; return{value:c,label:'Check',level:'low'}; }
  function quantity(el, cf) {
    cf = num(cf, 1); if (!el || !Number.isFinite(cf) || cf <= 0) return null;
    var type = String(el.type || '').toLowerCase(), len = num(el.length), w = num(el.w), h = num(el.h), t = num(el.thickness);
    if (len != null && (el.isLine || type === 'wall' || type === 'beam' || type === 'deduct')) return { gross:Math.abs(len)*cf, unit:'m', basis:'length' };
    if (w != null && h != null && ['slab','opening','floor','area'].indexOf(type)>=0) return { gross:Math.abs(w*h)*cf*cf, unit:'m²', basis:'area' };
    if (w != null && h != null && t != null && ['column','beam_volume','concrete'].indexOf(type)>=0) return { gross:Math.abs(w*h*t)*Math.pow(cf,3), unit:'m³', basis:'volume' };
    if (type === 'count' || type === 'opening_count') return {gross:1,unit:'nr',basis:'count'};
    return null;
  }
  function summarize(elements, cf) {
    var out={elementCount:0,costingEligible:0,aiElements:0,aiPendingReview:0,aiCorrected:0,rejected:0,byType:{},totalsByUnit:{},reviewReady:true};
    (Array.isArray(elements)?elements:[]).forEach(function(el){if(!el)return;out.elementCount++;if(isAi(el))out.aiElements++;if(el.reviewStatus==='REJECTED')out.rejected++;if(isAi(el)&&el.accepted!==true&&el.reviewStatus!=='QS_REVIEWED'&&el.reviewStatus!=='FINAL'){out.aiPendingReview++;out.reviewReady=false;}if(isAi(el)&&el.provenance&&el.provenance.editCount>0)out.aiCorrected++;var q=quantity(el,cf);if(!q||!costingEligible(el))return;out.costingEligible++;var typ=String(el.type||'unknown');out.byType[typ]=out.byType[typ]||{count:0,quantities:{}};out.byType[typ].count++;out.byType[typ].quantities[q.unit]=(out.byType[typ].quantities[q.unit]||0)+q.gross;out.totalsByUnit[q.unit]=(out.totalsByUnit[q.unit]||0)+q.gross;});
    return out;
  }
  root.MCTakeoffEngine = { num:num, clamp01:clamp01, confidenceBand:confidenceBand, isAi:isAi, costingEligible:costingEligible, elementQuantity:quantity, summarize:summarize };
}(typeof window !== 'undefined' ? window : this));
