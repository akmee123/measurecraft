/** Browser-side AI orchestration facade. Network calls are read-only until a QS review action is invoked. */
(function(root){
  'use strict';
  function headers(){
    var h={'Content-Type':'application/json'};
    try{
      var sr=sessionStorage.getItem('mc-session')||localStorage.getItem('mc-session');
      var ss=sr?JSON.parse(sr):null;
      var t=(ss&&ss.apiToken)||localStorage.getItem('mc_token')||localStorage.getItem('mcToken');
      if(t)h.Authorization='Bearer '+t;
      var mt=localStorage.getItem('mc-api-token')||localStorage.getItem('mc_api_token')||sessionStorage.getItem('mc-api-token');
      if(mt)h['X-MC-Token']=mt;
    }catch(_){}
    return h;
  }
  async function post(path,body){
    var r=await fetch(path,{method:'POST',headers:headers(),body:JSON.stringify(body||{})});
    var d=await r.json().catch(function(){return {};});
    if(!r.ok||d.success===false) throw new Error(d.error||('HTTP '+r.status));
    return d;
  }
  async function analyze(imageBase64,mime,w,h,goal){return post('/api/agent/analyze',{image_base64:imageBase64,mime_type:mime||'image/jpeg',pixel_w:w,pixel_h:h,goal:goal||''});}
  async function plan(document,goal){return post('/api/agent/plan',{document:document||{},goal:goal||''});}
  function graph(args){
    args=args||{}; var rooms=Array.isArray(args.rooms)?args.rooms:[]; var nodes=[],edges=[];
    rooms.forEach(function(r,i){var rid='room-'+i;nodes.push({id:rid,type:'room',name:r.name||('Room '+(i+1))});['walls','doors','windows','columns'].forEach(function(k){(r[k]||[]).forEach(function(_,j){var id=k.slice(0,-1)+'-'+i+'-'+j;nodes.push({id:id,type:k.slice(0,-1),roomId:rid});edges.push({from:rid,to:id,relation:'contains'});});});});
    return {version:'browser-1',nodes:nodes,edges:edges};
  }
  root.MCIntelligence={analyze:analyze,plan:plan,graph:graph,post:post};
}(typeof window!=='undefined'?window:this));
