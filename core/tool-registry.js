'use strict';
const engine = require('./takeoff-engine');
const drawingIntelligence = require('./drawing-intelligence');
const agentOrchestrator = require('./agent-orchestrator');

const TOOLS = [
  { name:'get_document_summary', description:'Deterministic quantity/review summary for a MeasureCraft document.', write:false },
  { name:'validate_document', description:'Validate document schema-adjacent integrity, calibration, geometry and AI review gates.', write:false },
  { name:'find_elements', description:'Find takeoff elements by text, type, source, review status or acceptance.', write:false },
  { name:'get_element', description:'Read one takeoff element by id.', write:false },
  { name:'propose_add_elements', description:'Create an explicit AI proposal payload; proposals remain unaccepted until QS review.', write:true },
  { name:'propose_update_elements', description:'Create an explicit element patch proposal; geometry writes remain reviewable.', write:true },
  { name:'create_agent_plan', description:'Build a read-only next-action plan from the current document.', write:false },
  { name:'build_drawing_graph', description:'Build deterministic room/element relationships from AI drawing proposals.', write:false },
  { name:'orchestrate_ai_takeoff', description:'Normalize vision output into auditable AI proposals, run deterministic relationship checks, and produce a QS review queue.', write:true },
];

function execute(name, document, args={}) {
  if (name === 'get_document_summary') return engine.summarize(document && document.elements, document && document.calibration ? document.calibration.factor : document && document.calibrationFactor);
  if (name === 'validate_document') return engine.validateDocument(document);
  if (name === 'find_elements') return engine.findElements(document && document.elements, args);
  if (name === 'get_element') {
    const id = String(args.id);
    return (document && Array.isArray(document.elements) ? document.elements : []).find(e => e && String(e.id) === id) || null;
  }
  if (name === 'propose_add_elements') return { requiresReview:true, operation:'add_elements', elements:Array.isArray(args.elements)?args.elements:[] };
  if (name === 'propose_update_elements') return { requiresReview:true, operation:'update_elements', updates:Array.isArray(args.updates)?args.updates:[] };
  if (name === 'create_agent_plan') return drawingIntelligence.createAgentPlan(document, args.goal || '');
  if (name === 'build_drawing_graph') return drawingIntelligence.analyze({ rooms: Array.isArray(args.rooms) ? args.rooms : [] }, { pixelW: args.pixelW, pixelH: args.pixelH });
  if (name === 'orchestrate_ai_takeoff') return agentOrchestrator.orchestrate(args.analysis || {}, { pixelW: args.pixelW, pixelH: args.pixelH, calibrated: args.calibrated });
  throw new Error('Unknown tool: ' + name);
}

module.exports = { TOOLS, execute };
