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
    priceFull: 100,       // 价格满分（通常=100，也可按适用规则调整）
    priceStrategy: 'averagePrice',
    strategyParams: {
      deductHigh: 0.5,
      deductLow:  0.3,
      avgBaseScore: 80,
      avgLowAdd: 1,
      avgHighDeduct: 1,
      avgMaxScore: 100,
      avgMinScore: 0,
      outlierCutoffMultiple: 1.5,
      outlierBenchmarkFactor: 0.95,
      outlierHighDeduct: 0.8,
      outlierLowDeduct: 0.3,
      outlierMinScore: 0,
      outlierDeviationDecimals: 2,
      outlierFullScore: 46,
      outlierSpecialFullScore: 1,
      weightLow:  0.5,
      weightAvg:  0.5,
      benchmark:  0,
      lowerPct:   3,
      upperPct:   3,
      deductOut:  1,
      trimCount:  1,
      tierHighThreshold: 10,
      tierMidThreshold: 5,
      tierHighTrim: 2,
      tierMidTrim: 1,
      benchmarkFactor: 0.95,
      benchmarkDecimals: 6,
      tierBaseScore: 35,
      tierHighDeduct: 0.5,
      tierLowAdd: 0.5,
      tierMinScore: 30,
      tierMaxScore: 40,
    },
    myBidderId: 'my',
  },
  bidders: [
    { id: 'my',   name: '目标方案', price: 0, businessScore: 80, techScore: 85, isMe: true  },
    { id: 'b1',   name: '其他样本A', price: 0, businessScore: 78, techScore: 82, isMe: false },
    { id: 'b2',   name: '其他样本B', price: 0, businessScore: 76, techScore: 80, isMe: false },
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
        name: b.name || (idx === 0 ? '目标方案' : '其他样本' + idx),
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
  const componentFullScore = getComponentFullScore(State.config.priceStrategy);
  if (componentFullScore != null) State.config.priceFull = componentFullScore;
  syncConfigFromState();
  bindConfigEvents();
  updateStrategyParams();
}

function getComponentFullScore(strategy) {
  if (strategy === 'tieredTrimmedBenchmark') {
    return State.config.strategyParams.tierMaxScore ?? 40;
  }
  if (strategy === 'outlierFilteredBenchmark') {
    return State.config.strategyParams.outlierFullScore ?? 46;
  }
  return null;
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
  gi('cfg-price-full').addEventListener('input', () => {
    State.config.priceFull = +gi('cfg-price-full').value || 100;
    if (State.config.priceStrategy === 'tieredTrimmedBenchmark') {
      State.config.strategyParams.tierMaxScore = State.config.priceFull;
      const tierMaxInput = gi('sp-tierMaxScore');
      if (tierMaxInput) tierMaxInput.value = State.config.priceFull;
    } else if (State.config.priceStrategy === 'outlierFilteredBenchmark') {
      State.config.strategyParams.outlierFullScore = State.config.priceFull;
    }
    saveState();
  });
  gi('cfg-strategy').addEventListener('change', () => {
    const previousStrategy = State.config.priceStrategy;
    const previousComponentFullScore = getComponentFullScore(previousStrategy);
    State.config.priceStrategy = gi('cfg-strategy').value;
    const nextComponentFullScore = getComponentFullScore(State.config.priceStrategy);
    if (nextComponentFullScore != null) {
      State.config.priceFull = nextComponentFullScore;
      v('cfg-price-full', State.config.priceFull);
    } else if (previousComponentFullScore != null && State.config.priceFull === previousComponentFullScore) {
      State.config.priceFull = 100;
      v('cfg-price-full', 100);
    }
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
    outlierFilteredBenchmark: `<div class="form-row">
      <div class="form-group"><label>高价剔除阈值（初始均值倍数）</label>
        <input type="number" id="sp-outlierCutoffMultiple" value="${p.outlierCutoffMultiple ?? 1.5}" step="0.01" min="1.01">
      </div>
      <div class="form-group"><label>基准价系数</label>
        <input type="number" id="sp-outlierBenchmarkFactor" value="${p.outlierBenchmarkFactor ?? 0.95}" step="0.01" min="0.01">
      </div>
      <div class="form-group"><label>高于基准价每1%扣（分）</label>
        <input type="number" id="sp-outlierHighDeduct" value="${p.outlierHighDeduct ?? 0.8}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>低于基准价每1%扣（分）</label>
        <input type="number" id="sp-outlierLowDeduct" value="${p.outlierLowDeduct ?? 0.3}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>最低分</label>
        <input type="number" id="sp-outlierMinScore" value="${p.outlierMinScore ?? 0}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>偏差率小数位</label>
        <input type="number" id="sp-outlierDeviationDecimals" value="${p.outlierDeviationDecimals ?? 2}" step="1" min="0" max="10">
      </div>
    </div>
    <p class="note">先以全部有效报价计算初始均值；报价达到初始均值×阈值时不参与基准价计算。其余报价均值×系数得到基准价。偏差率先保留指定小数位，再按高低侧斜率扣分；技术得分最高且有效报价最低时价格满分。价格满分使用上方“价格分项满分”。</p>`,
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
      <div class="form-group"><label>固定基准价（元）</label>
        <input type="number" id="sp-benchmark" value="${p.benchmark}" step="10000" min="0">
      </div>
      ${commonDeduct}
    </div>
    <p class="note">基准价由用户按适用规则预先设置，偏差越小得分越高</p>`,
    trimmedAverage: `<div class="form-row">
      <div class="form-group"><label>去掉最高/最低各几个</label>
        <input type="number" id="sp-trimCount" value="${p.trimCount}" step="1" min="1" max="3">
      </div>
      ${commonDeduct}
    </div>
    <p class="note">去掉最高价和最低价各若干个后取平均作为基准价</p>`,
    tieredTrimmedBenchmark: `<div class="form-row">
      <div class="form-group"><label>高档人数阈值（大于）</label>
        <input type="number" id="sp-tierHighThreshold" value="${p.tierHighThreshold ?? 10}" step="1" min="1">
      </div>
      <div class="form-group"><label>高档去掉两端各（家）</label>
        <input type="number" id="sp-tierHighTrim" value="${p.tierHighTrim ?? 2}" step="1" min="0">
      </div>
      <div class="form-group"><label>中档人数阈值（大于）</label>
        <input type="number" id="sp-tierMidThreshold" value="${p.tierMidThreshold ?? 5}" step="1" min="0">
      </div>
      <div class="form-group"><label>中档去掉两端各（家）</label>
        <input type="number" id="sp-tierMidTrim" value="${p.tierMidTrim ?? 1}" step="1" min="0">
      </div>
      <div class="form-group"><label>平均价系数</label>
        <input type="number" id="sp-benchmarkFactor" value="${p.benchmarkFactor ?? 0.95}" step="0.01" min="0">
      </div>
      <div class="form-group"><label>基准价小数位</label>
        <input type="number" id="sp-benchmarkDecimals" value="${p.benchmarkDecimals ?? 6}" step="1" min="0" max="10">
      </div>
      <div class="form-group"><label>基准价基础分</label>
        <input type="number" id="sp-tierBaseScore" value="${p.tierBaseScore ?? 35}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>高于基准价每1%扣（分）</label>
        <input type="number" id="sp-tierHighDeduct" value="${p.tierHighDeduct ?? 0.5}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>低于基准价每1%加（分）</label>
        <input type="number" id="sp-tierLowAdd" value="${p.tierLowAdd ?? 0.5}" step="0.1" min="0">
      </div>
      <div class="form-group"><label>最低分</label>
        <input type="number" id="sp-tierMinScore" value="${p.tierMinScore ?? 30}" step="0.5" min="0">
      </div>
      <div class="form-group"><label>最高分</label>
        <input type="number" id="sp-tierMaxScore" value="${p.tierMaxScore ?? 40}" step="0.5" min="0">
      </div>
    </div>
    <p class="note">默认规则：有效报价&gt;10个时去高去低各2个，6~10个各1个，≤5个不去除；剩余报价均值×0.95，基准价保留6位。基准价35分，高扣0.5、低加0.5，30~40分封顶。当前以报价&gt;0判定有效，无效样本请删除或将报价留空。</p>`,
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
  const paramIds = ['deductHigh','deductLow','avgBaseScore','avgLowAdd','avgHighDeduct','avgMaxScore','avgMinScore','outlierCutoffMultiple','outlierBenchmarkFactor','outlierHighDeduct','outlierLowDeduct','outlierMinScore','outlierDeviationDecimals','weightLow','weightAvg','benchmark','lowerPct','upperPct','deductOut','trimCount','tierHighThreshold','tierMidThreshold','tierHighTrim','tierMidTrim','benchmarkFactor','benchmarkDecimals','tierBaseScore','tierHighDeduct','tierLowAdd','tierMinScore','tierMaxScore'];
  paramIds.forEach(pid => {
    const el = gi('sp-' + pid);
    if (el) {
      el.addEventListener('input', () => {
        State.config.strategyParams[pid] = +el.value;
        if (pid === 'tierMaxScore' && State.config.priceStrategy === 'tieredTrimmedBenchmark') {
          State.config.priceFull = +el.value || 40;
          v('cfg-price-full', State.config.priceFull);
        }
        saveState();
      });
    }
  });
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
    row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
    row.innerHTML = `
      <span class="badge ${b.isMe ? 'badge-yellow' : 'badge-blue'}" style="min-width:36px;text-align:center;">
        ${b.isMe ? '目标' : String(idx)}
      </span>
      <input type="text" value="${escapeHtml(b.name)}" placeholder="样本名称"
        style="width:200px;padding:5px 8px;border:1px solid #d1d5db;border-radius:4px;"
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
function renderBidderTable() {
  const tbody = gi('bidder-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  State.bidders.forEach((b, idx) => {
    const tr = document.createElement('tr');
    if (b.isMe) tr.classList.add('my-row');
    tr.innerHTML = `
      <td>${b.isMe ? '<span class="badge badge-yellow">目标</span>' : `<span class="badge badge-blue">${idx}</span>`}</td>
      <td style="font-weight:${b.isMe ? 'bold' : 'normal'};">${escapeHtml(b.name)}</td>
      <td><input type="text" value="${b.price > 0 ? fmt(b.price) : ''}" placeholder="输入报价"
          inputmode="decimal" autocomplete="off"
          style="width:130px;padding:4px 6px;border:1px solid ${b.isMe ? '#2e6da4' : '#d1d5db'};border-radius:4px;${b.isMe ? 'background:#eff6ff;' : ''}"
          oninput="updateBidderPriceInput(${idx},this)"
          onblur="formatBidderPriceInput(${idx},this)"></td>
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
    name: '其他样本' + String.fromCharCode(64 + idx),
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
  }
  saveState();
}

function updateBidderPriceInput(idx, input) {
  const rawValue = input.value;
  const price = Scoring.normalizePriceInput(rawValue);
  State.bidders[idx].price = price;
  input.classList.toggle('price-input-invalid', rawValue.trim() !== '' && price <= 0);
  renderPredictTable();
  saveState();
}

function formatBidderPriceInput(idx, input) {
  const price = State.bidders[idx]?.price || 0;
  if (price > 0) input.value = fmt(price);
}

function updateBidderPriceById(id, value) {
  const bidder = State.bidders.find(b => b.id === id);
  if (!bidder) return;
  bidder.price = Scoring.normalizePriceInput(value);
  renderBidderTable();
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
  const bidValidity = Scoring.summarizeBidValidity(bidders);
  const result  = Scoring.evaluate(bidders, config);

  const me = result.find(b => b.isMe);
  const invalidNames = bidValidity.invalidBidders
    .map(bidder => escapeHtml(bidder.name || '未命名样本'))
    .join('、');
  const status = gi('result-bid-status');
  status.className = `bid-validity-status${bidValidity.invalidCount ? ' warn' : ''}`;
  let countDetailText = '';
  if (config.priceStrategy === 'tieredTrimmedBenchmark' && result[0]) {
    countDetailText = ` 去最高、最低各${result[0].trimCount}个，基准价平均值纳入${result[0].includedBidCount}个报价。`;
  } else if (config.priceStrategy === 'outlierFilteredBenchmark' && result[0]) {
    const excludedNames = result[0].excludedHighBidderNames.map(name => escapeHtml(name)).join('、');
    const excludedNamesText = excludedNames ? `（${excludedNames}）` : '';
    countDetailText = ` 初始均值¥${fmt(result[0].preliminaryAverage)}，达到¥${fmt(result[0].exclusionThreshold)}的${result[0].excludedHighBidCount}个高价${excludedNamesText}不参与基准价计算，最终纳入${result[0].includedBidCount}个报价。`;
  }
  const filtersInvalidBidders = config.priceStrategy === 'tieredTrimmedBenchmark' ||
    config.priceStrategy === 'outlierFilteredBenchmark';
  const invalidImpactText = filtersInvalidBidders
    ? '未进入本次评分及基准价计算'
    : '报价未进入价格基准计算';
  status.innerHTML = bidValidity.invalidCount
    ? `<strong>已建立${bidValidity.totalCount}个样本，有效${bidValidity.validCount}个。</strong>${invalidImpactText}：${invalidNames}（报价为空、为0或格式无效）。${countDetailText}`
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
      <div class="sub">满分100分</div>
    </div>
    <div class="summary-card">
      <div class="label">目标方案价格得分</div>
      <div class="value">${me ? fmtPriceScore(me.priceScore, config.priceStrategy) : '-'}</div>
      <div class="sub">满分${config.priceFull}分${me?.specialFullScore ? ' · 技术最高且最低价' : ''}</div>
    </div>
    ${me && me.benchmark ? `<div class="summary-card">
      <div class="label">评分基准价</div>
      <div class="value">¥${fmtBenchmark(me.benchmark, config.priceStrategy)}</div>
      <div class="sub">偏差 ${me.deviation ?? '-'}%${formatBenchmarkCountDetails(me, config.priceStrategy)}</div>
    </div>` : ''}
  `;
  gi('result-summary').innerHTML = sumHtml;

  // 明细表格
  const theadHtml = `
    <tr>
      <th>排名</th><th>报价样本</th><th>报价（元）</th>
      <th>与基准价偏差</th>
      <th>价格得分<br><small>（满分${config.priceFull}）</small></th>
      <th>商务得分<br><small>（满分100）</small></th>
      <th>技术得分<br><small>（满分100）</small></th>
      <th>综合得分</th>
    </tr>`;

  const tbodyHtml = result.map(b => `
    <tr class="${b.isMe ? 'my-row' : ''} ${b.rank === 1 ? 'rank-1' : ''}">
      <td><strong>${b.rank}</strong></td>
      <td>${escapeHtml(b.name)}${b.isMe ? ' <span class="badge badge-yellow">目标</span>' : ''}</td>
      <td>${fmt(b.price)}</td>
      <td>${b.deviation != null ? b.deviation + '%' : '—'}</td>
      <td>${fmtPriceScore(b.priceScore, config.priceStrategy)}${b.specialFullScore ? '<br><small class="score-reason">技术最高且最低价满分</small>' : ''}</td>
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
      <td>${b.isMe ? '<span class="badge badge-yellow">目标</span> ' : ''}${escapeHtml(b.name)}</td>
      <td><input type="text" class="predict-price-input" data-id="${b.id}"
          value="${b.price > 0 ? fmt(b.price) : ''}" placeholder="输入预测报价"
          inputmode="decimal" autocomplete="off"
          oninput="updateBidderPriceById('${b.id}', this.value)"
          style="width:150px;padding:4px 6px;border:1px solid #d1d5db;border-radius:4px;${b.isMe ? 'border-color:#2e6da4;background:#eff6ff;' : ''}"></td>
    `;
    tbody.appendChild(tr);
  });
}

function calcPredictResult() {
  document.querySelectorAll('.predict-price-input').forEach(input => {
    const id = input.dataset.id;
    const val = Scoring.normalizePriceInput(input.value);
    const bidder = State.bidders.find(b => b.id === id);
    if (bidder) bidder.price = val > 0 ? val : 0;
  });
  State.predictPrices = {};
  renderBidderTable();
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
  const configErrors = Scoring.validateStrategyConfig(strategy, config.priceFull, config.strategyParams);
  if (configErrors.length > 0) {
    gi('predict-result-box').innerHTML = `<p class="note" style="color:#dc2626;">${escapeHtml(configErrors.join('；'))}</p>`;
    return;
  }
  const priceResult = Scoring.PriceStrategies[strategy]
    ? Scoring.PriceStrategies[strategy](bidders, config.priceFull, config.strategyParams)
    : Scoring.PriceStrategies.lowestPrice(bidders, config.priceFull, config.strategyParams);

  const sorted = [...priceResult].sort((a, b) => b.priceScore - a.priceScore);
  sorted.forEach((b, i) => { b.priceRank = i + 1; });
  const ranked = priceResult.map(b => sorted.find(s => s.id === b.id));

  const benchmark = ranked.find(b => b.benchmark)?.benchmark;
  const benchmarkHtml = benchmark
    ? `<p style="font-size:12px;color:#666;margin-bottom:8px;">
        评分基准价：¥${fmtBenchmark(benchmark, strategy)}　|　价格方法：${Scoring.strategyNames[strategy]}
       </p>`
    : `<p style="font-size:12px;color:#666;margin-bottom:8px;">价格策略：${Scoring.strategyNames[strategy]}</p>`;

  const theadHtml = `<tr>
    <th>价格排名</th><th>报价样本</th><th>假设报价（元）</th>
    <th>与基准价偏差</th>
    <th>价格得分（满分${config.priceFull}）</th>
  </tr>`;

  const tbodyHtml = ranked.map(b => `
    <tr class="${b.isMe ? 'my-row' : ''} ${b.priceRank === 1 ? 'rank-1' : ''}">
      <td><strong>${b.priceRank}</strong></td>
      <td>${escapeHtml(b.name)}${b.isMe ? ' <span class="badge badge-yellow">目标</span>' : ''}</td>
      <td>${b.price > 0 ? '¥ ' + fmt(b.price) : '<span style="color:#bbb;">未填</span>'}</td>
      <td>${b.deviation != null ? b.deviation + '%' : '—'}</td>
      <td><strong>${fmtPriceScore(b.priceScore, strategy)}</strong>${b.specialFullScore ? '<br><small class="score-reason">技术最高且最低价满分</small>' : ''}</td>
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

function renderOptimize() {
  renderPredictTable();
  renderOptimizeTargetOptions();

  const config = buildConfig();
  if (!validateConfig(config)) return;

  const targetBidder = State.bidders.find(bidder => bidder.id === gi('opt-target').value);
  if (!targetBidder) return;

  const others = State.bidders.filter(bidder => bidder.id !== targetBidder.id && bidder.price > 0);
  let scenarios;
  try {
    scenarios = Scoring.parsePriceScenarios(gi('opt-scenarios').value, others);
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
    optimization = Scoring.optimizePriceAcrossScenarios(
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
  const countsText = optimization.participantCounts.map(count => `${count}个`).join('、');
  const specialRuleSearchNote = config.priceStrategy === 'outlierFilteredBenchmark'
    ? '；情景未提供技术分，技术最高且最低价的特殊满分条件不纳入本次价格搜索'
    : '';
  const detailRows = best.details.map(detail => `<tr>
    <td>${escapeHtml(detail.name)}</td>
    <td>${detail.participantCount}</td>
    <td>${detail.benchmark == null ? '—' : '¥ ' + fmtBenchmark(detail.benchmark, config.priceStrategy)}</td>
    <td><strong>${fmtPriceScore(detail.priceScore, config.priceStrategy)}</strong></td>
    <td>第${detail.priceRank}名${detail.isTop ? '（并列第一）' : ''}</td>
    <td>${formatOptimizationInclusion(detail, config.priceStrategy)}</td>
  </tr>`).join('');

  const optHtml = `
    <div class="optimize-result">
      <h3>${escapeHtml(targetBidder.name)} · 多情景最优报价推荐</h3>
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
        </div>
        <div class="optimize-item">
          <div class="oi-label">平均价格分 / 最差排名</div>
          <div class="oi-value" style="font-size:16px;">${fmtPriceScore(best.avgScore, config.priceStrategy)} / 第${best.worstRank}名</div>
        </div>
      </div>
      <p style="font-size:12px;opacity:.85;margin-top:10px;">价格规则：${escapeHtml(Scoring.strategyNames[config.priceStrategy] || config.priceStrategy)}；共测算${optimization.scenarioCount}个等权情景，样本数量覆盖：${countsText}。只改变目标报价，其他样本保持输入值不变${specialRuleSearchNote}。</p>
    </div>`;
  gi('optimize-result-box').innerHTML = `${optHtml}
    <div class="card" style="margin-top:16px;">
      <div class="card-title">推荐报价在各情景中的结果</div>
      <div class="table-wrap"><table>
        <thead><tr><th>情景</th><th>有效样本数</th><th>基准价</th><th>目标价格分</th><th>价格排名</th><th>去除及纳入</th></tr></thead>
        <tbody>${detailRows}</tbody>
      </table></div>
    </div>`;

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
  gi('btn-save-scenario').addEventListener('click', saveScenario);
  gi('btn-clear-scenarios').addEventListener('click', () => {
    if (confirm('确定清空所有方案？')) {
      State.scenarios = [];
      renderScenarios();
      saveState();
    }
  });

  // 默认带入当前报价样本中的目标方案数据
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
    alert('请填写目标报价');
    return;
  }

  const config = buildConfig();
  const bidders = [
    { id: 'my', name: '目标方案', price: myPrice, businessScore: myBiz, techScore: myTech, isMe: true },
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
      <td>${escapeHtml(s.name)}</td>
      <td><small style="color:#888;">${s.strategy}</small></td>
      <td>¥ ${fmt(s.price)}</td>
      <td>${s.businessScore}</td>
      <td>${s.techScore}</td>
      <td>${fmtPriceScore(s.priceScore, s.strategy)}</td>
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
        <th>方案名称</th><th>价格方法</th><th>目标报价</th>
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
  const strategyErrors = Scoring.validateStrategyConfig(
    config.priceStrategy,
    config.priceFull,
    config.strategyParams
  );
  if (strategyErrors.length > 0) {
    alert(strategyErrors.join('；'));
    return false;
  }
  const sum = config.businessWeight + config.priceWeight + config.techWeight;
  if (Math.abs(sum - 100) > 0.01) {
    // 不强制拦截，仅提示
    return true;
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
  return strategy === 'tieredTrimmedBenchmark' ? fmt(num, 6, 6) : fmt(num);
}
function fmtPriceScore(score, strategy = State.config.priceStrategy) {
  const tieredName = Scoring.strategyNames.tieredTrimmedBenchmark;
  const outlierName = Scoring.strategyNames.outlierFilteredBenchmark;
  return strategy === 'tieredTrimmedBenchmark' || strategy === tieredName ||
    strategy === 'outlierFilteredBenchmark' || strategy === outlierName
    ? Number(score).toFixed(2)
    : score;
}
function formatBenchmarkCountDetails(bidder, strategy) {
  if (bidder?.validBidCount == null) return '';
  if (strategy === 'tieredTrimmedBenchmark') {
    return `；有效${bidder.validBidCount}个，去两端各${bidder.trimCount}个，纳入平均${bidder.includedBidCount}个`;
  }
  if (strategy === 'outlierFilteredBenchmark') {
    return `；有效${bidder.validBidCount}个，剔除高价${bidder.excludedHighBidCount}个，纳入平均${bidder.includedBidCount}个`;
  }
  return '';
}
function formatOptimizationInclusion(detail, strategy) {
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
  const presets = {
    gov: {
      businessWeight: 20, priceWeight: 40, techWeight: 40,
      priceStrategy: 'averagePrice',
      strategyParams: { avgBaseScore: 80, avgLowAdd: 1, avgHighDeduct: 1, avgMaxScore: 100, avgMinScore: 0 },
      label: '通用评分模板（商务20/价格40/技术40）'
    },
    infra: {
      businessWeight: 10, priceWeight: 60, techWeight: 30,
      priceStrategy: 'compositePrice',
      strategyParams: { weightLow: 0.5, weightAvg: 0.5, deductHigh: 1, deductLow: 0.5 },
      label: '价格权重较高模板（商务10/价格60/技术30）'
    },
    tech: {
      businessWeight: 15, priceWeight: 30, techWeight: 55,
      priceStrategy: 'lowestPrice',
      strategyParams: {},
      label: '技术权重较高模板（商务15/价格30/技术55）'
    },
    lowest: {
      businessWeight: 20, priceWeight: 50, techWeight: 30,
      priceStrategy: 'lowestPrice',
      strategyParams: {},
      label: '价格优先模板（商务20/价格50/技术30）'
    },
  };

  const preset = presets[name];
  if (!preset) return;

  State.config.businessWeight  = preset.businessWeight;
  State.config.priceWeight     = preset.priceWeight;
  State.config.techWeight      = preset.techWeight;
  State.config.priceStrategy   = preset.priceStrategy;
  State.config.priceFull       = preset.priceFull ?? 100;
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
});
