/**
 * 主界面逻辑
 */

// ========================
// 全局状态
// ========================
const State = {
  config: {
    projectName: '',
    businessWeight: 20,
    priceWeight: 40,
    techWeight: 40,
    priceFull: 100,       // 价格满分（通常=100，但有时招标文件会规定不同满分）
    priceStrategy: 'averagePrice',
    strategyParams: {
      deductHigh: 0.5,
      deductLow:  0.3,
      avgBaseScore: 80,
      avgLowAdd: 1,
      avgHighDeduct: 1,
      avgMaxScore: 100,
      avgMinScore: 0,
      weightLow:  0.5,
      weightAvg:  0.5,
      benchmark:  0,
      lowerPct:   3,
      upperPct:   3,
      deductOut:  1,
      trimCount:  1,
    },
    myBidderId: 'my',
  },
  bidders: [
    { id: 'my',   name: '我方',   price: 0, businessScore: 80, techScore: 85, isMe: true  },
    { id: 'b1',   name: '竞争方A', price: 0, businessScore: 78, techScore: 82, isMe: false },
    { id: 'b2',   name: '竞争方B', price: 0, businessScore: 76, techScore: 80, isMe: false },
  ],
  scenarios: [],      // 方案对比
  predictPrices: {},  // 预测模拟报价 { bidderId: price }
};

const STORAGE_KEY = 'bid-scorer-desktop-state-v1';

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.config) {
      State.config = {
        ...State.config,
        ...saved.config,
        strategyParams: {
          ...State.config.strategyParams,
          ...(saved.config.strategyParams || {}),
        },
      };
    }
    if (Array.isArray(saved.bidders) && saved.bidders.length > 0) {
      State.bidders = saved.bidders.map((b, idx) => ({
        id: b.id || (idx === 0 ? 'my' : 'b' + Date.now() + idx),
        name: b.name || (idx === 0 ? '我方' : '竞争方' + idx),
        price: +b.price || 0,
        businessScore: +b.businessScore || 0,
        techScore: +b.techScore || 0,
        isMe: idx === 0 ? true : !!b.isMe,
      }));
      if (!State.bidders.some(b => b.isMe)) State.bidders[0].isMe = true;
    }
    if (Array.isArray(saved.scenarios)) State.scenarios = saved.scenarios;
    State.predictPrices = {};
  } catch (err) {
    console.warn('读取本地保存失败，已使用默认数据', err);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      config: State.config,
      bidders: State.bidders,
      scenarios: State.scenarios,
      savedAt: new Date().toISOString(),
    }));
  } catch (err) {
    console.warn('本地保存失败', err);
  }
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
      if (btn.dataset.tab === 'tab-optimize') renderOptimize();
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
  v('cfg-price-full', c.priceFull);
  v('cfg-strategy', c.priceStrategy);
  updateWeightSum();
}

function bindConfigEvents() {
  ['cfg-bw', 'cfg-pw', 'cfg-tw'].forEach(id => {
    gi(id).addEventListener('input', () => {
      autoBalanceWeights(id);
      updateWeightSum();
    });
  });
  gi('cfg-project').addEventListener('input', () => { State.config.projectName = gi('cfg-project').value; saveState(); });
  gi('cfg-price-full').addEventListener('input', () => { State.config.priceFull = +gi('cfg-price-full').value || 100; saveState(); });
  gi('cfg-strategy').addEventListener('change', () => {
    State.config.priceStrategy = gi('cfg-strategy').value;
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
  el.textContent = `权重合计：${sum}%`;
  el.className = 'weight-sum ' + (sum === 100 ? 'ok' : 'err');
}

function updateStrategyParams() {
  const strategy = gi('cfg-strategy').value;
  State.config.priceStrategy = strategy;
  const container = gi('strategy-params-container');

  const p = State.config.strategyParams;

  const commonDeduct = `
    <div class="form-group"><label>高于基准价每1%扣（分）</label>
      <input type="number" id="sp-deductHigh" value="${p.deductHigh}" step="0.1" min="0">
    </div>
    <div class="form-group"><label>低于基准价每1%扣（分）</label>
      <input type="number" id="sp-deductLow" value="${p.deductLow}" step="0.1" min="0">
    </div>`;

  const templates = {
    lowestPrice: `<p class="note">最低报价得满分，其他报价按"满分×(最低价÷本人报价)"计算，无需额外参数。</p>`,
    averagePrice: `<div class="form-row">
      <div class="form-group"><label>平均价得分</label>
        <input type="number" id="sp-avgBaseScore" value="${p.avgBaseScore ?? 80}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>低于平均价每1%加（分）</label>
        <input type="number" id="sp-avgLowAdd" value="${p.avgLowAdd ?? 1}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>高于平均价每1%减（分）</label>
        <input type="number" id="sp-avgHighDeduct" value="${p.avgHighDeduct ?? 1}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>最高分</label>
        <input type="number" id="sp-avgMaxScore" value="${p.avgMaxScore ?? State.config.priceFull}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>最低分</label>
        <input type="number" id="sp-avgMinScore" value="${p.avgMinScore ?? 0}" step="0.5" min="0">
      </div>
    </div>
    <p class="note">基准价 = 所有有效报价的算术平均值；默认适配当前项目：平均价80分，低于每1%加1分，高于每1%减1分，0~100分封顶。</p>`,
    compositePrice: `<div class="form-row">
      <div class="form-group"><label>最低价权重（0~1）</label>
        <input type="number" id="sp-weightLow" value="${p.weightLow}" step="0.05" min="0" max="1">
      </div>
      <div class="form-group"><label>平均价权重（0~1）</label>
        <input type="number" id="sp-weightAvg" value="${p.weightAvg}" step="0.05" min="0" max="1">
      </div>
      ${commonDeduct}
    </div>
    <p class="note">基准价 = 最低价×权重A + 平均价×权重B，权重之和应为1</p>`,
    fixedBenchmark: `<div class="form-row">
      <div class="form-group"><label>标底基准价（元）</label>
        <input type="number" id="sp-benchmark" value="${p.benchmark}" step="10000" min="0">
      </div>
      ${commonDeduct}
    </div>
    <p class="note">基准价由招标方设定（标底价），偏差越小得分越高</p>`,
    trimmedAverage: `<div class="form-row">
      <div class="form-group"><label>去掉最高/最低各几个</label>
        <input type="number" id="sp-trimCount" value="${p.trimCount}" step="1" min="1" max="3">
      </div>
      ${commonDeduct}
    </div>
    <p class="note">去掉最高价和最低价各若干个后取平均作为基准价</p>`,
    intervalScore: `<div class="form-row">
      <div class="form-group"><label>基准价（元）</label>
        <input type="number" id="sp-benchmark" value="${p.benchmark}" step="10000" min="0">
      </div>
      <div class="form-group"><label>下浮上限（%）</label>
        <input type="number" id="sp-lowerPct" value="${p.lowerPct}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>上浮上限（%）</label>
        <input type="number" id="sp-upperPct" value="${p.upperPct}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>超出区间每1%扣（分）</label>
        <input type="number" id="sp-deductOut" value="${p.deductOut}" step="0.5" min="0">
      </div>
    </div>
    <p class="note">在区间 [基准价×(1-下浮%), 基准价×(1+上浮%)] 内报价得满分，超出则扣分</p>`,
  };

  container.innerHTML = `<div class="strategy-params">${templates[strategy] || ''}</div>`;

  // 绑定参数输入事件
  const paramIds = ['deductHigh','deductLow','avgBaseScore','avgLowAdd','avgHighDeduct','avgMaxScore','avgMinScore','weightLow','weightAvg','benchmark','lowerPct','upperPct','deductOut','trimCount'];
  paramIds.forEach(pid => {
    const el = gi('sp-' + pid);
    if (el) {
      el.addEventListener('input', () => {
        State.config.strategyParams[pid] = +el.value;
        saveState();
      });
    }
  });
}

// ========================
// 投标方名称面板（Tab 1）
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
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
    row.innerHTML = `
      <span class="badge ${b.isMe ? 'badge-yellow' : 'badge-blue'}" style="min-width:36px;text-align:center;">
        ${b.isMe ? '我方' : String(idx)}
      </span>
      <input type="text" value="${b.name}" placeholder="单位名称"
        style="width:200px;padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;"
        oninput="updateBidderName(${idx}, this.value)">
      ${!b.isMe ? `<button class="btn btn-danger" onclick="removeBidder(${idx})">删除</button>` : ''}
    `;
    list.appendChild(row);
  });
}

// ========================
// 报价与评分录入（Tab 3）
// ========================
function renderBidderTable() {
  const tbody = gi('bidder-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  State.bidders.forEach((b, idx) => {
    const tr = document.createElement('tr');
    if (b.isMe) tr.classList.add('my-row');
    tr.innerHTML = `
      <td>${b.isMe ? '<span class="badge badge-yellow">我方</span>' : `<span class="badge badge-blue">${idx}</span>`}</td>
      <td style="font-weight:${b.isMe ? 'bold' : 'normal'};">${b.name}</td>
      <td><input type="number" value="${b.price || ''}" placeholder="输入报价"
          style="width:130px;padding:4px 6px;border:1px solid ${b.isMe ? '#2e6da4' : '#d1d5db'};border-radius:4px;${b.isMe ? 'background:#eff6ff;' : ''}"
          oninput="updateBidder(${idx},'price',+this.value)"></td>
      <td><input type="number" value="${b.businessScore}" min="0" max="100" step="0.1"
          style="width:80px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;"
          oninput="updateBidder(${idx},'businessScore',+this.value)"></td>
      <td><input type="number" value="${b.techScore}" min="0" max="100" step="0.1"
          style="width:80px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;"
          oninput="updateBidder(${idx},'techScore',+this.value)"></td>
    `;
    tbody.appendChild(tr);
  });
}

function addBidder() {
  const idx = State.bidders.length;
  State.bidders.push({
    id: 'b' + Date.now(),
    name: '竞争方' + String.fromCharCode(64 + idx),
    price: 0,
    businessScore: 75,
    techScore: 78,
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
    renderPartnerStrategyInputs();
  }
  saveState();
}

function updateBidderPriceById(id, value) {
  const bidder = State.bidders.find(b => b.id === id);
  if (!bidder) return;
  bidder.price = value > 0 ? value : 0;
  renderBidderTable();
  renderPartnerStrategyInputs();
  saveState();
}

// ========================
// 结果面板
// ========================
function renderResult() {
  const config = buildConfig();
  if (!validateConfig(config)) return;

  const resultArea = gi('result-area');
  if (resultArea) resultArea.style.display = '';

  const bidders = State.bidders.map(b => ({ ...b }));
  const result  = Scoring.evaluate(bidders, config);

  const me = result.find(b => b.isMe);

  // 摘要
  const sumHtml = `
    <div class="summary-card ${me && me.rank === 1 ? 'highlight' : me && me.rank <= 2 ? '' : 'warn'}">
      <div class="label">我方综合排名</div>
      <div class="value">第 ${me ? me.rank : '-'} 名</div>
      <div class="sub">共 ${result.length} 家投标</div>
    </div>
    <div class="summary-card">
      <div class="label">我方综合得分</div>
      <div class="value">${me ? me.total.toFixed(4) : '-'}</div>
      <div class="sub">满分100分</div>
    </div>
    <div class="summary-card">
      <div class="label">我方价格得分</div>
      <div class="value">${me ? me.priceScore : '-'}</div>
      <div class="sub">满分${config.priceFull}分</div>
    </div>
    ${me && me.benchmark ? `<div class="summary-card">
      <div class="label">评标基准价</div>
      <div class="value">¥${fmt(me.benchmark)}</div>
      <div class="sub">偏差 ${me.deviation ?? '-'}%</div>
    </div>` : ''}
  `;
  gi('result-summary').innerHTML = sumHtml;

  // 明细表格
  const theadHtml = `
    <tr>
      <th>排名</th><th>投标方</th><th>报价（元）</th>
      <th>与基准价偏差</th>
      <th>价格得分<br><small>（满分${config.priceFull}）</small></th>
      <th>商务得分<br><small>（满分100）</small></th>
      <th>技术得分<br><small>（满分100）</small></th>
      <th>综合得分</th>
    </tr>`;

  const tbodyHtml = result.map(b => `
    <tr class="${b.isMe ? 'my-row' : ''} ${b.rank === 1 ? 'rank-1' : ''}">
      <td><strong>${b.rank}</strong></td>
      <td>${b.name}${b.isMe ? ' <span class="badge badge-yellow">我方</span>' : ''}</td>
      <td>${fmt(b.price)}</td>
      <td>${b.deviation != null ? b.deviation + '%' : '—'}</td>
      <td>${b.priceScore}</td>
      <td>${b.businessScore}</td>
      <td>${b.techScore}</td>
      <td><strong>${b.total.toFixed(4)}</strong></td>
    </tr>`).join('');

  gi('result-table-head').innerHTML = theadHtml;
  gi('result-table-body').innerHTML = tbodyHtml;

  // 权重提示
  gi('result-weight-info').textContent =
    `评分权重：商务${config.businessWeight}% + 价格${config.priceWeight}% + 技术${config.techWeight}%  |  价格策略：${Scoring.strategyNames[config.priceStrategy]}`;
}

// ========================
// 预测模拟
// ========================
function renderPredictTable() {
  const tbody = gi('predict-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  State.bidders.forEach(b => {
    const tr = document.createElement('tr');
    if (b.isMe) tr.classList.add('my-row');
    tr.innerHTML = `
      <td>${b.isMe ? '<span class="badge badge-yellow">我方</span> ' : ''}${b.name}</td>
      <td><input type="number" class="predict-price-input" data-id="${b.id}"
          value="${b.price > 0 ? b.price : ''}" placeholder="输入预测报价"
          oninput="updateBidderPriceById('${b.id}', +this.value)"
          style="width:150px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;${b.isMe ? 'border-color:#2e6da4;background:#eff6ff;' : ''}"></td>
    `;
    tbody.appendChild(tr);
  });
}

function calcPredictResult() {
  document.querySelectorAll('.predict-price-input').forEach(input => {
    const id = input.dataset.id;
    const val = +input.value;
    const bidder = State.bidders.find(b => b.id === id);
    if (bidder) bidder.price = val > 0 ? val : 0;
  });
  State.predictPrices = {};
  renderBidderTable();
  renderPartnerStrategyInputs();
  saveState();

  const config = buildConfig();
  const bidders = State.bidders.map(b => ({ ...b }));

  if (!bidders.some(b => b.price > 0)) {
    gi('predict-result-box').innerHTML =
      '<p class="note" style="color:#dc2626;">请至少输入一方的预测报价</p>';
    return;
  }

  // 只计算价格得分，按价格得分排名
  const strategy = config.priceStrategy;
  const priceResult = Scoring.PriceStrategies[strategy]
    ? Scoring.PriceStrategies[strategy](bidders, config.priceFull, config.strategyParams)
    : Scoring.PriceStrategies.lowestPrice(bidders, config.priceFull, config.strategyParams);

  const sorted = [...priceResult].sort((a, b) => b.priceScore - a.priceScore);
  sorted.forEach((b, i) => { b.priceRank = i + 1; });
  const ranked = priceResult.map(b => sorted.find(s => s.id === b.id));

  const benchmark = ranked.find(b => b.benchmark)?.benchmark;
  const benchmarkHtml = benchmark
    ? `<p style="font-size:12px;color:#666;margin-bottom:8px;">
        评标基准价：¥${fmt(benchmark)}　|　价格策略：${Scoring.strategyNames[strategy]}
       </p>`
    : `<p style="font-size:12px;color:#666;margin-bottom:8px;">价格策略：${Scoring.strategyNames[strategy]}</p>`;

  const theadHtml = `<tr>
    <th>价格排名</th><th>投标方</th><th>预测报价（元）</th>
    <th>与基准价偏差</th>
    <th>价格得分（满分${config.priceFull}）</th>
  </tr>`;

  const tbodyHtml = ranked.map(b => `
    <tr class="${b.isMe ? 'my-row' : ''} ${b.priceRank === 1 ? 'rank-1' : ''}">
      <td><strong>${b.priceRank}</strong></td>
      <td>${b.name}${b.isMe ? ' <span class="badge badge-yellow">我方</span>' : ''}</td>
      <td>${b.price > 0 ? '¥ ' + fmt(b.price) : '<span style="color:#bbb;">未填</span>'}</td>
      <td>${b.deviation != null ? b.deviation + '%' : '—'}</td>
      <td><strong>${b.priceScore}</strong></td>
    </tr>`).join('');

  gi('predict-result-box').innerHTML = `
    ${benchmarkHtml}
    <div class="table-wrap">
      <table>
        <thead>${theadHtml}</thead>
        <tbody>${tbodyHtml}</tbody>
      </table>
    </div>`;
}

// ========================
// 优化面板
// ========================
function renderOptimize() {
  renderPredictTable();
  renderPartnerStrategyInputs();

  const config = buildConfig();
  if (!validateConfig(config)) return;

  const myBidder = State.bidders.find(b => b.isMe);
  if (!myBidder) return;

  // 默认搜索区间：基于其他投标方报价
  const others = State.bidders.filter(b => !b.isMe && b.price > 0);
  let searchMin, searchMax;

  if (others.length > 0) {
    const prices = others.map(b => b.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    searchMin = gi('opt-min').value ? +gi('opt-min').value : Math.round(minP * 0.85);
    searchMax = gi('opt-max').value ? +gi('opt-max').value : Math.round(maxP * 1.1);
  } else {
    searchMin = gi('opt-min').value ? +gi('opt-min').value : 800000;
    searchMax = gi('opt-max').value ? +gi('opt-max').value : 1200000;
  }
  const step = gi('opt-step').value ? +gi('opt-step').value : Math.round((searchMax - searchMin) / 500);

  if (!gi('opt-min').value) gi('opt-min').value = searchMin;
  if (!gi('opt-max').value) gi('opt-max').value = searchMax;
  if (!gi('opt-step').value) gi('opt-step').value = Math.max(step, 100);

  // 最优报价
  const otherBidders = State.bidders.filter(b => !b.isMe).map(b => ({ ...b }));
  const optResult = Scoring.findOptimalPrice(
    myBidder.id,
    otherBidders.map(b => ({ ...b, businessScore: b.businessScore, techScore: b.techScore })),
    { ...config, myBidderId: myBidder.id },
    { minPrice: searchMin, maxPrice: searchMax, step: Math.max(+gi('opt-step').value || 1000, 100) }
  );

  const optHtml = `
    <div class="optimize-result">
      <h3>最优报价推荐</h3>
      <div class="optimize-grid">
        <div class="optimize-item">
          <div class="oi-label">推荐报价</div>
          <div class="oi-value">¥ ${fmt(optResult.bestPrice)}</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">预计综合得分</div>
          <div class="oi-value">${optResult.bestScore?.toFixed(4) ?? '-'}</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">预计排名</div>
          <div class="oi-value">第 ${optResult.bestRank} 名</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">${optResult.bestRank === 1 ? '策略建议' : '注意'}</div>
          <div class="oi-value" style="font-size:14px;">${optResult.bestRank === 1 ? '在最高价位保持排名第一' : '当前无法排名第一，建议调整策略'}</div>
        </div>
      </div>
    </div>`;
  gi('optimize-result-box').innerHTML = optHtml;

  // 敏感性分析表格
  const sensitData = Scoring.sensitivityAnalysis(
    myBidder.id,
    otherBidders.map(b => ({ ...b, businessScore: b.businessScore, techScore: b.techScore })),
    { ...config, myBidderId: myBidder.id },
    { minPrice: searchMin, maxPrice: searchMax },
    25
  );

  const maxTotal = Math.max(...sensitData.map(r => r.total));
  const sensitRows = sensitData.map(r => {
    const barWidth = Math.round(r.total / maxTotal * 120);
    const rankColor = r.rank === 1 ? '#16a34a' : r.rank === 2 ? '#2e6da4' : '#dc2626';
    return `<tr>
      <td>¥ ${fmt(r.price)}</td>
      <td>${r.priceScore}</td>
      <td>
        <span style="display:inline-block;width:${barWidth}px;height:12px;background:${rankColor};border-radius:2px;vertical-align:middle;margin-right:4px;"></span>
        ${r.total.toFixed(4)}
      </td>
      <td><span class="badge" style="background:${r.rank===1?'#dcfce7':r.rank===2?'#dbeafe':'#fee2e2'};color:${rankColor};">第${r.rank}名</span></td>
    </tr>`;
  }).join('');

  gi('sensitivity-tbody').innerHTML = sensitRows;
}

// ========================
// 配合方报价策略
// ========================
function renderPartnerStrategyInputs() {
  const container = gi('ps-competitor-inputs');
  if (!container) return;

  const competitors = State.bidders.filter(b => !b.isMe);
  if (competitors.length === 0) {
    container.innerHTML = '<p class="note">请先在"投标方信息"中添加竞争方</p>';
    return;
  }

  // 自动带入已有报价
  const myBidder = State.bidders.find(b => b.isMe);
  const myPriceEl = gi('ps-my-price');
  if (myPriceEl && !myPriceEl.value) {
    const myPrice = myBidder?.price || '';
    if (myPrice > 0) myPriceEl.value = myPrice;
  }

  let html = '<div style="margin-bottom:6px;font-size:13px;color:#555;font-weight:500;">已知竞争方报价</div><div class="form-row">';
  competitors.forEach(b => {
    const savedPrice = b.price > 0 ? b.price : '';
    html += `
      <div class="form-group">
        <label>${b.name}</label>
        <input type="number" class="ps-comp-price" data-id="${b.id}" value="${savedPrice}"
          placeholder="输入竞争方报价"
          style="width:140px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;">
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function recommendPartnerPrices(myPrice, competitorPrices, numPartners, config) {
  const { priceStrategy: strategy, strategyParams: params, priceFull } = config;
  const allKnown = [myPrice, ...competitorPrices];
  const maxKnown = Math.max(...allKnown);
  const sumComp = competitorPrices.reduce((a, b) => a + b, 0);
  const n = 1 + competitorPrices.length + numPartners;
  let partnerPrices = [];
  let explanation = '';

  if (strategy === 'lowestPrice') {
    for (let i = 0; i < numPartners; i++)
      partnerPrices.push(Math.round(maxKnown * (1.06 + i * 0.04)));
    explanation = '最低价法下报价最低者得满分。配合方须高于我方报价，建议各自拉开梯度，避免相同报价引发质疑。';

  } else if (strategy === 'averagePrice') {
    const baseScore = params.avgBaseScore ?? 80;
    const lowAdd = params.avgLowAdd ?? 1;
    const maxScore = params.avgMaxScore ?? priceFull;
    const requiredBelowPct = lowAdd > 0 ? Math.max(0, (maxScore - baseScore) / lowAdd) : 0;
    const targetRatio = Math.max(0.01, 1 - requiredBelowPct / 100);
    // 目标均价 = 我方报价 / 目标报价占均价比例，取刚好达到最高分的最低均价，避免无意义拉高配合方报价。
    const targetAvg = myPrice / targetRatio;
    const targetSum = targetAvg * n - myPrice - sumComp;
    if (targetSum > myPrice * numPartners * 0.3) {
      const base = targetSum / numPartners;
      for (let i = 0; i < numPartners; i++)
        partnerPrices.push(Math.round(base * (1 + i * 0.01)));
      explanation = `平均价法下，平均价为${baseScore}分；按当前参数，我方报价需约低于平均价${roundText(requiredBelowPct)}%才能达到最高分${maxScore}分。配合方按上述报价可把预测均价抬到该有利区间。`;
    } else {
      for (let i = 0; i < numPartners; i++)
        partnerPrices.push(Math.round(maxKnown * (1.06 + i * 0.04)));
      explanation = `平均价法下，现有竞争方报价已足以把均价抬高到有利区间；配合方建议高于已知报价并拉开梯度，避免拉低均价影响我方达到${maxScore}分。`;
    }

  } else if (strategy === 'compositePrice') {
    // 目标：复合基准价 ≈ 我方报价（偏差为0得满分）
    // Σpartners = myPrice × (n-1) - Σcomp
    const targetSum = myPrice * (n - 1) - sumComp;
    if (targetSum > myPrice * numPartners * 0.3) {
      const base = targetSum / numPartners;
      for (let i = 0; i < numPartners; i++)
        partnerPrices.push(Math.round(base * (1 + i * 0.01))); // 微小错开
      explanation = `${Scoring.strategyNames[strategy]}下，评标基准价为均值。配合方按上述报价可使均价贴近我方报价，偏差趋近于0，我方获得最高价格得分。`;
    } else {
      // 竞争方报价已偏低，配合方需报高价拉升均值
      for (let i = 0; i < numPartners; i++)
        partnerPrices.push(Math.round(myPrice * (1.25 + i * 0.06)));
      explanation = `${Scoring.strategyNames[strategy]}下，现有竞争方报价偏低导致均值低于我方。配合方报高价可拉升基准价，减小我方偏差，提升价格得分。`;
    }

  } else if (strategy === 'trimmedAverage') {
    const trimCount = params.trimCount || 1;
    if (numPartners <= trimCount) {
      // 全部配合方报极高价，被剔除，不影响基准价
      for (let i = 0; i < numPartners; i++)
        partnerPrices.push(Math.round(maxKnown * (1.35 + i * 0.08)));
      explanation = `去高去低平均价法下，配合方全部报极高价（超过去除阈值），系统自动剔除，不影响基准价计算，同时完成投标人数要求。`;
    } else {
      // 部分被剔除，其余调节均值
      for (let i = 0; i < trimCount; i++)
        partnerPrices.push(Math.round(maxKnown * (1.35 + i * 0.08)));
      const remain = numPartners - trimCount;
      const nAfterTrim = 1 + competitorPrices.length + remain;
      const targetSumRemain = myPrice * (nAfterTrim - 1) - sumComp;
      const base = targetSumRemain > 0 ? targetSumRemain / remain : myPrice * 1.15;
      for (let i = 0; i < remain; i++)
        partnerPrices.push(Math.round(base * (1 + i * 0.01)));
      explanation = `去高去低平均价法下，${trimCount}家配合方报极高价被剔除，其余${remain}家通过精准报价将剔除后的均值调节至接近我方报价。`;
    }

  } else if (strategy === 'fixedBenchmark' || strategy === 'intervalScore') {
    // 基准价固定，配合方无法影响，只需自身得分低于我方即可
    const benchmark = params.benchmark || myPrice;
    for (let i = 0; i < numPartners; i++)
      partnerPrices.push(Math.round(benchmark * (1.18 + i * 0.06)));
    explanation = `固定基准价/区间得分法下，基准价由招标方设定，配合方报价不影响基准价。建议配合方报价明显偏离基准价，自身价格得分低于我方即可。`;

  } else {
    for (let i = 0; i < numPartners; i++)
      partnerPrices.push(Math.round(myPrice * (1.08 + i * 0.04)));
    explanation = '建议配合方报价高于我方，保持合理间距。';
  }

  return { partnerPrices, explanation };
}

function calcPartnerStrategy() {
  const myPrice = +gi('ps-my-price').value;
  if (!myPrice) {
    gi('ps-result-box').innerHTML = '<p class="note" style="color:#dc2626;">请输入我方确定报价</p>';
    return;
  }

  const competitorPrices = [];
  const competitorNames = [];
  document.querySelectorAll('.ps-comp-price').forEach(input => {
    const price = +input.value;
    if (price > 0) {
      competitorPrices.push(price);
      const bidder = State.bidders.find(b => b.id === input.dataset.id);
      competitorNames.push(bidder?.name || '竞争方');
    }
  });

  if (competitorPrices.length === 0) {
    gi('ps-result-box').innerHTML = '<p class="note" style="color:#dc2626;">请至少输入一家竞争方的报价</p>';
    return;
  }

  const numPartners = +gi('ps-partner-count').value || 2;
  const config = buildConfig();
  const { partnerPrices, explanation } = recommendPartnerPrices(myPrice, competitorPrices, numPartners, config);

  // 构建虚拟投标列表，仅做价格得分计算
  const allBidders = [
    { id: 'ps-me', name: '我方', price: myPrice, isMe: true, isPartner: false },
    ...competitorPrices.map((p, i) => ({ id: 'ps-c' + i, name: competitorNames[i], price: p, isMe: false, isPartner: false })),
    ...partnerPrices.map((p, i) => ({ id: 'ps-p' + i, name: `配合方${i + 1}`, price: p, isMe: false, isPartner: true })),
  ];

  const strategy = config.priceStrategy;
  const priceResult = (Scoring.PriceStrategies[strategy] || Scoring.PriceStrategies.lowestPrice)(
    allBidders, config.priceFull, config.strategyParams
  );
  const sorted = [...priceResult].sort((a, b) => b.priceScore - a.priceScore);
  sorted.forEach((b, i) => { b.priceRank = i + 1; });
  const ranked = priceResult.map(b => sorted.find(s => s.id === b.id));

  const benchmark = ranked.find(b => b.benchmark)?.benchmark;
  const me = ranked.find(b => b.isMe);

  const recsHtml = partnerPrices.map((p, i) => `
    <div class="optimize-item">
      <div class="oi-label">配合方${i + 1} 建议报价</div>
      <div class="oi-value">¥ ${fmt(p)}</div>
    </div>`).join('');

  const theadHtml = `<tr>
    <th>价格排名</th><th>角色</th><th>报价（元）</th>
    <th>与基准价偏差</th><th>价格得分（满分${config.priceFull}）</th>
  </tr>`;

  const tbodyHtml = ranked.map(b => {
    const roleLabel = b.isMe ? '我方' : b.isPartner ? '配合方' : '竞争方';
    const badgeClass = b.isMe ? 'badge-yellow' : b.isPartner ? 'badge-blue' : '';
    const rowClass = (b.isMe ? 'my-row' : b.isPartner ? 'partner-row' : '') + (b.priceRank === 1 ? ' rank-1' : '');
    return `<tr class="${rowClass}">
      <td><strong>${b.priceRank}</strong></td>
      <td><span class="badge ${badgeClass}">${roleLabel}</span> ${b.name}</td>
      <td>¥ ${fmt(b.price)}</td>
      <td>${b.deviation != null ? b.deviation + '%' : '—'}</td>
      <td><strong>${b.priceScore}</strong></td>
    </tr>`;
  }).join('');

  gi('ps-result-box').innerHTML = `
    <div class="optimize-result">
      <h3>策略说明</h3>
      <p style="font-size:13px;color:#555;margin-bottom:12px;">${explanation}</p>
      <div class="optimize-grid">
        <div class="optimize-item">
          <div class="oi-label">我方报价</div>
          <div class="oi-value">¥ ${fmt(myPrice)}</div>
        </div>
        ${recsHtml}
        ${benchmark ? `<div class="optimize-item">
          <div class="oi-label">预测基准价</div>
          <div class="oi-value">¥ ${fmt(benchmark)}</div>
        </div>` : ''}
        <div class="optimize-item">
          <div class="oi-label">我方价格得分</div>
          <div class="oi-value">${me?.priceScore ?? '-'} 分</div>
        </div>
        <div class="optimize-item">
          <div class="oi-label">我方价格排名</div>
          <div class="oi-value">第 ${me?.priceRank ?? '-'} 名</div>
        </div>
      </div>
    </div>
    <p style="font-size:12px;color:#666;margin:8px 0 6px;">价格策略：${Scoring.strategyNames[strategy]}${benchmark ? '　|　评标基准价：¥' + fmt(benchmark) : ''}</p>
    <div class="table-wrap">
      <table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>
    </div>`;
}

// ========================
// 方案对比面板
// ========================
function initScenarioPanel() {
  gi('btn-save-scenario').addEventListener('click', saveScenario);
  gi('btn-clear-scenarios').addEventListener('click', () => {
    if (confirm('确定清空所有方案？')) {
      State.scenarios = [];
      renderScenarios();
      saveState();
    }
  });

  // 默认带入当前投标方信息中我方数据
  const myBidder = State.bidders.find(b => b.isMe);
  if (myBidder) {
    if (myBidder.price > 0) gi('scenario-my-price').value = myBidder.price;
    gi('scenario-my-biz').value = myBidder.businessScore;
    gi('scenario-my-tech').value = myBidder.techScore;
  }
}

function saveScenario() {
  const myPrice = +gi('scenario-my-price').value;
  const myBiz   = +gi('scenario-my-biz').value;
  const myTech  = +gi('scenario-my-tech').value;

  if (!myPrice) {
    alert('请填写我方报价');
    return;
  }

  const config = buildConfig();
  const bidders = [
    { id: 'my', name: '我方', price: myPrice, businessScore: myBiz, techScore: myTech, isMe: true },
    ...State.bidders.filter(b => !b.isMe).map(b => ({ ...b })),
  ];
  const result = Scoring.evaluate(bidders, config);
  const me = result.find(b => b.isMe);

  const name = gi('scenario-name').value || `方案${State.scenarios.length + 1}`;
  State.scenarios.push({
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
      <td>${s.name}</td>
      <td><small style="color:#888;">${s.strategy}</small></td>
      <td>¥ ${fmt(s.price)}</td>
      <td>${s.businessScore}</td>
      <td>${s.techScore}</td>
      <td>${s.priceScore}</td>
      <td>
        <span style="display:inline-block;width:${Math.round(s.total/maxTotal*100)}px;height:12px;background:#2e6da4;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>
        <strong>${s.total.toFixed(4)}</strong>
      </td>
      <td><span class="badge ${s.rank===1?'badge-green':s.rank<=2?'badge-blue':'badge-red'}">第${s.rank}名</span></td>
      <td><small style="color:#888;">${s.timestamp || '-'}</small></td>
      <td><button class="btn btn-danger" onclick="removeScenario(${i})">删除</button></td>
    </tr>`).join('');

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>方案名称</th><th>价格策略</th><th>我方报价</th>
        <th>商务得分</th><th>技术得分</th><th>价格得分</th>
        <th>综合得分</th><th>排名</th><th>保存时间</th><th>操作</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
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
  return {
    businessWeight: State.config.businessWeight,
    priceWeight:    State.config.priceWeight,
    techWeight:     State.config.techWeight,
    priceFull:      State.config.priceFull,
    priceStrategy:  State.config.priceStrategy,
    strategyParams: { ...State.config.strategyParams },
    myBidderId:     'my',
  };
}

function validateConfig(config) {
  const sum = config.businessWeight + config.priceWeight + config.techWeight;
  if (Math.abs(sum - 100) > 0.01) {
    // 不强制拦截，仅提示
    return true;
  }
  return true;
}

function gi(id) { return document.getElementById(id); }
function v(id, val) { const el = gi(id); if (el) el.value = val; }
function fmt(num) {
  if (!num && num !== 0) return '-';
  return Number(num).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
function roundText(num) {
  return Number(num).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

// ========================
// 快速导入预设
// ========================
function loadPreset(name) {
  const presets = {
    gov: {
      businessWeight: 20, priceWeight: 40, techWeight: 40,
      priceStrategy: 'averagePrice',
      strategyParams: { avgBaseScore: 80, avgLowAdd: 1, avgHighDeduct: 1, avgMaxScore: 100, avgMinScore: 0 },
      label: '政府采购（商务20/价格40/技术40）'
    },
    infra: {
      businessWeight: 10, priceWeight: 60, techWeight: 30,
      priceStrategy: 'compositePrice',
      strategyParams: { weightLow: 0.5, weightAvg: 0.5, deductHigh: 1, deductLow: 0.5 },
      label: '基础设施工程（商务10/价格60/技术30）'
    },
    tech: {
      businessWeight: 15, priceWeight: 30, techWeight: 55,
      priceStrategy: 'lowestPrice',
      strategyParams: {},
      label: '信息技术项目（商务15/价格30/技术55）'
    },
    lowest: {
      businessWeight: 20, priceWeight: 50, techWeight: 30,
      priceStrategy: 'lowestPrice',
      strategyParams: {},
      label: '最低价竞标型（商务20/价格50/技术30）'
    },
  };

  const preset = presets[name];
  if (!preset) return;

  State.config.businessWeight  = preset.businessWeight;
  State.config.priceWeight     = preset.priceWeight;
  State.config.techWeight      = preset.techWeight;
  State.config.priceStrategy   = preset.priceStrategy;
  State.config.strategyParams  = { ...State.config.strategyParams, ...preset.strategyParams };

  syncConfigFromState();
  updateStrategyParams();

  // 同步strategy select
  gi('cfg-strategy').value = preset.priceStrategy;
  updateWeightSum();
  saveState();

  alert(`已加载预设：${preset.label}`);
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

  gi('btn-calc-result').addEventListener('click', renderResult);
  gi('btn-search-optimal').addEventListener('click', renderOptimize);
  gi('btn-predict-calc').addEventListener('click', calcPredictResult);
  gi('btn-partner-strategy').addEventListener('click', calcPartnerStrategy);
});
