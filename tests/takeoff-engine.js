'use strict';
const { createSuite } = require('./_harness');
const E = require('../core/takeoff-engine');
const { TOOLS, execute } = require('../core/tool-registry');
const t = createSuite('takeoff engine / agent tools');

t.test('confidence bands normalize percentages and decimals', () => {
  t.assert.strictEqual(E.confidenceBand(95).level, 'high');
  t.assert.strictEqual(E.confidenceBand(0.75).level, 'medium');
  t.assert.strictEqual(E.confidenceBand(40).level, 'low');
});
t.test('AI pending elements are not costing eligible', () => {
  t.assert.strictEqual(E.costingEligible({source:'AI',reviewStatus:'AI_GENERATED',accepted:false}), false);
  t.assert.strictEqual(E.costingEligible({source:'AI',reviewStatus:'QS_REVIEWED',accepted:true}), true);
});
t.test('summary separates pending AI from eligible quantities', () => {
  const els=[
    {id:1,type:'wall',isLine:true,length:10,source:'MANUAL',accepted:true,reviewStatus:'MANUAL'},
    {id:2,type:'wall',isLine:true,length:5,source:'AI',accepted:false,reviewStatus:'AI_GENERATED'},
    {id:3,type:'wall',isLine:true,length:4,source:'AI',accepted:true,reviewStatus:'QS_REVIEWED'},
  ];
  const s=E.summarize(els,1);
  t.assert.strictEqual(s.aiPendingReview,1);
  t.assert.strictEqual(s.costingEligible,2);
  t.almostEqual(s.totalsByUnit.m,14);
});
t.test('validation catches duplicate ids and invalid calibration', () => {
  const r=E.validateDocument({calibration:{factor:0},elements:[{id:1},{id:1}]});
  t.assert.strictEqual(r.valid,false);
  t.assert.ok(r.errors>=2);
});
t.test('agent registry exposes read and proposal tools', () => {
  t.assert.ok(TOOLS.some(x=>x.name==='validate_document'&&!x.write));
  const r=execute('propose_add_elements',{}, {elements:[{type:'wall'}]});
  t.assert.strictEqual(r.requiresReview,true);
  t.assert.strictEqual(r.operation,'add_elements');
});
t.done();
