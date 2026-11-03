/**
 * 主界面逻辑
 */

// ========================
// 全局状态
// ========================
const State = {
  ...ScoringRules.createProject(),
  predictPrices: {},
  predictSort: {key:'priceRank',direction:'asc'},
  predictResult: null,
  compositeResult: null,
};

function loadSavedState() {
  WorkspaceUI.load(State);
}

function saveState() {
  WorkspaceUI.save();
}

// ========================
// Tab 切换
// ========================
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-result') renderResult();
      if (btn.dataset.tab === 'tab-optimize') { renderPredictTable(); renderOptimizeTargetOptions(); }
    });
  });
}

// ========================
// 配置面板
// ========================
function initConfigPanel() {
  syncConfigFromState();
  bindConfigEvents();
  updateStrategyParams();
}

function syncConfigFromState() {
  const c = State.config;
  v('cfg-project', c.projectName);
  v('cfg-bw', c.businessWeight);
  v('cfg-pw', c.priceWeight);
  v('cfg-tw', c.techWeight);
  v('cfg-business-full', c.businessFull);
  v('cfg-price-full', c.priceFull);
  v('cfg-tech-full', c.techFull);
  RuleUI.renderStrategySelect(gi('cfg-strategy'),c.priceStrategy);
  updateWeightSum();
  syncScoreFullUI();
}

function syncScoreFullUI() {
  const businessFull = Number(State.config.businessFull);
  const techFull = Number(State.config.techFull);
  const businessLabel = gi('bidder-business-full-label');
  const techLabel = gi('bidder-tech-full-label');
  if (businessLabel) businessLabel.textContent = `（满分${fmt(businessFull)}）`;
  if (techLabel) techLabel.textContent = `（满分${fmt(techFull)}）`;
  const scenarioBusinessLabel = gi('scenario-business-full-label');
  const scenarioTechLabel = gi('scenario-tech-full-label');
  if (scenarioBusinessLabel) scenarioBusinessLabel.textContent = `（满分${fmt(businessFull)}）`;
  if (scenarioTechLabel) scenarioTechLabel.textContent = `（满分${fmt(techFull)}）`;
  const scenarioBusiness = gi('scenario-my-biz');
  const scenarioTech = gi('scenario-my-tech');
  if (scenarioBusiness) {
    scenarioBusiness.max = businessFull;
    scenarioBusiness.placeholder = `0~${fmt(businessFull)}`;
    scenarioBusiness.classList.toggle('score-input-invalid', +scenarioBusiness.value < 0 || +scenarioBusiness.value > businessFull);
  }
  if (scenarioTech) {
    scenarioTech.max = techFull;
    scenarioTech.placeholder = `0~${fmt(techFull)}`;
    scenarioTech.classList.toggle('score-input-invalid', +scenarioTech.value < 0 || +scenarioTech.value > techFull);
  }
}

function bindConfigEvents() {
  ['cfg-bw', 'cfg-pw', 'cfg-tw'].forEach(id => {
    gi(id).addEventListener('input', () => {
      autoBalanceWeights(id);
      updateWeightSum();
    });
  });
  gi('cfg-project').addEventListener('input', () => { State.config.projectName = gi('cfg-project').value; saveState(); });
  ['cfg-business-full', 'cfg-tech-full'].forEach(id => {
    gi(id).addEventListener('input', () => {
      State.config[id === 'cfg-business-full' ? 'businessFull' : 'techFull'] = +gi(id).value;
      syncScoreFullUI();
      renderBidderTable();
      saveState();
    });
  });
  gi('cfg-price-full').addEventListener('input', () => {
    State.config.priceFull = Number(gi('cfg-price-full').value);
    saveState();
  });
  gi('cfg-strategy').addEventListener('change', () => {
    State.config = ScoringRules.selectStrategy(State.config, gi('cfg-strategy').value);
    syncConfigFromState();
    updateStrategyParams();
    saveState();
  });
}

function autoBalanceWeights(changedId) {
  // 读取三个值
  const bw = +gi('cfg-bw').value || 0;
  const pw = +gi('cfg-pw').value || 0;
  const tw = +gi('cfg-tw').value || 0;

  State.config.businessWeight = bw;
  State.config.priceWeight    = pw;
  State.config.techWeight     = tw;
  saveState();
}

function updateWeightSum() {
  const sum = State.config.businessWeight + State.config.priceWeight + State.config.techWeight;
  const el = gi('weight-sum');
  el.textContent = `分值合计：${sum}`;
  el.className = 'weight-sum ' + (sum === 100 ? 'ok' : 'err');
}

function updateStrategyParams() {
  RuleUI.renderParams(gi('strategy-params-container'), State.config, saveState);
}

// ========================
// 报价样本名称面板（Tab 1）
// ========================
function initBidderNamesPanel() {
  renderBidderNamesPanel();
  gi('btn-add-bidder').addEventListener('click', addBidder);
}

function renderBidderNamesPanel() {
  const list = gi('bidder-names-list');
  if (!list) return;
  list.innerHTML = '';
  State.bidders.forEach((b, idx) => {
    const row = document.createElement('div');
    row.className = 'bidder-name-row';
    row.innerHTML = `
      <span class="badge ${b.isMe ? 'badge-yellow' : 'badge-blue'}">
        ${b.isMe ? '目标' : String(idx)}
      </span>
      <input type="text" value="${escapeHtml(b.name)}" placeholder="样本名称" aria-label="${b.isMe ? '目标样本名称' : '样本' + idx + '名称'}"
        oninput="updateBidderName(${idx}, this.value)">
      ${!b.isMe ? `<button class="btn btn-danger" onclick="removeBidder(${idx})">删除</button>` : ''}
    `;
    list.appendChild(row);
  });
  renderOptimizeTargetOptions();
}

// ========================
// 报价与评分录入（Tab 3）
// ========================
// Inputs are always read from live samples; scores remain an explicit calculation snapshot.
function desktopRows(snapshot, priceOnly = false) {
  const scored = new Map((snapshot?.rows || []).map(row => [row.id, row]));
  const rows = State.bidders.map((bidder, index) => {
    const score = scored.get(bidder.id);
    return {...score, id:bidder.id, name:bidder.name, price:bidder.price,
      rank:score?.rank ?? Infinity, priceRank:score?.priceRank ?? Infinity, bidder, index, score};
  });
  return priceOnly ? Scoring.sortPriceResults(rows, State.predictSort.key, State.predictSort.direction)
    : WorkspaceUI.sortedResults(rows);
}

function desktopPriceInput(bidder, index, prediction = false) {
  return `<input type="text" value="${escapeHtml(WorkspaceUI.priceInputValue(bidder))}" placeholder="输入报价"
    inputmode="decimal" autocomplete="off" data-id="${escapeHtml(bidder.id)}"
    class="table-input${prediction?' predict-price-input':''}${bidder.isMe?' my-bid':''}${bidder.priceInputError?' price-input-invalid':''}"
    aria-label="${escapeHtml(bidder.name)}${prediction?'假设报价':'报价'}"
    oninput="${prediction?`updateBidderPriceById(State.bidders[${index}].id,this.value,this)`:`updateBidderPriceInput(${index},this)`}"
    onblur="formatBidderPriceInput(${index},this)">`;
}

function desktopScoreInput(bidder, index, field, fullScore, label) {
  const value = bidder[field];
  return `<input type="number" value="${escapeHtml(value)}" min="0" max="${fullScore}" step="0.1"
    class="table-input${!Number.isFinite(Number(value))||value<0||value>fullScore?' score-input-invalid':''}"
    aria-label="${escapeHtml(bidder.name)}${label}" oninput="updateBidderScore(${index},'${field}',this)">`;
}

function desktopExplanations(rows, config) {
  return `<details class="compact-scale"><summary>评分口径</summary>${RuleUI.scaleHtml(config)}</details>${WorkspaceUI.trace(rows,config)}`;
}

function renderBidderTable() {
  const tbody = gi('result-table-body');
  if (!tbody) return;
  const snapshot = State.compositeResult;
  gi('result-area').dataset.resultReady = String(!!snapshot);
  const config = snapshot?.config || buildConfig();
  const businessFull = Number(State.config.businessFull), techFull = Number(State.config.techFull);
  syncScoreFullUI();
  gi('result-table-head').innerHTML = `<tr>
    <th>综合排名</th><th>报价样本</th><th>报价（元）</th>
    <th>商务得分<small>满分 ${fmt(businessFull)}</small></th>
    <th>技术得分<small>满分 ${fmt(techFull)}</small></th>
    <th>价格原始分<small>公式满分 ${config.priceFull}</small></th>
    <th>计入综合分<small>价格分值 ${config.priceWeight}</small></th><th>综合得分</th>
  </tr>`;
  tbody.innerHTML = desktopRows(snapshot).map(({bidder:b,index,score:r}) => `<tr data-input-index="${index}" ${r?'data-scored':''}
    ${b.isMe?'data-result-target':''} class="${b.isMe?'my-row':''} ${r?.rank===1?'rank-1':''}">
    <td><strong>${r?`${r.rank}${r.tied?'（并列）':''}`:'—'}</strong></td>
    <td>${escapeHtml(b.name)}${b.isMe?' <span class="badge badge-yellow">目标</span>':''}${!r?`<small class="input-status">${b.enabled===false?'已停用':b.price>0?'待计算':'未报价'}</small>`:''}</td>
    <td>${desktopPriceInput(b,index)}</td>
    <td>${desktopScoreInput(b,index,'businessScore',businessFull,'商务得分')}</td>
    <td>${desktopScoreInput(b,index,'techScore',techFull,'技术得分')}</td>
    <td>${r?fmtPriceScore(r.priceScore,config.priceStrategy):'—'}${r?.specialFullScore?'<small class="score-reason">技术最高且最低价满分</small>':''}</td>
    <td>${r?RuleUI.contributionHtml(r.priceScore,config):'—'}</td>
    <td><strong>${r?r.total.toFixed(4):'—'}</strong></td>
  </tr>`).join('');
  if (snapshot) {
    gi('result-tools').innerHTML = WorkspaceUI.resultTools(snapshot.rows);
    if (snapshot.inputKey !== WorkspaceUI.inputKey()) WorkspaceUI.markStale('result-area');
  } else gi('result-tools').textContent = '';
}

function addBidder() {
  const idx = State.bidders.length;
  State.bidders.push({
    id: 'b' + Date.now(),
    name: '其他样本' + String.fromCharCode(64 + idx),
    price: 0,
    businessScore: Scoring.round(Number(State.config.businessFull) * 0.75, 2),
    techScore: Scoring.round(Number(State.config.techFull) * 0.78, 2),
    isMe: false,
  });
  renderBidderNamesPanel();
  renderBidderTable();
  saveState();
}

function removeBidder(idx) {
  if (State.bidders[idx].isMe) return;
  State.bidders.splice(idx, 1);
  renderBidderNamesPanel();
  renderBidderTable();
  saveState();
}

function updateBidder(idx, field, value) {
  State.bidders[idx][field] = value;
  if (field === 'price') {
    renderPredictTable();
  }
  saveState();
}

function updateBidderScore(idx, field, input) {
  const value = +input.value;
  State.bidders[idx][field] = value;
  const fullScore = field === 'businessScore'
    ? Number(State.config.businessFull)
    : Number(State.config.techFull);
  input.classList.toggle('score-input-invalid', !Number.isFinite(value) || value < 0 || value > fullScore);
  saveState();
}

function updateBidderPriceInput(idx, input) {
  const rawValue = input.value;
  const price = Scoring.normalizePriceInput(rawValue);
  State.bidders[idx].price = price;
  State.bidders[idx].priceInput = rawValue;
  State.bidders[idx].priceInputError = rawValue.trim() !== '' && price <= 0;
  input.classList.toggle('price-input-invalid', rawValue.trim() !== '' && price <= 0);
  renderPredictTable();
  saveState();
}

function formatBidderPriceInput(idx, input) {
  const price = State.bidders[idx]?.price || 0;
  if (price > 0) input.value = WorkspaceUI.priceInputValue(State.bidders[idx]);
}

function updateBidderPriceById(id, value, input) {
  const bidder = State.bidders.find(b => b.id === id);
  if (!bidder) return;
  bidder.priceInput = String(value);
  bidder.price = Scoring.normalizePriceInput(value);
  bidder.priceInputError = String(value).trim() !== '' && bidder.price <= 0;
  input?.classList.toggle('price-input-invalid',bidder.priceInputError);
  renderBidderTable();
  saveState();
}

// ========================
// 结果面板
// ========================
function renderResult() {
  renderBidderTable();
  const config = buildConfig();
  const bidders = State.bidders.map(b => ({ ...b }));
  if (!validateConfig(config, bidders)) return;

  const resultArea = gi('result-area');
  if (resultArea) resultArea.style.display = '';

  const bidValidity = Scoring.summarizeBidValidity(bidders);
  let result;
  try { result = Scoring.evaluate(bidders, config); }
  catch(error) { gi('result-bid-status').textContent=error.message;return; }
  WorkspaceUI.fresh('result-area');

  const me = result.find(b => b.isMe);
  const invalidNames = bidValidity.invalidBidders
    .map(bidder => escapeHtml(bidder.name || '未命名样本'))
    .join('、');
  const status = gi('result-bid-status');
  status.className = `bid-validity-status${bidValidity.invalidCount ? ' warn' : ''}`;
  let countDetailText = '';
  if (config.priceStrategy === 'tieredTrimmedBenchmark' && result[0]) {
    countDetailText = ` 去最高、最低各${result[0].trimCount}个，基准价平均值纳入${result[0].includedBidCount}个报价。`;
  } else if (config.priceStrategy === 'qualifiedMeanBenchmark' && result[0]) {
    countDetailText = ` 基准价平均值纳入全部${result[0].includedBidCount}个有效评标价格。`;
  } else if (config.priceStrategy === 'outlierFilteredBenchmark' && result[0]) {
    const excludedNames = result[0].excludedHighBidderNames.map(name => escapeHtml(name)).join('、');
    const excludedNamesText = excludedNames ? `（${excludedNames}）` : '';
    countDetailText = ` 初始均值¥${fmt(result[0].preliminaryAverage)}，达到¥${fmt(result[0].exclusionThreshold)}的${result[0].excludedHighBidCount}个高价${excludedNamesText}不参与基准价计算，最终纳入${result[0].includedBidCount}个报价。`;
  }
  const invalidImpactText = '未进入本次评分及基准价计算';
  status.innerHTML = bidValidity.invalidCount
    ? `<strong>已建立${bidValidity.totalCount}个样本，有效${bidValidity.validCount}个。</strong>${invalidImpactText}：${invalidNames}（未报价或已停用）。${countDetailText}`
    : `<strong>已建立${bidValidity.totalCount}个样本，${bidValidity.validCount}个报价全部有效。</strong>${countDetailText}`;

  // 摘要
  const sumHtml = `
    <div class="summary-card ${me && me.rank === 1 ? 'highlight' : me && me.rank <= 2 ? '' : 'warn'}">
      <div class="label">目标方案综合排名</div>
      <div class="value">第 ${me ? me.rank : '-'} 名</div>
      <div class="sub">有效 ${bidValidity.validCount} / 已建立 ${bidValidity.totalCount}</div>
    </div>
    <div class="summary-card">
      <div class="label">目标方案综合得分</div>
      <div class="value">${me ? me.total.toFixed(4) : '-'}</div>
      <div class="sub">满分${config.businessWeight + config.priceWeight + config.techWeight}分</div>
    </div>
    <div class="summary-card">
      <div class="label">目标方案价格原始分</div>
      <div class="value">${me ? fmtPriceScore(me.priceScore, config.priceStrategy) : '-'}</div>
      <div class="sub">公式满分${config.priceFull}分${me?.specialFullScore ? ' · 技术最高且最低价' : ''}${me?`<br>计入综合分 ${RuleUI.contributionHtml(me.priceScore,config)}`:''}</div>
    </div>
    ${me && me.benchmark ? `<div class="summary-card summary-benchmark">
      <div class="label">评分基准价</div>
      <div class="value">¥${fmtBenchmark(me.benchmark, config.priceStrategy)}</div>
      <div class="sub">偏差 ${me.deviation == null ? '—' : fmt(me.deviation,6)+'%'}${formatBenchmarkCountDetails(me, config.priceStrategy)}</div>
    </div>` : ''}
  `;
  gi('result-summary').innerHTML = sumHtml;
  gi('result-explanations').innerHTML = desktopExplanations(result,config);

  State.compositeResult = {rows:result,config:Workspace.clone(config),inputKey:WorkspaceUI.inputKey()};
  renderBidderTable();

  // 权重提示
  gi('result-weight-info').textContent =
    `分值构成：商务${config.businessWeight} + 价格${config.priceWeight} + 技术${config.techWeight}；商务/技术录入满分：${fmt(config.businessFull)} / ${fmt(config.techFull)}；价格公式满分：${fmt(config.priceFull)}  |  价格策略：${Scoring.strategyNames[config.priceStrategy]}`;
}

// ========================
// 预测模拟
// ========================
function renderPredictTable() {
  renderPredictResultTable();
}

function calcPredictResult() {
  const config = buildConfig();
  const bidders = State.bidders.map(b => ({ ...b }));

  if (!bidders.some(b => b.price > 0)) {
    gi('predict-error').textContent = '请至少输入一方的预测报价';
    return;
  }

  // 只计算价格得分，按价格得分排名
  const strategy = config.priceStrategy;
  const configErrors = Scoring.validateStrategyConfig(strategy, config.priceFull, config.strategyParams);
  if (configErrors.length > 0) {
    gi('predict-error').textContent = configErrors.join('；');
    return;
  }
  let ranked;
  try { ranked = Scoring.evaluatePrice(bidders, config); }
  catch(error) { gi('predict-error').textContent=error.message;return; }
  WorkspaceUI.fresh('predict-result-box');

  const benchmark = ranked.find(b => b.benchmark)?.benchmark;
  State.predictResult = {
    rows: ranked,
    benchmark,
    strategy,
    priceFull: config.priceFull,
    config: Workspace.clone(config),
    inputKey: WorkspaceUI.inputKey(),
  };
  renderPredictResultTable();
}

function sortPredictResult(key) {
  if (State.predictSort.key === key) {
    State.predictSort.direction = State.predictSort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    State.predictSort = { key, direction: 'asc' };
  }
  renderPredictResultTable();
}

function renderPredictResultTable() {
  const snapshot = State.predictResult;
  gi('predict-result-box').dataset.resultReady = String(!!snapshot);
  const config = snapshot?.config || buildConfig();
  const { key, direction } = State.predictSort;
  const rows = desktopRows(snapshot,true);
  const sortLabel = key==='priceRank'?'价格排名':'报价';
  const icon = column => key===column?(direction==='asc'?'↑':'↓'):'↕';
  const ariaSort = column => key===column?(direction==='asc'?'ascending':'descending'):'none';
  const target = snapshot?.rows.find(b=>b.isMe);
  const tbodyHtml = rows.map(({bidder:b,index,score:r}) => `<tr data-input-index="${index}" ${r?'data-scored':''} class="${b.isMe?'my-row':''} ${r?.priceRank===1?'rank-1':''}">
    <td><strong>${r?`${r.priceRank}${r.priceTied?'（并列）':''}`:'—'}</strong></td>
    <td>${escapeHtml(b.name)}${b.isMe?' <span class="badge badge-yellow">目标</span>':''}${!r?`<small class="input-status">${b.enabled===false?'已停用':b.price>0?'待计算':'未报价'}</small>`:''}</td>
    <td>${desktopPriceInput(b,index,true)}</td>
    <td>${r?.deviation!=null?fmt(r.deviation,6)+'%':'—'}</td>
    <td><strong>${r?fmtPriceScore(r.priceScore,config.priceStrategy):'—'}</strong>${r?.specialFullScore?'<small class="score-reason">技术最高且最低价满分</small>':''}</td>
    <td>${r?RuleUI.contributionHtml(r.priceScore,config):'—'}</td>
  </tr>`).join('');
  gi('predict-result-box').innerHTML = `
    <div class="summary-grid compact-price-summary">
      <div class="summary-card summary-benchmark"><div class="label">评标基准价</div><div class="value">${snapshot?.benchmark?'¥ '+fmtBenchmark(snapshot.benchmark,config.priceStrategy):'—'}</div><div class="sub">${snapshot?`${snapshot.rows.length} 个有效报价参与排名`:'填写报价后点击计算'}</div></div>
      <div class="summary-card"><div class="label">目标价格原始分</div><div class="value">${target?fmtPriceScore(target.priceScore,config.priceStrategy):'—'}</div><div class="sub">公式满分 ${config.priceFull}</div></div>
      <div class="summary-card"><div class="label">目标价格计入综合分</div><div class="value">${target?RuleUI.contributionHtml(target.priceScore,config):'—'}</div><div class="sub">${target?`价格排名：${target.priceTied?'并列':''}第 ${target.priceRank} 名`:'计算后显示排名'}</div></div>
    </div>
    <div class="workbench-rule">${escapeHtml(Scoring.strategyNames[config.priceStrategy])} · 公式满分 ${config.priceFull} / 价格分值 ${config.priceWeight}<span class="workbench-sort">${sortLabel} ${icon(key)} · 点击表头切换</span></div>
    <div class="compact-explanations">${desktopExplanations(snapshot?.rows||[],config)}</div>
    <p id="predict-error" class="ws-error" role="status" aria-live="polite"></p>
    <p class="predict-scroll-hint">左右滑动表格，查看完整评分明细</p>
    <div class="table-wrap predict-table-wrap" tabindex="0" role="region" aria-label="价格评分录入与明细，可横向滚动">
      <table class="predict-score-table editable-score-table" aria-label="价格得分与排名">
        <colgroup><col class="predict-col-rank"><col class="predict-col-name"><col class="predict-col-price"><col class="predict-col-deviation"><col class="predict-col-score"><col class="predict-col-contribution"></colgroup>
        <thead><tr>
          <th aria-sort="${ariaSort('priceRank')}"><button type="button" class="table-sort-btn" onclick="sortPredictResult('priceRank')" aria-label="按价格排名排序">价格排名 <span>${icon('priceRank')}</span></button></th>
          <th>报价样本</th>
          <th aria-sort="${ariaSort('price')}"><button type="button" class="table-sort-btn" onclick="sortPredictResult('price')" aria-label="按假设报价排序">报价（元） <span>${icon('price')}</span></button></th>
          <th>与基准价偏差</th><th>价格原始分<small>公式满分 ${config.priceFull}</small></th><th>计入综合分<small>价格分值 ${config.priceWeight}</small></th>
        </tr></thead><tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
  if (snapshot && snapshot.inputKey !== WorkspaceUI.inputKey()) WorkspaceUI.markStale('predict-result-box');
}

// Common project controls stay one click away on every desktop tab.
function initCompactWorkspace() {
  const panel = gi('tab-config').querySelector(':scope > .ws-panel');
  panel.classList.add('desktop-workspace');
  const row = panel.querySelector('.ws-row'), status = gi('ws-status');
  panel.querySelector('.ws-title').remove();
  const drawer = document.createElement('details');
  drawer.id='desktop-project-tools';
  const summary = document.createElement('summary');summary.textContent='项目与数据管理';drawer.append(summary);
  for (const node of [...panel.children]) if (node!==row && node!==status) drawer.append(node);
  panel.replaceChildren(row,drawer,status);
  document.querySelector('.container').prepend(panel);
}

// ========================
// 优化面板
// ========================
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function renderOptimizeTargetOptions() {
  const select = gi('opt-target');
  if (!select) return;
  const previousId = select.value;
  const defaultBidder = State.bidders.find(bidder => bidder.isMe) || State.bidders[0];
  select.innerHTML = State.bidders.map(bidder =>
    `<option value="${escapeHtml(bidder.id)}">${escapeHtml(bidder.name)}</option>`
  ).join('');
  const selectedId = State.bidders.some(bidder => bidder.id === previousId)
    ? previousId
    : defaultBidder?.id;
  if (selectedId) select.value = selectedId;
}

function sampleOptimizationCandidates(candidates, best, maxRows = 25) {
  if (candidates.length <= maxRows) return candidates;
  const stride = Math.ceil(candidates.length / maxRows);
  const sampled = candidates.filter((candidate, index) => index % stride === 0);
  const last = candidates[candidates.length - 1];
  if (!sampled.includes(last)) sampled.push(last);
  if (!sampled.includes(best)) sampled.push(best);
  return sampled.sort((left, right) => left.price - right.price);
}

async function renderOptimize() {
  renderPredictTable();
  renderOptimizeTargetOptions();

  const config = buildConfig();
  const configErrors=Scoring.validateConfig(config, [], true);
  if(configErrors.length){gi('optimize-result-box').textContent=configErrors.join('；');return;}

  const targetBidder = State.bidders.find(bidder => bidder.id === gi('opt-target').value);
  if (!targetBidder) return;

  const others = State.bidders.filter(bidder => bidder.id !== targetBidder.id && bidder.price > 0 && bidder.enabled !== false);
  let scenarios;
  try {
    scenarios = WorkspaceUI.scenarios(gi('opt-scenarios').value, others);
    if(!scenarios.length || scenarios.some(s=>!s.bidders.length))throw new Error('每个情景至少需要一个其他报价');
  } catch (error) {
    gi('optimize-result-box').innerHTML = `<p class="note" style="color:#dc2626;">${escapeHtml(error.message)}</p>`;
    gi('sensitivity-tbody').innerHTML = '';
    return;
  }

  const scenarioPrices = scenarios.flatMap(scenario => scenario.bidders.map(bidder => bidder.price));
  const defaultMin = Math.round(Math.min(...scenarioPrices) * 0.85);
  const defaultMax = Math.round(Math.max(...scenarioPrices) * 1.1);
  const searchMin = gi('opt-min').value ? +gi('opt-min').value : defaultMin;
  const searchMax = gi('opt-max').value ? +gi('opt-max').value : defaultMax;
  const defaultStep = Math.max(Math.round((searchMax - searchMin) / 500), 1);
  const step = gi('opt-step').value ? +gi('opt-step').value : defaultStep;

  if (!gi('opt-min').value) gi('opt-min').value = searchMin;
  if (!gi('opt-max').value) gi('opt-max').value = searchMax;
  if (!gi('opt-step').value) gi('opt-step').value = step;

  if (!(searchMin > 0) || !(searchMax >= searchMin) || !(step > 0)) {
    gi('optimize-result-box').innerHTML = '<p class="note" style="color:#dc2626;">请填写有效的最低价、最高价和搜索步长</p>';
    gi('sensitivity-tbody').innerHTML = '';
    return;
  }

  let optimization;
  try {
    optimization = await WorkspaceUI.search(
      targetBidder.id,
      scenarios,
      config,
      { minPrice: searchMin, maxPrice: searchMax, step }
    );
  } catch (error) {
    gi('optimize-result-box').innerHTML = `<p class="note" style="color:#dc2626;">${escapeHtml(error.message)}</p>`;
    gi('sensitivity-tbody').innerHTML = '';
    return;
  }

  const best = optimization.best;
  WorkspaceUI.fresh('optimize-result-box','sensitivity-card');
  const countsText = optimization.participantCounts.map(count => `${count}个`).join('、');
  const specialRuleSearchNote = config.priceStrategy === 'outlierFilteredBenchmark'
    ? (optimization.specialMode === 'technical' ? '；采用完整技术分及特殊满分条件' : '；仅价格公式模式，不采用技术分特殊满分条件')
    : '';
  const detailRows = best.details.map(detail => `<tr>
    <td>${escapeHtml(detail.name)}</td>
    <td>${detail.participantCount}</td>
    <td>${detail.benchmark == null ? '—' : '¥ ' + fmtBenchmark(detail.benchmark, config.priceStrategy)}</td>
    <td><strong>${fmtPriceScore(detail.priceScore, config.priceStrategy)}</strong></td>
    <td>${RuleUI.contributionHtml(detail.priceScore,config)}</td>
    <td>第${detail.priceRank}名${detail.priceTied ? '（并列）' : ''}</td>
    <td>${formatOptimizationInclusion(detail, config.priceStrategy)}</td>
  </tr>`).join('');

  const optHtml = `
    <div class="optimize-result">
      <h3>${escapeHtml(targetBidder.name)} · 已搜索候选中的优选报价</h3>
      <div class="optimize-grid">
        <div class="optimize-item">
          <div class="oi-label">推荐报价</div>
          <div class="oi-value">¥ ${fmt(best.price)}</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">价格排名第一情景</div>
          <div class="oi-value">${fmt(best.topRate)}%</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">最低价格分</div>
          <div class="oi-value">${fmtPriceScore(best.minScore, config.priceStrategy)}</div>
          <div class="oi-contribution">计入 ${RuleUI.contributionHtml(best.minScore,config)}</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">平均价格分 / 最差排名</div>
          <div class="oi-value" style="font-size:16px;">${fmtPriceScore(best.avgScore, config.priceStrategy)} / 第${best.worstRank}名</div>
        </div>
      </div>
      <p style="font-size:12px;opacity:.85;margin-top:10px;">价格规则：${escapeHtml(Scoring.strategyNames[config.priceStrategy] || config.priceStrategy)}；共测算${optimization.scenarioCount}个情景，按所设权重计算；样本数量覆盖：${countsText}。只改变目标报价，其他样本保持输入值不变${specialRuleSearchNote}。</p>
    </div>`;
  gi('optimize-result-box').innerHTML = `${optHtml}
    <details id="desktop-search-details" class="card compact-disclosure" style="margin-top:10px;">
      <summary>推荐报价在各情景中的结果</summary>
      ${RuleUI.scaleHtml(config)}
      <p class="table-scroll-hint table-scroll-hint-wide">可在表格内左右滑动，查看全部情景明细。</p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="推荐报价逐情景结果表，可横向滚动"><table class="optimization-detail-table">
        <colgroup><col style="width:25%"><col style="width:8%"><col style="width:18%"><col style="width:12%"><col style="width:14%"><col style="width:10%"><col style="width:13%"></colgroup>
        <thead><tr><th>情景</th><th>有效<br>样本数</th><th>基准价</th><th>目标价格原始分<small>公式满分${config.priceFull}</small></th><th>价格计入综合分<small>分值${config.priceWeight}</small></th><th>价格排名</th><th>去除及纳入</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table></div>
    </details>`;

  const sensitRows = sampleOptimizationCandidates(optimization.candidates, best).map(candidate => `
    <tr class="${candidate === best ? 'my-row rank-1' : ''}">
      <td>¥ ${fmt(candidate.price)}</td>
      <td>${fmt(candidate.topRate)}%</td>
      <td>${fmtPriceScore(candidate.minScore, config.priceStrategy)} / ${fmtPriceScore(candidate.avgScore, config.priceStrategy)}</td>
      <td>第${candidate.worstRank}名</td>
    </tr>`).join('');

  gi('sensitivity-tbody').innerHTML = sensitRows;
}

// ========================
// 方案对比面板
// ========================
function initScenarioPanel() {
  syncScoreFullUI();
  gi('btn-save-scenario').addEventListener('click', saveScenario);
  gi('btn-clear-scenarios').addEventListener('click', () => {
    if (confirm('确定清空所有方案？')) {
      State.scenarios = [];
      renderScenarios();
      saveState();
    }
  });

  resetScenarioInputs();
}

function resetScenarioInputs() {
  const myBidder = State.bidders.find(b => b.isMe);
  gi('scenario-name').value = '';
  gi('scenario-my-price').value = myBidder?.price>0 ? myBidder.price : '';
  gi('scenario-my-biz').value = myBidder?.businessScore ?? 0;
  gi('scenario-my-tech').value = myBidder?.techScore ?? 0;
}

function saveScenario() {
  const myPrice = +gi('scenario-my-price').value;
  const myBiz   = +gi('scenario-my-biz').value;
  const myTech  = +gi('scenario-my-tech').value;

  if (!myPrice) {
    alert('请填写目标报价');
    return;
  }

  const config = buildConfig();
  const bidders = [
    { ...State.bidders.find(b=>b.isMe), price:myPrice, priceInput:String(myPrice), priceInputError:false, businessScore:myBiz, techScore:myTech, enabled:true },
    ...State.bidders.filter(b => !b.isMe).map(b => ({ ...b })),
  ];
  if (!validateConfig(config, bidders)) return;
  let result;
  try{result=Scoring.evaluate(bidders,config);}catch(error){alert(error.message);return;}
  const me = result.find(b => b.isMe);

  const name = gi('scenario-name').value || `方案${State.scenarios.length + 1}`;
  State.scenarios.push({
    snapshot: WorkspaceUI.createSnapshot(config, bidders),
    name,
    price: myPrice,
    strategy: Scoring.strategyNames[config.priceStrategy],
    businessScore: myBiz,
    techScore: myTech,
    priceScore: me?.priceScore ?? 0,
    total: me?.total ?? 0,
    rank: me?.rank ?? '-',
    timestamp: new Date().toLocaleString(),
  });
  gi('scenario-name').value = '';
  renderScenarios();
  WorkspaceUI.renderSnapshots();
  saveState();
}

function renderScenarios() {
  const container = gi('scenario-table-wrap');
  if (State.scenarios.length === 0) {
    container.innerHTML = '<p class="note" style="text-align:center;padding:20px;">暂无方案，填写参数后点击"计算并保存"</p>';
    return;
  }
  const maxTotal = Math.max(...State.scenarios.map(s => s.total));
  const rows = State.scenarios.map((s, i) => `
    <tr class="${s.rank === 1 ? 'rank-1' : ''}">
      <td>${escapeHtml(s.name)}</td>
      <td><small style="color:#888;">${escapeHtml(s.strategy)}</small></td>
      <td>¥ ${fmt(s.price)}</td>
      <td>${s.businessScore}</td>
      <td>${s.techScore}</td>
      <td>${fmtPriceScore(s.priceScore, s.strategy)}${s.snapshot?`<small class="ws-score-contribution"> / ${s.snapshot.config.priceFull}<br>计入综合分 ${RuleUI.contributionHtml(s.priceScore,s.snapshot.config)}</small>`:'<small class="ws-score-contribution">旧版未记录满分</small>'}</td>
      <td class="scenario-total-cell">
        <span class="rank-bar" style="width:${maxTotal > 0 ? Math.round(s.total/maxTotal*100) : 0}%;"></span>
        <strong>${s.total.toFixed(4)}</strong>
      </td>
      <td><span class="badge ${s.rank===1?'badge-green':s.rank<=2?'badge-blue':'badge-red'}">第${s.rank}名</span></td>
      <td><small style="color:#888;">${escapeHtml(s.timestamp || '-')}</small></td>
      <td><button class="btn btn-danger" onclick="removeScenario(${i})">删除</button></td>
    </tr>`).join('');

  container.innerHTML = `${WorkspaceUI.comparisonHint()}
    <p class="table-scroll-hint table-scroll-hint-wide">可在表格内左右滑动，查看全部方案与操作。</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="方案对比表，可横向滚动"><table class="scenario-compare-table">
      <colgroup><col style="width:22%"><col style="width:14%"><col style="width:11%"><col style="width:6%"><col style="width:6%"><col style="width:12%"><col style="width:9%"><col style="width:6%"><col style="width:9%"><col style="width:5%"></colgroup>
      <thead><tr>
        <th>方案名称</th><th>价格方法</th><th>目标报价</th>
        <th>商务得分</th><th>技术得分</th><th>价格得分</th>
        <th>综合得分</th><th>排名</th><th>保存时间</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function removeScenario(idx) {
  State.scenarios.splice(idx, 1);
  renderScenarios();
  saveState();
}

// ========================
// 工具函数
// ========================
function buildConfig() {
  return {...State.config, strategyParams:{...State.config.strategyParams}, myBidderId:State.bidders.find(b=>b.isMe)?.id || 'my'};
}

function validateConfig(config, bidders = []) {
  const strategyErrors = Scoring.validateConfig(config, bidders);
  if (strategyErrors.length > 0) {
    alert(strategyErrors.join('；'));
    return false;
  }
  return true;
}

function gi(id) { return document.getElementById(id); }
function v(id, val) { const el = gi(id); if (el) el.value = val; }
function fmt(num, maximumFractionDigits = 2, minimumFractionDigits = 0) {
  if (!num && num !== 0) return '-';
  return Number(num).toLocaleString('zh-CN', { maximumFractionDigits, minimumFractionDigits });
}
function fmtBenchmark(num, strategy) {
  if (strategy === 'qualifiedMeanBenchmark') return fmt(num, 6);
  return ['tieredTrimmedBenchmark','piecewiseAverage'].includes(strategy) ? fmt(num, 6, 6) : fmt(num);
}
function fmtPriceScore(score, strategy = State.config.priceStrategy) {
  return Number(score).toFixed(2);
}
function formatBenchmarkCountDetails(bidder, strategy) {
  if (bidder?.validBidCount == null) return '';
  if (strategy === 'qualifiedMeanBenchmark') return `；有效${bidder.validBidCount}个，全部纳入平均`;
  if (strategy === 'piecewiseAverage') return `；参与${bidder.validBidCount}个，全部纳入算术均值`;
  if (strategy === 'tieredTrimmedBenchmark') {
    return `；有效${bidder.validBidCount}个，去两端各${bidder.trimCount}个，纳入平均${bidder.includedBidCount}个`;
  }
  if (strategy === 'outlierFilteredBenchmark') {
    return `；有效${bidder.validBidCount}个，剔除高价${bidder.excludedHighBidCount}个，纳入平均${bidder.includedBidCount}个`;
  }
  return '';
}
function formatOptimizationInclusion(detail, strategy) {
  if (strategy === 'qualifiedMeanBenchmark') return `全部纳入${detail.includedBidCount}个`;
  if (strategy === 'tieredTrimmedBenchmark') {
    return `最高/最低各${detail.trimCount}个；纳入${detail.includedBidCount}个`;
  }
  if (strategy === 'outlierFilteredBenchmark') {
    return `剔除高价${detail.excludedHighBidCount}个；纳入${detail.includedBidCount}个`;
  }
  return '—';
}
// ========================
// 快速导入预设
// ========================
function loadPreset(name) {
  if (!ScoringRules.presetLabel(name)) return;
  State.config = ScoringRules.applyPreset(State.config,name);
  syncConfigFromState();
  updateStrategyParams();
  renderBidderTable();
  saveState();
  alert(`已加载预设：${ScoringRules.presetLabel(name)}`);
}

// ========================
// 入口
// ========================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  initTabs();
  initConfigPanel();
  initBidderNamesPanel();  // Tab 1：名称管理
  renderBidderTable();     // Tab 3：报价录入表格初始渲染
  initScenarioPanel();
  renderPredictTable();
  renderOptimizeTargetOptions();
  renderScenarios();
  WorkspaceUI.mount({projectHost:'tab-config',searchHost:'desktop-search-options',priceScaleId:'price-scale-note',searchIds:{scenarios:'opt-scenarios',minPrice:'opt-min',maxPrice:'opt-max',step:'opt-step',target:'opt-target'},resultIds:['result-area','predict-result-box','optimize-result-box','sensitivity-card'],
    clearIds:['result-summary','result-bid-status','result-weight-info','result-explanations','optimize-result-box','sensitivity-tbody'],
    renderResults:renderBidderTable,
    resetDrafts:resetScenarioInputs,
    syncName:()=>v('cfg-project',State.config.projectName),
    refresh:()=>{State.compositeResult=null;State.predictResult=null;syncConfigFromState();updateStrategyParams();renderBidderNamesPanel();renderBidderTable();renderPredictTable();renderOptimizeTargetOptions();renderScenarios();}
  });

  initCompactWorkspace();

  gi('btn-calc-result').addEventListener('click', renderResult);
  gi('btn-search-optimal').addEventListener('click', renderOptimize);
  gi('btn-predict-calc').addEventListener('click', calcPredictResult);
});
