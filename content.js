let panel, currentChatKey = null, currentStageId = null, pendingStageId = null, isSavingLead = false, justSavedLeadUntil = 0, currentContact = {}, pipelines = [], stageFormData = {};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = s => (s || '').replace(/\s+/g,' ').trim();
const phoneRegex = /(\+?\d[\d\s().-]{7,}\d)/g;
const sanitizePhone = p => (p || '').replace(/[^\d]/g,'');

init();

async function init(){
  await ensureDefaults();
  await loadPipelines();
  createPanel();
  restorePanelPosition();
  makeDraggable(panel);
  watchChatChanges();
  setupSelectionSaver();
  setTimeout(handleChatChanged, 1200);
}

function chromeGet(keys){ return new Promise(resolve => chrome.storage.local.get(keys, resolve)); }
function chromeSet(obj){ return new Promise(resolve => chrome.storage.local.set(obj, resolve)); }

async function ensureDefaults(){
  const res = await chromeGet(['pipelines','leads']);
  if (!res.pipelines || !res.leads) {
    const patch = {};
    if (!res.leads) patch.leads = {};
    if (!res.pipelines) patch.pipelines = [{id:'default',name:'Default Pipeline',stages:[
      {id:'new',name:'New Lead',color:'#2563eb',formFields:['requirement','budget','location']},
      {id:'contacted',name:'Contacted',color:'#7c3aed',formFields:['contactResult','nextAction']},
      {id:'qualified',name:'Qualified',color:'#d97706',formFields:['budget','location','propertyType']},
      {id:'viewing',name:'Viewing',color:'#0891b2',formFields:['viewingDate','propertyShown']},
      {id:'negotiation',name:'Negotiation',color:'#dc2626',formFields:['offerPrice','sellerResponse']},
      {id:'closed',name:'Closed',color:'#16a34a',formFields:['dealValue','closingNote']},
      {id:'dead',name:'Dead',color:'#6b7280',formFields:['lostReason']}
    ]}];
    await chromeSet(patch);
  }
}
async function loadPipelines(){ pipelines = (await chromeGet(['pipelines'])).pipelines || []; }
const stages = () => (pipelines[0]?.stages || []);
const stageById = id => stages().find(s => s.id === id) || stages()[0];

function createPanel(){
  if (document.getElementById('wa-crm-panel')) return;
  panel = document.createElement('div');
  panel.id = 'wa-crm-panel';
  panel.innerHTML = `
    <div id="wa-crm-header"><span>CRM Overlay ☰</span><span id="crm-close">×</span></div>
    <div id="wa-crm-body">
      <div class="crm-card">
        <div class="crm-label">Current Lead</div>
        <div id="crm-contact-name" style="font-weight:800;font-size:15px">No chat detected</div>
        <div id="crm-contact-phone" class="crm-mini">Phone: -</div>
        <div class="crm-label">Current Status</div>
        <span id="crm-status-pill" class="crm-status-pill">None</span>
        <div id="crm-warning" class="crm-warn"></div>
      </div>
      <div class="crm-label">Pipeline Stage</div>
      <div id="crm-stage-buttons" class="crm-stage-grid"></div>
      <div id="crm-stage-form" class="crm-card" style="margin-top:10px"></div>
      <div class="crm-label">Follow-up</div>
      <div class="crm-row"><input id="crm-follow-date" class="crm-input" type="date"><input id="crm-follow-time" class="crm-input" type="time"></div>
      <div class="crm-actions"><button id="crm-today" class="crm-btn dark">Today</button><button id="crm-tomorrow" class="crm-btn dark">Tomorrow</button></div>
      <div class="crm-label">Notes</div>
      <textarea id="crm-notes" class="crm-textarea" placeholder="Lead notes"></textarea>
      <div class="crm-actions"><button id="crm-save" class="crm-btn green">Save Lead</button><button id="crm-sync" class="crm-btn dark">Sync Contact</button></div>
      <div class="crm-actions"><button id="crm-dashboard" class="crm-btn dark">Dashboard</button><button id="crm-clear" class="crm-btn red">Clear Form</button></div>
      <div id="crm-debug" class="crm-debug">Waiting for chat...</div>
    </div>`;
  document.body.appendChild(panel);
  document.getElementById('crm-close').onclick = () => panel.style.display = 'none';
  document.getElementById('crm-save').onclick = async () => {
  isSavingLead = true;

  // If user selected a stage, this is the truth for this save.
  const stageToSave = pendingStageId || currentStageId;

  await forceFreshContactBeforeSave();

  if (stageToSave) {
    currentStageId = stageToSave;
    pendingStageId = stageToSave;
    renderActiveStage();
    renderStageForm(stageToSave);
  }

  await saveLead(false);

  const savedKey = currentChatKey;

  // Guard against WhatsApp header/sidebar mutation events wiping the form after save.
  justSavedLeadUntil = Date.now() + 2500;

  // Reload exact record first.
  await syncSavedLeadBackToForm(savedKey);

  // Then force phone-based sync from dashboard.
  await syncCurrentChatFromDashboard();

  pendingStageId = null;
  isSavingLead = false;

  setTimeout(() => {
    if (Date.now() < justSavedLeadUntil) {
      syncCurrentChatFromDashboard();
    }
  }, 700);
};
  document.getElementById('crm-sync').onclick = () => syncCurrentChatFromDashboard();
  document.getElementById('crm-dashboard').onclick = () => chrome.runtime.sendMessage({type:'OPEN_DASHBOARD'});
  document.getElementById('crm-clear').onclick = clearForm;
  document.getElementById('crm-today').onclick = () => setFollowDate(0);
  document.getElementById('crm-tomorrow').onclick = () => setFollowDate(1);
  renderStageButtons();
}
function renderStageButtons(){
  const box = document.getElementById('crm-stage-buttons');
  box.innerHTML='';
  stages().forEach(stage => {
    const b = document.createElement('button');
    b.className = 'crm-stage-btn';
    b.textContent = stage.name;
    b.style.background = stage.color || '#334155';
    b.dataset.stage = stage.id;
    b.onclick = async () => {
      // User-selected stage is a pending edit.
      // It must not be overwritten by contact refresh, sidebar scrape, or lead reload.
      currentStageId = stage.id;
      pendingStageId = stage.id;
      renderActiveStage();
      renderStageForm(stage.id);
      setDebug(`Stage selected: ${stage.name}\nClick Save Lead to update this lead.`);
    };
    box.appendChild(b);
  });
  renderActiveStage();
}
function renderActiveStage(){
  document.querySelectorAll('.crm-stage-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.stage === currentStageId));
  const st = stageById(currentStageId);
  const pill = document.getElementById('crm-status-pill');
  pill.textContent = st?.name || 'None';
  pill.style.background = st?.color || '#334155';
}
function renderStageForm(stageId){
  const st = stageById(stageId);
  const fields = st?.formFields || [];
  const box = document.getElementById('crm-stage-form');
  if (!fields.length){ box.innerHTML='<div class="crm-mini">No stage fields.</div>'; return; }
  box.innerHTML = `<div class="crm-label">${st.name} Details</div>` + fields.map(f => `
    <div class="crm-field-title">${labelize(f)}</div>
    <input class="crm-input crm-stage-field" data-field="${escapeHtml(f)}" value="${escapeHtml(stageFormData[f] || '')}" placeholder="${escapeHtml(labelize(f))}">
  `).join('');
  box.querySelectorAll('.crm-stage-field').forEach(inp => inp.oninput = () => stageFormData[inp.dataset.field] = inp.value);
}
function labelize(s){return String(s).replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());}
function escapeHtml(s){return String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}

function watchChatChanges(){
  let last = '';
  setInterval(() => {
    const sig = getHeaderSignature();
    if (sig && sig !== last) { last = sig; handleChatChanged(); }
  }, 900);
  document.addEventListener('click', e => {
    const row = e.target.closest('[role="listitem"], [aria-selected="true"], div[tabindex="-1"]');
    if (row) setTimeout(handleChatChanged, 650);
  }, true);
}
function getHeaderSignature(){
  const header = getChatHeader();
  return clean(header?.innerText || '');
}
async function handleChatChanged(){
  const basic = scrapeBasicChat();

  // After Save, WhatsApp can fire header/sidebar mutations while closing Contact Info.
  // Do not clear the form during this short window.
  if (Date.now() < justSavedLeadUntil && currentChatKey) {
    updateContactUI();
    await syncSavedLeadBackToForm(currentChatKey);
    setDebug(`Post-save sync preserved form:\nKey: ${currentChatKey}`);
    return;
  }

  currentContact = basic;
  currentChatKey = makeLeadKey(currentContact);

  if (!isSavingLead && !pendingStageId) {
    currentStageId = null;
    stageFormData = {};
    updateContactUI();
    clearForm();
    await loadLeadForCurrentKey(true);
  } else {
    updateContactUI();
    await loadLeadForCurrentKey(false);
  }

  setDebug(`Detected chat:\nName: ${basic.name || '-'}\nPhone: ${basic.phone || '-'}\nKey: ${currentChatKey || '-'}`);
}
function getChatHeader(){
  const headers = [...document.querySelectorAll('header')];
  // The chat header normally contains Call/Search/menu controls and is not the left app header.
  return headers.find(h => /Call|Search|Contact info|Video/i.test(h.innerText || '')) || headers[headers.length-1] || null;
}
function scrapeBasicChat(){
  const header = getChatHeader();
  let name = '';
  let phone = '';
  if (header){
    const text = clean(header.innerText);
    const lines = (header.innerText || '').split('\n').map(clean).filter(Boolean);
    const ignore = /^(call|search|menu|more|video|typing|online|last seen|contact info)$/i;
    name = lines.find(x => !ignore.test(x) && x.length > 1) || '';
    const pm = text.match(phoneRegex);
    if (pm) phone = pm[0];
  }
  if (!name) {
    const selected = document.querySelector('[aria-selected="true"], [role="listitem"][tabindex="0"]');
    const lines = (selected?.innerText || '').split('\n').map(clean).filter(Boolean);
    name = lines.find(x => x.length > 1 && !/^\d{1,2}:\d{2}/.test(x)) || '';
  }
  return {name: name || 'Unknown', phone: phone || '', about:'', image:'', lastDetectedAt: new Date().toISOString()};
}
function makeLeadKey(c){
  const p = sanitizePhone(c?.phone);
  if (p && p.length >= 8) return `phone:${p}`;
  const n = clean(c?.name || 'Unknown');
  return `name:${n.toLowerCase()}`;
}
function updateContactUI(){
  document.getElementById('crm-contact-name').textContent = currentContact.name || 'Unknown';
  document.getElementById('crm-contact-phone').textContent = `Phone: ${currentContact.phone || '-'}`;
}

async function scrapeViaProfileSidebar(){
  try {
    const header = getChatHeader();
    if (!header) { setDebug('No chat header found.'); return {}; }
    const beforeText = document.body.innerText;
    const clickable = findProfileClickTarget(header);
    if (!clickable) { setDebug('Could not find profile click target in header.'); return {}; }
    clickable.click();
    const sidebar = await waitForContactInfoPanel(beforeText, 5000);
    if (!sidebar) { setDebug('Contact info sidebar not found after profile click.'); return {}; }
    await sleep(500);
    const data = scrapeContactPanel(sidebar);
    closeContactPanel(sidebar);
    setDebug(`Profile scrape result:\nName: ${data.name || '-'}\nPhone: ${data.phone || '-'}\nAbout: ${data.about || '-'}\nKey: ${makeLeadKey(data)}`);
    return data;
  } catch (err) {
    setDebug('Profile scrape error: ' + (err?.message || err));
    return {};
  }
}
function findProfileClickTarget(header){
  // Avoid CRM panel z-index issue by selecting WhatsApp header elements only, never coordinates.
  const candidates = [
    ...header.querySelectorAll('img'),
    ...header.querySelectorAll('[role="button"]'),
    ...header.querySelectorAll('div[title], span[title]')
  ];
  // Prefer avatar image or title area, avoid call/search/menu buttons by text/aria-label.
  for (const el of candidates) {
    const t = clean((el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || ''));
    if (/call|search|menu|more|video/i.test(t)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 20 && r.height > 20) return el;
  }
  // fallback: click first third of chat header title area
  return header.querySelector('div, span');
}
async function waitForContactInfoPanel(beforeText, timeout=5000){
  const start = Date.now();
  while(Date.now()-start < timeout){
    const panels = [...document.querySelectorAll('div[role="dialog"], aside, section, div')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 250 || r.height < 250) return false;
        if (r.left < window.innerWidth * .45) return false; // right-side drawer/panel
        const txt = el.innerText || '';
        return /Contact info|About|Media, links and docs|Disappearing messages|Encryption|Search/i.test(txt);
      });
    if (panels.length) return panels.sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];
    await sleep(200);
  }
  return null;
}
function scrapeContactPanel(panelEl){
  const txtRaw = panelEl.innerText || '';
  const lines = txtRaw.split('\n').map(clean).filter(Boolean);
  const phoneMatches = txtRaw.match(phoneRegex) || [];
  const phone = phoneMatches.map(clean).find(p => sanitizePhone(p).length >= 8) || '';
  let name = '';
  const bad = /^(Contact info|Search|About|Media, links and docs|Starred messages|Mute notifications|Disappearing messages|Encryption|Block|Report|Delete|Phone|Mobile)$/i;
  for (const line of lines){
    if (bad.test(line)) continue;
    if (phone && line.includes(phone)) continue;
    if (line.length >= 2 && line.length <= 80){ name = line; break; }
  }
  const aboutIndex = lines.findIndex(l => /^About$/i.test(l));
  const about = aboutIndex >= 0 ? (lines[aboutIndex+1] || '') : '';
  const img = [...panelEl.querySelectorAll('img')].map(i=>i.src).find(src => src && !src.startsWith('data:')) || '';
  return {name: name || currentContact.name || 'Unknown', phone, about, image: img, lastSyncedAt: new Date().toISOString()};
}
function closeContactPanel(panelEl){
  const closeButtons = [...panelEl.querySelectorAll('[aria-label="Close"], [data-icon="x"], [role="button"]')];
  const close = closeButtons.find(b => /close|x/i.test(b.getAttribute('aria-label') || b.innerText || b.getAttribute('data-icon') || ''));
  if (close) close.click(); else document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
}

function findLeadByPhone(leads, phone){
  const digits = sanitizePhone(phone || '');
  if (!digits || digits.length < 8) return null;

  const directKey = `phone:${digits}`;
  if (leads[directKey]) return { key: directKey, lead: leads[directKey] };

  for (const [key, lead] of Object.entries(leads || {})) {
    const leadPhone = sanitizePhone(lead?.phone || lead?.contact?.phone || '');
    if (!leadPhone) continue;

    if (
      leadPhone === digits ||
      leadPhone.endsWith(digits) ||
      digits.endsWith(leadPhone)
    ) {
      return { key, lead };
    }
  }

  return null;
}

function populateFormFromLead(lead, key){
  if (!lead) return false;

  currentChatKey = key || lead.id || currentChatKey;

  currentContact = {
    ...currentContact,
    ...(lead.contact || {}),
    name: lead.name || currentContact.name || 'Unknown',
    phone: lead.phone || lead.contact?.phone || currentContact.phone || '',
    about: lead.about || lead.contact?.about || currentContact.about || '',
    image: lead.image || lead.contact?.image || currentContact.image || ''
  };

  currentStageId = lead.stageId || currentStageId || stages()[0]?.id || 'new';
  pendingStageId = null;
  stageFormData = { ...(lead.stageData || {}) };

  const notesEl = document.getElementById('crm-notes');
  const dateEl = document.getElementById('crm-follow-date');
  const timeEl = document.getElementById('crm-follow-time');

  if (notesEl) notesEl.value = lead.notes || '';

  if (lead.followup) {
    const [d, t] = String(lead.followup).split('T');
    if (dateEl) dateEl.value = d || '';
    if (timeEl) timeEl.value = (t || '').slice(0, 5);
  } else {
    if (dateEl) dateEl.value = '';
    if (timeEl) timeEl.value = '';
  }

  updateContactUI();
  renderActiveStage();
  renderStageForm(currentStageId);

  setDebug(
    `Form synced from dashboard record:\nName: ${lead.name || '-'}\nPhone: ${lead.phone || '-'}\nStage: ${lead.stageName || lead.stageId || '-'}`
  );

  return true;
}

async function scrapeCurrentChatContactStrict(){
  const deep = await scrapeViaProfileSidebar();

  if (deep && (deep.phone || deep.name)) {
    currentContact = {
      ...currentContact,
      ...deep
    };
    currentChatKey = makeLeadKey(currentContact);
    updateContactUI();
    return currentContact;
  }

  const basic = scrapeBasicChat();
  currentContact = {
    ...currentContact,
    ...basic
  };
  currentChatKey = makeLeadKey(currentContact);
  updateContactUI();
  return currentContact;
}

async function syncCurrentChatFromDashboard(){
  try {
    isSavingLead = true;
    setDebug('Syncing current chat from dashboard by phone...');

    const contact = await scrapeCurrentChatContactStrict();
    const digits = sanitizePhone(contact?.phone || '');

    if (!digits || digits.length < 8) {
      setDebug('Sync failed: phone number not found in current chat.');
      isSavingLead = false;
      return false;
    }

    const { leads = {} } = await chromeGet(['leads']);
    const found = findLeadByPhone(leads, digits);

    if (!found) {
      setDebug(`No dashboard record found for phone:\n${contact.phone || digits}`);
      isSavingLead = false;
      return false;
    }

    populateFormFromLead(found.lead, found.key);

    justSavedLeadUntil = Date.now() + 1500;
    isSavingLead = false;
    return true;

  } catch (err) {
    isSavingLead = false;
    setDebug('Sync error: ' + (err?.message || err));
    return false;
  }
}


async function syncAndReload(){
  const deep = await scrapeViaProfileSidebar();
  if (deep && (deep.phone || deep.name)) {
    currentContact = {...currentContact, ...deep};
    currentChatKey = makeLeadKey(currentContact);
    updateContactUI();
    // removed reload to preserve updated stage selection
    // autosave removed to prevent duplicate lead creation
  }
}
async function loadLeadForCurrentKey(resetIfNone){
  if (!currentChatKey) return;
  const {leads={}} = await chromeGet(['leads']);
  const lead = leads[currentChatKey];
  if (!lead){
    if(resetIfNone && Date.now() >= justSavedLeadUntil) {
      currentStageId=null;
      stageFormData={};
      clearForm();
    }
    updateContactUI(); renderActiveStage(); renderStageForm(currentStageId || stages()[0]?.id);
    return;
  }
  currentContact = {...currentContact, ...(lead.contact || {}), name: lead.name || currentContact.name, phone: lead.phone || currentContact.phone};
  // Do not overwrite a stage the user just selected.
  if (pendingStageId) {
    currentStageId = pendingStageId;
  } else if (!currentStageId || resetIfNone) {
    if (pendingStageId) {
    currentStageId = pendingStageId;
  } else if (!currentStageId || resetIfNone) {
    currentStageId = lead.stageId || null;
  }
  }
  stageFormData = lead.stageData || stageFormData || {};
  document.getElementById('crm-notes').value = lead.notes || '';
  const dt = lead.followup || '';
  if (dt) { const [d,t] = dt.split('T'); document.getElementById('crm-follow-date').value=d||''; document.getElementById('crm-follow-time').value=(t||'').slice(0,5); }
  updateContactUI(); renderActiveStage(); renderStageForm(currentStageId || stages()[0]?.id);
}

async function forceFreshContactBeforeSave(){
  try {
    setDebug('Refreshing contact before save...');

    const deep = await scrapeViaProfileSidebar();

    if (deep && (deep.phone || deep.name)) {

      currentContact = {
        ...currentContact,
        ...deep
      };

      const freshPhone = sanitizePhone(deep.phone || '');
      const freshPhoneKey = freshPhone ? `phone:${freshPhone}` : null;

      const { leads = {} } = await chromeGet(['leads']);

      if (freshPhoneKey && leads[freshPhoneKey]) {

        const existing = leads[freshPhoneKey];

        currentChatKey = freshPhoneKey;

        currentContact = {
          ...(existing.contact || {}),
          ...currentContact
        };

        setDebug(
          `Existing lead detected.\nUpdating existing phone record:\n${freshPhoneKey}`
        );

      } else {
        currentChatKey = makeLeadKey(currentContact);
      }

      updateContactUI();
    }

  } catch (err) {
    setDebug('Force refresh before save failed: ' + (err?.message || err));
  }
}



async function syncSavedLeadBackToForm(keyToSync){
  const key = keyToSync || currentChatKey;
  if (!key) return;

  const { leads = {} } = await chromeGet(['leads']);
  const saved = leads[key];

  if (!saved) return;

  populateFormFromLead(saved, key);
}

async function saveLead(silent){
  if (!currentChatKey) currentChatKey = makeLeadKey(currentContact);
  const {leads={}} = await chromeGet(['leads']);
  const date = document.getElementById('crm-follow-date').value;
  const time = document.getElementById('crm-follow-time').value;
  const followup = date ? `${date}${time ? 'T'+time : ''}` : '';
  // preserve currently selected stage during updates
  // Final guard: pending user-selected stage wins over any loaded/stored stage.
  if (pendingStageId) currentStageId = pendingStageId;
  currentStageId = currentStageId || stages()[0]?.id || 'new';
  document.querySelectorAll('.crm-stage-field').forEach(inp => stageFormData[inp.dataset.field] = inp.value);
  const key = makeLeadKey(currentContact);
  // if key changed from name fallback to phone after scrape, migrate old record.
  if (key !== currentChatKey && leads[currentChatKey]) { leads[key] = {...leads[currentChatKey]}; delete leads[currentChatKey]; currentChatKey = key; }
  leads[currentChatKey] = {
    ...(leads[currentChatKey] || {}),
    id: currentChatKey,
    name: currentContact.name || 'Unknown',
    phone: currentContact.phone || '',
    about: currentContact.about || '',
    image: currentContact.image || '',
    contact: currentContact,
    stageId: currentStageId,
    stageName: stageById(currentStageId)?.name || currentStageId,
    stageColor: stageById(currentStageId)?.color || '#334155',
    stageData: stageFormData,
    notes: document.getElementById('crm-notes').value || '',
    followup,
    updatedAt: new Date().toISOString()
  };
  await chromeSet({leads});
  renderActiveStage();
  if (!silent) setDebug(`Saved lead:\nName: ${leads[currentChatKey].name}\nPhone: ${leads[currentChatKey].phone || '-'}\nStage: ${leads[currentChatKey].stageName}`);
}
function clearForm(){
  document.getElementById('crm-notes').value=''; document.getElementById('crm-follow-date').value=''; document.getElementById('crm-follow-time').value=''; stageFormData={}; renderStageForm(currentStageId || stages()[0]?.id); renderActiveStage();
}
function setFollowDate(offset){
  const d = new Date(); d.setDate(d.getDate()+offset); document.getElementById('crm-follow-date').value = d.toISOString().slice(0,10);
}
function setDebug(t){ const el=document.getElementById('crm-debug'); if(el) el.textContent=t; }
function restorePanelPosition(){
  chrome.storage.local.get(['panelPos'], res => { const p=res.panelPos; if(p){ panel.style.left=p.left+'px'; panel.style.top=p.top+'px'; panel.style.right='auto'; }});
}
function makeDraggable(el){
  const header = document.getElementById('wa-crm-header'); let dragging=false, ox=0, oy=0;
  header.addEventListener('mousedown', e=>{ if(e.target.id==='crm-close')return; dragging=true; ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; e.preventDefault(); });
  document.addEventListener('mousemove', e=>{ if(!dragging)return; el.style.left=Math.max(0,e.clientX-ox)+'px'; el.style.top=Math.max(0,e.clientY-oy)+'px'; el.style.right='auto'; });
  document.addEventListener('mouseup', ()=>{ if(dragging){ dragging=false; chrome.storage.local.set({panelPos:{left:el.offsetLeft, top:el.offsetTop}}); }});
}
function setupSelectionSaver(){
  let popup;
  document.addEventListener('mouseup', e => {
    const selected = String(window.getSelection?.() || '').trim();
    if (popup) popup.remove();
    if (!selected || selected.length < 2 || panel?.contains(e.target)) return;
    popup = document.createElement('div'); popup.className='crm-selected-popup';
    popup.style.left = (e.pageX+8)+'px'; popup.style.top = (e.pageY+8)+'px';
    popup.innerHTML = '<button>Save selected text</button>';
    popup.querySelector('button').onclick = () => {
      const notes = document.getElementById('crm-notes');
      notes.value = (notes.value ? notes.value + '\n' : '') + selected;
      popup.remove();
    };
    document.body.appendChild(popup);
  });
}
