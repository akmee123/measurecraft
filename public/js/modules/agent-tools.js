/**
 * MeasureCraft Agent Tool Registry.
 * Read tools are always safe; write tools return proposals for QS confirmation.
 */
(function (root) {
  'use strict';
  var tools = {};
  function register(name, description, handler, opts) { tools[name]={name:name,description:description,handler:handler,write:!!(opts&&opts.write)}; }
  register('get_document_summary','Summarize quantities, review state and AI status.',function(ctx){return root.MCTakeoffEngine.summarize(ctx.elements,ctx.calibrationFactor);});
  register('validate_document','Validate calibration, geometry, IDs and AI review gates.',function(ctx){return root.MCValidation.validate(ctx.document||ctx);});
  register('list_elements','List takeoff elements with optional type/status/source filters.',function(ctx,args){var list=Array.isArray(ctx.elements)?ctx.elements:[];args=args||{};return list.filter(function(e){if(args.type&&String(e.type)!==String(args.type))return false;if(args.reviewStatus&&String(e.reviewStatus)!==String(args.reviewStatus))return false;if(args.source&&String(e.source)!==String(args.source))return false;return true;});});
  register('propose_add_elements','Prepare AI-agent elements. Proposals are not accepted automatically.',function(ctx,args){return {requiresReview:true,operation:'add_elements',elements:(args&&args.elements)||[]};},{write:true});
  register('create_agent_plan','Build a read-only action plan from the current document.',function(ctx,args){return root.MCIntelligence && root.MCIntelligence.plan ? root.MCIntelligence.plan(ctx,args||{}) : {error:'Drawing intelligence module not loaded'};});
  register('build_drawing_graph','Build relationships between rooms and detected elements.',function(ctx,args){return root.MCIntelligence && root.MCIntelligence.graph ? root.MCIntelligence.graph(args||{}) : {error:'Drawing intelligence module not loaded'};});
  register('propose_update_elements','Prepare patches to existing elements. A QS must approve the mutation.',function(ctx,args){return {requiresReview:true,operation:'update_elements',updates:(args&&args.updates)||[]};},{write:true});
  function list(){return Object.keys(tools).map(function(k){var t=tools[k];return {name:t.name,description:t.description,write:t.write};});}
  function call(name,ctx,args){if(!tools[name])throw new Error('Unknown tool: '+name);return tools[name].handler(ctx||{},args||{});}
  root.MCAgentTools={register:register,list:list,call:call};
}(typeof window!=='undefined'?window:this));
