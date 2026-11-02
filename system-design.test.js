const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('./js/scoring');
const W = require('./js/workspace');

const config = {
  businessWeight:10, priceWeight:35, techWeight:55,
  businessFull:10, priceFull:100, techFull:55,
  priceStrategy:'qualifiedMeanBenchmark', strategyParams:{},
};
const bidder = (price, i=0) => ({id:i===0?'my':`b${i}`, name:`样本${i}`, price, isMe:i===0, businessScore:0, techScore:0});
const project = () => ({config:{...config}, bidders:[bidder(100),bidder(110,1)], scenarios:[], search:{}});

test('tender price formula and contribution stay separate on both supported scales', () => {
  const bids=[1250000,1160000,980000,1215000,1250000,1395000,1460000].map(bidder);
  const me=S.evaluate(bids,config).find(b=>b.isMe);
  assert.equal(me.priceScore,94.19);
  assert.ok(Math.abs(me.priceContribution-32.9665)<1e-10);
  assert.equal(me.total,32.9665);
  const legacy=S.evaluate(bids,{...config,priceFull:35}).find(b=>b.isMe);
  assert.equal(legacy.priceScore,29.19);
  assert.equal(legacy.total,29.19);
  const scaled=S.evaluate(bids,{...config,priceFull:35,strategyParams:{meanHighDeduct:.175,meanLowDeduct:.0875}}).find(b=>b.isMe);
  assert.equal(scaled.priceScore,32.97);
});

test('extracting contributions preserves historical total rounding at half-way boundaries', () => {
  const c={...config,businessFull:100,businessWeight:7,priceWeight:0,techWeight:93,techFull:100,priceStrategy:'lowestPrice'};
  assert.equal(S.evaluate([{...bidder(100),businessScore:.345}],c)[0].total,.0242);
});

test('search ignores disabled scenarios exactly as normal price evaluation does', () => {
  const c={...config,priceStrategy:'lowestPrice'};
  const others=[bidder(110,1),{...bidder(50,2),enabled:false}];
  const direct=S.evaluatePrice([bidder(100),...others],c)[0];
  const detail=S.optimizePriceAcrossScenarios('my',[{bidders:others}],c,{minPrice:100,maxPrice:100,step:1}).best.details[0];
  assert.equal(detail.priceScore,direct.priceScore);
  assert.equal(detail.priceRank,direct.priceRank);
  assert.equal(detail.participantCount,2);
  assert.equal(detail.priceContribution,35);
  assert.throws(()=>S.optimizePriceAcrossScenarios('my',[{bidders:[{price:50,enabled:false}]}],c,{minPrice:100,maxPrice:100,step:1}),/有效|参与/);
});

test('unrounded piecewise ranking has one comparison contract in search and evaluation', () => {
  const c={...config,priceStrategy:'piecewiseAverage'};
  const other=99.9999999999;
  const me=S.evaluatePrice([bidder(100),bidder(other,1)],c).find(b=>b.isMe);
  assert.equal(me.priceRank,2);
  const detail=S.optimizePriceAcrossScenarios('my',[[other]],c,{minPrice:100,maxPrice:100,step:1}).best.details[0];
  assert.equal(detail.priceRank,me.priceRank);
  assert.equal(detail.isTop,false);
});

test('all public calculation paths reject non-finite results from older strategies', () => {
  for(const strategy of ['averagePrice','compositePrice','trimmedAverage','tieredTrimmedBenchmark','outlierFilteredBenchmark']) {
    const c={...config,priceStrategy:strategy};
    const bids=Array.from({length:5},(_,i)=>bidder(Number.MAX_VALUE,i));
    assert.throws(()=>S.evaluatePrice(bids,c),/范围|无效|有限/,strategy);
    assert.throws(()=>S.optimizePriceAcrossScenarios('my',[Array(4).fill(Number.MAX_VALUE)],c,{minPrice:Number.MAX_VALUE,maxPrice:Number.MAX_VALUE,step:1e300}),/范围|无效|有限/,strategy);
  }
});

test('project import rejects unrenderable search structure but preserves editable drafts', () => {
  for(const search of [[],42,{rows:[{}]},{rows:{}},{options:[]},{target:{}},{rows:[{name:'S',weight:1,bidders:[],pricesText:{}}]}]) {
    assert.throws(()=>W.importProject(W.exportProject({...project(),search})),/搜索|情景/,JSON.stringify(search));
  }
  const draft={...project(),search:{target:'my',minPrice:'',options:{requiredScore:''},rows:[{name:'编辑中',weight:'',bidders:[],pricesText:'110; ',techText:''}]}};
  assert.deepEqual(W.importProject(W.exportProject(draft)).search,draft.search);
});

test('storage read validates all project structure and keeps damaged source unchanged', () => {
  const original=JSON.stringify({version:2,revision:1,activeId:'p',projects:[{id:'p',data:{...project(),search:{rows:[{}]}}}],templates:[]});
  const memory=new Map([[W.KEY,original]]);
  const storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  assert.throws(()=>W.createStore(storage,project()).open(),/情景|搜索/);
  assert.equal(storage.getItem(W.KEY),original);
});

test('shared rule catalog preserves saved scales and defines deterministic strategy transitions', () => {
  const R=require('./js/rules');
  const saved={...config,priceStrategy:'outlierFilteredBenchmark',priceFull:60,strategyParams:{outlierFullScore:46}};
  assert.equal(R.createConfig(saved).priceFull,60);
  assert.equal(R.selectStrategy(saved,'qualifiedMeanBenchmark').priceFull,100);
  assert.equal(R.selectStrategy(config,'tieredTrimmedBenchmark').priceFull,40);
  assert.equal(R.selectStrategy({...config,priceFull:35},'fixedBenchmark').priceFull,35);
  assert.equal(saved.priceFull,60);
  assert.deepEqual(Object.keys(R.strategies).sort(),Object.keys(S.PriceStrategies).sort());
});

test('named presets reset their rule parameters and cannot be mutated across projects', () => {
  const R=require('./js/rules');
  const c=R.applyPreset({...config,strategyParams:{deductHigh:9,deductLow:9}},'infra');
  assert.equal(c.strategyParams.deductHigh,1);
  assert.equal(c.strategyParams.deductLow,.5);
  c.strategyParams.deductHigh=99;
  assert.equal(R.applyPreset(config,'infra').strategyParams.deductHigh,1);
  assert.equal(R.applyPreset(config,'gov').strategyParams.avgBaseScore,80);
});

test('legacy implicit average cap follows formula full while explicit caps stay unchanged', () => {
  const R=require('./js/rules');
  for (const priceFull of [90,120]) {
    const c={...config,priceStrategy:'averagePrice',priceFull,strategyParams:{}};
    const bids=[bidder(50),bidder(150,1)];
    assert.deepEqual(S.evaluatePrice(bids,R.createConfig(c)).map(b=>b.priceScore),S.evaluatePrice(bids,c).map(b=>b.priceScore));
  }
  assert.equal(R.createConfig({...config,priceFull:90,strategyParams:{avgMaxScore:100}}).strategyParams.avgMaxScore,100);
});

test('max weights produce finite weighted search aggregates', () => {
  const c={...config,priceStrategy:'lowestPrice'};
  for (const cases of [[{weight:1e308,bidders:[110]}],[{weight:1e308,bidders:[110]},{weight:1e308,bidders:[120]}]]) {
    const result=S.optimizePriceAcrossScenarios('my',cases,c,{minPrice:100,maxPrice:100,step:1});
    assert.equal(result.best.topRate,100);
    assert.equal(result.best.avgScore,100);
    for (const key of ['topRate','minScore','avgScore','maxScore','worstRank','avgRank']) assert.ok(Number.isFinite(result.best[key]),key);
  }
});

test('fallback parser and search keep eligibility and technical metadata', () => {
  const c={...config,priceStrategy:'lowestPrice'};
  const cases=S.parsePriceScenarios('',[{price:110,techScore:40},{price:50,enabled:false}]);
  assert.equal(cases[0].bidders.length,1);
  assert.equal(cases[0].bidders[0].techScore,40);
  const detail=S.optimizePriceAcrossScenarios('my',cases,c,{minPrice:100,maxPrice:100,step:1}).best.details[0];
  assert.equal(detail.priceScore,100);assert.equal(detail.priceRank,1);
});

test('numeric string parameters accepted by validation remain calculable', () => {
  for(const priceStrategy of ['fixedBenchmark','intervalScore','averagePrice']) {
    const c={...config,priceStrategy,strategyParams:{benchmark:'100',avgBaseScore:'80',avgLowAdd:'1'}};
    const numeric={...c,strategyParams:{benchmark:100,avgBaseScore:80,avgLowAdd:1}};
    const bids=[bidder(90),bidder(110,1)];
    assert.deepEqual(S.validateConfig(c,bids,true),[]);
    assert.deepEqual(S.evaluatePrice(bids,c).map(b=>b.priceScore),S.evaluatePrice(bids,numeric).map(b=>b.priceScore));
  }
});

test('template structure is rejected before storage mutation and valid templates reopen', () => {
  const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
  const store=W.createStore(storage,project());store.open();store.save(project());
  const before=storage.getItem(W.KEY);
  assert.throws(()=>store.saveTemplate('bad',{...config,strategyParams:[]}),/参数结构/);
  assert.equal(storage.getItem(W.KEY),before);
  store.saveTemplate('valid',config);
  const reopened=W.createStore(storage,project());reopened.open();assert.equal(reopened.templates().length,1);
});

test('search grid never rounds a candidate below the entered floor or loses sub-micro precision', () => {
  const floor=1.0000001;
  const result=S.optimizePriceAcrossScenarios('my',[[2]],{...config,priceStrategy:'lowestPrice'},{minPrice:1,maxPrice:1.0000003,step:.0000001,floorPrice:floor});
  assert.equal(result.candidates[0].price,floor);
  assert.ok(result.candidates.every(c=>c.price>=floor && c.price<=1.0000003));
});
