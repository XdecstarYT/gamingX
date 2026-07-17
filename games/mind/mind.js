/* ============================================================================
   GX MIND — bootstrap: login gate, model management, chat, training UI.
   Everything runs client-side; models are tiny feedforward neural nets
   (see nn.js) trained in-browser and saved to localStorage.
   ========================================================================== */
(() => {
'use strict';
const D = window.GXMindData;
const { DenseNN } = window.GXNN;
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DEMO_USER = 'dec01', DEMO_PASS = 'pass';
const MODELS_KEY = 'gamingx.mind.models';
const ACTIVE_KEY = 'gamingx.mind.activeModel';

function showScreen(id) {
  document.querySelectorAll('.gm-screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

/* ------------------------------------------------------------------ */
/* login — a local demo gate only; see the on-screen notice            */
/* ------------------------------------------------------------------ */
$('btn-login').addEventListener('click', tryLogin);
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
function tryLogin() {
  const user = $('login-user').value.trim();
  const pass = $('login-pass').value;
  if (user === DEMO_USER && pass === DEMO_PASS) {
    $('login-error').classList.add('hidden');
    showScreen('screen-app');
    setTab('chat');
  } else {
    $('login-error').classList.remove('hidden');
  }
}
$('btn-logout').addEventListener('click', () => {
  $('login-user').value = ''; $('login-pass').value = '';
  showScreen('screen-login');
});

/* ------------------------------------------------------------------ */
/* model storage                                                       */
/* ------------------------------------------------------------------ */
function loadModels() { try { return JSON.parse(localStorage.getItem(MODELS_KEY) || '[]'); } catch (e) { return []; } }
function saveModels(list) { try { localStorage.setItem(MODELS_KEY, JSON.stringify(list)); } catch (e) {} }
function getActiveModelId() { try { return localStorage.getItem(ACTIVE_KEY) || ''; } catch (e) { return ''; } }
function setActiveModel(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {} renderApp(); }
function deleteModel(id) {
  saveModels(loadModels().filter(m => m.id !== id));
  if (getActiveModelId() === id) { try { localStorage.removeItem(ACTIVE_KEY); } catch (e) {} }
  renderApp();
}
function respond(model, text) {
  const nn = DenseNN.fromJSON({ sizes: model.sizes, W: model.W, b: model.b });
  const x = D.bagOfWords(text, model.vocab);
  const probs = nn.predict(x);
  const bestIdx = probs.indexOf(Math.max(...probs));
  const conf = probs[bestIdx];
  if (conf < 0.4 || !model.intents[bestIdx]) {
    const pool = model.fallback.responses;
    return { text: pool[Math.floor(Math.random() * pool.length)], confidence: conf, tag: 'fallback' };
  }
  const pool = model.intents[bestIdx].responses;
  return { text: pool[Math.floor(Math.random() * pool.length)], confidence: conf, tag: model.intents[bestIdx].tag };
}

/* ------------------------------------------------------------------ */
/* tabs                                                                 */
/* ------------------------------------------------------------------ */
let currentTab = 'chat';
document.querySelectorAll('.gm-tab').forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.gm-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  renderApp();
}
function renderApp() {
  const body = $('app-body');
  body.innerHTML = '';
  if (currentTab === 'chat') renderChat(body);
  else if (currentTab === 'models') renderModelsTab(body);
  else renderAbout(body);
}

/* ------------------------------------------------------------------ */
/* chat tab                                                             */
/* ------------------------------------------------------------------ */
let chatHistory = []; // { role: 'user'|'bot', text, confidence? } — session-only, not persisted
function renderChat(body) {
  body.innerHTML = '';
  const inner = document.createElement('div'); inner.className = 'gm-inner';
  const models = loadModels();
  const card = document.createElement('div'); card.className = 'gm-card';
  card.innerHTML = '<h2>💬 Chat</h2>';

  if (!models.length) {
    card.innerHTML += '<div class="gm-empty-note">No trained models yet. Go to <b>Models</b> to train your first one — it takes a few seconds, right in your browser.</div>';
    inner.appendChild(card); body.appendChild(inner); return;
  }
  let activeId = getActiveModelId();
  if (!models.find(m => m.id === activeId)) { activeId = models[0].id; setActiveModelSilent(activeId); }

  const selRow = document.createElement('div'); selRow.className = 'gm-model-select';
  selRow.innerHTML = '<span>Chatting with:</span>';
  const sel = document.createElement('select');
  for (const m of models) {
    const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.name;
    if (m.id === activeId) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => setActiveModel(sel.value));
  selRow.appendChild(sel);
  card.appendChild(selRow);

  const log = document.createElement('div'); log.className = 'gm-chat-log'; log.id = 'chat-log';
  if (!chatHistory.length) log.innerHTML = '<p style="color:var(--muted);font-size:.8rem;text-align:center;margin:auto">Say hello — this model will try to recognize what you mean.</p>';
  for (const m of chatHistory) {
    const el = document.createElement('div'); el.className = 'gm-msg ' + m.role;
    el.innerHTML = esc(m.text) + (m.role === 'bot' ? `<span class="conf">matched "${esc(m.tag)}" · ${Math.round(m.confidence * 100)}% confidence</span>` : '');
    log.appendChild(el);
  }
  card.appendChild(log);

  const inputRow = document.createElement('div'); inputRow.className = 'gm-chat-input-row';
  const input = document.createElement('input'); input.type = 'text'; input.id = 'chat-input'; input.placeholder = 'Type a message...';
  const sendBtn = document.createElement('button'); sendBtn.textContent = 'SEND';
  inputRow.appendChild(input); inputRow.appendChild(sendBtn);
  card.appendChild(inputRow);
  inner.appendChild(card);
  body.appendChild(inner);

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    chatHistory.push({ role: 'user', text });
    const model = loadModels().find(m => m.id === activeId);
    const r = respond(model, text);
    chatHistory.push({ role: 'bot', text: r.text, confidence: r.confidence, tag: r.tag });
    renderChat(body);
    const newLog = $('chat-log'); if (newLog) newLog.scrollTop = newLog.scrollHeight;
    const newInput = $('chat-input'); if (newInput) newInput.focus();
  };
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  log.scrollTop = log.scrollHeight;
}
function setActiveModelSilent(id) { try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {} }

/* ------------------------------------------------------------------ */
/* about tab                                                            */
/* ------------------------------------------------------------------ */
function renderAbout(body) {
  const inner = document.createElement('div'); inner.className = 'gm-inner';
  const card = document.createElement('div'); card.className = 'gm-card gm-about';
  card.innerHTML = `<h2>ℹ️ How This Works</h2>
    <p><b>This is real, small-scale machine learning — not a large language model.</b> Every "model" you train here is a tiny feedforward neural network (a multi-layer perceptron) written from scratch in plain JavaScript, trained entirely in your browser with genuine backpropagation and gradient descent.</p>
    <p>When you train a model, it learns to recognize which <b>category</b> (an "intent," like "greeting" or "joke") your message most resembles, based on which words appear in it. Once it picks a category, it replies with one of the canned responses you wrote for that category.</p>
    <p>That means it can't write anything you didn't teach it — it's a categorizer with scripted replies, not a generator. Train it on more categories and examples in the <b>Models</b> tab to make it recognize more things, or make an entirely different model with a different personality.</p>
    <p style="color:#f87171"><b>Also worth knowing:</b> the login on this app is a local demo gate, not real security — this whole platform is static files with no server, so the credentials live in plain view in this page's JavaScript.</p>`;
  inner.appendChild(card);
  body.appendChild(inner);
}

/* ------------------------------------------------------------------ */
/* models tab: list + train new                                        */
/* ------------------------------------------------------------------ */
let draftIntents = JSON.parse(JSON.stringify(D.STARTER_INTENTS));
let draftName = '';
let draftHidden = 16, draftLr = 0.3, draftEpochs = 300;
let training = false;

function renderModelsTab(body) {
  const inner = document.createElement('div'); inner.className = 'gm-inner';

  const listCard = document.createElement('div'); listCard.className = 'gm-card';
  listCard.innerHTML = '<h2>🧬 Your Models</h2><div class="sub">Train a new one below, then switch which one answers in Chat.</div>';
  const models = loadModels();
  const activeId = getActiveModelId();
  if (!models.length) {
    const p = document.createElement('p'); p.style.cssText = 'color:var(--muted);font-size:.82rem';
    p.textContent = 'No models yet — train your first one below.';
    listCard.appendChild(p);
  } else {
    for (const m of models) {
      const row = document.createElement('div'); row.className = 'gm-model-card';
      const info = document.createElement('div'); info.className = 'info';
      info.innerHTML = `<div class="nm">${esc(m.name)}</div><div class="meta">${m.intents.length} categories · ${m.vocab.length}-word vocabulary · final loss ${m.finalLoss.toFixed(3)} · trained ${new Date(m.createdAt).toLocaleString()}</div>`;
      row.appendChild(info);
      if (m.id === activeId) {
        const badge = document.createElement('span'); badge.className = 'active-badge'; badge.textContent = 'ACTIVE IN CHAT';
        row.appendChild(badge);
      } else {
        const useBtn = document.createElement('button'); useBtn.className = 'primary'; useBtn.textContent = 'USE IN CHAT';
        useBtn.addEventListener('click', () => setActiveModel(m.id));
        row.appendChild(useBtn);
      }
      const delBtn = document.createElement('button'); delBtn.className = 'danger'; delBtn.textContent = 'DELETE';
      delBtn.addEventListener('click', () => { if (confirm(`Delete "${m.name}"?`)) deleteModel(m.id); });
      row.appendChild(delBtn);
      listCard.appendChild(row);
    }
  }
  inner.appendChild(listCard);

  const formCard = document.createElement('div'); formCard.className = 'gm-card';
  formCard.innerHTML = '<h2>Train a New Model</h2><div class="sub">Edit the categories below (or use the starter set as-is), tune the settings, then train.</div>';

  const nameRow = document.createElement('div'); nameRow.className = 'gm-form-row';
  nameRow.innerHTML = '<label>MODEL NAME</label>';
  const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.placeholder = 'e.g. Friendly Bot v1'; nameInput.value = draftName;
  nameInput.addEventListener('input', () => { draftName = nameInput.value; });
  nameRow.appendChild(nameInput);
  formCard.appendChild(nameRow);

  formCard.appendChild(sliderRow('HIDDEN LAYER SIZE', 4, 32, draftHidden, v => { draftHidden = v; }));
  formCard.appendChild(sliderRow('LEARNING RATE (x100)', 5, 80, Math.round(draftLr * 100), v => { draftLr = v / 100; }));
  formCard.appendChild(sliderRow('TRAINING EPOCHS', 50, 800, draftEpochs, v => { draftEpochs = v; }));

  const intentsWrap = document.createElement('div');
  renderIntentEditor(intentsWrap);
  formCard.appendChild(intentsWrap);

  const addBtn = document.createElement('button'); addBtn.className = 'gm-add-intent'; addBtn.textContent = '+ ADD CATEGORY';
  addBtn.addEventListener('click', () => {
    draftIntents.push({ tag: '', patterns: [], responses: [] });
    renderIntentEditor(intentsWrap);
  });
  formCard.appendChild(addBtn);

  const trainBtn = document.createElement('button'); trainBtn.className = 'gm-train-btn';
  trainBtn.textContent = training ? 'TRAINING…' : '🧠 TRAIN MODEL';
  trainBtn.disabled = training;
  trainBtn.addEventListener('click', () => startTraining(formCard));
  formCard.appendChild(trainBtn);

  const progress = document.createElement('div'); progress.className = 'gm-progress hidden'; progress.id = 'train-progress';
  progress.innerHTML = '<div class="bar"><i id="train-bar" style="width:0%"></i></div><canvas class="gm-loss-chart" id="loss-chart" width="600" height="80"></canvas>';
  formCard.appendChild(progress);

  inner.appendChild(formCard);
  body.appendChild(inner);
}

function sliderRow(label, min, max, value, onChange) {
  const row = document.createElement('div'); row.className = 'gm-form-row';
  const lbl = document.createElement('label'); lbl.innerHTML = `${label}: <span class="gm-slider-val">${value}</span>`;
  row.appendChild(lbl);
  const input = document.createElement('input'); input.type = 'range'; input.min = min; input.max = max; input.value = value;
  input.addEventListener('input', () => { lbl.querySelector('.gm-slider-val').textContent = input.value; onChange(Number(input.value)); });
  row.appendChild(input);
  return row;
}

function renderIntentEditor(wrap) {
  wrap.innerHTML = '';
  draftIntents.forEach((intent, i) => {
    const row = document.createElement('div'); row.className = 'gm-intent-row';
    if (draftIntents.length > 1) {
      const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '✕ remove';
      rm.addEventListener('click', () => { draftIntents.splice(i, 1); renderIntentEditor(wrap); });
      row.appendChild(rm);
    }
    const tagLbl = document.createElement('span'); tagLbl.className = 'lbl'; tagLbl.textContent = 'CATEGORY NAME';
    row.appendChild(tagLbl);
    const tagInput = document.createElement('input'); tagInput.type = 'text'; tagInput.value = intent.tag; tagInput.placeholder = 'e.g. greeting';
    tagInput.addEventListener('input', () => { intent.tag = tagInput.value; });
    row.appendChild(tagInput);

    const patLbl = document.createElement('span'); patLbl.className = 'lbl'; patLbl.textContent = 'EXAMPLE MESSAGES (one per line)';
    row.appendChild(patLbl);
    const patArea = document.createElement('textarea'); patArea.value = intent.patterns.join('\n');
    patArea.addEventListener('input', () => { intent.patterns = patArea.value.split('\n').map(s => s.trim()).filter(Boolean); });
    row.appendChild(patArea);

    const resLbl = document.createElement('span'); resLbl.className = 'lbl'; resLbl.textContent = 'REPLIES (one per line, picked at random)';
    row.appendChild(resLbl);
    const resArea = document.createElement('textarea'); resArea.value = intent.responses.join('\n');
    resArea.addEventListener('input', () => { intent.responses = resArea.value.split('\n').map(s => s.trim()).filter(Boolean); });
    row.appendChild(resArea);

    wrap.appendChild(row);
  });
}

function startTraining(formCard) {
  const name = draftName.trim() || `Model ${loadModels().length + 1}`;
  const trainable = draftIntents.filter(i => i.tag.trim() && i.patterns.length && i.responses.length);
  const fallback = draftIntents.find(i => i.tag.trim().toLowerCase() === 'fallback' && i.responses.length)
    || { responses: ["I haven't learned that yet — try training me on it!"] };
  if (trainable.length < 2) { alert('Add at least 2 categories with example messages and replies before training.'); return; }

  training = true;
  renderModelsTab($('app-body'));
  const progress = $('train-progress'); progress.classList.remove('hidden');
  const bar = $('train-bar');
  const canvas = $('loss-chart'); const ctx = canvas.getContext('2d');

  const vocab = D.buildVocab(trainable);
  const samples = [];
  trainable.forEach((intent, idx) => { for (const p of intent.patterns) samples.push([D.bagOfWords(p, vocab), idx]); });
  const nn = new DenseNN([vocab.length, draftHidden, trainable.length]);
  const lossHistory = [];
  let epoch = 0;
  const EPOCHS_PER_CHUNK = 5;

  function drawChart() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (lossHistory.length < 2) return;
    const max = Math.max(...lossHistory), min = 0;
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2; ctx.beginPath();
    lossHistory.forEach((v, i) => {
      const x = (i / (lossHistory.length - 1)) * canvas.width;
      const y = canvas.height - ((v - min) / (max - min || 1)) * (canvas.height - 6) - 3;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function runChunk() {
    const shuffled = samples.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    let chunkEnd = Math.min(draftEpochs, epoch + EPOCHS_PER_CHUNK);
    let lastLoss = 0;
    for (; epoch < chunkEnd; epoch++) {
      let total = 0;
      for (const [x, y] of shuffled) total += nn.trainStep(x, y, draftLr);
      lastLoss = total / shuffled.length;
      lossHistory.push(lastLoss);
    }
    bar.style.width = Math.round((epoch / draftEpochs) * 100) + '%';
    drawChart();
    if (epoch < draftEpochs) {
      setTimeout(runChunk, 0);
    } else {
      finishTraining(nn, vocab, trainable, fallback, name, lastLoss);
    }
  }
  setTimeout(runChunk, 0);
}

function finishTraining(nn, vocab, trainable, fallback, name, finalLoss) {
  const json = nn.toJSON();
  const model = {
    id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name, vocab, sizes: json.sizes, W: json.W, b: json.b,
    intents: trainable.map(i => ({ tag: i.tag.trim(), responses: i.responses })),
    fallback: { responses: fallback.responses },
    finalLoss, createdAt: Date.now(),
  };
  const models = loadModels(); models.push(model); saveModels(models);
  setActiveModelSilent(model.id);
  training = false;
  draftName = '';
  renderApp();
}

showScreen('screen-login');
})();
