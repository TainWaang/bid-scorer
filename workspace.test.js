const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('./js/scoring');
const W = require('./js/workspace');
const config = {businessWeight:8,priceWeight:46,techWeight:46,businessFull:8,priceFull:46,techFull:46,priceStrategy:'fixedBenchmark',strategyParams:{benchmark:100,deductHigh:1,deductLow:1}};
const data = () => ({config:{...config,projectName:'测试项目'},bidders:[{id:'my',name:'目标',isMe:true,price:100,businessScore:8,techScore:46},{id:'b',name:'样本',price:110,businessScore:7,techScore:40}],scenarios:[]});
const memory = () => {const map = new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};

test('contradictory average scales rejected at both calculation entry points',()=>{
  const c={...config,priceStrategy:'averagePrice',strategyParams:{avgBaseScore:80,avgMaxScore:100}};
  assert.throws(()=>S.evaluate(data().bidders,c),/最低分/);
  assert.throws(()=>S.optimizePriceAcrossScenarios('my',[[100]],c,{minPrice:90,maxPrice:110,step:1}),/最低分/);
  const valid={...c,strategyParams:{avgBaseScore:35,avgMaxScore:46,avgMinScore:0}};
  assert.ok(S.evaluate(data().bidders,valid).every(b=>b.total<=100&&b.priceScore<=46));
});
test('all strategy parameter gates reject bad and accept valid counterparts',()=>{
  const cases=[
    ['lowestPrice',{},46,{},0],
    ['averagePrice',{avgBaseScore:35},46,{avgBaseScore:47},46],
    ['compositePrice',{weightLow:.4,weightAvg:.6},46,{weightLow:.6,weightAvg:.6},46],
    ['fixedBenchmark',{benchmark:100},46,{benchmark:0},46],
    ['trimmedAverage',{trimCount:1},46,{trimCount:1.5},46],
    ['tieredTrimmedBenchmark',{tierMidThreshold:5,tierHighThreshold:10},46,{tierMidThreshold:10,tierHighThreshold:5},46],
    ['intervalScore',{benchmark:100},46,{benchmark:100,lowerPct:101},46],
    ['outlierFilteredBenchmark',{outlierCutoffMultiple:1.5},46,{outlierCutoffMultiple:1},46],
  ];
  for(const [name,good,full,bad,badFull] of cases){assert.equal(S.validateStrategyConfig(name,full,good).length,0,name);assert.ok(S.validateStrategyConfig(name,badFull,bad).length,name);}
});
test('non-100 composition rejected and valid composition accepted',()=>{
  assert.throws(()=>S.evaluate(data().bidders,{...config,businessWeight:10}),/合计100/);
  assert.ok(S.evaluate(data().bidders,config).length);
});
test('ties do not depend on entry order; disabled and absent prices are unranked',()=>{
  const rows=data().bidders.map(b=>({...b,price:100,businessScore:8,techScore:46}));
  rows.push({id:'absent',price:0},{id:'off',price:90,enabled:false});
  const ranked=S.evaluate(rows,config);
  assert.deepEqual(ranked.map(b=>[b.rank,b.priceRank,b.priceTied]),[[1,1,true],[1,1,true]]);
  assert.deepEqual(S.evaluate([...rows].reverse(),config).map(b=>b.rank),[1,1]);
});
test('malformed prices are rejected while blank placeholders are permitted',()=>{
  assert.equal(S.normalizePriceInput('1,2'),0);
  assert.equal(S.normalizePriceInput('1,200'),1200);
  assert.throws(()=>S.evaluatePrice([{name:'X',price:0,priceInputError:true}],config),/报价格式错误/);
  assert.deepEqual(S.evaluatePrice([{price:0}],config),[]);
});
test('too few samples do not silently change the trimming rule',()=>{
  const c={...config,priceStrategy:'trimmedAverage',strategyParams:{trimCount:1}};
  assert.throws(()=>S.evaluatePrice(data().bidders,c),/不足/);
  assert.equal(S.evaluatePrice([...data().bidders,{id:'c',price:120}],c).length,3);
});
test('ambiguous thousands separators rejected; unambiguous amounts accepted',()=>{
  assert.throws(()=>S.parsePriceScenarios('A:4,960,100'),/歧义/);
  assert.equal(S.parsePriceScenarios('A:4960100;5200000')[0].bidders.length,2);
  assert.equal(W.parseTable('样本\t4,960,100\t8\t46')[0].price,4960100);
  assert.throws(()=>W.parseTable('样本\t4,96,100'),/正数/);
});
test('weighted scenarios and objective change the selected candidate',()=>{
  const cases=[{name:'low',weight:1,bidders:[100]},{name:'high',weight:3,bidders:[200]}];
  const c={...config,priceStrategy:'averagePrice',priceFull:100,strategyParams:{avgBaseScore:100,avgMaxScore:100,avgLowAdd:0,avgHighDeduct:1}};
  const r=S.optimizePriceAcrossScenarios('my',cases,c,{minPrice:100,maxPrice:200,step:100});
  assert.equal(r.candidates[1].topRate,75);
  const threshold=S.optimizePriceAcrossScenarios('my',cases,c,{minPrice:100,maxPrice:200,step:100,objective:'threshold',requiredScore:60});
  assert.equal(threshold.best.price,200);
  assert.equal(r.best.price,100);
  const missing=S.optimizePriceAcrossScenarios('my',cases,c,{minPrice:200,maxPrice:200,step:1,objective:'threshold',requiredScore:100});
  assert.equal(missing.best,null);
  assert.deepEqual(missing.ranges,[]);
});
test('technical special condition is explicit and requires complete evidence',()=>{
  const c={...config,priceStrategy:'outlierFilteredBenchmark',strategyParams:{outlierBenchmarkFactor:.95}};
  const cases=[{name:'A',bidders:[{price:120,techScore:40}]}];
  const range={minPrice:100,maxPrice:100,step:1,specialMode:'technical',targetTechScore:46};
  assert.equal(S.optimizePriceAcrossScenarios('my',cases,c,range).best.minScore,46);
  assert.equal(S.evaluate([{...data().bidders[0],price:100},{...data().bidders[1],price:120}],c)[0].priceScore,46);
  assert.ok(S.optimizePriceAcrossScenarios('my',cases,c,{...range,specialMode:'priceOnly'}).best.minScore<46);
  assert.throws(()=>S.optimizePriceAcrossScenarios('my',[[120]],c,range),/全部样本/);
});
test('invalid search ranges, objectives and weights are rejected',()=>{
  for(const range of [{minPrice:90,maxPrice:100,step:Infinity},{minPrice:90,maxPrice:100,step:1,floorPrice:110},{minPrice:90,maxPrice:100,step:1,objective:'unknown'},{minPrice:90,maxPrice:100,step:1,requiredScore:47}]) assert.throws(()=>S.optimizePriceAcrossScenarios('my',[[100]],config,range));
  assert.throws(()=>S.optimizePriceAcrossScenarios('my',[{bidders:[100],weight:0}],config,{minPrice:90,maxPrice:100,step:1}),/权重/);
});
test('legacy migration preserves source and desktop/mobile share active project',()=>{
  const storage=memory(); const legacy=JSON.stringify(data());storage.setItem('bid-scorer-desktop-state-v1',legacy);
  const desktop=W.createStore(storage,data());assert.equal(desktop.open().bidders[0].price,100);desktop.save({...data(),search:{step:'100'}});
  const mobile=W.createStore(storage,data());assert.equal(mobile.open().search.step,'100');
  assert.equal(storage.getItem('bid-scorer-desktop-state-v1'),legacy);
  mobile.save({...mobile.current(),config:{...config,projectName:'手机修改'}});
  assert.throws(()=>desktop.save(data()),/另一页面/);
});
test('quota failure leaves previous stored and in-memory projects intact',()=>{
  const storage=memory();const store=W.createStore(storage,data());store.open();store.save(data());
  storage.setItem=()=>{throw new Error('quota');};
  assert.throws(()=>store.add({...data(),config:{...config,projectName:'new'}}),/quota/);
  assert.equal(store.list().length,1);
});
test('snapshot roundtrip retains rules, scores, samples and search options',()=>{
  const full=data();full.search={options:{objective:'minScore'},rows:[{name:'s',weight:3,bidders:[{price:100}]}]};
  full.scenarios=[{name:'方案',price:100,businessScore:8,techScore:46,priceScore:46,total:100,rank:1,strategy:'固定基准价法',snapshot:data()}];
  assert.deepEqual(W.importProject(W.exportProject(full)).scenarios[0].snapshot.bidders,full.bidders);
  assert.equal(W.importProject(W.exportProject(full)).search.rows[0].weight,3);
  assert.throws(()=>W.importProject('{}'),/版本/);
  assert.throws(()=>W.importProject(W.exportProject({...full,bidders:[]})),/数量/);
  assert.throws(()=>W.importProject(W.exportProject({...full,config:{...config,priceFull:'<script>'}})),/规则数值/);
});
