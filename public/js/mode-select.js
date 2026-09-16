(function () {
            const strip = document.getElementById('tickStrip');
            for (let i = 0; i < 110; i++) { strip.appendChild(document.createElement('span')); }

            function getSession() {
                try {
                    const raw = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
                    return raw ? JSON.parse(raw) : null;
                } catch (_) { return null; }
            }
            const session = getSession();
            if (!session || !session.email) {
                window.location.href = 'login.html';
                return;
            }
            const root = document.documentElement;
            const themeToggle = document.getElementById('themeToggle');
            const themeLabel = document.getElementById('themeLabel');
            const savedTheme = localStorage.getItem('mc-theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
                root.setAttribute('data-theme', 'dark');
                themeLabel.textContent = 'Light';
            }
            themeToggle.addEventListener('click', function () {
                const isDark = root.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    root.removeAttribute('data-theme');
                    localStorage.setItem('mc-theme', 'light');
                    themeLabel.textContent = 'Dark';
                } else {
                    root.setAttribute('data-theme', 'dark');
                    localStorage.setItem('mc-theme', 'dark');
                    themeLabel.textContent = 'Light';
                }
            });

            document.getElementById('logoutBtn').addEventListener('click', function () {
                sessionStorage.removeItem('mc-session');
                localStorage.removeItem('mc-session');
                window.location.href = 'login.html';
            });

            const proBtn = document.getElementById('proBtn');
            const modal = document.getElementById('confirmModal');
            const cancelBtn = document.getElementById('modalCancel');
            const confirmBtn = document.getElementById('modalConfirm');
            const pidInput = document.getElementById('participantId');
            const pidErr = document.getElementById('participantErr');

            // Restore prior participant ID (research code, or from email/Gmail join session)
            try {
                let prev = sessionStorage.getItem('mc-research-participant');
                if (!prev) {
                    const raw = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
                    if (raw) {
                        const sess = JSON.parse(raw);
                        if (sess && sess.participantId) prev = sess.participantId;
                        else if (sess && sess.email) prev = String(sess.email).split('@')[0];
                    }
                }
                if (prev && pidInput) pidInput.value = prev;
            } catch (_) {}

            function requireParticipantId() {
                const id = (pidInput && pidInput.value || '').trim();
                if (!id) {
                    if (pidErr) {
                        pidErr.style.display = 'block';
                        pidErr.textContent = 'Enter a Participant ID before starting (e.g. P01).';
                    }
                    if (pidInput) pidInput.focus();
                    return null;
                }
                if (pidErr) pidErr.style.display = 'none';
                try { sessionStorage.setItem('mc-research-participant', id); } catch (_) {}
                return id;
            }

            function sessionEmail() {
                try {
                    const raw = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
                    if (!raw) return null;
                    const s = JSON.parse(raw);
                    return (s && s.email) ? String(s.email).trim() : null;
                } catch (_) { return null; }
            }

            // Lock field if email already has a permanent Participant ID
            (function restoreLockedParticipant() {
                try {
                    const s = JSON.parse(sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session') || 'null');
                    if (s && s.participantId && pidInput) {
                        pidInput.value = s.participantId;
                        pidInput.readOnly = true;
                        pidInput.title = 'Participant ID is locked to your email and cannot be changed';
                        if (pidErr) {
                            pidErr.style.display = 'block';
                            pidErr.style.color = '#2f6f66';
                            pidErr.textContent = 'Participant ID is permanent for your email: ' + s.participantId;
                        }
                    }
                } catch (_) {}
            })();

            async function beginResearchSession(mode, href) {
                const id = requireParticipantId();
                if (!id) return;
                const email = sessionEmail();
                // Enforce unique one-time Participant ID server-side
                try {
                    const claimResp = await fetch('/api/research/participant/claim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ participantId: id, email: email }),
                    });
                    const claim = await claimResp.json().catch(function () { return {}; });
                    if (!claimResp.ok || claim.success === false) {
                        if (pidErr) {
                            pidErr.style.display = 'block';
                            pidErr.style.color = '#B23A2E';
                            pidErr.textContent = claim.error || 'Participant ID is not available.';
                        }
                        if (claim.participantId && pidInput) {
                            pidInput.value = claim.participantId;
                            pidInput.readOnly = true;
                        }
                        return;
                    }
                    if (claim.participantId && pidInput) pidInput.value = claim.participantId;
                } catch (_) { /* allow offline */ }

                try {
                    await fetch('/api/research/session/start', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ participantId: (pidInput && pidInput.value) || id, mode: mode }),
                    }).then(function (r) { return r.json(); }).then(function (data) {
                        if (data && data.success && data.session) {
                            sessionStorage.setItem('mc-research-session', JSON.stringify(data.session));
                            sessionStorage.setItem('mc-research-session-start', String(Date.now()));
                            sessionStorage.setItem('mc-research-mode', mode === 'pro' ? 'pro' : 'simple');
                            sessionStorage.setItem('mc-research-participant', (pidInput && pidInput.value) || id);
                            sessionStorage.removeItem('mc-research-project');
                        }
                    }).catch(function () { /* offline / server down — still allow measurement */ });
                } catch (_) {}
                window.location.href = href;
            }

            const btnSimple = document.getElementById('btnSimple');
            if (btnSimple) {
                btnSimple.addEventListener('click', function (e) {
                    e.preventDefault();
                    beginResearchSession('simple', 'measurecraft_quantity_only.html');
                });
            }

            proBtn.addEventListener('click', function () {
                if (!requireParticipantId()) return;
                modal.classList.add('open');
            });
            function closeModal() { modal.classList.remove('open'); }
            cancelBtn.addEventListener('click', closeModal);
            modal.addEventListener('click', function (e) { if (e.target === this) closeModal(); });
            confirmBtn.addEventListener('click', function () {
                beginResearchSession('pro', 'takeoff_pro.html');
            });
        })();

/* extracted script block */

(function(){const fab=document.getElementById('mcAiFab'),panel=document.getElementById('mcAiPanel'),body=document.getElementById('mcAiBody'),input=document.getElementById('mcAiInput');if(!fab||!panel)return;
        function openPanel(){panel.classList.add('open')}
        function closePanel(){panel.classList.remove('open')}
        fab.addEventListener('click',()=>{if(panel.classList.contains('open'))closePanel();else openPanel()});
        document.getElementById('mcAiClose').addEventListener('click',closePanel);
        let mcAiHistory=[];
        function escapeMc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
        function mcAiHeaders(){const h={'Content-Type':'application/json'};try{const tok=localStorage.getItem('mc-api-token')||sessionStorage.getItem('mc-api-token');if(tok)h['X-MC-Token']=tok}catch(_){}return h}
        function offlineReply(q){const l=(q||'').toLowerCase();let r='I can help with modes, calibration, and takeoff tools.';if(l.includes('simple'))r='Simple Mode guides you: upload → calibrate → AI detect → quantities → export.';else if(l.includes('pro')||l.includes('professional'))r='Professional Mode has full tools: walls, slabs, beams, layers, 3D, BOQ export.';else if(l.includes('calibr'))r='Calibrate with two points on a known length, enter real metres, then apply.';return r}
        async function reply(q){
            const thinkId='mcAiThink'+Date.now();
            body.innerHTML+='<br><br><strong>You:</strong> '+escapeMc(q)+'<br><strong>AI:</strong> <span id="'+thinkId+'">…</span>';
            body.scrollTop=body.scrollHeight;
            const slot=document.getElementById(thinkId);
            let answer=null;
            try{
                const resp=await fetch('/api/assistant-chat',{method:'POST',headers:mcAiHeaders(),body:JSON.stringify({message:q,history:mcAiHistory})});
                const data=await resp.json().catch(()=>({}));
                if(resp.ok&&data&&data.success&&data.answer)answer=data.answer;
            }catch(_){}
            const finalText=answer||offlineReply(q);
            if(slot)slot.textContent=finalText;
            if(answer){mcAiHistory.push({role:'user',text:q},{role:'assistant',text:answer});if(mcAiHistory.length>12)mcAiHistory=mcAiHistory.slice(-12)}
            body.scrollTop=body.scrollHeight;
        }
        document.getElementById('mcAiSend').addEventListener('click',()=>{const q=(input.value||'').trim();if(!q)return;input.value='';reply(q)});
        input.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('mcAiSend').click()});
        })();
