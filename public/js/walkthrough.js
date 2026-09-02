(function(){
  try {
    var embed = /(?:\?|&)embed=1(?:&|$)/.test(location.search);
    if (embed) {
      document.documentElement.classList.add('embed');
      document.body.classList.add('embed');
    }
  } catch (_) {}
})();

/* extracted script block */

const stepsMeta = [
  {n:1, t:"Upload"},
  {n:2, t:"Calibrate"},
  {n:3, t:"AI analysis"},
  {n:4, t:"Review"},
  {n:5, t:"Rates"},
  {n:6, t:"Export"},
];
const stepperEl = document.getElementById('stepper');
stepsMeta.forEach(s=>{
  const el = document.createElement('div');
  el.className = 'step'; el.id = 'step'+s.n;
  el.innerHTML = `<div class="step-num">${s.n}</div><div class="step-title">${s.t}</div>`;
  stepperEl.appendChild(el);
});
const dotsnav = document.getElementById('dotsnav');
stepsMeta.forEach((s,i)=>{
  const b = document.createElement('button'); b.id='dot'+i; b.dataset.label = s.t;
  b.addEventListener('click', ()=>{ idx=i; paused=true; app.removeAttribute('data-theme'); document.getElementById('pauseBtn').textContent='▶ Resume'; clearTimeout(timer); playScene(idx); });
  dotsnav.appendChild(b);
});

const app = document.getElementById('app');
const leftPanel = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const viewerArea = document.getElementById('viewerArea');
const cursor = document.getElementById('cursor');
const clickRing = document.getElementById('clickRing');
const caption = document.getElementById('caption');
const tbScale = document.getElementById('tbScale');
const tbMeta = document.getElementById('tbMeta');
const progressfill = document.getElementById('progressfill');
const dragFile = document.getElementById('dragFile');
const themeBtn = document.getElementById('themeBtn');
themeBtn.addEventListener('click', ()=>{
  const dark = app.getAttribute('data-theme') === 'dark';
  if(dark){ app.removeAttribute('data-theme'); themeBtn.textContent='☾'; }
  else { app.setAttribute('data-theme','dark'); themeBtn.textContent='☀'; }
});

/* ---------- sound ---------- */
let audioCtx = null, muted = true; /* muted by default — no demo sound */
function beep(freq=680, dur=0.05, vol=0.05){
  if(muted) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  }catch(e){}
}
document.getElementById('muteBtn').textContent = '🔇';
document.getElementById('muteBtn').addEventListener('click', (e)=>{
  muted = !muted; e.target.textContent = muted ? '🔇' : '🔊';
});

/* ---------- speed control ---------- */
let speedMult = 1;
document.querySelectorAll('#speedgroup button').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('#speedgroup button').forEach(x=>x.classList.remove('on'));
    b.classList.add('on'); speedMult = parseFloat(b.dataset.speed);
    scheduleNext(true);
  });
});

/* ---------- count-up helper ---------- */
function countUp(el, from, to, ms, prefix='LKR '){
  const start = performance.now();
  function tick(t){
    const p = Math.min(1, (t-start)/ms);
    const eased = 1 - Math.pow(1-p, 3);
    const val = Math.round(from + (to-from)*eased);
    el.textContent = prefix + val.toLocaleString('en-US');
    if(p<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function setStepStates(activeIdx){
  stepsMeta.forEach((s,i)=>{
    const el = document.getElementById('step'+s.n);
    el.classList.remove('active','done');
    if(i<activeIdx) el.classList.add('done');
    else if(i===activeIdx) el.classList.add('active');
    document.getElementById('dot'+i).classList.toggle('on', i===activeIdx);
  });
}
function setCaption(html){
  caption.classList.remove('show');
  setTimeout(()=>{ caption.innerHTML = html; caption.classList.add('show'); }, 160);
}
function moveCursor(x,y,cb,delay=900){
  cursor.style.left = x+'px'; cursor.style.top = y+'px';
  setTimeout(()=>{
    clickRing.style.left = x+'px'; clickRing.style.top = y+'px';
    clickRing.classList.remove('go'); void clickRing.offsetWidth; clickRing.classList.add('go');
    beep(720, 0.045, 0.045);
    if(cb) cb();
  }, delay/speedMult);
}
/* Returns {x,y} of an element's center, in coordinates relative to #app
   (the positioning context shared by the cursor, click-ring and drag-file). */
function centerOf(el, offsetX, offsetY){
  const r = el.getBoundingClientRect();
  const a = app.getBoundingClientRect();
  return {
    x: r.left - a.left + (offsetX !== undefined ? offsetX : r.width/2),
    y: r.top - a.top + (offsetY !== undefined ? offsetY : r.height/2)
  };
}
/* Move the cursor to the center of a live DOM element (auto-converts coordinates). */
function moveCursorToEl(el, cb, delay=900, offsetX, offsetY){
  const p = centerOf(el, offsetX, offsetY);
  moveCursor(p.x, p.y, cb, delay);
}
/* Converts a point in an SVG's own viewBox units to #app-relative pixel coordinates
   (accounts for the SVG being scaled/positioned on the page). */
function svgPointToApp(svgEl, vx, vy){
  const vb = svgEl.viewBox.baseVal;
  const r = svgEl.getBoundingClientRect();
  const a = app.getBoundingClientRect();
  return {
    x: r.left - a.left + ((vx - vb.x) / vb.width) * r.width,
    y: r.top - a.top + ((vy - vb.y) / vb.height) * r.height
  };
}
function clear(){
  leftPanel.innerHTML=''; rightPanel.innerHTML='';
  viewerArea.innerHTML = '<div class="scan-line" id="scanLine"></div>';
  viewerArea.classList.remove('in');
  dragFile.classList.remove('show','drop');
}

const panelSVGWalls = `
  <rect x="10" y="10" width="380" height="270" fill="#fff" stroke="#DED5C2" stroke-width="1"/>
  <rect x="34" y="34" width="150" height="100" fill="none" stroke="#221F1C" stroke-width="3"/>
  <rect x="204" y="34" width="162" height="100" fill="none" stroke="#221F1C" stroke-width="3"/>
  <rect x="34" y="154" width="332" height="100" fill="none" stroke="#221F1C" stroke-width="3"/>
  <line x1="184" y1="34" x2="184" y2="134" stroke="#221F1C" stroke-width="3"/>
  <line x1="184" y1="154" x2="184" y2="254" stroke="#221F1C" stroke-width="1.5" stroke-dasharray="4 3" opacity=".4"/>
  <text x="60" y="90" font-family="Work Sans" font-size="11" fill="#6B6155" letter-spacing=".5">BEDROOM</text>
  <text x="234" y="90" font-family="Work Sans" font-size="11" fill="#6B6155" letter-spacing=".5">KITCHEN</text>
  <text x="150" y="210" font-family="Work Sans" font-size="11" fill="#6B6155" letter-spacing=".5">LIVING ROOM</text>
`;

function rightSummary({file='—', scale='Not calibrated', ai='Not yet', wall='—', slab='—', conc='—', open='—', elems='0', total='LKR 0'}={}){
  rightPanel.innerHTML = `
    <div class="eyebrow">Live summary</div>
    <div class="sum-block">
      <h4>Drawing</h4>
      <div class="sum-row"><span class="k">File</span><span class="v">${file}</span></div>
      <div class="sum-row"><span class="k">Scale</span><span class="v">${scale}</span></div>
      <div class="sum-row"><span class="k">AI run</span><span class="v">${ai}</span></div>
    </div>
    <div class="sum-block">
      <h4>Quantities</h4>
      <div class="sum-row"><span class="k">Wall face</span><span class="v">${wall}</span></div>
      <div class="sum-row"><span class="k">Floor / slab</span><span class="v">${slab}</span></div>
      <div class="sum-row"><span class="k">Concrete vol</span><span class="v">${conc}</span></div>
      <div class="sum-row"><span class="k">Openings</span><span class="v">${open}</span></div>
      <div class="sum-row"><span class="k">Elements on</span><span class="v">${elems}</span></div>
    </div>
    <div class="sum-block">
      <h4>Estimate</h4>
      <div class="sum-row"><span class="k">Grand total</span><span class="v hl">${total}</span></div>
    </div>
  `;
}

/* ---------- Scene 1: Upload ---------- */
function sceneUpload(){
  app.dataset.scene = 'upload';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 1 of 6</div>
    <div class="p-title">Upload floor plan</div>
    <div class="p-hint">Start with a legible architectural plan. MeasureCraft accepts PDF, PNG, and JPG files and preserves the drawing as the source of truth for every downstream quantity.</div>
    <div class="panel-note"><strong>Best input</strong>Use a high-contrast plan with visible room boundaries, dimensions, and a consistent orientation.</div>`;
  tbScale.textContent = 'Scale: not calibrated'; tbMeta.textContent = '0 elements';
  rightSummary({});
  viewerArea.innerHTML += `
    <div class="dropzone" id="dz">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"/></svg>
      <strong>Drop plan here or click to browse</strong>
      <p>PDF · PNG · JPG · max 25MB</p>
      <div class="file-chip" id="fc">✓ floor_plan.pdf attached</div>
    </div>`;
  setCaption("Step 1 — Add the source drawing so every later quantity can be traced back to the plan");
  const dz = document.getElementById('dz');
  const startPt = centerOf(app, 40, 40);      // top-left corner of the app, "outside" the drop zone
  const dropPt  = centerOf(dz);                // dead-center of the drop zone
  dragFile.classList.remove('show','drop');
  dragFile.style.left = startPt.x+'px'; dragFile.style.top = startPt.y+'px';
  cursor.style.left = startPt.x+'px'; cursor.style.top = startPt.y+'px';
  setTimeout(()=>{
    dragFile.classList.add('show');
    cursor.style.left = dropPt.x+'px'; cursor.style.top = dropPt.y+'px';
    dragFile.style.left = dropPt.x+'px'; dragFile.style.top = dropPt.y+'px';
    setTimeout(()=>{
      dz.classList.add('drag');
      dragFile.classList.add('drop');
      beep(560, 0.06, 0.05);
      setTimeout(()=>{
        dz.classList.remove('drag');
        document.getElementById('fc').classList.add('show');
        beep(900, 0.08, 0.05);
      }, 350/speedMult);
    }, 950/speedMult);
  }, 250/speedMult);
}

/* ---------- Scene 2: Calibrate ---------- */
function sceneCalibrate(){
  app.dataset.scene = 'calibrate';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 2 of 6</div>
    <div class="p-title">Calibrate scale</div>
    <div class="p-hint">Set the drawing scale by selecting two points on a known wall or dimension line. Enter the real-world distance so pixel measurements can be converted into metres.</div>
    <div class="panel-note"><strong>Why it matters</strong>Calibration is the control that makes every detected length and area measurable rather than merely visual.</div>`;
  tbScale.textContent = 'Scale: not calibrated'; tbMeta.textContent = '0 elements';
  rightSummary({file:'floor_plan.pdf'});
  viewerArea.innerHTML += `
    <div class="calibrate-banner" id="banner">Click the start point of a known length</div>
    <div class="plan-wrap">
      <svg viewBox="0 0 400 290">${panelSVGWalls}
        <circle id="d1" class="ruler-dot" cx="34" cy="34" r="5" opacity="0"/>
        <circle id="d2" class="ruler-dot" cx="184" cy="34" r="5" opacity="0"/>
        <line id="rl" class="ruler-line" x1="34" y1="34" x2="34" y2="34"/>
      </svg>
      <div class="len-popover" id="lp" style="top:6%; left:34%;">Length = <b>4.00 m</b></div>
    </div>`;
  setCaption("Step 2 — Calibrate once, then let the workspace convert pixels into real-world dimensions");
  const svgEl = viewerArea.querySelector('.plan-wrap svg');
  const p1 = svgPointToApp(svgEl, 34, 34);
  const p2 = svgPointToApp(svgEl, 184, 34);
  document.getElementById('banner').classList.add('show');
  moveCursor(p1.x, p1.y, ()=>{
    document.getElementById('d1').setAttribute('opacity',1);
    document.getElementById('banner').textContent = 'Now click the end point';
    moveCursor(p2.x, p2.y, ()=>{
      document.getElementById('d2').setAttribute('opacity',1);
      document.getElementById('rl').setAttribute('x2','184');
      document.getElementById('rl').classList.add('show');
      document.getElementById('banner').classList.remove('show');
      setTimeout(()=>{
        document.getElementById('lp').classList.add('show');
        tbScale.textContent = 'Scale: 1px = 0.032m';
        rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓'});
      }, 400);
    }, 800);
  }, 700);
}

/* ---------- Scene 3: AI analysis ---------- */
function sceneAI(){
  app.dataset.scene = 'ai';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 3 of 6</div>
    <div class="p-title">AI analysis</div>
    <div class="p-hint">The analysis pass interprets the calibrated geometry and proposes measurable elements such as walls, slabs, doors, windows, and columns.</div>
    <div class="p-hint" style="margin-top:10px;"><span id="aiStatus" style="font-weight:600;color:var(--brass-h)">Analyzing drawing…</span></div>
    <div class="panel-note"><strong>Human in the loop</strong>AI proposes geometry; the review step remains the approval gate before quantities are priced.</div>`;
  tbScale.textContent = 'Scale: 1px = 0.032m'; tbMeta.textContent = '0 elements';
  rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Running…'});
  viewerArea.innerHTML += `
    <div class="plan-wrap">
      <svg viewBox="0 0 400 290">${panelSVGWalls}</svg>
      <div class="det-box" id="b1" style="top:11%;left:8.5%;width:37.5%;height:35%;"><div class="tag">Wall · 6.2m</div></div>
      <div class="det-box" id="b2" style="top:11%;left:51%;width:40.5%;height:35%;"><div class="tag">Wall · 5.8m</div></div>
      <div class="det-box" id="b3" style="top:53%;left:8.5%;width:83%;height:35%;"><div class="tag">Slab · 33.2m²</div></div>
      <div class="det-box door" id="b4" style="top:14%;left:44.5%;width:3.5%;height:29%;"><div class="tag">Door</div></div>
    </div>`;
  document.getElementById('scanLine').classList.add('run');
  /* No zoom-pulse scale — keeps drawing size stable during AI analysis */
  setCaption("Step 3 — Let AI propose <b>measurable building elements</b> while the drawing stays visible");
  setTimeout(()=>{
    ['b1','b2','b3','b4'].forEach((id,i)=> setTimeout(()=>{ document.getElementById(id).classList.add('show'); beep(760+i*40,0.04,0.035); }, i*260/speedMult));
    setTimeout(()=>{
      document.getElementById('aiStatus').innerHTML = '<span style="color:var(--success)">Complete — 14 elements found ✓</span>';
      tbMeta.textContent = '14 elements';
      rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓'});
      beep(1000,0.1,0.05);
    }, 1500/speedMult);
  }, 300/speedMult);
}

/* ---------- Scene 4: Review ---------- */
function sceneReview(){
  app.dataset.scene = 'review';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 4 of 6</div>
    <div class="p-title">Review elements</div>
    <div class="p-hint">Validate the proposed elements before they enter the takeoff. Each item can be accepted, corrected, retyped, resized, or removed when the drawing requires a human judgement.</div>
    <div class="panel-note"><strong>Quality check</strong>Reviewing detections protects the estimate from omitted openings, duplicate geometry, and incorrect element types.</div>`;
  tbScale.textContent = 'Scale: 1px = 0.032m'; tbMeta.textContent = '14 elements';
  rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓', elems:'0 / 14'});
  const rows = [
    ['Wall — Exterior North','6.2m'],['Wall — Exterior East','5.8m'],
    ['Slab — Ground floor','33.2m²'],['Door — D1','0.9m'],['Column — C1','0.23×0.23m'],
  ];
  viewerArea.innerHTML += `<div class="elem-list" id="elemList">${rows.map((r,i)=>`
    <div class="elem-row" id="er${i}">
      <span><span class="nm">${r[0]}</span><span class="dim">${r[1]}</span></span>
      <span class="check" id="ck${i}">✓</span>
    </div>`).join('')}</div>`;
  setCaption("Step 4 — Approve the geometry before it becomes a priced quantity");
  rows.forEach((r,i)=>{
    setTimeout(()=>{
      document.getElementById('er'+i).classList.add('show');
      moveCursorToEl(document.getElementById('ck'+i), ()=>{
        document.getElementById('ck'+i).classList.add('on');
        rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓', elems:(i+1)+' / 14'});
      }, 260);
    }, i*520 + 300);
  });
}

/* ---------- Scene 5: Rates ---------- */
function sceneRates(){
  app.dataset.scene = 'rates';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 5 of 6</div>
    <div class="p-title">Quantities & rates</div>
    <div class="p-hint">Apply project-specific unit rates to the approved quantities. Rates are kept separate from measured geometry so the same takeoff can be repriced without redrawing.</div>
    <div class="panel-note"><strong>Pricing logic</strong>Quantity × unit rate produces each line value; the estimate rolls up to a single transparent grand total.</div>`;
  tbScale.textContent = 'Scale: 1px = 0.032m'; tbMeta.textContent = '14 elements';
  rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓', elems:'14 / 14',
    wall:'142.0 m²', slab:'96.4 m²', conc:'18.2 m³', open:'9 nr', total:'LKR 0'});
  viewerArea.innerHTML += `
    <div class="rate-table">
      <div class="rate-row"><span class="nm">Wall face (m²)</span><span class="val">142.0 × <input class="rate-input" id="ri1" value="2,450"></span></div>
      <div class="rate-row"><span class="nm">Floor / slab (m²)</span><span class="val">96.4 × <input class="rate-input" id="ri2" value="3,100"></span></div>
      <div class="rate-row"><span class="nm">Concrete vol (m³)</span><span class="val">18.2 × <input class="rate-input" id="ri3" value="42,000"></span></div>
      <div class="rate-row"><span class="nm">Openings (nr)</span><span class="val">9 × <input class="rate-input" id="ri4" value="18,500"></span></div>
      <div class="total-strip" id="tb"><span class="lbl">Grand total</span><span class="amt">LKR 1,577,640</span></div>
    </div>`;
  setCaption("Step 5 — Keep measurement and pricing separate, then reprice without redrawing");
  document.querySelectorAll('.rate-input').forEach(input=>input.addEventListener('input', ()=>{
    const rates = [...document.querySelectorAll('.rate-input')].map(x=>parseFloat(x.value.replace(/,/g,''))||0);
    const total = Math.round(142*rates[0] + 96.4*rates[1] + 18.2*rates[2] + 9*rates[3]);
    document.querySelector('#tb .amt').textContent = 'LKR ' + total.toLocaleString('en-US');
    const totalRow = document.querySelector('.sum-row .v.hl');
    if(totalRow) totalRow.textContent = 'LKR ' + total.toLocaleString('en-US');
  }));
  moveCursorToEl(document.getElementById('ri3'), ()=>{
    document.getElementById('ri3').classList.add('focus');
    beep(650, 0.04, 0.03);
    setTimeout(()=>{
      document.getElementById('tb').classList.add('show');
      const amtEl = document.querySelector('#tb .amt');
      countUp(amtEl, 0, 1577640, 900/speedMult, 'LKR ');
      rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓', elems:'14 / 14',
        wall:'142.0 m²', slab:'96.4 m²', conc:'18.2 m³', open:'9 nr'});
      setTimeout(()=>{
        const v = document.querySelectorAll('.sum-row .v.hl')[0];
        if(v) countUp(v, 0, 1577640, 900/speedMult, 'LKR ');
      }, 50);
    }, 500/speedMult);
  }, 700);
}

/* ---------- Scene 6: Export ---------- */
function sceneExport(){
  app.dataset.scene = 'export';
  clear();
  leftPanel.innerHTML = `
    <div class="eyebrow">Step 6 of 6</div>
    <div class="p-title">Report & export</div>
    <div class="p-hint">Export a structured Bill of Quantities with quantities, rates, totals, and the element list. The result is ready for client review, contractor pricing, or internal cost checks.</div>
    <div class="panel-note"><strong>Handoff</strong>Keep the exported BOQ with the calibrated source drawing so the estimate remains auditable.</div>`;
  tbScale.textContent = 'Scale: 1px = 0.032m'; tbMeta.textContent = '14 elements';
  rightSummary({file:'floor_plan.pdf', scale:'Calibrated ✓', ai:'Complete ✓', elems:'14 / 14',
    wall:'142.0 m²', slab:'96.4 m²', conc:'18.2 m³', open:'9 nr', total:'LKR 1,577,640'});
  viewerArea.innerHTML += `
    <div class="export-card" id="ec">
      <div class="xicon">XL</div>
      <div class="fn">BOQ_Untitled_Project.xlsx</div>
      <div class="fn2">Quantities · Rates · Grand total · Element list</div>
      <button class="dl-btn" id="db">⬇ Download Excel BOQ</button>
    </div>`;
  setCaption("Step 6 — Export a structured <b>Excel BOQ</b> for review, pricing, and handoff");
  document.getElementById('ec').classList.add('show');
  setTimeout(()=>{
    moveCursorToEl(document.getElementById('db'), ()=>{
      document.getElementById('db').classList.add('show');
      beep(1100, 0.09, 0.05);
    }, 500);
  }, 300/speedMult);
}

const scenes = [sceneUpload, sceneCalibrate, sceneAI, sceneReview, sceneRates, sceneExport];
const SCENE_MS = [3400, 4600, 3600, 3800, 3600, 3000];
let idx = 0, paused = false, timer = null, raf = null;

function playScene(i){
  setStepStates(i);
  scenes[i]();
  animateProgress(SCENE_MS[i]/speedMult);
}
function animateProgress(duration){
  const start = performance.now();
  cancelAnimationFrame(raf);
  function tick(t){
    if(paused){ raf = requestAnimationFrame(tick); return; }
    const elapsed = t-start;
    progressfill.style.width = Math.min(100,(elapsed/duration)*100)+'%';
    if(elapsed < duration) raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);
}
function scheduleNext(resetOnly){
  clearTimeout(timer);
  if(resetOnly){
    // speed changed mid-scene: just re-time remaining loop from now
    timer = setTimeout(()=>{
      if(!paused){ idx = (idx+1)%scenes.length; playScene(idx); }
      scheduleNext();
    }, SCENE_MS[idx]/speedMult);
    return;
  }
  timer = setTimeout(()=>{
    if(!paused){ idx = (idx+1)%scenes.length; playScene(idx); }
    scheduleNext();
  }, SCENE_MS[idx]/speedMult);
}
function startLoop(){ clearTimeout(timer); playScene(idx); scheduleNext(); }

document.getElementById('replayBtn').addEventListener('click', ()=>{
  idx = 0; paused = false; app.removeAttribute('data-theme');
  document.getElementById('pauseBtn').textContent = '⏸ Pause'; startLoop();
});
document.getElementById('pauseBtn').addEventListener('click', (e)=>{
  paused = !paused; e.target.textContent = paused ? '▶ Resume' : '⏸ Pause';
});

document.querySelectorAll('.controls button, .dotsnav button, .hbtn').forEach(btn=>{
  btn.addEventListener('focus', ()=>btn.style.outline='3px solid var(--brass-soft)');
  btn.addEventListener('blur', ()=>btn.style.outline='');
});

/* keyboard shortcuts */
document.addEventListener('keydown', (e)=>{
  if(e.code === 'Space'){
    e.preventDefault();
    paused = !paused;
    document.getElementById('pauseBtn').textContent = paused ? '▶ Resume' : '⏸ Pause';
  } else if(e.code === 'ArrowRight'){
    idx = (idx+1)%scenes.length; paused = true;
    document.getElementById('pauseBtn').textContent = '▶ Resume';
    clearTimeout(timer); playScene(idx);
  } else if(e.code === 'ArrowLeft'){
    idx = (idx-1+scenes.length)%scenes.length; paused = true;
    document.getElementById('pauseBtn').textContent = '▶ Resume';
    clearTimeout(timer); playScene(idx);
  } else if(e.key === 'm' || e.key === 'M'){
    muted = !muted; document.getElementById('muteBtn').textContent = muted ? '🔇' : '🔊';
  }
});

startLoop();
