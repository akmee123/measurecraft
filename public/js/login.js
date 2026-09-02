(function () {
            // build the tick strip
            const strip = document.getElementById('tickStrip');
            for (let i = 0; i < 90; i++) { strip.appendChild(document.createElement('span')); }

            const root = document.documentElement;
            const themeToggle = document.getElementById('themeToggle');
            const themeLabel = document.getElementById('themeLabel');

            const saved = localStorage.getItem('mc-theme');
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            if (saved === 'dark' || (!saved && prefersDark)) {
                root.setAttribute('data-theme', 'dark');
                if (themeLabel) themeLabel.textContent = 'Light';
            }

            function applyThemeLabels(isDark) {
                document.querySelectorAll('#themeLabel, .themeLabelDup').forEach(el => {
                    el.textContent = isDark ? 'Light' : 'Dark';
                });
            }
            function toggleTheme() {
                const isDark = root.getAttribute('data-theme') === 'dark';
                if (isDark) {
                    root.removeAttribute('data-theme');
                    localStorage.setItem('mc-theme', 'light');
                    applyThemeLabels(false);
                } else {
                    root.setAttribute('data-theme', 'dark');
                    localStorage.setItem('mc-theme', 'dark');
                    applyThemeLabels(true);
                }
            }
            if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
            const themeToggleDesktop = document.getElementById('themeToggleDesktop');
            if (themeToggleDesktop) themeToggleDesktop.addEventListener('click', toggleTheme);
            applyThemeLabels(root.getAttribute('data-theme') === 'dark');

            const passInput = document.getElementById('password');
            const togglePass = document.getElementById('togglePass');
            if (togglePass && passInput) {
                togglePass.addEventListener('click', function () {
                    const show = passInput.type === 'password';
                    passInput.type = show ? 'text' : 'password';
                    this.classList.toggle('showing', show);
                    this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
                });
            }

            const form = document.getElementById('loginForm');
            const joinForm = document.getElementById('joinForm');
            const errorMsg = document.getElementById('errorMsg');
            const errorText = document.getElementById('errorText');
            const btnLogin = document.getElementById('btnLogin');
            const btnJoinEmail = document.getElementById('btnJoinEmail');

            const DEMO_EMAIL = 'demo@measurecraft.com';
            const DEMO_PASS = 'demo1234';

            function showError(msg) {
                errorText.textContent = msg || 'Something went wrong.';
                errorMsg.classList.add('show');
            }
            function clearError() { errorMsg.classList.remove('show'); }

            function saveSession(session, remember) {
                const payload = JSON.stringify(session);
                if (remember) {
                    localStorage.setItem('mc-session', payload);
                    sessionStorage.removeItem('mc-session');
                } else {
                    sessionStorage.setItem('mc-session', payload);
                    localStorage.removeItem('mc-session');
                }
                if (session.participantId) {
                    try { sessionStorage.setItem('mc-research-participant', session.participantId); } catch (_) {}
                }
            }
            function goToModes() { window.location.href = 'mode-select.html'; }

            // Email join for study participants (no password)
            if (joinForm) {
                joinForm.addEventListener('submit', async function (e) {
                    e.preventDefault();
                    clearError();
                    const email = (document.getElementById('joinEmail').value || '').trim().toLowerCase();
                    const participantId = (document.getElementById('joinParticipant').value || '').trim();
                    const remember = !!(document.getElementById('joinRemember') && document.getElementById('joinRemember').checked);
                    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                        showError('Please enter a valid email address.');
                        return;
                    }
                    if (!participantId) {
                        showError('Participant ID is required. Choose a unique ID (e.g. P01 or QS-03).');
                        return;
                    }
                    btnJoinEmail.disabled = true;
                    btnJoinEmail.classList.add('loading');
                    try {
                        const resp = await fetch('/api/auth/email-join', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email: email, participantId: participantId }),
                        });
                        const data = await resp.json().catch(function () { return {}; });
                        if (resp.ok && data.success && data.session) {
                            saveSession(data.session, remember);
                            goToModes();
                            return;
                        }
                        if (resp.status === 409 || (data && data.code === 'EMAIL_PARTICIPANT_LOCKED')) {
                            showError(data.error || 'This email is already linked to another participant ID, or this ID already exists.');
                            if (data.participantId) {
                                const pidEl = document.getElementById('joinParticipant');
                                if (pidEl) pidEl.value = data.participantId;
                            }
                            btnJoinEmail.disabled = false;
                            btnJoinEmail.classList.remove('loading');
                            return;
                        }
                        if (data && data.code === 'PARTICIPANT_ID_REQUIRED') {
                            showError(data.error || 'Participant ID is required.');
                            btnJoinEmail.disabled = false;
                            btnJoinEmail.classList.remove('loading');
                            return;
                        }
                        if (resp.status >= 500) {
                            showError('Server error while joining. If this persists after redeploy, check Render logs for CORS or research storage errors.');
                        } else {
                            showError((data && data.error) || ('Could not join (HTTP ' + resp.status + '). Try again.'));
                        }
                        btnJoinEmail.disabled = false;
                        btnJoinEmail.classList.remove('loading');
                        return;
                    } catch (err) {
                        // Network / offline fallback so local demos still work.
                        console.warn('email-join network error, using offline session', err);
                        saveSession({
                            email: email,
                            name: email.split('@')[0] || 'User',
                            participantId: participantId || null,
                            provider: 'email',
                            loggedInAt: Date.now(),
                        }, remember);
                        goToModes();
                    }
                });
            }

            // Demo / admin password login
            if (form) {
                form.addEventListener('submit', function (e) {
                    e.preventDefault();
                    clearError();
                    const email = document.getElementById('email').value.trim().toLowerCase();
                    const password = document.getElementById('password').value;
                    const remember = document.getElementById('remember').checked;
                    btnLogin.disabled = true;
                    btnLogin.classList.add('loading');
                    setTimeout(function () {
                        if (email === DEMO_EMAIL && password === DEMO_PASS) {
                            saveSession({ email: email, name: 'demo', provider: 'demo', loggedInAt: Date.now() }, remember);
                            goToModes();
                        } else {
                            showError('Invalid email or password. Use Continue with email above, or demo@measurecraft.com / demo1234.');
                            btnLogin.disabled = false;
                            btnLogin.classList.remove('loading');
                        }
                    }, 500);
                });
            }

            const forgotLink = document.getElementById('forgotLink');
            if (forgotLink) {
                forgotLink.addEventListener('click', function (e) {
                    e.preventDefault();
                    alert('For the research study, use “Continue with email” — no password is required.');
                });
            }

            // Social buttons — Google works when GOOGLE_CLIENT_ID is set; others guide user
            let googleReady = false;
            async function initGoogleJoin() {
                try {
                    const resp = await fetch('/api/auth/config');
                    const cfg = await resp.json().catch(function () { return {}; });
                    const clientId = cfg && cfg.googleClientId;
                    if (!clientId) return;
                    await new Promise(function (resolve, reject) {
                        if (window.google && window.google.accounts) return resolve();
                        const s = document.createElement('script');
                        s.src = 'https://accounts.google.com/gsi/client';
                        s.async = true;
                        s.onload = resolve;
                        s.onerror = reject;
                        document.head.appendChild(s);
                    });
                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        callback: async function (response) {
                            clearError();
                            try {
                                const r = await fetch('/api/auth/google', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        credential: response.credential,
                                        participantId: (document.getElementById('joinParticipant').value || '').trim() || undefined,
                                    }),
                                });
                                const data = await r.json().catch(function () { return {}; });
                                if (!r.ok || !data.success) throw new Error(data.error || 'Google sign-in failed');
                                saveSession(data.session, true);
                                goToModes();
                            } catch (err) {
                                showError(err.message || 'Google sign-in failed');
                            }
                        },
                    });
                    googleReady = true;
                } catch (_) {}
            }
            initGoogleJoin();

            const btnGoogle = document.getElementById('btnGoogle');
            if (btnGoogle) {
                btnGoogle.addEventListener('click', function () {
                    clearError();
                    if (googleReady && window.google && window.google.accounts) {
                        try {
                            window.google.accounts.id.prompt();
                        } catch (_) {
                            showError('Google sign-in could not open. Enter your email below and press Continue.');
                        }
                    } else {
                        // No GOOGLE_CLIENT_ID — guide user to email field (still works for Gmail addresses)
                        const emailEl = document.getElementById('joinEmail');
                        if (emailEl) {
                            emailEl.focus();
                            if (!emailEl.value) emailEl.placeholder = 'you@gmail.com';
                        }
                        showError('Google one-click is not configured on this server. Enter your Gmail below and press Continue.');
                    }
                });
            }
            const btnMs = document.getElementById('btnMicrosoft');
            if (btnMs) {
                btnMs.addEventListener('click', function () {
                    clearError();
                    const emailEl = document.getElementById('joinEmail');
                    if (emailEl) {
                        emailEl.focus();
                        emailEl.placeholder = 'you@outlook.com';
                    }
                    showError('Enter your Microsoft / Outlook email below and press Continue.');
                });
            }
            const btnApple = document.getElementById('btnApple');
            if (btnApple) {
                btnApple.addEventListener('click', function () {
                    clearError();
                    const emailEl = document.getElementById('joinEmail');
                    if (emailEl) {
                        emailEl.focus();
                        emailEl.placeholder = 'you@icloud.com';
                    }
                    showError('Enter your Apple / iCloud email below and press Continue.');
                });
            }

            try {
                const s = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
                if (s) {
                    const parsed = JSON.parse(s);
                    if (parsed && parsed.email) window.location.href = 'mode-select.html';
                }
            } catch (_) {}
        })();

/* extracted script block */

(function () {
            const fab = document.getElementById('mcAiFab');
            const panel = document.getElementById('mcAiPanel');
            const body = document.getElementById('mcAiBody');
            const input = document.getElementById('mcAiInput');
            if (!fab || !panel) return;
            function openPanel() { panel.classList.add('open'); }
            function closePanel() { panel.classList.remove('open'); }
            fab.addEventListener('click', () => {
                if (panel.classList.contains('open')) closePanel(); else openPanel();
            });
            document.getElementById('mcAiClose').addEventListener('click', closePanel);
            let mcAiHistory = [];
            function escapeMc(s) {
                return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            }
            function mcAiHeaders() {
                const h = { 'Content-Type': 'application/json' };
                try {
                    const tok = localStorage.getItem('mc-api-token') || sessionStorage.getItem('mc-api-token');
                    if (tok) h['X-MC-Token'] = tok;
                } catch (_) {}
                return h;
            }
            function offlineReply(q) {
                const lower = (q || '').toLowerCase();
                let r = 'I can help with calibration, tools, and exports. Try asking about scale, walls, or AI detect.';
                if (lower.includes('calibr')) r = 'Use Calibrate: pick two points on a known dimension, enter the real length in metres, then Apply.';
                else if (lower.includes('zoom') || lower.includes('track')) r = 'Use + / − / Fit in the toolbar. Lock Zoom disables trackpad scroll-zoom so pan is easier (Ctrl+scroll still zooms).';
                else if (lower.includes('export') || lower.includes('boq')) r = 'In the workspace, open Export for Excel BOQ, PDF/PNG marked plan, or project JSON.';
                else if (lower.includes('wall') || lower.includes('measure')) r = 'Select Wall or Measure from the toolbar, click points along the plan, finish with Enter or double-click.';
                else if (lower.includes('ai') || lower.includes('detect')) r = 'After loading a drawing and calibrating, use AI Detect to propose elements, then accept or edit them.';
                return r;
            }
            async function reply(q) {
                const thinkId = 'mcAiThink' + Date.now();
                body.innerHTML += '<br><br><strong>You:</strong> ' + escapeMc(q) + '<br><strong>AI:</strong> <span id="' + thinkId + '">…</span>';
                body.scrollTop = body.scrollHeight;
                const slot = document.getElementById(thinkId);
                let answer = null;
                try {
                    const resp = await fetch('/api/assistant-chat', {
                        method: 'POST',
                        headers: mcAiHeaders(),
                        body: JSON.stringify({ message: q, history: mcAiHistory }),
                    });
                    const data = await resp.json().catch(() => ({}));
                    if (resp.ok && data && data.success && data.answer) answer = data.answer;
                } catch (_) {}
                const finalText = answer || offlineReply(q);
                if (slot) slot.textContent = finalText;
                if (answer) {
                    mcAiHistory.push({ role: 'user', text: q }, { role: 'assistant', text: answer });
                    if (mcAiHistory.length > 12) mcAiHistory = mcAiHistory.slice(-12);
                }
                body.scrollTop = body.scrollHeight;
            }
            document.getElementById('mcAiSend').addEventListener('click', () => {
                const q = (input.value || '').trim();
                if (!q) return;
                input.value = '';
                reply(q);
            });
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('mcAiSend').click(); });
        })();
