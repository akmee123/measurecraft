'use strict';
const assert=require('assert');
const di=require('../core/drawing-intelligence');
const result=di.analyze({summary:'x',rooms:[{name:'Office',floor:{x:10,y:10,w:100,h:80},confidence:.92,evidence:['room label Office'],uncertainty:[],walls:[{x:10,y:10,w:100,h:4},{x:10,y:86,w:100,h:4}],doors:[{x:50,y:10,w:10,h:4}],windows:[{x:20,y:86,w:20,h:4}],columns:[{x:15,y:15,w:8,h:8}]}]},{pixelW:200,pixelH:200});
assert.equal(result.counts.rooms,1); assert.equal(result.counts.walls,2); assert.equal(result.counts.doors,1); assert.equal(result.graph.nodes.length,6); assert(result.graph.edges.some(e=>e.relation==='hosted_by'));
const plan=di.createAgentPlan({elements:[{id:1,type:'wall',source:'AGENT',reviewStatus:'AI_GENERATED',accepted:false,confidence:.5}],calibrationFactor:1},'walls');
assert(plan.actions.some(a=>a.type==='review_ai')); assert(plan.actions.some(a=>a.type==='inspect_low_confidence'));
console.log('drawing-intelligence tests passed');
