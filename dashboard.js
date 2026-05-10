let pipelines=[], leads={}, viewMode='list';
const $ = s => document.querySelector(s);
const escapeHtml=s=>String(s||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const phoneDigits=p=>String(p||'').replace(/\D/g,'');
init();
async function init(){ await load(); setupTabs(); renderStageFilter(); renderLeads(); renderFollowups(); renderStages(); $('#refresh').onclick=()=>init(); $('#search').oninput=renderLeads; $('#stageFilter').onchange=renderLeads; $('#addStage').onclick=addStageRow; $('#saveStages').onclick=saveStages; $('#export').onclick=exportJson; setupViewButtons(); }
function get(keys){return new Promise(r=>chrome.storage.local.get(keys,r));} function set(o){return new Promise(r=>chrome.storage.local.set(o,r));}
async function load(){ const r=await get(['pipelines','leads']); pipelines=r.pipelines||[]; leads=r.leads||{}; }
function setupTabs(){ document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button,.tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); $('#'+b.dataset.tab).classList.add('active');}); }
function stages(){return pipelines[0]?.stages||[];}
function renderStageFilter(){ const s=$('#stageFilter'); const val=s.value; s.innerHTML='<option value="">All stages</option>'+stages().map(st=>`<option value="${escapeHtml(st.id)}">${escapeHtml(st.name)}</option>`).join(''); s.value=val||''; }

function setupViewButtons(){
  const listBtn=$('#listView'), cardBtn=$('#cardView');
  if(!listBtn || !cardBtn) return;
  listBtn.onclick=()=>{viewMode='list'; listBtn.classList.add('active'); cardBtn.classList.remove('active'); renderLeads();};
  cardBtn.onclick=()=>{viewMode='card'; cardBtn.classList.add('active'); listBtn.classList.remove('active'); renderLeads();};
}
function formatStageData(data){
  const obj=data||{};
  const entries=Object.entries(obj).filter(([k,v])=>String(v||'').trim());
  if(!entries.length) return '-';
  return entries.map(([k,v])=>`${k}: ${v}`).join('\\n');
}
function filteredLeadArray(){
  const q=($('#search').value||'').toLowerCase();
  const f=$('#stageFilter').value;
  let arr=Object.values(leads);
  if(f)arr=arr.filter(l=>l.stageId===f);
  if(q)arr=arr.filter(l=>JSON.stringify(l).toLowerCase().includes(q));
  arr.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return arr;
}

function renderLeads(){
  const arr=filteredLeadArray();

  const table=$('#leadTable');
  const cards=$('#leadCards');

  if(viewMode==='card'){
    if(table) table.style.display='none';
    if(cards) cards.style.display='grid';
  } else {
    if(table) table.style.display='table';
    if(cards) cards.style.display='none';
  }

  if(table){
    table.innerHTML=`<tr><th>Name</th><th>Contact No.</th><th>Stage</th><th>Follow-up</th><th>Stage Fields</th><th>Notes</th><th>Updated</th><th>Action</th></tr>`+arr.map(l=>`<tr>
      <td>${escapeHtml(l.name)}</td>
      <td>${escapeHtml(l.phone||'-')}</td>
      <td><span class="pill" style="background:${escapeHtml(l.stageColor||'#334155')}">${escapeHtml(l.stageName||l.stageId||'-')}</span></td>
      <td>${escapeHtml(l.followup||'-')}</td>
      <td><pre style="white-space:pre-wrap;margin:0">${escapeHtml(formatStageData(l.stageData))}</pre></td>
      <td>${escapeHtml(l.notes||'-')}</td>
      <td>${escapeHtml(l.updatedAt||'-')}</td>
      <td><button class="rowbtn" data-open="${escapeHtml(l.id)}">Open WhatsApp</button><button class="rowbtn" data-del="${escapeHtml(l.id)}" style="background:#ef4444;color:#fff">Delete</button></td>
    </tr>`).join('');
  }

  if(cards){
    cards.innerHTML=arr.map(l=>`<div class="leadCard">
      <h3>${escapeHtml(l.name||'Unknown')}</h3>
      <div class="muted">${escapeHtml(l.phone||'-')}</div>
      <div style="margin-top:8px"><span class="pill" style="background:${escapeHtml(l.stageColor||'#334155')}">${escapeHtml(l.stageName||l.stageId||'-')}</span></div>
      <div class="kv">
        <b>Follow-up</b><span>${escapeHtml(l.followup||'-')}</span>
        <b>About</b><span>${escapeHtml(l.about||'-')}</span>
        <b>Updated</b><span>${escapeHtml(l.updatedAt||'-')}</span>
        <b>ID</b><span>${escapeHtml(l.id||'-')}</span>
      </div>
      <div class="stageData"><b>Stage Fields</b>\\n${escapeHtml(formatStageData(l.stageData))}</div>
      <div class="notesBox"><b>Notes</b>\\n${escapeHtml(l.notes||'-')}</div>
      <div style="margin-top:10px"><button class="rowbtn" data-open="${escapeHtml(l.id)}">Open WhatsApp</button><button class="rowbtn" data-del="${escapeHtml(l.id)}" style="background:#ef4444;color:#fff">Delete</button></div>
    </div>`).join('') || '<p class="muted">No leads found.</p>';
  }

  document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>openWA(leads[b.dataset.open]));
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{delete leads[b.dataset.del]; await set({leads}); renderLeads(); renderFollowups();});
}
function openWA(l){ const d=phoneDigits(l?.phone); const url=d?`https://web.whatsapp.com/send?phone=${d}`:'https://web.whatsapp.com/'; chrome.runtime.sendMessage({type:'OPEN_WA',url}); }
function renderFollowups(){ const now=new Date(); const arr=Object.values(leads).filter(l=>l.followup).sort((a,b)=>String(a.followup).localeCompare(String(b.followup))); $('#followupList').innerHTML=arr.map(l=>`<div class="card"><b>${escapeHtml(l.name)}</b> <span class="muted">${escapeHtml(l.phone||'')}</span><br>Follow-up: ${escapeHtml(l.followup)}<br><button class="rowbtn" data-fopen="${escapeHtml(l.id)}">Open WhatsApp</button></div>`).join('') || '<p class="muted">No follow-ups.</p>'; document.querySelectorAll('[data-fopen]').forEach(b=>b.onclick=()=>openWA(leads[b.dataset.fopen])); }
function renderStages(){ $('#stageList').innerHTML=stages().map(st=>stageRow(st)).join(''); }
function stageRow(st={id:'',name:'',color:'#334155',formFields:[]}){ return `<div class="stageEdit"><input class="st-name" value="${escapeHtml(st.name)}" placeholder="Stage name"><input class="st-color" type="color" value="${escapeHtml(st.color||'#334155')}"><input class="st-fields" value="${escapeHtml((st.formFields||[]).join(','))}" placeholder="fields comma separated"><button class="remove">Remove</button></div>`; }
function addStageRow(){ $('#stageList').insertAdjacentHTML('beforeend',stageRow({id:'stage_'+Date.now(),name:'New Stage',color:'#334155',formFields:[]})); document.querySelectorAll('.remove').forEach(b=>b.onclick=()=>b.closest('.stageEdit').remove()); }
async function saveStages(){ const rows=[...document.querySelectorAll('.stageEdit')]; const newStages=rows.map((r,i)=>{ const name=r.querySelector('.st-name').value.trim()||`Stage ${i+1}`; return {id:name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')||`stage_${i}`, name, color:r.querySelector('.st-color').value||'#334155', formFields:r.querySelector('.st-fields').value.split(',').map(x=>x.trim()).filter(Boolean)}; }); pipelines=[{...(pipelines[0]||{id:'default',name:'Default Pipeline'}),stages:newStages}]; await set({pipelines}); renderStageFilter(); renderStages(); alert('Pipeline saved. Refresh WhatsApp Web to reload sidebar buttons.'); }
function exportJson(){ const blob=new Blob([JSON.stringify({pipelines,leads},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='whatsapp-crm-backup.json'; a.click(); }
document.addEventListener('click',e=>{if(e.target.classList.contains('remove'))e.target.closest('.stageEdit').remove();});
