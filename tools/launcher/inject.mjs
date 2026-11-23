#!/usr/bin/env node
/**
 * Orion Linux auto-injector.
 *
 * Connects to Discord Canary's remote-debugging endpoint, injects index.js into
 * the running renderer (the same as pasting it into the DevTools console), and
 * auto-starts the run: it selects every quest and clicks START if the picker is
 * shown, or simply reports that AUTO_START is already running.
 *
 * Usage:  node inject.mjs [path/to/index.js]
 *
 * Requires Node >= 22 (global fetch + WebSocket). No dependencies.
 */
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const INDEX = process.argv[2] || new URL('../../index.js', import.meta.url).pathname;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findPage() {
    const list = await (await fetch(`${CDP}/json/list`)).json();
    return list.find(t => t.type === 'page' && /discord\.com/.test(t.url)) || null;
}

async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const { res, rej } = pending.get(m.id);
            pending.delete(m.id);
            m.error ? rej(new Error(m.error.message)) : res(m.result);
        }
    };
    const call = (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    return { ws, call };
}

async function evaluate(call, expression, awaitPromise = false) {
    const r = await call('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, includeCommandLineAPI: true });
    if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'evaluate failed');
    }
    return r.result?.value;
}

async function main() {
    console.log(`[inject] waiting for Discord Canary CDP on ${CDP} ...`);
    let page = null;
    for (let i = 0; i < 60; i++) {
        try { page = await findPage(); } catch (_) { }
        if (page) break;
        await sleep(500);
    }
    if (!page) { console.error('[inject] Discord page not found. Is Canary running with --remote-debugging-port?'); process.exit(1); }
    console.log(`[inject] attached to ${page.url}`);

    const { ws, call } = await connect(page.webSocketDebuggerUrl);
    const code = fs.readFileSync(INDEX, 'utf8');
    console.log(`[inject] injecting index.js (${(code.length / 1024).toFixed(1)} KB)`);
    await evaluate(call, code, true);
    console.log('[inject] injected. waiting for the quest engine to come up ...');

    // Wait for either the picker (AUTO_START off) or live task cards (AUTO_START on).
    for (let i = 0; i < 60; i++) {
        const state = await evaluate(call, `(() => {
            const form = document.getElementById('orion-picker-form');
            if (form) return { kind: 'picker' };
            const cards = document.querySelectorAll('#orion-body .task-card').length;
            const logs = [...document.querySelectorAll('#orion-logs .log-item')].map(e => e.textContent).slice(-3);
            return cards > 0 ? { kind: 'running', cards } : { kind: 'waiting', logs };
        })()`);
        if (state.kind === 'picker') {
            const clicked = await evaluate(call, `(() => {
                const f = document.getElementById('orion-picker-form');
                if (!f) return 0;
                const cbs = [...f.querySelectorAll('.quest-pick input[type="checkbox"]')].filter(cb => !cb.closest('.quest-pick').classList.contains('hidden'));
                cbs.forEach(cb => { cb.checked = true; });
                const btn = document.getElementById('start-btn');
                if (btn) btn.click(); else f.requestSubmit();
                return cbs.length;
            })()`);
            console.log(`[inject] started ${clicked} quest(s) via the picker.`);
            break;
        }
        if (state.kind === 'running') {
            console.log(`[inject] engine already running (${state.cards} task card(s)).`);
            break;
        }
        await sleep(500);
    }

    console.log('[inject] done. The dashboard now runs inside Discord. Press Shift+. to toggle it.');
    ws.close();
}

main().catch(e => { console.error('[inject] error:', e.message); process.exit(1); });
