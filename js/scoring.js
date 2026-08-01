/**
 * 评分计算核心模块
 * 支持多种价格评分策略
 */

const Scoring = (() => {

  /**
   * 价格评分策略
   */
  const PriceStrategies = {

    /**
     * 1. 最低价法
     * 最低报价得满分，其他按比例扣分
     * 得分 = 满分 × (最低价 / 本人报价)
     */
    lowestPrice(bids, fullScore, params = {}) {
      const validBids = bids.filter(b => b.price > 0);
      if (validBids.length === 0) return bids.map(b => ({ ...b, priceScore: 0 }));
      const minPrice = Math.min(...validBids.map(b => b.price));
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0 };
        const score = Math.max(0, fullScore * (minPrice / b.price));
        return { ...b, priceScore: round(score, 2) };
      });
    },

    /**
     * 2. 平均价法
     * 评标基准价 = 所有有效报价的算术平均值
     * 平均价得基础分；低于平均价按比例加分；高于平均价按比例扣分；
     * 最终得分限制在最低分和最高分之间
     */
    averagePrice(bids, fullScore, params = {}) {
      const baseScore = params.avgBaseScore ?? 80;
      const lowAdd = params.avgLowAdd ?? 1;
      const highDeduct = params.avgHighDeduct ?? 1;
      const maxScore = params.avgMaxScore ?? fullScore;
      const minScore = params.avgMinScore ?? 0;
      const validBids = bids.filter(b => b.price > 0);
      if (validBids.length === 0) return bids.map(b => ({ ...b, priceScore: 0, benchmark: 0 }));
      const avg = validBids.reduce((s, b) => s + b.price, 0) / validBids.length;
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0, benchmark: avg };
        const deviation = (b.price - avg) / avg * 100; // 偏差率%
        const score = deviation > 0
          ? Math.max(minScore, baseScore - deviation * highDeduct)
          : Math.min(maxScore, baseScore + Math.abs(deviation) * lowAdd);
        return { ...b, priceScore: round(score, 2), benchmark: avg, deviation: round(deviation, 2) };
      });
    },

    /**
     * 3. 复合基准价法
     * 基准价 = A×最低价 + B×平均价  (A+B=1)
     * 偏差扣分同平均价法
     */
    compositePrice(bids, fullScore, params = {}) {
      const weightLow = params.weightLow ?? 0.5;    // 最低价权重
      const weightAvg = params.weightAvg ?? 0.5;    // 平均价权重
      const deductHigh = params.deductHigh ?? 0.5;
      const deductLow  = params.deductLow  ?? 0.3;
      const validBids = bids.filter(b => b.price > 0);
      if (validBids.length === 0) return bids.map(b => ({ ...b, priceScore: 0, benchmark: 0 }));
      const minPrice = Math.min(...validBids.map(b => b.price));
      const avg = validBids.reduce((s, b) => s + b.price, 0) / validBids.length;
      const benchmark = weightLow * minPrice + weightAvg * avg;
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0, benchmark };
        const deviation = (b.price - benchmark) / benchmark * 100;
        let deduct = deviation > 0
          ? deviation * deductHigh
          : Math.abs(deviation) * deductLow;
        const score = Math.max(0, fullScore - deduct);
        return { ...b, priceScore: round(score, 2), benchmark, deviation: round(deviation, 2) };
      });
    },

    /**
     * 4. 固定基准价法（标底法）
     * 基准价由招标方设定（通常为标底价×系数）
     * 偏差扣分同平均价法
     */
    fixedBenchmark(bids, fullScore, params = {}) {
      const benchmark = params.benchmark ?? 0;
      const deductHigh = params.deductHigh ?? 0.5;
      const deductLow  = params.deductLow  ?? 0.3;
      if (benchmark <= 0) return bids.map(b => ({ ...b, priceScore: 0, benchmark: 0 }));
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0, benchmark };
        const deviation = (b.price - benchmark) / benchmark * 100;
        let deduct = deviation > 0
          ? deviation * deductHigh
          : Math.abs(deviation) * deductLow;
        const score = Math.max(0, fullScore - deduct);
        return { ...b, priceScore: round(score, 2), benchmark, deviation: round(deviation, 2) };
      });
    },

    /**
     * 5. 去最高最低后平均价法
     * 去掉最高价和最低价后取平均作为基准价
     */
    trimmedAverage(bids, fullScore, params = {}) {
      const deductHigh = params.deductHigh ?? 0.5;
      const deductLow  = params.deductLow  ?? 0.3;
      const trimCount  = params.trimCount  ?? 1;     // 各去掉几个
      const validBids = bids.filter(b => b.price > 0).sort((a, b) => a.price - b.price);
      if (validBids.length <= trimCount * 2) {
        // 不够去除，退化为普通平均价法
        return PriceStrategies.averagePrice(bids, fullScore, params);
      }
      const trimmed = validBids.slice(trimCount, validBids.length - trimCount);
      const avg = trimmed.reduce((s, b) => s + b.price, 0) / trimmed.length;
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0, benchmark: avg };
        const deviation = (b.price - avg) / avg * 100;
        let deduct = deviation > 0
          ? deviation * deductHigh
          : Math.abs(deviation) * deductLow;
        const score = Math.max(0, fullScore - deduct);
        return { ...b, priceScore: round(score, 2), benchmark: avg, deviation: round(deviation, 2) };
      });
    },

    /**
     * 6. 分档去高去低下浮基准价法
     * 按有效投标人数自动决定去除数量，剩余报价均值乘以下浮系数；
     * 基准价保留指定小数位，低于基准价加分、高于基准价扣分。
     */
    tieredTrimmedBenchmark(bids, fullScore, params = {}) {
      const midThreshold = Math.max(0, Math.trunc(params.tierMidThreshold ?? 5));
      const highThreshold = Math.max(midThreshold, Math.trunc(params.tierHighThreshold ?? 10));
      const highTrim = Math.max(0, Math.trunc(params.tierHighTrim ?? 2));
      const midTrim = Math.max(0, Math.trunc(params.tierMidTrim ?? 1));
      const benchmarkFactor = Number(params.benchmarkFactor) > 0 ? Number(params.benchmarkFactor) : 0.95;
      const benchmarkDecimals = Math.min(10, Math.max(0, Math.trunc(params.benchmarkDecimals ?? 6)));
      const baseScore = params.tierBaseScore ?? 35;
      const highDeduct = params.tierHighDeduct ?? 0.5;
      const lowAdd = params.tierLowAdd ?? 0.5;
      const minScore = params.tierMinScore ?? 30;
      const maxScore = params.tierMaxScore ?? 40;

      const validBids = bids.filter(b => b.price > 0).sort((a, b) => a.price - b.price);
      if (validBids.length === 0) {
        return bids.map(b => ({ ...b, priceScore: 0, benchmark: 0, validBidCount: 0, trimCount: 0 }));
      }

      const requestedTrim = validBids.length > highThreshold
        ? highTrim
        : validBids.length > midThreshold
          ? midTrim
          : 0;
      const trimCount = Math.min(requestedTrim, Math.floor((validBids.length - 1) / 2));
      const included = trimCount > 0
        ? validBids.slice(trimCount, validBids.length - trimCount)
        : validBids;
      const avg = included.reduce((sum, b) => sum + b.price, 0) / included.length;
      const benchmark = round(avg * benchmarkFactor, benchmarkDecimals);

      return bids.map(b => {
        if (b.price <= 0) {
          return { ...b, priceScore: 0, benchmark, validBidCount: validBids.length, trimCount };
        }
        const deviation = (b.price - benchmark) / benchmark * 100;
        const score = deviation > 0
          ? Math.max(minScore, baseScore - deviation * highDeduct)
          : Math.min(maxScore, baseScore + Math.abs(deviation) * lowAdd);
        return {
          ...b,
          priceScore: round(score, 2),
          benchmark,
          deviation: round(deviation, 2),
          validBidCount: validBids.length,
          trimCount,
        };
      });
    },

    /**
     * 7. 区间得分法
     * 报价在 [基准价×(1-a%), 基准价×(1+b%)] 区间内得满分
     * 超出区间每1%扣X分
     */
    intervalScore(bids, fullScore, params = {}) {
      const benchmark  = params.benchmark  ?? 0;
      const lowerPct   = params.lowerPct   ?? 3;     // 下浮上限%
      const upperPct   = params.upperPct   ?? 3;     // 上浮上限%
      const deductOut  = params.deductOut  ?? 1;     // 超出区间每1%扣分
      if (benchmark <= 0) return bids.map(b => ({ ...b, priceScore: 0, benchmark: 0 }));
      const lowerBound = benchmark * (1 - lowerPct / 100);
      const upperBound = benchmark * (1 + upperPct / 100);
      return bids.map(b => {
        if (b.price <= 0) return { ...b, priceScore: 0, benchmark };
        let score = fullScore;
        if (b.price < lowerBound) {
          const excess = (lowerBound - b.price) / benchmark * 100;
          score = Math.max(0, fullScore - excess * deductOut);
        } else if (b.price > upperBound) {
          const excess = (b.price - upperBound) / benchmark * 100;
          score = Math.max(0, fullScore - excess * deductOut);
        }
        const deviation = (b.price - benchmark) / benchmark * 100;
        return { ...b, priceScore: round(score, 2), benchmark, deviation: round(deviation, 2) };
      });
    },
  };

  /**
   * 计算综合得分
   */
  function calcTotal(bidders, config) {
    const { businessWeight, priceWeight, techWeight } = config;
    const priceFull = Number(config.priceFull) > 0 ? Number(config.priceFull) : 100;
    return bidders.map(b => {
      const total = round(
        b.businessScore * businessWeight / 100 +
        b.priceScore    * priceWeight    / priceFull +
        b.techScore     * techWeight     / 100,
        4
      );
      return { ...b, total };
    });
  }

  /**
   * 排名
   */
  function rank(bidders) {
    const sorted = [...bidders].sort((a, b) => b.total - a.total);
    return sorted.map((b, i) => ({ ...b, rank: i + 1 }));
  }

  /**
   * 完整评分流程
   */
  function evaluate(bidders, config) {
    const strategy = config.priceStrategy;
    const params   = config.strategyParams || {};
    const priceFull = config.priceFull ?? 100;
    const eligibleBidders = strategy === 'tieredTrimmedBenchmark'
      ? bidders.filter(b => b.price > 0)
      : bidders;

    // 计算价格得分
    let result = PriceStrategies[strategy]
      ? PriceStrategies[strategy](eligibleBidders, priceFull, params)
      : PriceStrategies.lowestPrice(eligibleBidders, priceFull, params);

    // 综合得分
    result = calcTotal(result, config);

    // 排名
    result = rank(result);

    return result;
  }

  /**
   * 最优报价搜索
   * 在给定报价范围内，搜索使我方综合排名第一的最优（最高）报价
   */
  function findOptimalPrice(myBidderId, otherBidders, config, searchRange) {
    const { minPrice, maxPrice, step = 1000 } = searchRange;
    let bestPrice = null;
    let bestScore = -1;
    let bestRank  = 999;

    for (let price = maxPrice; price >= minPrice; price -= step) {
      const myBidder = { id: myBidderId, name: '我方', price };
      const allBidders = [myBidder, ...otherBidders];
      const result = evaluate(
        allBidders.map(b => ({
          ...b,
          businessScore: b.businessScore ?? 0,
          techScore: b.techScore ?? 0,
        })),
        config
      );
      const me = result.find(b => b.id === myBidderId);
      if (me && me.rank === 1) {
        if (price > bestPrice || bestPrice === null) {
          bestPrice = price;
          bestScore = me.total;
          bestRank  = 1;
        }
        break; // 从高价往低找，找到第一个rank=1即为最高可用价
      }
    }

    // 如果找不到rank=1，找rank最小的
    if (bestPrice === null) {
      for (let price = minPrice; price <= maxPrice; price += step) {
        const myBidder = { id: myBidderId, name: '我方', price };
        const allBidders = [myBidder, ...otherBidders];
        const result = evaluate(
          allBidders.map(b => ({
            ...b,
            businessScore: b.businessScore ?? 0,
            techScore: b.techScore ?? 0,
          })),
          config
        );
        const me = result.find(b => b.id === myBidderId);
        if (me) {
          if (me.rank < bestRank || (me.rank === bestRank && me.total > bestScore)) {
            bestRank  = me.rank;
            bestScore = me.total;
            bestPrice = price;
          }
        }
      }
    }

    return { bestPrice, bestScore, bestRank };
  }

  /**
   * 敏感性分析：在价格区间内生成得分/排名曲线
   */
  function sensitivityAnalysis(myBidderId, otherBidders, config, range, points = 20) {
    const { minPrice, maxPrice } = range;
    const step = (maxPrice - minPrice) / (points - 1);
    const rows = [];
    for (let i = 0; i < points; i++) {
      const price = Math.round(minPrice + step * i);
      const myBidder = { id: myBidderId, name: '我方', price };
      const allBidders = [myBidder, ...otherBidders];
      const result = evaluate(
        allBidders.map(b => ({
          ...b,
          businessScore: b.businessScore ?? 0,
          techScore: b.techScore ?? 0,
        })),
        config
      );
      const me = result.find(b => b.id === myBidderId);
      if (me) {
        rows.push({
          price,
          priceScore: me.priceScore,
          total: me.total,
          rank: me.rank,
        });
      }
    }
    return rows;
  }

  function round(val, decimals) {
    return Math.round(val * 10 ** decimals) / 10 ** decimals;
  }

  return {
    PriceStrategies,
    evaluate,
    findOptimalPrice,
    sensitivityAnalysis,
    round,
    strategyNames: {
      lowestPrice:     '最低价法',
      averagePrice:    '平均价法',
      compositePrice:  '复合基准价法',
      fixedBenchmark:  '固定基准价法（标底法）',
      trimmedAverage:  '去高去低平均价法',
      tieredTrimmedBenchmark: '分档去高去低×系数法',
      intervalScore:   '区间得分法',
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Scoring;
}
