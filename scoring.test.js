const assert = require('assert');
const Scoring = require('./js/scoring.js');

const params = {
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
};

function bidders(prices) {
  return prices.map((price, index) => ({
    id: String(index),
    name: `报价样本${index + 1}`,
    price,
    businessScore: 0,
    techScore: 0,
  }));
}

function evaluatePrices(prices, overrides = {}) {
  return Scoring.PriceStrategies.tieredTrimmedBenchmark(
    bidders(prices),
    40,
    { ...params, ...overrides }
  );
}

const benchmarkCases = [
  { prices: [101, 103, 107, 109, 113], benchmark: 101.270000, trimCount: 0 },
  { prices: [101, 103, 107, 109, 113, 127], benchmark: 102.600000, trimCount: 1 },
  { prices: [100, 200, 300, 400, 500, 600, 700, 800, 900], benchmark: 475.000000, trimCount: 1 },
  { prices: [101, 103, 107, 109, 113, 127, 131, 137, 139, 149], benchmark: 114.712500, trimCount: 1 },
  { prices: [101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 157], benchmark: 117.121429, trimCount: 2 },
];

for (const testCase of benchmarkCases) {
  const result = evaluatePrices(testCase.prices);
  assert.strictEqual(result[0].benchmark, testCase.benchmark);
  assert.strictEqual(result[0].trimCount, testCase.trimCount);
  assert.strictEqual(result[0].validBidCount, testCase.prices.length);
  assert.strictEqual(result[0].includedBidCount, testCase.prices.length - testCase.trimCount * 2);
}

const formattedNine = evaluatePrices([
  '1,000,000', '2，000，000', '3 000 000', '4,000,000', '5,000,000',
  '6,000,000', '7,000,000', '8,000,000', '9,000,000',
]);
assert.strictEqual(formattedNine[0].validBidCount, 9);
assert.strictEqual(formattedNine[0].trimCount, 1);
assert.strictEqual(formattedNine[0].includedBidCount, 7);
assert.strictEqual(formattedNine[0].benchmark, 4750000);

const evaluatedFormattedNine = Scoring.evaluate(
  bidders([
    '1,000,000', '2,000,000', '3,000,000', '4,000,000', '5,000,000',
    '6,000,000', '7,000,000', '8,000,000', '9,000,000',
  ]),
  {
    businessWeight: 0,
    priceWeight: 100,
    techWeight: 0,
    priceFull: 40,
    priceStrategy: 'tieredTrimmedBenchmark',
    strategyParams: params,
  }
);
assert.strictEqual(evaluatedFormattedNine.length, 9);
assert.strictEqual(evaluatedFormattedNine[0].validBidCount, 9);
assert.strictEqual(evaluatedFormattedNine[0].includedBidCount, 7);

const validitySummary = Scoring.summarizeBidValidity([
  { name: '逗号格式', price: '4,500,000' },
  { name: '人民币符号', price: '￥ 3 200 000' },
  { name: '空值', price: '' },
  { name: '格式错误', price: 'abc' },
  { name: '零报价', price: 0 },
]);
assert.strictEqual(validitySummary.totalCount, 5);
assert.strictEqual(validitySummary.validCount, 2);
assert.strictEqual(validitySummary.invalidCount, 3);
assert.deepStrictEqual(validitySummary.validBidders.map(bidder => bidder.price), [4500000, 3200000]);
assert.deepStrictEqual(validitySummary.invalidBidders.map(bidder => bidder.name), ['空值', '格式错误', '零报价']);

const outlierParams = {
  outlierCutoffMultiple: 1.5,
  outlierBenchmarkFactor: 0.95,
  outlierHighDeduct: 0.8,
  outlierLowDeduct: 0.3,
  outlierMinScore: 0,
  outlierDeviationDecimals: 2,
  outlierSpecialFullScore: 1,
};

function evaluateOutlier(prices, overrides = {}, techScores = []) {
  return Scoring.PriceStrategies.outlierFilteredBenchmark(
    prices.map((price, index) => ({
      id: String(index),
      name: `报价样本${index + 1}`,
      price,
      techScore: techScores[index] ?? null,
    })),
    46,
    { ...outlierParams, ...overrides }
  );
}

// 等于初始均值的150%必须剔除；100、200的均值150，再乘0.95得到142.5。
const equalityExcluded = evaluateOutlier([100, 200, 300]);
assert.strictEqual(equalityExcluded[0].preliminaryAverage, 200);
assert.strictEqual(equalityExcluded[0].exclusionThreshold, 300);
assert.strictEqual(equalityExcluded[0].excludedHighBidCount, 1);
assert.deepStrictEqual(equalityExcluded[0].excludedHighBidderNames, ['报价样本3']);
assert.strictEqual(equalityExcluded[0].includedBidCount, 2);
assert.strictEqual(equalityExcluded[0].benchmark, 142.5);
assert.strictEqual(equalityExcluded[0].deviation, -29.82);
assert.strictEqual(equalityExcluded[0].priceScore, 37.05);

// 299低于阈值299.5，不能被边界条件误剔除。
const justBelowThreshold = evaluateOutlier([100, 200, 299]);
assert.strictEqual(justBelowThreshold[0].excludedHighBidCount, 0);
assert.strictEqual(justBelowThreshold[0].includedBidCount, 3);

// 偏差率必须先保留两位再计分，否则首项会得到45.01而不是45.02。
const roundedDeviationFirst = evaluateOutlier(
  [101.2349, 98.7651],
  { outlierBenchmarkFactor: 1, outlierSpecialFullScore: 0 }
);
assert.strictEqual(roundedDeviationFirst[0].benchmark, 100);
assert.strictEqual(roundedDeviationFirst[0].deviation, 1.23);
assert.strictEqual(roundedDeviationFirst[0].priceScore, 45.02);

const negativeHalfRoundsAwayFromZero = evaluateOutlier(
  [101.235, 98.765],
  { outlierBenchmarkFactor: 1, outlierSpecialFullScore: 0 }
);
assert.strictEqual(negativeHalfRoundsAwayFromZero[1].deviation, -1.24);
assert.strictEqual(negativeHalfRoundsAwayFromZero[1].priceScore, 45.63);

const zeroFloor = evaluateOutlier([100, 1000]);
assert.strictEqual(zeroFloor[1].excludedHighBidCount, 1);
assert.strictEqual(zeroFloor[1].priceScore, 0);

const specialFullScore = evaluateOutlier([90, 100, 110], {}, [46, 40, 30]);
assert.strictEqual(specialFullScore[0].specialFullScore, true);
assert.strictEqual(specialFullScore[0].priceScore, 46);
assert.strictEqual(specialFullScore[1].specialFullScore, false);

const highestTechnicalButNotLowest = evaluateOutlier([90, 100, 110], {}, [40, 46, 30]);
assert.strictEqual(highestTechnicalButNotLowest[0].specialFullScore, false);
assert.strictEqual(highestTechnicalButNotLowest[1].specialFullScore, false);

const noTechnicalDataOverride = evaluateOutlier([90, 100, 110]);
assert.strictEqual(noTechnicalDataOverride[0].specialFullScore, false);
assert.strictEqual(noTechnicalDataOverride[0].priceScore, 44.42);

const invalidOutlierErrors = Scoring.validateStrategyConfig(
  'outlierFilteredBenchmark',
  46,
  { ...outlierParams, outlierCutoffMultiple: 1, outlierMinScore: 47, outlierDeviationDecimals: 2.5 }
);
assert.deepStrictEqual(invalidOutlierErrors, [
  '高价剔除阈值倍数必须大于1',
  '最低分不能高于价格满分',
  '偏差率小数位必须是0到10之间的整数',
]);
assert.throws(
  () => evaluateOutlier([90, 100, 110], { outlierCutoffMultiple: 1 }),
  /高价剔除阈值倍数必须大于1/
);

const evaluatedOutlierValidOnly = Scoring.evaluate(
  [
    { id: 'my', name: '目标方案', price: '90', businessScore: 80, techScore: 100, isMe: true },
    { id: 'b1', name: '有效样本', price: '100', businessScore: 80, techScore: 90 },
    { id: 'b2', name: '无效样本', price: 'abc', businessScore: 80, techScore: 80 },
  ],
  {
    businessWeight: 8,
    priceWeight: 46,
    techWeight: 46,
    priceFull: 46,
    priceStrategy: 'outlierFilteredBenchmark',
    strategyParams: outlierParams,
  }
);
assert.strictEqual(evaluatedOutlierValidOnly.length, 2);
assert.strictEqual(evaluatedOutlierValidOnly[0].validBidCount, 2);
assert.strictEqual(evaluatedOutlierValidOnly.find(bidder => bidder.id === 'my').priceScore, 46);

const outlierOptimization = Scoring.optimizePriceAcrossScenarios(
  'my',
  [{ name: '固定目标情景', bidders: [100, 200, 300] }],
  {
    businessWeight: 0,
    priceWeight: 100,
    techWeight: 0,
    priceFull: 46,
    priceStrategy: 'outlierFilteredBenchmark',
    strategyParams: outlierParams,
  },
  { minPrice: 90, maxPrice: 90, step: 1 }
);
assert.strictEqual(outlierOptimization.best.details[0].participantCount, 4);
assert.strictEqual(outlierOptimization.best.details[0].excludedHighBidCount, 1);
assert.strictEqual(outlierOptimization.best.details[0].includedBidCount, 3);
assert.strictEqual(outlierOptimization.best.details[0].benchmark, 123.5);
assert.strictEqual(outlierOptimization.best.details[0].specialFullScore, false);

const scoreCases = [
  { price: 100.6, expected: 34.70 },
  { price: 99.3, expected: 35.35 },
  { price: 130, expected: 30.00 },
  { price: 70, expected: 40.00 },
];

for (const testCase of scoreCases) {
  const balancingPrice = (500 - testCase.price) / 4;
  const result = evaluatePrices(
    [testCase.price, balancingPrice, balancingPrice, balancingPrice, balancingPrice],
    { benchmarkFactor: 1 }
  );
  assert.strictEqual(result[0].benchmark, 100);
  assert.strictEqual(result[0].priceScore, testCase.expected);
}

const invalidExcluded = evaluatePrices([101, 103, 107, 109, 113, 127, 0]);
assert.strictEqual(invalidExcluded[0].validBidCount, 6);
assert.strictEqual(invalidExcluded[0].trimCount, 1);
assert.strictEqual(invalidExcluded[0].includedBidCount, 4);

const rankedValidOnly = Scoring.evaluate(
  bidders([101, 103, 107, 109, 113, 127, 0]),
  {
    businessWeight: 20,
    priceWeight: 40,
    techWeight: 40,
    priceFull: 40,
    priceStrategy: 'tieredTrimmedBenchmark',
    strategyParams: params,
  }
);
assert.strictEqual(rankedValidOnly.length, 6);
assert.ok(rankedValidOnly.every(b => b.price > 0));

const normalized = Scoring.evaluate(
  [{ id: 'my', name: '目标方案', price: 100, businessScore: 80, techScore: 80, isMe: true }],
  {
    businessWeight: 20,
    priceWeight: 40,
    techWeight: 40,
    priceFull: 40,
    priceStrategy: 'tieredTrimmedBenchmark',
    strategyParams: { ...params, benchmarkFactor: 1 },
  }
)[0];
assert.strictEqual(normalized.priceScore, 35);
assert.strictEqual(normalized.total, 83);

const defaultScale = Scoring.evaluate(
  [{ id: 'my', name: '目标方案', price: 100, businessScore: 80, techScore: 80, isMe: true }],
  {
    businessWeight: 20,
    priceWeight: 40,
    techWeight: 40,
    priceFull: 100,
    priceStrategy: 'averagePrice',
    strategyParams: { avgBaseScore: 80 },
  }
)[0];
assert.strictEqual(defaultScale.priceScore, 80);
assert.strictEqual(defaultScale.total, 80);

const directComponentScores = Scoring.evaluate(
  [{ id: 'my', name: '目标方案', price: 100, businessScore: 8, techScore: 43.7, isMe: true }],
  {
    businessWeight: 8,
    priceWeight: 46,
    techWeight: 46,
    businessFull: 8,
    priceFull: 46,
    techFull: 46,
    priceStrategy: 'fixedBenchmark',
    strategyParams: { benchmark: 100, deductHigh: 0, deductLow: 0 },
  }
)[0];
assert.strictEqual(directComponentScores.priceScore, 46);
assert.strictEqual(directComponentScores.total, 97.7);

const normalizedComponentScores = Scoring.evaluate(
  [{ id: 'my', name: '目标方案', price: 100, businessScore: 100, techScore: 95, isMe: true }],
  {
    businessWeight: 8,
    priceWeight: 46,
    techWeight: 46,
    businessFull: 100,
    priceFull: 46,
    techFull: 100,
    priceStrategy: 'fixedBenchmark',
    strategyParams: { benchmark: 100, deductHigh: 0, deductLow: 0 },
  }
)[0];
assert.strictEqual(normalizedComponentScores.total, directComponentScores.total);

const componentRangeErrors = Scoring.validateComponentScoreConfig(
  { businessFull: 8, priceFull: 46, techFull: 46 },
  [{ name: '超分样本', businessScore: 9, techScore: 47 }]
);
assert.deepStrictEqual(componentRangeErrors, [
  '“超分样本”商务得分必须在0到8之间',
  '“超分样本”技术得分必须在0到46之间',
]);
assert.deepStrictEqual(
  Scoring.validateComponentScoreConfig(
    { businessFull: 8, priceFull: 46, techFull: 46, priceStrategy: 'outlierFilteredBenchmark' },
    [{ name: '未报价占位样本', price: 0, businessScore: 100, techScore: 100 }]
  ),
  []
);
assert.deepStrictEqual(
  Scoring.validateComponentScoreConfig({ businessFull: 0, priceFull: 46, techFull: -1 }, []),
  ['商务录入满分必须大于0', '技术录入满分必须大于0']
);
assert.throws(
  () => Scoring.evaluate(
    [{ name: '超分样本', price: 100, businessScore: 9, techScore: 47 }],
    {
      businessWeight: 8, priceWeight: 46, techWeight: 46,
      businessFull: 8, priceFull: 46, techFull: 46,
      priceStrategy: 'fixedBenchmark', strategyParams: { benchmark: 100 },
    }
  ),
  /商务得分必须在0到8之间.*技术得分必须在0到46之间/
);

const optimizationConfig = {
  businessWeight: 0,
  priceWeight: 100,
  techWeight: 0,
  priceFull: 40,
  priceStrategy: 'tieredTrimmedBenchmark',
  strategyParams: params,
};

const parsedScenarios = Scoring.parsePriceScenarios(
  '总5家：101, 103，107; 109\n总11家: 90 92 94 96 98 100 102 104 106 108'
);
assert.deepStrictEqual(parsedScenarios.map(scenario => scenario.bidders.length + 1), [5, 11]);
assert.deepStrictEqual(parsedScenarios.map(scenario => scenario.name), ['总5家', '总11家']);
assert.deepStrictEqual(
  Scoring.parsePriceScenarios('', [{ name: 'A', price: 100 }, { name: '空值', price: 0 }]),
  [{ name: '当前报价样本列表', bidders: [{ name: 'A', price: 100 }] }]
);
assert.throws(() => Scoring.parsePriceScenarios('异常: 100, abc'), /第1行含无效报价/);

const arbitrarySizeScenarios = [
  { name: '总5家', bidders: [101, 103, 107, 109] },
  { name: '总10家', bidders: [91, 94, 97, 100, 103, 106, 109, 112, 115] },
  { name: '总11家', bidders: [88, 91, 94, 97, 100, 103, 106, 109, 112, 115] },
  { name: '总16家', bidders: [80, 83, 86, 89, 92, 95, 98, 101, 104, 107, 110, 113, 116, 119, 122] },
];
const scenariosSnapshot = JSON.parse(JSON.stringify(arbitrarySizeScenarios));
const multiScenario = Scoring.optimizePriceAcrossScenarios(
  'my',
  arbitrarySizeScenarios,
  optimizationConfig,
  { minPrice: 90, maxPrice: 110, step: 7 }
);
assert.deepStrictEqual(arbitrarySizeScenarios, scenariosSnapshot);
assert.strictEqual(multiScenario.scenarioCount, 4);
assert.deepStrictEqual(multiScenario.participantCounts, [5, 10, 11, 16]);
assert.deepStrictEqual(multiScenario.candidates.map(candidate => candidate.price), [90, 97, 104, 110]);
for (const candidate of multiScenario.candidates) {
  assert.deepStrictEqual(candidate.details.map(detail => detail.participantCount), [5, 10, 11, 16]);
  assert.deepStrictEqual(candidate.details.map(detail => detail.trimCount), [0, 1, 2, 2]);
  assert.deepStrictEqual(candidate.details.map(detail => detail.includedBidCount), [5, 8, 7, 12]);
  assert.strictEqual(
    candidate.topRate,
    Scoring.round(candidate.details.filter(detail => detail.priceRank === 1).length / 4 * 100, 2)
  );
}
assert.ok(multiScenario.best.price >= 90 && multiScenario.best.price <= 110);

const independentlySelectedTarget = Scoring.optimizePriceAcrossScenarios(
  'sample-b',
  [{ name: '独立情景', bidders: [96, 100, 104, 108] }],
  optimizationConfig,
  { minPrice: 85, maxPrice: 105, step: 5 }
);
assert.strictEqual(independentlySelectedTarget.scenarioCount, 1);
assert.strictEqual(independentlySelectedTarget.best.details[0].participantCount, 5);
assert.strictEqual(independentlySelectedTarget.best.details[0].trimCount, 0);
assert.ok(independentlySelectedTarget.best.price >= 85 && independentlySelectedTarget.best.price <= 105);

const higherPriceTieBreak = Scoring.optimizePriceAcrossScenarios(
  'my',
  [{ name: '同分情景', bidders: [95, 105] }],
  {
    ...optimizationConfig,
    priceStrategy: 'fixedBenchmark',
    strategyParams: { benchmark: 100, deductHigh: 0, deductLow: 0 },
  },
  { minPrice: 80, maxPrice: 89, step: 4 }
);
assert.deepStrictEqual(higherPriceTieBreak.candidates.map(candidate => candidate.price), [80, 84, 88, 89]);
assert.strictEqual(higherPriceTieBreak.best.price, 89);
assert.strictEqual(higherPriceTieBreak.best.topRate, 100);

assert.throws(
  () => Scoring.optimizePriceAcrossScenarios('my', [], optimizationConfig, { minPrice: 90, maxPrice: 110, step: 1 }),
  /至少需要一个/
);
assert.throws(
  () => Scoring.optimizePriceAcrossScenarios('my', [{ name: '含无效值', bidders: [100, 0] }], optimizationConfig, { minPrice: 90, maxPrice: 110, step: 1 }),
  /第2个报价无效/
);
assert.throws(
  () => Scoring.optimizePriceAcrossScenarios('my', arbitrarySizeScenarios, optimizationConfig, { minPrice: 110, maxPrice: 90, step: 1 }),
  /搜索价格区间或步长无效/
);

console.log('scoring tests passed');
