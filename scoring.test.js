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
  { prices: [101, 103, 107, 109, 113, 127, 131, 137, 139, 149], benchmark: 114.712500, trimCount: 1 },
  { prices: [101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 157], benchmark: 117.121429, trimCount: 2 },
];

for (const testCase of benchmarkCases) {
  const result = evaluatePrices(testCase.prices);
  assert.strictEqual(result[0].benchmark, testCase.benchmark);
  assert.strictEqual(result[0].trimCount, testCase.trimCount);
  assert.strictEqual(result[0].validBidCount, testCase.prices.length);
}

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
