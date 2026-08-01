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
    name: `投标人${index + 1}`,
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
  [{ id: 'my', name: '我方', price: 100, businessScore: 80, techScore: 80, isMe: true }],
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
  [{ id: 'my', name: '我方', price: 100, businessScore: 80, techScore: 80, isMe: true }],
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

console.log('scoring tests passed');
