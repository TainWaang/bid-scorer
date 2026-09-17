/* Shared project, import, scenario, search and report controls for both layouts. */
const WorkspaceUI = (() => {
  let state, defaults, store, adapter, loadError, lastSaved, worker, rejectSearch;
  let preview = null, fingerprint;
  const calculationKey = () => JSON.stringify({config:state.config,bidders:state.bidders,search:state.search});
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = n => Number(n).toLocaleString('zh-CN', {maximumFractionDigits:6});
  function snapshot() { return Workspace.clone({config:state.config,bidders:state.bidders,scenarios:state.scenarios,search:state.search || {}}); }
  function apply(data) {
    state.config = {...Workspace.clone(defaults.config), ...data.config, strategyParams:{...defaults.config.strategyParams,...data.config.strategyParams}};
    state.bidders = Workspace.clone(data.bidders);
    state.scenarios = Workspace.clone(data.scenarios || []);
    state.search = Workspace.clone(data.search || {});
    state.predictResult = null;
  }
  function load(s) {
    state = s;
    defaults = snapshot();
    try { store = Workspace.createStore(localStorage, defaults); apply(store.open()); }
    catch (error) { loadError = error.message; store = null; }
    lastSaved = JSON.stringify(snapshot());
  }
  function status(message, error = false) {
    if (!$('ws-status')) return;
    $('ws-status').textContent = message;
    $('ws-status').classList.toggle('ws-error', error);
  }
  function captureSearch() {
    if (!adapter) return;
    state.search ||= {};
    for (const [key,id] of Object.entries(adapter.searchIds)) if ($(id)) state.search[key] = $(id).value;
  }
  function save(force = false) {
    if (!state) return false;
    captureSearch();
    const data = snapshot();
    const serialized = JSON.stringify(data);
    if (!force && serialized === lastSaved) return true;
    if (!store) { status(`未保存：${loadError || '存储不可用'}。可导出项目备份。`,true); return false; }
    try {
      const time = store.save(data); lastSaved = serialized;
      status('已保存到此浏览器 · ' + new Date(time).toLocaleTimeString());
      if ($('ws-project')) {
        const option = $('ws-project').selectedOptions[0];
        if (option) option.textContent = state.config.projectName || '未命名项目';
      }
      return true;
    } catch (error) { status('未保存：' + error.message, true); return false; }
  }
  function download(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text],{type}));
    const a = document.createElement('a'); a.href=url; a.download=name.replace(/[\\/:*?"<>|]/g,'_'); a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function invalidate() {
    cancelSearch();
    for (const id of adapter?.resultIds || []) {
      const node=$(id);
      if (!node || !node.textContent.trim()) continue;
      node.classList.add('ws-stale');
      if (!node.querySelector('.ws-stale-note')) {
        const note=document.createElement('p'); note.className='ws-stale-note'; note.textContent='输入或规则已变化，此处为旧结果，请重新计算。'; node.prepend(note);
      }
    }
  }
  function fresh(...ids) {
    for (const id of ids) { $(id)?.classList.remove('ws-stale'); $(id)?.querySelectorAll('.ws-stale-note').forEach(n=>n.remove()); }
  }
  function refresh() {
    cancelSearch();
    adapter.refresh();
    for (const [key,id] of Object.entries(adapter.searchIds)) if ($(id)) $(id).value=state.search?.[key] ?? (key==='target'?state.bidders.find(b=>b.isMe)?.id||'':'');
    for (const id of adapter.clearIds || adapter.resultIds) if ($(id)) { $(id).innerHTML=''; fresh(id); }
    fresh(...adapter.resultIds);
    $('ws-name').value=state.config.projectName || '';
    renderProjects(); renderScenarios(); renderSnapshots(); renderRules();
    fingerprint=calculationKey();
  }
  function renderProjects() {
    if (!store) return;
    $('ws-project').innerHTML=store.list().map(p=>`<option value="${esc(p.id)}" ${p.active?'selected':''}>${esc(p.name)}</option>`).join('');
    $('ws-templates').innerHTML='<option value="">选择已保存规则</option>'+store.templates().map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  }
  function transact(fn) {
    try { fn(); } catch(error) { status(error.message,true); }
  }
  function mount(a) {
    adapter=a;
    const panel=document.createElement('section'); panel.className='ws-panel';
    panel.innerHTML=`<div class="ws-title">项目工作区</div>
      <div class="ws-row"><label>当前项目<select id="ws-project" aria-label="当前项目"></select></label><label>项目名称<input id="ws-name" maxlength="200"></label></div>
      <div class="ws-actions"><button id="ws-new">新建项目</button><button id="ws-copy">复制项目</button><button id="ws-export">导出项目</button><label class="ws-file">导入项目<input id="ws-import" type="file" accept=".json,application/json"></label><button id="ws-report">导出测算报告</button><button id="ws-reload">重新加载</button></div>
      <p id="ws-status" role="status" aria-live="polite">数据保存在此浏览器，跨设备请使用项目文件导入/导出。</p>
      <details><summary>规则模板与录入口径</summary><div class="ws-row"><button id="ws-raw">按分值构成录入原始分</button><button id="ws-percent">商务/技术使用百分制</button><button id="ws-template-save">保存当前规则模板</button><select id="ws-templates" aria-label="规则模板"></select></div><p class="ws-note">切换口径保留原始数值，不自动转换已录入分数；超出新上限时会提示修正。</p><div id="ws-rules"></div></details>
      <details><summary>批量录入与参与状态</summary><p class="ws-note">从 Excel 复制：名称、报价、商务分、技术分（后两列可省略，默认为0）。先预览再追加，不覆盖现有样本。</p><textarea id="ws-paste" rows="4" placeholder="名称 ⇥ 报价 ⇥ 商务分 ⇥ 技术分"></textarea><div class="ws-actions"><button id="ws-preview">预览</button><button id="ws-append" disabled>追加样本</button></div><div id="ws-preview-result"></div><div id="ws-participants"></div></details>
      <details><summary>已保存方案：恢复与复算</summary><p class="ws-note">恢复为新项目，保留当前项目。旧版方案仅有结果摘要，无法完整恢复。</p><div id="ws-snapshots"></div></details>`;
    $(a.projectHost).prepend(panel);
    $('ws-name').value=state.config.projectName || '';
    $('ws-name').addEventListener('input',()=>{state.config.projectName=$('ws-name').value; adapter.syncName?.(); save();});
    $('ws-project').addEventListener('change',()=>transact(()=>{const id=$('ws-project').value;if(!save()) {renderProjects();return;} apply(store.select(id));lastSaved=JSON.stringify(snapshot());refresh();status('已切换项目');}));
    $('ws-new').onclick=()=>transact(()=>{if(!save())return;const data=Workspace.clone(defaults);data.config.projectName='新项目';data.bidders=data.bidders.slice(0,1).map(b=>({...b,price:0,businessScore:0,techScore:0}));data.scenarios=[];data.search={};apply(store.add(data));refresh();save(true);});
    $('ws-copy').onclick=()=>transact(()=>{if(!save())return;const data=snapshot();data.config.projectName=(data.config.projectName||'未命名项目')+' 副本';apply(store.add(data));refresh();save(true);});
    $('ws-export').onclick=()=>{captureSearch();download((state.config.projectName||'项目')+'.json',Workspace.exportProject(snapshot()));};
    $('ws-import').onchange=async e=>{
      try { const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('文件不能大于10MB');const data=Workspace.importProject(await file.text());if(!save())return;apply(store.add(data));refresh();save(true); }
      catch(error){status(error.message,true);} finally{e.target.value='';}
    };
    $('ws-report').onclick=()=>transact(exportReport);
    $('ws-reload').onclick=()=>{if(confirm('重新加载会放弃当前未保存输入，建议先导出项目。继续吗？'))location.reload();};
    $('ws-template-save').onclick=()=>transact(()=>{const errors=Scoring.validateConfig(state.config,[]);if(errors.length)throw new Error(errors.join('；'));const name=prompt('规则模板名称');if(!name?.trim())return;store.saveTemplate(name,state.config);renderProjects();status('规则模板已保存');});
    $('ws-templates').onchange=()=>transact(()=>{const template=store.templates().find(t=>t.id===$('ws-templates').value);if(!template)return;state.config={...Workspace.clone(template.config),projectName:state.config.projectName};refresh();save(true);});
    $('ws-raw').onclick=()=>{state.config.businessFull=state.config.businessWeight || 100;state.config.techFull=state.config.techWeight || 100;refresh();save(true);};
    $('ws-percent').onclick=()=>{state.config.businessFull=100;state.config.techFull=100;refresh();save(true);};
    $('ws-paste').oninput=()=>{preview=null;$('ws-append').disabled=true;$('ws-preview-result').textContent='内容已修改，请重新预览';};
    $('ws-preview').onclick=()=>{try{preview=Workspace.parseTable($('ws-paste').value);const errors=Scoring.validateComponentScoreConfig(state.config,preview);if(errors.length)throw new Error(errors.join('；'));$('ws-preview-result').innerHTML=`<p>将追加${preview.length}个样本</p><div class="ws-scroll"><table><thead><tr><th>名称</th><th>报价</th><th>商务</th><th>技术</th></tr></thead><tbody>${preview.map(b=>`<tr><td>${esc(b.name)}</td><td>${fmt(b.price)}</td><td>${b.businessScore}</td><td>${b.techScore}</td></tr>`).join('')}</tbody></table></div>`;$('ws-append').disabled=!preview.length;}catch(error){preview=null;$('ws-append').disabled=true;$('ws-preview-result').textContent=error.message;}};
    $('ws-append').onclick=()=>{if(!preview)return;state.bidders.push(...preview);preview=null;refresh();save(true);$('ws-preview-result').textContent='样本已追加';$('ws-append').disabled=true;};
    for (const [key,id] of Object.entries(adapter.searchIds)) if ($(id) && state.search?.[key]!=null) $(id).value=state.search[key];
    mountSearch();
    renderProjects();renderRules();renderSnapshots();renderScenarios();
    if(loadError)status(loadError,true);
    else save(true);
    fingerprint=calculationKey();
    document.addEventListener('input',handleChange);
    document.addEventListener('change',handleChange);
    document.addEventListener('click',e=>{if(e.target.closest('.ws-panel')||e.target.closest('.ws-controls'))return;setTimeout(()=>{captureSearch();if(fingerprint!==calculationKey()){invalidate();fingerprint=calculationKey();}save();renderSnapshots();},0);});
    window.addEventListener('storage',e=>{if(e.key===Workspace.KEY)status('另一页面已更新项目，请先导出未保存内容，再重新加载。',true);});
  }
  function handleChange(e) {
    if(e.target.closest('.ws-panel') || e.target.closest('#ws-search') || e.target.closest('.ws-controls'))return;
    captureSearch();invalidate();fingerprint=calculationKey();save();renderRules();renderSnapshots();
  }
  function renderRules() {
    if(!$('ws-rules'))return;
    const c=state.config;
    const errors=Scoring.validateConfig(c,state.bidders);
    $('ws-rules').innerHTML=`<p>${esc(Scoring.describeRule(c))}</p>${c.priceStrategy==='outlierFilteredBenchmark'?`<label class="ws-participant"><input type="checkbox" id="ws-special-rule" ${c.strategyParams.outlierSpecialFullScore!==0&&c.strategyParams.outlierSpecialFullScore!==false?'checked':''}>启用技术最高且最低价满分</label>`:''}<p>综合分 = 商务原始分 ÷ ${esc(c.businessFull)} × ${esc(c.businessWeight)} + 价格分 ÷ ${esc(c.priceFull)} × ${esc(c.priceWeight)} + 技术原始分 ÷ ${esc(c.techFull)} × ${esc(c.techWeight)}</p>${errors.length?`<p class="ws-error">${errors.map(esc).join('；')}</p>`:'<p>当前规则与综合评分输入校验通过。</p>'}`;
    if($('ws-special-rule'))$('ws-special-rule').onchange=e=>{state.config.strategyParams.outlierSpecialFullScore=e.target.checked?1:0;invalidate();save();renderRules();};
    $('ws-participants').innerHTML=state.bidders.map((b,i)=>`<label class="ws-participant"><input type="checkbox" data-index="${i}" ${b.enabled!==false?'checked':''}>${esc(b.name)}${b.isMe?'（目标）':''} · ${b.priceInputError?'格式错误':b.price>0?fmt(b.price):'未报价'}</label>`).join('');
    $('ws-participants').querySelectorAll('input').forEach(input=>input.onchange=()=>{state.bidders[+input.dataset.index].enabled=input.checked;invalidate();save();renderRules();});
  }
  function renderSnapshots() {
    if(!$('ws-snapshots'))return;
    $('ws-snapshots').innerHTML=state.scenarios.map((s,i)=>`<div class="ws-row"><span>${esc(s.name)} · ${esc(s.timestamp||'历史方案')}</span><button data-index="${i}" ${s.snapshot?'':'disabled'}>${s.snapshot?'恢复为新项目':'旧版摘要，无法恢复'}</button></div>`).join('') || '<p>暂无方案</p>';
    $('ws-snapshots').querySelectorAll('button[data-index]').forEach(b=>b.onclick=()=>transact(()=>{if(!save())return;const s=state.scenarios[+b.dataset.index];const data=Workspace.clone(s.snapshot);data.config.projectName=s.name+' 复算';apply(store.add(data));refresh();save(true);}));
  }
  function createSnapshot(config, bidders) { captureSearch();return Workspace.clone({config,bidders,scenarios:[],search:state.search||{}}); }

  function mountSearch() {
    const panel=document.createElement('section');panel.id='ws-search';panel.className='ws-panel';
    panel.innerHTML=`<div class="ws-title">搜索目标与情景</div><div class="ws-row"><label>选择目标<select id="ws-objective"><option value="topRate">价格第一情景占比优先</option><option value="minScore">最差情景得分优先</option><option value="avgScore">加权平均得分优先</option><option value="threshold">全部情景达标后报价最高</option></select></label><label>最低可接受报价<input id="ws-floor" type="number" min="0" placeholder="可选"></label><label>目标价格分<input id="ws-required" type="number" min="0" value="0"></label></div>
      <label>特殊满分条件<select id="ws-special"><option value="priceOnly">仅按报价公式，不采用技术分特殊条件</option><option value="technical">采用已填写技术分（需完整数据）</option></select></label>
      <details><summary>表格管理情景（支持任意样本数量与权重）</summary><label class="ws-participant"><input type="checkbox" id="ws-use-scenarios">使用下方情景表，替代文本情景</label><button id="ws-add-scenario">从当前样本新增情景</button><p class="ws-note">报价使用分号分隔，每个技术分与报价一一对应。权重表示相对重视程度，不代表实际发生概率。</p><div id="ws-scenario-rows"></div></details>
      <div id="ws-search-status" role="status"></div><button id="ws-cancel" hidden>取消测算</button><div id="ws-ranges"></div>`;
    $(adapter.searchIds.scenarios).parentElement.after(panel);
    const values=state.search?.options||{};
    for(const [key,id] of Object.entries({objective:'ws-objective',floorPrice:'ws-floor',requiredScore:'ws-required',specialMode:'ws-special'}))if(values[key]!=null)$(id).value=values[key];
    $('ws-use-scenarios').checked=!!state.search?.useTable;
    panel.addEventListener('input',()=>{invalidate();saveSearchOptions();});
    panel.addEventListener('change',()=>{invalidate();saveSearchOptions();});
    $('ws-add-scenario').onclick=()=>{state.search ||= {};state.search.rows ||= [];state.search.rows.push({name:'情景'+(state.search.rows.length+1),weight:1,bidders:state.bidders.filter(b=>b.id!==$(adapter.searchIds.target).value && b.enabled!==false && b.price>0).map(b=>({...b}))});state.search.useTable=true;renderScenarios();save(true);};
    $('ws-cancel').onclick=cancelSearch;
  }
  function saveSearchOptions() {
    state.search ||= {};
    state.search.options={objective:$('ws-objective').value,floorPrice:$('ws-floor').value||0,requiredScore:$('ws-required').value||0,specialMode:$('ws-special').value};
    state.search.useTable=$('ws-use-scenarios').checked;
    $(adapter.searchIds.scenarios).disabled=state.search.useTable;
    save();
    fingerprint=calculationKey();
  }
  function renderScenarios() {
    if(!$('ws-scenario-rows'))return;
    const options=state.search?.options||{};
    for(const [key,id] of Object.entries({objective:'ws-objective',floorPrice:'ws-floor',requiredScore:'ws-required',specialMode:'ws-special'}))$(id).value=options[key]??({objective:'topRate',specialMode:'priceOnly'}[key]||0);
    $('ws-use-scenarios').checked=!!state.search?.useTable;
    $(adapter.searchIds.scenarios).disabled=!!state.search?.useTable;
    $('ws-scenario-rows').innerHTML=(state.search?.rows||[]).map((s,i)=>`<div class="ws-scenario"><div class="ws-row"><label>情景名称<input data-index="${i}" data-field="name" value="${esc(s.name)}"></label><label>权重<input data-index="${i}" data-field="weight" type="number" min="0.01" value="${esc(s.weight)}"></label><span id="ws-count-${i}">含目标共${(s.pricesText==null?s.bidders.length:s.pricesText.split(/[;；\n]+/).filter(v=>v.trim()).length)+1}个样本</span></div><label>其他报价<input data-index="${i}" data-field="prices" value="${esc(s.pricesText ?? s.bidders.map(b=>b.price).join('; '))}"></label><label>对应技术分（可选）<input data-index="${i}" data-field="tech" value="${esc(s.techText ?? s.bidders.map(b=>b.techScore??'').join('; '))}"></label><div class="ws-actions"><button data-copy="${i}">复制</button><button data-remove="${i}">移除</button></div></div>`).join('');
    $('ws-scenario-rows').querySelectorAll('input').forEach(el=>el.addEventListener('input',()=>{
      const s=state.search.rows[+el.dataset.index],field=el.dataset.field;
      if(field==='name'||field==='weight')s[field]=el.value;
      else s[field==='prices'?'pricesText':'techText']=el.value;
      if(field==='prices')$('ws-count-'+el.dataset.index).textContent='含目标共'+(el.value.split(/[;；\n]+/).filter(x=>x.trim()).length+1)+'个样本';
      save();
    }));
    $('ws-scenario-rows').querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{const copy=Workspace.clone(state.search.rows[+b.dataset.copy]);copy.name+=' 副本';state.search.rows.push(copy);renderScenarios();invalidate();save();});
    $('ws-scenario-rows').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{state.search.rows.splice(+b.dataset.remove,1);renderScenarios();invalidate();save();});
  }
  function scenarios(text, fallback) {
    if(!state.search?.useTable) {
      if(!text.trim() && $('ws-special').value==='technical') return [{name:'当前样本',weight:1,bidders:fallback.map(b=>({...b}))}];
      return Scoring.parsePriceScenarios(text,fallback);
    }
    return (state.search.rows||[]).map(s=>{
      if(s.pricesText==null && s.techText==null)return Workspace.clone(s);
      const prices=s.pricesText==null?s.bidders.map(b=>String(b.price)):s.pricesText.split(/[;；\n]+/).map(v=>v.trim()).filter(Boolean);
      const scores=s.techText==null?s.bidders.map(b=>b.techScore):s.techText.split(/[;；\n]/).map(v=>v.trim());
      if($('ws-special').value==='technical' && scores.length!==prices.length)throw new Error(`情景“${s.name}”技术分数量必须与报价数量相同`);
      return {name:s.name,weight:s.weight,bidders:prices.map((p,i)=>{
        if(!/^\d+(?:\.\d+)?$/.test(p))throw new Error(`情景“${s.name}”报价需为正数，用分号分隔且不含千位分隔符`);
        return {name:'样本'+(i+1),price:Number(p),techScore:scores[i]===''||scores[i]==null?null:Number(scores[i])};
      })};
    });
  }
  function cancelSearch() {
    if(worker){worker.terminate();worker=null;rejectSearch?.(new Error('测算已取消'));rejectSearch=null;}
    if($('ws-cancel'))$('ws-cancel').hidden=true;
    if($('ws-search-status'))$('ws-search-status').textContent='';
  }
  async function search(target, cases, config, range) {
    cancelSearch();saveSearchOptions();
    const targetBidder=state.bidders.find(b=>b.id===target);
    const args=[target,cases,config,{...range,...state.search.options,targetTechScore:targetBidder?.techScore}];
    fingerprint=calculationKey();
    $('ws-search-status').textContent='正在测算… 可随时取消';$('ws-cancel').hidden=false;
    $('ws-ranges').textContent='';
    const result=await new Promise((resolve,reject)=>{
      rejectSearch=reject;
      try{worker=new Worker('js/search-worker.js');worker.onmessage=e=>{const value=e.data;worker.terminate();worker=null;rejectSearch=null;$('ws-cancel').hidden=true;$('ws-search-status').textContent=value.error?'测算未完成':'测算完成';value.error?reject(new Error(value.error)):resolve(value.result);};worker.onerror=()=>{cancelSearch();reject(new Error('搜索任务无法启动，请通过本地HTTP服务或网站打开'));};worker.postMessage(args);}
      catch(error){worker=null;rejectSearch=null;$('ws-cancel').hidden=true;reject(error);}
    });
    $('ws-ranges').innerHTML=`<p>目标：${esc($('ws-objective').selectedOptions[0].textContent)}；步长 ${fmt(range.step)}；已搜索 ${result.candidates.length} 个候选。比例按情景权重计算，不是实际胜出概率。</p><details><summary>全部情景达到目标分的候选区间</summary><p>${result.ranges.length?result.ranges.map(r=>`${fmt(r.min)} ～ ${fmt(r.max)}`).join('；'):'没有满足条件的候选'}</p><p>仅代表已搜索点，步长之间未经验证，规则切换处可能不连续。</p></details>`;
    if(!result.best)throw new Error('当前搜索范围内没有达到目标得分的候选，请调整条件');
    return result;
  }
  function exportReport() {
    const data=snapshot();const errors=Scoring.validateConfig(data.config,data.bidders);if(errors.length)throw new Error(errors.join('；'));
    const result=Scoring.evaluate(data.bidders,data.config);
    const count=Scoring.summarizeBidValidity(data.bidders);
    const details=result.map(b=>`<tr><td>${esc(b.name)}</td><td>${fmt(b.price)}</td><td>${b.priceRank}${b.priceTied?'（并列）':''}</td><td>${b.priceScore.toFixed(2)}</td><td>${b.businessScore}</td><td>${b.techScore}</td><td>${b.total.toFixed(4)}</td><td>${b.rank}${b.tied?'（并列）':''}</td><td>${b.benchmark==null?'—':fmt(b.benchmark)}</td></tr>`).join('');
    const body=`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>测算报告</title><style>body{font:14px sans-serif;margin:32px;color:#172b4d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px}th{background:#eef3f8}pre{white-space:pre-wrap}button{padding:8px}@media print{button{display:none}}</style><h1>${esc(data.config.projectName||'报价测算')}</h1><p>生成时间：${esc(new Date().toLocaleString())}</p><p>${esc(Scoring.describeRule(data.config))}</p><p>分值构成：${data.config.businessWeight}/${data.config.priceWeight}/${data.config.techWeight}；录入满分：${data.config.businessFull}/${data.config.priceFull}/${data.config.techFull}</p><p>已建立${count.totalCount}个，有效${count.validCount}个。未参与：${count.invalidBidders.map(b=>esc(b.name)).join('、')||'无'}</p>${trace(result)}<table><thead><tr><th>名称</th><th>报价</th><th>价格排名</th><th>价格分</th><th>商务</th><th>技术</th><th>总分</th><th>综合排名</th><th>基准价</th></tr></thead><tbody>${details}</tbody></table><p>同分采用并列排名。规则及数据取自本次导出的项目状态。</p><details><summary>完整复核数据</summary><pre>${esc(Workspace.exportProject(data))}</pre></details><button onclick="window.print()">打印 / 保存PDF</button></html>`;
    download((data.config.projectName||'测算')+'-报告.html',body,'text/html');status('报告已导出，可打开后打印为PDF');
  }
  function trace(rows) {
    const b=rows.find(b=>b.benchmark>0);if(!b)return '';
    return `<details class="ws-trace"><summary>基准价 ${fmt(b.benchmark)} · 查看计算过程</summary><p>${esc(Scoring.describeRule(state.config))}</p>${b.preliminaryAverage!=null?`<p>初始均价：${fmt(b.preliminaryAverage)}；高价阈值：${fmt(b.exclusionThreshold)}；不纳入均价：${(b.excludedHighBidderNames||[]).map(esc).join('、')||'无'}</p>`:''}${b.validBidCount!=null?`<p>有效${b.validBidCount}个；${b.trimCount!=null?'两端各去'+b.trimCount+'个；':''}纳入均价${b.includedBidCount}个。</p>`:''}<p>偏差率 =（报价 − 基准价）÷ 基准价 × 100%；按所选规则的高低侧斜率及舍入顺序计分，再应用得分上下限与特殊条件。</p></details>`;
  }
  function resultTools(rows) {
    const view=state.resultView||{sort:'rank',query:''};
    const target=rows.find(b=>b.isMe);
    const max=rows.length?Math.max(...rows.map(b=>b.priceScore)):0;
    return `<div class="ws-controls"><label>结果排序<select id="ws-result-sort" onchange="WorkspaceUI.changeView('sort',this.value)">${[['rank','综合排名'],['priceRank','价格排名'],['priceAsc','报价从低到高'],['priceDesc','报价从高到低']].map(([key,label])=>`<option value="${key}" ${view.sort===key?'selected':''}>${label}</option>`).join('')}</select></label><label>查找样本<input id="ws-result-query" value="${esc(view.query)}" placeholder="输入名称后按回车" onchange="WorkspaceUI.changeView('query',this.value)"></label><button onclick="WorkspaceUI.changeView('query','');document.querySelector('[data-result-target]')?.scrollIntoView({block:'center',behavior:'smooth'})">定位目标</button>${target?`<p>目标价格排名：${target.priceTied?'并列':''}${target.priceRank}；距最高价格分：${(max-target.priceScore).toFixed(2)}分</p>`:''}</div>`;
  }
  function changeView(key,value){state.resultView={sort:'rank',query:'',...state.resultView,[key]:value};adapter.renderResults();}
  function comparisonHint() {
    const known=state.scenarios.filter(s=>s.snapshot);
    const key=s=>JSON.stringify({config:s.snapshot.config,others:s.snapshot.bidders.filter(b=>!b.isMe)});
    const different=known.length>1 && known.some(s=>key(s)!==key(known[0]));
    return `<p class="ws-note">${different?'这些方案的规则或其他样本条件不同，分数不可直接视为同条件优劣。可恢复为新项目核对。':'方案记录保存时的结果；修改当前规则不会改写历史方案。'}${state.scenarios.some(s=>!s.snapshot)?' 部分旧方案仅保留摘要，无法完整复算。':''}</p>`;
  }
  function sortedResults(rows){const view=state.resultView||{sort:'rank',query:''};return rows.filter(b=>!view.query||b.name.toLowerCase().includes(view.query.toLowerCase())).slice().sort((a,b)=>view.sort==='priceAsc'?a.price-b.price:view.sort==='priceDesc'?b.price-a.price:view.sort==='priceRank'?a.priceRank-b.priceRank:a.rank-b.rank);}
  return {load,mount,save,refresh,renderRules,renderSnapshots,invalidate,fresh,createSnapshot,scenarios,search,trace,esc,resultTools,changeView,sortedResults,comparisonHint};
})();
