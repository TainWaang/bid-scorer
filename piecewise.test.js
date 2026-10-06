const {test}=require('node:test');
const assert=require('node:assert/strict');
const S=require('./js/scoring');
const W=require('./js/workspace');
const {cases}=require('./fixtures/piecewise-cases.json');
const config={businessWeight:10,priceWeight:20,techWeight:70,businessFull:100,priceFull:100,techFull:100,priceStrategy:'piecewiseAverage',strategyParams:{piecewiseNodes:S.DEFAULT_PIECEWISE_NODES,piecewiseLeftScore:80,piecewiseRightScore:60,piecewiseScoreDecimals:-1}};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

for(const [k,score] of cases){
  test(`spreadsheet cross-check K=${k}% => ${score}`,()=>{
    const price=100*(1+k/100);
    const bids=[{id:'my',name:'目标',price,businessScore:70,techScore:85,isMe:true},{id:'b',name:'样本',price:200-price,businessScore:70,techScore:85}];
    const row=S.evaluate(bids,config).find(b=>b.id==='my');
    near(row.benchmark,100);near(row.priceScore,score);near(row.deviation,k);
    near(row.total,S.round(7+59.5+score*.2,4));
    const searched=S.optimizePriceAcrossScenarios('my',[{name:'固定范围',bidders:[bids[1]]}],config,{minPrice:price,maxPrice:price,step:1});
    near(searched.best.minScore,score);near(searched.best.details[0].benchmark,100);
  });
}

test('generic nodes and an internal plateau work independently of composition',()=>{
  const p={piecewiseNodes:'-2 20\n0 40\n1 40\n2 20',piecewiseLeftScore:20,piecewiseRightScore:20};
  const c={...config,priceFull:40,strategyParams:p};
  const result=S.evaluatePrice([{price:100.5},{price:99.5}],c);
  assert.equal(result[0].priceScore,40);assert.equal(result[1].priceScore,35);
  near(S.interpolateDeviation(1.5,S.parsePiecewiseNodes(p.piecewiseNodes),20,20),30);
});

test('score rounding is explicit; mean and deviation retain full precision',()=>{
  const bids=[{price:89.4445},{price:110.5555}];
  const precise=S.evaluatePrice(bids,config)[0];
  near(precise.priceScore,84.445);assert.notEqual(precise.priceScore,84.45);
  const rounded=S.evaluatePrice(bids,{...config,strategyParams:{...config.strategyParams,piecewiseScoreDecimals:2}})[0];
  assert.equal(rounded.priceScore,84.45);assert.equal(rounded.deviation,precise.deviation);assert.equal(rounded.benchmark,precise.benchmark);
});

test('floating-point noise at plateau endpoints preserves ties without rounding real deviations',()=>{
  const bids=[97.097,95.095,108.108].map((price,i)=>({id:String(i),price}));
  const rows=S.evaluatePrice(bids,config);
  assert.deepEqual(rows.slice(0,2).map(b=>b.priceScore),[100,100]);
  assert.deepEqual(rows.slice(0,2).map(b=>[b.priceRank,b.priceTied]),[[1,true],[1,true]]);
  const nodes=S.parsePiecewiseNodes(S.DEFAULT_PIECEWISE_NODES);
  assert.ok(S.interpolateDeviation(-3+1e-8,nodes,80,60)<100);
  assert.ok(S.interpolateDeviation(-5-1e-8,nodes,80,60)<100);
});

test('six-sample mean matches spreadsheet and disabled outlier does not enter average',()=>{
  const prices=[880000,950000,970000,1000000,1025000,1175000];
  const bids=prices.map((price,i)=>({id:String(i),price,businessScore:100,techScore:100}));
  bids.push({id:'off',price:9000000,enabled:false});
  const rows=S.evaluate(bids,config);
  assert.equal(rows.length,6);assert.ok(rows.every(b=>b.benchmark===1000000&&b.includedBidCount===6));
  near(rows.find(b=>b.id==='4').priceScore,67.5);near(rows.find(b=>b.id==='4').total,93.5);
  assert.deepEqual(rows.filter(b=>b.priceScore===100).map(b=>b.priceRank),[1,1]);
});

test('active incomplete quote blocks scoring instead of changing the mean',()=>{
  assert.throws(()=>S.evaluatePrice([{name:'未复核',price:0},{price:100}],config),/补齐或停用/);
  assert.equal(S.evaluatePrice([{price:0,enabled:false},{price:100}],config).length,1);
  assert.deepEqual(S.evaluatePrice([],config),[]);
});

test('all new parameter gates reject invalid input and a valid counterpart passes',()=>{
  const invalid=[
    {piecewiseNodes:''},{piecewiseNodes:'0 85'},{piecewiseNodes:'hello\n1 80'},
    {piecewiseNodes:'0 80\n-1 60'},{piecewiseNodes:'0 80\n0 60'},
    {piecewiseNodes:'-1 80\n0 -1\n1 60'},{piecewiseNodes:'-1 80\n0 101\n1 60'},
    {piecewiseNodes:'-1 81\n1 60'},{piecewiseNodes:'-1 80\n1 61'},
    {piecewiseLeftScore:-1},{piecewiseRightScore:101},{piecewiseScoreDecimals:-2},
    {piecewiseScoreDecimals:2.5},{piecewiseScoreDecimals:7},
    {piecewiseNodes:' '.repeat(12001)},{piecewiseNodes:[]},
    {piecewiseNodes:Array.from({length:201},(_,i)=>`${i} 80`).join('\n')},
    {piecewiseNodes:'9'.repeat(400)+' 80\n1 60'},
    {piecewiseLeftScore:NaN},{piecewiseRightScore:Infinity},
  ];
  for(const override of invalid){
    const p={...config.strategyParams,...override};
    assert.ok(S.validateStrategyConfig('piecewiseAverage',100,p).length,JSON.stringify(override));
    assert.throws(()=>S.PriceStrategies.piecewiseAverage([{price:100}],100,p));
  }
  assert.ok(S.validateStrategyConfig('piecewiseAverage',46,config.strategyParams).length);
  assert.deepEqual(S.validateStrategyConfig('piecewiseAverage',100,config.strategyParams),[]);
});

test('node text survives project and nested snapshot roundtrip without changing other strategies',()=>{
  const data={config,bidders:[{id:'my',name:'A',isMe:true,price:100,businessScore:70,techScore:85}],scenarios:[]};
  data.scenarios=[{name:'快照',strategy:'均价基准＋节点分段插值',price:100,businessScore:70,techScore:85,priceScore:85,total:83.5,rank:1,snapshot:{config,bidders:data.bidders,scenarios:[]}}];
  const restored=W.importProject(W.exportProject(data));
  assert.equal(restored.config.strategyParams.piecewiseNodes,S.DEFAULT_PIECEWISE_NODES);
  assert.equal(restored.scenarios[0].snapshot.config.strategyParams.piecewiseNodes,S.DEFAULT_PIECEWISE_NODES);
  near(S.evaluate(restored.bidders,restored.config)[0].total,83.5);
  const old={...data,scenarios:[],config:{...config,priceStrategy:'lowestPrice'}};
  near(S.evaluate(W.importProject(W.exportProject(old)).bidders,old.config)[0].priceScore,100);
  assert.throws(()=>W.importProject(W.exportProject({...data,config:{...config,strategyParams:{piecewiseNodes:{x:1}}}})),/文本/);
});
