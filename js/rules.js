/* Rule configuration shared by desktop, mobile, imports and the scoring Worker. No browser state. */
const ScoringRules = (() => {
  const DEFAULT_PIECEWISE_NODES = '-11 80\n-10 90\n-9 93\n-8 95\n-7 97\n-6 99\n-5 100\n-3 100\n-2 95\n-1 90\n0 85\n1 80\n2 75\n3 60';
  const clone = value => JSON.parse(JSON.stringify(value));
  const num = (key,label,value,step=.1,min=0,max) => ({key,label,value,step,min,max,type:'number'});
  const deductions = () => [num('deductHigh','高于基准价每1%扣（公式分）',.5),num('deductLow','低于基准价每1%扣（公式分）',.3)];
  const strategies = {
    lowestPrice: {
      name:'最低价法', fields:[],
      hint:'最低有效报价得公式满分，其他报价得分＝公式满分×最低价÷本人报价。',
    },
    averagePrice: {
      name:'平均价法',
      fields:[num('avgBaseScore','平均价得分',80,.5),num('avgLowAdd','低于均价每1%加（公式分）',1),num('avgHighDeduct','高于均价每1%扣（公式分）',1),num('avgMaxScore','最高分',100,.5),num('avgMinScore','最低分',0,.5)],
      hint:'基准价为全部有效报价的算术均值，低于基准价加分、高于基准价扣分。基础分、加扣分和上下限均使用公式分值。',
    },
    qualifiedMeanBenchmark: {
      name:'合格均价×系数双向扣分法', defaultFull:100,
      fields:[num('meanBenchmarkFactor','基准价系数',.9,.01),num('meanHighDeduct','高于基准价每1%扣（公式分）',.5,'any'),num('meanLowDeduct','低于基准价每1%扣（公式分）',.25,'any')],
      hint:'录入人工复核后的最终评标价格，并停用不合格样本；全部已启用样本须填写有效评标价。算术平均值乘系数为基准价，不去高去低。A和K不提前舍入，价格原始分保留两位，最低0分。扣分参数与公式满分使用同一分值口径。',
    },
    piecewiseAverage: {
      name:'均价基准＋节点分段插值', defaultFull:100,
      fields:[
        {key:'piecewiseNodes',label:'偏差率节点（百分数）与得分：每行一组',value:DEFAULT_PIECEWISE_NODES,type:'textarea'},
        num('piecewiseLeftScore','左端固定分（含首节点）',80,'any'),
        num('piecewiseRightScore','右端固定分（含末节点）',60,'any'),
        {key:'piecewiseScoreDecimals',label:'价格分舍入口径',value:-1,type:'select',options:[-1,0,1,2,3,4,5,6].map(value=>({value,label:value===-1?'保留计算精度（显示两位）':`先四舍五入至${value}位`}))},
      ],
      hint:'A为全部合格样本经复核价格的算术均值，不去高低、不乘系数；K=(价格-A)/A×100%。已启用样本须补齐有效评标价。节点严格递增，首末得分分别等于左右固定分；相邻节点线性插值，-5和-3两个节点同为100分即形成满分平台。A和K不提前舍入。参考节点使用100分公式。',
    },
    outlierFilteredBenchmark: {
      name:'高价阈值剔除×系数平均价法', defaultFull:46,
      fields:[num('outlierCutoffMultiple','高价剔除阈值（初始均值倍数）',1.5,.01,1),num('outlierBenchmarkFactor','基准价系数',.95,.01),num('outlierHighDeduct','高于基准价每1%扣（公式分）',.8),num('outlierLowDeduct','低于基准价每1%扣（公式分）',.3),num('outlierMinScore','最低分',0,.5),num('outlierDeviationDecimals','偏差率小数位',2,1,0,10)],
      hint:'达到全部有效报价初始均值×阈值及以上的高价不参与基准价；其余均值×系数得到基准价。偏差率先按指定小数位舍入，再扣分。技术最高且有效报价最低的特殊满分条件可在“规则模板与录入口径”中设置。',
    },
    compositePrice: {
      name:'复合基准价法',
      fields:[num('weightLow','最低价系数',.5,.05,0,1),num('weightAvg','平均价系数',.5,.05,0,1),...deductions()],
      hint:'基准价＝最低价×系数A＋有效报价均值×系数B；两个系数合计1，高低两侧均扣分。',
    },
    fixedBenchmark: {
      name:'固定基准价法',
      fields:[num('benchmark','固定基准价（元）',0,'any'),...deductions()],
      hint:'基准价按适用规则预先填写，高低两侧均扣分。',
    },
    trimmedAverage: {
      name:'去高去低平均价法',
      fields:[num('trimCount','最高、最低两端各去除（个）',1,1),...deductions()],
      hint:'去掉最高价、最低价各指定数量后取均值。样本不足时提示修正规则，不自动更换方法。',
    },
    tieredTrimmedBenchmark: {
      name:'分档去高去低×系数法', defaultFull:40,
      fields:[num('tierHighThreshold','高档人数阈值（大于）',10,1),num('tierHighTrim','高档两端各去除（个）',2,1),num('tierMidThreshold','中档人数阈值（大于）',5,1),num('tierMidTrim','中档两端各去除（个）',1,1),num('benchmarkFactor','平均价系数',.95,.01),num('benchmarkDecimals','基准价小数位',6,1,0,10),num('tierBaseScore','基准价基础分',35,.5),num('tierHighDeduct','高于基准价每1%扣（公式分）',.5),num('tierLowAdd','低于基准价每1%加（公式分）',.5),num('tierMinScore','最低分',30,.5),num('tierMaxScore','最高分',40,.5)],
      hint:'按有效样本数量去高去低，其余均值×系数得到基准价。基准价按指定小数位舍入，低价加分、高价扣分。最高分是得分上限，可小于公式满分；改变上限不会改变公式满分。',
    },
    intervalScore: {
      name:'区间得分法',
      fields:[num('benchmark','固定基准价（元）',0,'any'),num('lowerPct','下浮上限（%）',3,.5),num('upperPct','上浮上限（%）',3,.5),num('deductOut','区间外每1%扣（公式分）',1,.5)],
      hint:'报价在［基准价×(1−下浮%)，基准价×(1＋上浮%)］区间内得公式满分，区间外按超出部分扣分。',
    },
  };
  const defaultParams = () => ({...Object.fromEntries(Object.values(strategies).flatMap(s=>s.fields.map(f=>[f.key,f.value]))),outlierSpecialFullScore:1});
  function createConfig(saved={}) {
    const strategyParams={...defaultParams(),...clone(saved.strategyParams || {})};
    // An omitted average cap has always meant the formula full, including legacy custom scales.
    if (saved.strategyParams?.avgMaxScore==null) strategyParams.avgMaxScore=Number(saved.priceFull ?? 100);
    return {
      projectName:'',businessWeight:20,priceWeight:40,techWeight:40,
      businessFull:100,priceFull:100,techFull:100,priceStrategy:'averagePrice',
      ...clone(saved),strategyParams,
    };
  }
  function createProject() {
    return {config:createConfig(),bidders:[
      {id:'my',name:'目标方案',price:0,businessScore:80,techScore:85,isMe:true},
      {id:'b1',name:'其他样本A',price:0,businessScore:78,techScore:82,isMe:false},
      {id:'b2',name:'其他样本B',price:0,businessScore:76,techScore:80,isMe:false},
    ],scenarios:[],search:{}};
  }
  function selectStrategy(config,strategy) {
    if (!Object.hasOwn(strategies,strategy)) throw new Error('价格策略无效');
    const next=createConfig(config),previous=next.priceStrategy;
    next.priceStrategy=strategy;
    // Apply recommended scales on an explicit user selection, never on load/import/refresh.
    if (strategies[strategy].defaultFull!=null) {
      next.priceFull=strategy==='tieredTrimmedBenchmark' && Number(next.strategyParams.tierMaxScore)>0
        ? Number(next.strategyParams.tierMaxScore) : strategies[strategy].defaultFull;
    } else {
      const previousDefault=previous==='tieredTrimmedBenchmark'?next.strategyParams.tierMaxScore:strategies[previous]?.defaultFull;
      if (previousDefault!=null && Number(next.priceFull)===Number(previousDefault)) next.priceFull=100;
    }
    return next;
  }
  const presets = {
    gov:{label:'通用评分模板',businessWeight:20,priceWeight:40,techWeight:40,priceStrategy:'averagePrice',strategyParams:{avgBaseScore:80,avgLowAdd:1,avgHighDeduct:1,avgMaxScore:100,avgMinScore:0}},
    infra:{label:'价格权重较高模板',businessWeight:10,priceWeight:60,techWeight:30,priceStrategy:'compositePrice',strategyParams:{weightLow:.5,weightAvg:.5,deductHigh:1,deductLow:.5}},
    tech:{label:'技术权重较高模板',businessWeight:15,priceWeight:30,techWeight:55,priceStrategy:'lowestPrice'},
    lowest:{label:'价格优先模板',businessWeight:20,priceWeight:50,techWeight:30,priceStrategy:'lowestPrice'},
  };
  function applyPreset(config,name) {
    if (!Object.hasOwn(presets,name)) throw new Error('预设不存在');
    const {label,...settings}=presets[name];
    return createConfig({...config,...clone(settings),businessFull:100,priceFull:100,techFull:100,strategyParams:{...defaultParams(),...settings.strategyParams}});
  }
  return {strategies,DEFAULT_PIECEWISE_NODES,createConfig,createProject,selectStrategy,applyPreset,presetLabel:name=>presets[name]?.label};
})();
if (typeof module!=='undefined') module.exports=ScoringRules;
