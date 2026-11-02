/* Shared rule editor and score-scale explanation; layout adapters own the rest of the page. */
const RuleUI = (() => {
  const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function renderStrategySelect(select,value) {
    select.innerHTML=Object.entries(ScoringRules.strategies).map(([key,rule])=>`<option value="${key}">${esc(rule.name)}</option>`).join('');
    select.value=value;
  }
  function renderParams(host,config,onChange,{mobile=false}={}) {
    const rule=ScoringRules.strategies[config.priceStrategy];
    if (!rule) {host.textContent='价格策略无效';return;}
    const mobileIds={piecewiseNodes:'m-piecewise-nodes',piecewiseScoreDecimals:'m-piecewise-rounding'};
    host.innerHTML=`<div class="ws-param-grid">${rule.fields.map(field=>{
      const id=mobile?(mobileIds[field.key] || 'm-sp-'+field.key):'sp-'+field.key;
      const value=config.strategyParams?.[field.key] ?? field.value;
      const attrs=`id="${id}" data-key="${field.key}"`;
      let input;
      if (field.type==='textarea') input=`<textarea ${attrs} rows="14" spellcheck="false">${esc(value)}</textarea>`;
      else if (field.type==='select') input=`<select ${attrs}>${field.options.map(o=>`<option value="${o.value}" ${Number(value)===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`;
      else input=`<input ${attrs} type="number" value="${esc(value)}" min="${field.min}" ${field.max==null?'':`max="${field.max}"`} step="${field.step}" inputmode="decimal">`;
      return `<div class="ws-param${field.type==='textarea'?' ws-param-wide':''}"><label for="${id}">${esc(field.label)}</label>${input}</div>`;
    }).join('')}</div><p class="note ws-rule-hint">${esc(rule.hint)}</p>`;
    host.querySelectorAll('[data-key]').forEach(input=>input.addEventListener('input',()=>{
      config.strategyParams[input.dataset.key]=input.tagName==='TEXTAREA'?input.value:Number(input.value);
      onChange?.();
    }));
  }
  function scaleHtml(config) {
    const full=Number(config.priceFull),weight=Number(config.priceWeight);
    if (!Number.isFinite(full)||full<=0||!Number.isFinite(weight)||weight<0||weight>100) return '<p class="ws-error">请填写有效的价格公式满分与价格分值。</p>';
    const nonstandard=config.priceStrategy==='qualifiedMeanBenchmark' && full!==100;
    return `<div class="ws-scale${nonstandard?' ws-scale-check':''}"><strong>价格公式满分 ${full} 分；计入综合分的价格分值 ${weight} 分。</strong><p>价格计入综合分 = 价格原始分 ÷ ${full} × ${weight}。加扣分参数按公式分值填写，不随价格分值自动缩放。</p>${nonstandard?`<p>当前按 ${full} 分公式计算。若招标文件写“100 − 偏差率 × 100 × 扣分系数”，价格公式满分应填 100，价格分值仍填 ${weight}；请核对文件后调整。</p>`:''}</div>`;
  }
  function contributionHtml(score,config) {
    const amount=Scoring.getPriceContribution(score,config);
    return amount==null?'—':`${amount.toFixed(4)}<small class="ws-contribution-unit"> / ${esc(config.priceWeight)}</small>`;
  }
  return {renderStrategySelect,renderParams,scaleHtml,contributionHtml};
})();
