/** MeasureCraft document validation + review gate. */
(function (root) {
  'use strict';
  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function ai(el) { return !!el && (el.source === 'AI' || el.source === 'AGENT' || el.method === 'ai_detect' || el.method === 'ai_agent' || el.reviewStatus === 'AI_GENERATED'); }
  function validate(doc) {
    var d=doc||{}, els=Array.isArray(d.elements)?d.elements:[], issues=[], ids={};
    var cf=d.calibration&&d.calibration.factor!=null?Number(d.calibration.factor):Number(d.calibrationFactor);
    if(!Number.isFinite(cf)||cf<=0) issues.push({severity:'error',code:'invalid_calibration',message:'Calibration factor must be finite and positive.'});
    els.forEach(function(el,i){
      if(!el||typeof el!=='object'){issues.push({severity:'error',code:'invalid_element',index:i,message:'Invalid element.'});return;}
      var id=el.id!=null?String(el.id):''; if(!id)issues.push({severity:'error',code:'missing_id',index:i,message:'Element is missing an id.'}); else if(ids[id])issues.push({severity:'error',code:'duplicate_id',id:id,index:i,message:'Duplicate element id: '+id}); else ids[id]=true;
      ['x','y','w','h','length','thickness'].forEach(function(k){if(el[k]!=null&&!finite(Number(el[k])))issues.push({severity:'error',code:'non_finite_geometry',id:id,field:k,message:k+' must be finite.'});});
      if(Array.isArray(el.vertices))el.vertices.forEach(function(p,pi){if(!p||!finite(Number(p.x))||!finite(Number(p.y)))issues.push({severity:'error',code:'invalid_vertex',id:id,vertex:pi,message:'Vertex coordinates must be finite.'});});
      if(ai(el)&&el.reviewStatus==='AI_GENERATED'&&el.accepted!==true)issues.push({severity:'warning',code:'ai_pending_review',id:id,message:'AI proposal requires QS review before costing/export.'});
      if(el.confidence!=null&&!Number.isFinite(Number(el.confidence)))issues.push({severity:'warning',code:'invalid_confidence',id:id,message:'Confidence is not numeric.'});
    });
    var errors=issues.filter(function(x){return x.severity==='error';}).length, warnings=issues.length-errors;
    return {valid:errors===0,errors:errors,warnings:warnings,issues:issues};
  }
  root.MCValidation={validate:validate};
}(typeof window!=='undefined'?window:this));
