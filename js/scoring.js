/**
 * 评分计算核心模块
 * 支持多种价格评分策略
 */

const Scoring = (() => {

  /**
   * 将单个报价输入标准化为正数。
   * 支持半角/全角逗号、空格以及人民币符号；空值和非法值返回 0。
   */
  function normalizePriceInput(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    const raw = String(value ?? '').trim().replace(/[\s¥￥]/g, '');
    if (!/^(?:\d+(?:\.\d+)?|\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?)$/.test(raw)) return 0;
    const normalized = raw.replace(/[,，]/g, '');
    if (!normalized) return 0;
    const price = Number(normalized);
    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  /**
   * 汇总已建立样本与有效/未计入样本，供计算和界面提示共用。
   */
  function summarizeBidValidity(bidders = []) {
    const normalizedBidders = bidders.map(bidder => ({
      ...bidder,
      price: normalizePriceInput(bidder.price),
    }));
    const validBidders = normalizedBidders.filter(bidder => bidder.price > 0 && bidder.enabled !== false);
    const invalidBidders = normalizedBidders.filter(bidder => bidder.price <= 0 || bidder.enabled === false);
    return {
      totalCount: normalizedBidders.length,
      validCount: validBidders.length,
      invalidCount: invalidBidders.length,
      normalizedBidders,
      validBidders,
      invalidBidders,
    };
  }

  function validateStrategyConfig(strategy, fullScore, params = {}) {
    if (strategy !== 'outlierFilteredBenchmark') {
      const errors = [];
      const number = (key, fallback, label, min = 0, integer = false) => {
        const value = Number(params[key] ?? fallback);
        if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) errors.push(`${label}无效`);
        return value;
      };
      const full = Number(fullScore);
      if (!Number.isFinite(full) || full <= 0) errors.push('价格满分必须大于0');
      if (!Object.prototype.hasOwnProperty.call(PriceStrategies, strategy)) errors.push('请选择有效的价格策略');
      if (['averagePrice', 'tieredTrimmedBenchmark'].includes(strategy)) {
        const tier = strategy === 'tieredTrimmedBenchmark';
        const base = number(tier ? 'tierBaseScore' : 'avgBaseScore', tier ? 35 : 80, '基础分');
        const low = number(tier ? 'tierMinScore' : 'avgMinScore', tier ? 30 : 0, '最低分');
        const high = number(tier ? 'tierMaxScore' : 'avgMaxScore', tier ? 40 : full, '最高分');
        if (!(low <= base && base <= high && high <= full)) errors.push('需满足：最低分 ≤ 基础分 ≤ 最高分 ≤ 价格满分');
        number(tier ? 'tierHighDeduct' : 'avgHighDeduct', tier ? 0.5 : 1, '高价扣分');
        number(tier ? 'tierLowAdd' : 'avgLowAdd', tier ? 0.5 : 1, '低价加分');
        if (tier) {
          const mid = number('tierMidThreshold', 5, '中档阈值', 0, true);
          const highThreshold = number('tierHighThreshold', 10, '高档阈值', 0, true);
          if (highThreshold <= mid) errors.push('高档阈值必须大于中档阈值');
          number('tierMidTrim', 1, '中档去除数量', 0, true);
          number('tierHighTrim', 2, '高档去除数量', 0, true);
          number('benchmarkFactor', 0.95, '基准价系数', Number.MIN_VALUE);
          const decimals = number('benchmarkDecimals', 6, '基准价小数位', 0, true);
          if (decimals > 10) errors.push('基准价小数位不能大于10');
        }
      }
      if (['fixedBenchmark', 'intervalScore'].includes(strategy)) number('benchmark', 0, '固定基准价', Number.MIN_VALUE);
      if (['fixedBenchmark', 'trimmedAverage', 'compositePrice'].includes(strategy)) {
        number('deductHigh', 0.5, '高价扣分'); number('deductLow', 0.3, '低价扣分');
      }
      if (strategy === 'trimmedAverage') number('trimCount', 1, '去除数量', 0, true);
      if (strategy === 'compositePrice') {
        const low = number('weightLow', 0.5, '最低价系数');
        const avg = number('weightAvg', 0.5, '平均价系数');
        if (Math.abs(low + avg - 1) > 1e-9) errors.push('最低价与平均价系数之和必须为1');
      }
      if (strategy === 'intervalScore') {
        const lower = number('lowerPct', 3, '下浮区间');
        number('upperPct', 3, '上浮区间'); number('deductOut', 1, '区间外扣分');
        if (lower > 100) errors.push('下浮区间不能大于100%');
      }
      return errors;
    }
    const errors = [];
    const score = Number(fullScore);
    const cutoff = Number(params.outlierCutoffMultiple ?? 1.5);
    const factor = Number(params.outlierBenchmarkFactor ?? 0.95);
    const highDeduct = Number(params.outlierHighDeduct ?? 0.8);
    const lowDeduct = Number(params.outlierLowDeduct ?? 0.3);
    const minScore = Number(params.outlierMinScore ?? 0);
    const decimals = Number(params.outlierDeviationDecimals ?? 2);
    if (!Number.isFinite(score) || score <= 0) errors.push('价格满分必须大于0');
    if (!Number.isFinite(cutoff) || cutoff <= 1) errors.push('高价剔除阈值倍数必须大于1');
    if (!Number.isFinite(factor) || factor <= 0) errors.push('基准价系数必须大于0');
    if (!Number.isFinite(highDeduct) || highDeduct < 0) errors.push('高于基准价扣分不能小于0');
    if (!Number.isFinite(lowDeduct) || lowDeduct < 0) errors.push('低于基准价扣分不能小于0');
    if (!Number.isFinite(minScore) || minScore < 0) errors.push('最低分不能小于0');
    if (Number.isFinite(score) && Number.isFinite(minScore) && minScore > score) errors.push('最低分不能高于价格满分');
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 10) errors.push('偏差率小数位必须是0到10之间的整数');
    return errors;
  }

  function validateComponentScoreConfig(config = {}, bidders = []) {
    const errors = [];
    const businessFull = Number(config.businessFull ?? 100);
    const priceFull = Number(config.priceFull ?? 100);
    const techFull = Number(config.techFull ?? 100);
    if (!Number.isFinite(businessFull) || businessFull <= 0) errors.push('商务录入满分必须大于0');
    if (!Number.isFinite(priceFull) || priceFull <= 0) errors.push('价格录入满分必须大于0');
    if (!Number.isFinite(techFull) || techFull <= 0) errors.push('技术录入满分必须大于0');
    if (errors.length > 0) return errors;

    const scoreBidders = config.priceStrategy
      ? bidders.filter(bidder => normalizePriceInput(bidder.price) > 0 && bidder.enabled !== false)
      : bidders;
    for (const bidder of scoreBidders) {
      const name = bidder.name || '未命名样本';
      const businessScore = Number(bidder.businessScore ?? 0);
      const techScore = Number(bidder.techScore ?? 0);
      if (!Number.isFinite(businessScore) || businessScore < 0 || businessScore > businessFull) {
        errors.push(`“${name}”商务得分必须在0到${businessFull}之间`);
      }
      if (!Number.isFinite(techScore) || techScore < 0 || techScore > techFull) {
        errors.push(`“${name}”技术得分必须在0到${techFull}之间`);
      }
    }
    return errors;
  }

  function roundHalfAwayFromZero(value, decimals) {
    const factor = 10 ** decimals;
    const scaled = Math.abs(Number(value)) * factor;
    const rounded = Math.round(scaled + 1e-10) / factor;
    return Number(value) < 0 ? -rounded : rounded;
  }

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
     * 评分基准价 = 所有有效报价的算术平均值
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
        const score = Math.min(maxScore, Math.max(minScore, deviation > 0
          ? baseScore - deviation * highDeduct
          : baseScore + Math.abs(deviation) * lowAdd));
        return { ...b, priceScore: round(score, 2), benchmark: avg, deviation: round(deviation, 2) };
      });
    },

    /**
     * 3. 高价阈值剔除×系数平均价法
     * 先计算全部有效报价的初始均值；达到初始均值×阈值倍数的报价不参与
     * 基准价计算。其余报价的均值乘系数得到基准价。偏差率先按指定小数位
     * 舍入，再分别按高/低侧斜率扣分。技术得分最高且有效报价最低时满分。
     */
    outlierFilteredBenchmark(bids, fullScore, params = {}) {
      const configErrors = validateStrategyConfig('outlierFilteredBenchmark', fullScore, params);
      if (configErrors.length > 0) throw new Error(configErrors.join('；'));
      const fullScoreValue = Number(fullScore);
      const maximumScore = Number.isFinite(fullScoreValue) && fullScoreValue > 0 ? fullScoreValue : 46;
      const cutoffValue = Number(params.outlierCutoffMultiple);
      const cutoffMultiple = Number.isFinite(cutoffValue) && cutoffValue > 1 ? cutoffValue : 1.5;
      const factorValue = Number(params.outlierBenchmarkFactor);
      const benchmarkFactor = Number.isFinite(factorValue) && factorValue > 0 ? factorValue : 0.95;
      const highDeductValue = Number(params.outlierHighDeduct ?? 0.8);
      const highDeduct = Number.isFinite(highDeductValue) && highDeductValue >= 0 ? highDeductValue : 0.8;
      const lowDeductValue = Number(params.outlierLowDeduct ?? 0.3);
      const lowDeduct = Number.isFinite(lowDeductValue) && lowDeductValue >= 0 ? lowDeductValue : 0.3;
      const minScoreValue = Number(params.outlierMinScore ?? 0);
      const minScore = Number.isFinite(minScoreValue)
        ? Math.min(maximumScore, Math.max(0, minScoreValue))
        : 0;
      const deviationDecimals = Math.min(10, Math.max(0, Math.trunc(params.outlierDeviationDecimals ?? 2)));
      const specialFullScoreEnabled = params.outlierSpecialFullScore !== false && params.outlierSpecialFullScore !== 0;
      const { normalizedBidders, validBidders } = summarizeBidValidity(bids);

      if (validBidders.length === 0) {
        return normalizedBidders.map(bidder => ({
          ...bidder,
          priceScore: 0,
          benchmark: 0,
          deviation: null,
          validBidCount: 0,
          includedBidCount: 0,
          excludedHighBidCount: 0,
          excludedHighBidderNames: [],
          preliminaryAverage: 0,
          exclusionThreshold: 0,
          specialFullScore: false,
        }));
      }

      const preliminaryAverage = validBidders.reduce((sum, bidder) => sum + bidder.price, 0) / validBidders.length;
      const exclusionThreshold = preliminaryAverage * cutoffMultiple;
      const includedBids = validBidders.filter(bidder => bidder.price < exclusionThreshold);
      const excludedHighBids = validBidders.filter(bidder => bidder.price >= exclusionThreshold);
      const includedTotal = includedBids.reduce((sum, bidder) => sum + bidder.price, 0);
      const benchmark = includedTotal / includedBids.length * benchmarkFactor;
      const technicalScoresAvailable = validBidders.every(bidder =>
        bidder.techScore !== '' && bidder.techScore != null && Number.isFinite(Number(bidder.techScore))
      );
      const highestTechnicalScore = technicalScoresAvailable
        ? Math.max(...validBidders.map(bidder => Number(bidder.techScore)))
        : null;
      const lowestValidPrice = Math.min(...validBidders.map(bidder => bidder.price));

      return normalizedBidders.map(bidder => {
        const metadata = {
          benchmark,
          validBidCount: validBidders.length,
          includedBidCount: includedBids.length,
          excludedHighBidCount: excludedHighBids.length,
          excludedHighBidderNames: excludedHighBids.map(excluded => excluded.name || '未命名样本'),
          preliminaryAverage,
          exclusionThreshold,
        };
        if (bidder.price <= 0) {
          return { ...bidder, ...metadata, priceScore: 0, deviation: null, specialFullScore: false };
        }

        const deviation = roundHalfAwayFromZero(
          (bidder.price - benchmark) / benchmark * 100,
          deviationDecimals
        );
        const specialFullScore = specialFullScoreEnabled && technicalScoresAvailable &&
          Number(bidder.techScore) === highestTechnicalScore && bidder.price === lowestValidPrice;
        const deduction = deviation > 0
          ? deviation * highDeduct
          : Math.abs(deviation) * lowDeduct;
        const score = specialFullScore
          ? maximumScore
          : Math.max(minScore, maximumScore - deduction);
        return {
          ...bidder,
          ...metadata,
          priceScore: roundHalfAwayFromZero(score, 2),
          deviation,
          specialFullScore,
        };
      });
    },

    /**
     * 4. 复合基准价法
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
     * 5. 固定基准价法
     * 基准价由用户按适用规则预先设置
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
     * 6. 去最高最低后平均价法
     * 去掉最高价和最低价后取平均作为基准价
     */
    trimmedAverage(bids, fullScore, params = {}) {
      const deductHigh = params.deductHigh ?? 0.5;
      const deductLow  = params.deductLow  ?? 0.3;
      const trimCount  = params.trimCount  ?? 1;     // 各去掉几个
      const validBids = bids.filter(b => b.price > 0).sort((a, b) => a.price - b.price);
      if (validBids.length <= trimCount * 2) {
        if (!validBids.length) return [];
        throw new Error('有效报价不足以按当前规则去除，请调整规则或样本');
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
     * 7. 分档去高去低下浮基准价法
     * 按有效报价样本数自动决定去除数量，剩余报价均值乘以下浮系数；
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

      const { normalizedBidders, validBidders } = summarizeBidValidity(bids);
      const validBids = [...validBidders].sort((a, b) => a.price - b.price);
      if (validBids.length === 0) {
        return normalizedBidders.map(b => ({ ...b, priceScore: 0, benchmark: 0, validBidCount: 0, trimCount: 0, includedBidCount: 0 }));
      }

      const requestedTrim = validBids.length > highThreshold
        ? highTrim
        : validBids.length > midThreshold
          ? midTrim
          : 0;
      if (validBids.length <= requestedTrim * 2) throw new Error('有效报价不足以按当前分档规则去除');
      const trimCount = Math.min(requestedTrim, Math.floor((validBids.length - 1) / 2));
      const included = trimCount > 0
        ? validBids.slice(trimCount, validBids.length - trimCount)
        : validBids;
      const avg = included.reduce((sum, b) => sum + b.price, 0) / included.length;
      const benchmark = round(avg * benchmarkFactor, benchmarkDecimals);

      return normalizedBidders.map(b => {
        if (b.price <= 0) {
          return { ...b, priceScore: 0, benchmark, validBidCount: validBids.length, trimCount, includedBidCount: included.length };
        }
        const deviation = (b.price - benchmark) / benchmark * 100;
        const score = Math.min(maxScore, Math.max(minScore, deviation > 0
          ? baseScore - deviation * highDeduct
          : baseScore + Math.abs(deviation) * lowAdd));
        return {
          ...b,
          priceScore: round(score, 2),
          benchmark,
          deviation: round(deviation, 2),
          validBidCount: validBids.length,
          trimCount,
          includedBidCount: included.length,
        };
      });
    },

    /**
     * 8. 区间得分法
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
    const businessFull = Number(config.businessFull) > 0 ? Number(config.businessFull) : 100;
    const priceFull = Number(config.priceFull) > 0 ? Number(config.priceFull) : 100;
    const techFull = Number(config.techFull) > 0 ? Number(config.techFull) : 100;
    return bidders.map(b => {
      const total = round(
        b.businessScore * businessWeight / businessFull +
        b.priceScore    * priceWeight    / priceFull +
        b.techScore     * techWeight     / techFull,
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
    let position = 0;
    return sorted.map((b, i) => {
      if (i === 0 || b.total !== sorted[i - 1].total) position = i + 1;
      return { ...b, rank: position, tied: sorted.filter(row => row.total === b.total).length > 1 };
    });
  }

  function validateConfig(config, bidders = [], priceOnly = false) {
    const errors = validateStrategyConfig(config.priceStrategy, config.priceFull ?? 100, config.strategyParams || {});
    for (const b of bidders) if (b.enabled !== false && b.priceInputError) errors.push(`“${b.name || '样本'}”报价格式错误`);
    if (!priceOnly) {
      errors.push(...validateComponentScoreConfig(config, bidders));
      const weights = ['businessWeight', 'priceWeight', 'techWeight'].map(key => Number(config[key]));
      if (weights.some(value => !Number.isFinite(value) || value < 0) || Math.abs(weights.reduce((sum, v) => sum + v, 0) - 100) > 1e-8) errors.push('三项分值构成必须非负且合计100');
    }
    return errors;
  }

  function evaluatePrice(bidders, config) {
    const errors = validateConfig(config, bidders, true);
    if (errors.length) throw new Error(errors.join('；'));
    const valid = summarizeBidValidity(bidders).validBidders;
    const scored = PriceStrategies[config.priceStrategy](valid, config.priceFull ?? 100, config.strategyParams || {});
    return scored.map(b => ({ ...b,
      priceRank: 1 + scored.filter(row => row.priceScore > b.priceScore).length,
      priceTied: scored.filter(row => row.priceScore === b.priceScore).length > 1,
    }));
  }

  /**
   * 对已计算价格排名的结果排序，不修改原数组。
   * 报价为空或无效时，无论升降序都排在有效报价之后。
   */
  function sortPriceResults(rows, sortKey = 'priceRank', direction = 'asc') {
    const key = sortKey === 'price' ? 'price' : 'priceRank';
    const multiplier = direction === 'desc' ? -1 : 1;
    return rows
      .map((row, sourceIndex) => ({ row, sourceIndex }))
      .sort((left, right) => {
        if (key === 'price') {
          const leftValid = normalizePriceInput(left.row.price) > 0;
          const rightValid = normalizePriceInput(right.row.price) > 0;
          if (leftValid !== rightValid) return leftValid ? -1 : 1;
        }
        const leftValue = Number(left.row[key]) || 0;
        const rightValue = Number(right.row[key]) || 0;
        const primary = (leftValue - rightValue) * multiplier;
        if (primary !== 0) return primary;
        const rankFallback = (Number(left.row.priceRank) || 0) - (Number(right.row.priceRank) || 0);
        return rankFallback || left.sourceIndex - right.sourceIndex;
      })
      .map(item => item.row);
  }

  /**
   * 完整评分流程
   */
  function evaluate(bidders, config) {
    const componentErrors = validateConfig(config, bidders);
    if (componentErrors.length > 0) throw new Error(componentErrors.join('；'));
    const strategy = config.priceStrategy;
    const params   = config.strategyParams || {};
    const priceFull = config.priceFull ?? 100;
    const { normalizedBidders } = summarizeBidValidity(bidders);
    const eligibleBidders = normalizedBidders.filter(b => b.price > 0 && b.enabled !== false);

    // 计算价格得分
    let result = evaluatePrice(eligibleBidders, config);

    // 综合得分
    result = calcTotal(result, config);

    // 排名
    result = rank(result);

    return result;
  }

  /**
   * 最优报价搜索
   * 在给定报价范围内，搜索使目标方案综合排名第一的最优（最高）报价
   */
  function findOptimalPrice(myBidderId, otherBidders, config, searchRange) {
    const { minPrice, maxPrice, step = 1000 } = searchRange;
    let bestPrice = null;
    let bestScore = -1;
    let bestRank  = 999;

    for (let price = maxPrice; price >= minPrice; price -= step) {
      const myBidder = { id: myBidderId, name: '目标方案', price };
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
        const myBidder = { id: myBidderId, name: '目标方案', price };
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
   * 将每行一个情景的文本解析为报价数组；每行只包含其他报价样本。
   */
  function parsePriceScenarios(text, fallbackBidders = []) {
    const content = String(text || '').trim();
    if (!content) {
      const bidders = fallbackBidders
        .filter(bidder => Number(bidder.price) > 0)
        .map(bidder => ({ name: bidder.name, price: Number(bidder.price) }));
      if (bidders.length === 0) {
        throw new Error('请填写至少一个报价情景，或先填写其他报价样本');
      }
      return [{ name: '当前报价样本列表', bidders }];
    }

    return content.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
      const colonIndex = line.search(/[:：]/);
      const rawName = colonIndex >= 0 ? line.slice(0, colonIndex).trim() : '';
      const payload = (colonIndex >= 0 ? line.slice(colonIndex + 1) : line).trim();
      // Comma-separated amounts and thousands separators are ambiguous. Never guess.
      if (/^\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?$/.test(payload) || /(?:^|[\s;；])\d{1,3}(?:[,，]\d{3}){2,}(?:\.\d+)?(?:$|[\s;；])/.test(payload)) {
        throw new Error(`第${index + 1}行报价分隔有歧义，请去掉千位分隔符，并用分号或空格分隔报价`);
      }
      const tokens = payload.split(/[，,;；\s]+/).filter(Boolean);
      if (tokens.length === 0) throw new Error(`第${index + 1}行没有报价`);
      const prices = tokens.map(token => {
        if (!/^\d+(?:\.\d+)?$/.test(token) || !(Number(token) > 0)) {
          throw new Error(`第${index + 1}行含无效报价“${token}”；请使用正数且不要加千位分隔符`);
        }
        return Number(token);
      });
      return {
        name: rawName || `情景${index + 1}（共${prices.length + 1}家）`,
        bidders: prices.map((price, bidderIndex) => ({
          name: `其他样本${bidderIndex + 1}`,
          price,
        })),
      };
    });
  }

  /**
   * 多情景价格优化：只改变目标报价，其他报价样本由用户按情景独立给定。
   * 排序目标依次为：价格排名第一情景占比、最低价格分、平均价格分、较高报价。
   */
  function optimizePriceAcrossScenarios(myBidderId, scenarios, config, searchRange) {
    const minPrice = Math.max(Number(searchRange.minPrice), Number(searchRange.floorPrice ?? 0));
    const maxPrice = Number(searchRange.maxPrice);
    const step = Number(searchRange.step);
    if (![minPrice, maxPrice, step].every(Number.isFinite) || !(minPrice > 0) || !(maxPrice >= minPrice) || !(step > 0) || minPrice + step === minPrice) {
      throw new Error('搜索价格区间或步长无效');
    }

    if (!Array.isArray(scenarios)) {
      throw new Error('报价情景格式无效');
    }
    const normalizedScenarios = scenarios.map((scenario, scenarioIndex) => {
      const source = Array.isArray(scenario) ? scenario : scenario?.bidders;
      const name = Array.isArray(scenario) ? `情景${scenarioIndex + 1}` : (scenario?.name || `情景${scenarioIndex + 1}`);
      if (!Array.isArray(source) || source.length === 0) {
        throw new Error(`情景“${name}”至少需要一个其他报价样本`);
      }
      const bidders = source.map((bidder, bidderIndex) => {
        const sourceBidder = typeof bidder === 'number'
          ? { name: `其他样本${bidderIndex + 1}`, price: bidder }
          : { ...bidder };
        const price = Number(sourceBidder.price);
        if (!Number.isFinite(price) || !(price > 0)) {
          throw new Error(`情景“${name}”的第${bidderIndex + 1}个报价无效`);
        }
        return { ...sourceBidder, id: `s${scenarioIndex}-b${bidderIndex}`, price };
      });
      const weight = Number(scenario.weight ?? 1);
      if (!Number.isFinite(weight) || weight <= 0) throw new Error(`情景“${name}”权重必须大于0`);
      return { name, bidders, weight };
    });

    if (normalizedScenarios.length === 0) {
      throw new Error('至少需要一个包含其他报价样本的有效情景');
    }

    const candidatePrices = [];
    const estimatedCount = Math.ceil((maxPrice - minPrice) / step) + 1;
    if (estimatedCount > 200000) {
      throw new Error('搜索点超过200000个，请增大搜索步长');
    }
    for (let price = minPrice; price <= maxPrice + 1e-9; price += step) {
      const roundedPrice = round(Math.min(price, maxPrice), 6);
      if (candidatePrices[candidatePrices.length - 1] !== roundedPrice) {
        candidatePrices.push(roundedPrice);
      }
    }
    const roundedMax = round(maxPrice, 6);
    if (candidatePrices[candidatePrices.length - 1] < roundedMax) {
      candidatePrices.push(roundedMax);
    }
    const workUnits = candidatePrices.length * normalizedScenarios.reduce(
      (sum, scenario) => sum + scenario.bidders.length + 1,
      0
    );
    if (workUnits > 5000000) {
      throw new Error('测算规模过大，请增大搜索步长或减少情景数量');
    }

    const configErrors = validateConfig(config, [], true);
    if (configErrors.length) throw new Error(configErrors.join('；'));
    const strategy = PriceStrategies[config.priceStrategy];
    const priceFull = config.priceFull ?? 100;
    const params = config.strategyParams || {};
    const candidates = [];
    const objective = searchRange.objective || 'topRate';
    if (!['topRate', 'minScore', 'avgScore', 'threshold'].includes(objective)) throw new Error('搜索目标无效');
    const requiredScore = Number(searchRange.requiredScore ?? 0);
    if (!Number.isFinite(requiredScore) || requiredScore < 0 || requiredScore > priceFull) throw new Error('目标得分必须在0到价格满分之间');
    const totalWeight = normalizedScenarios.reduce((sum, s) => sum + s.weight, 0);
    const useTechnical = searchRange.specialMode === 'technical';
    if (useTechnical && (searchRange.targetTechScore == null || !Number.isFinite(Number(searchRange.targetTechScore)) || Number(searchRange.targetTechScore) < 0 || Number(searchRange.targetTechScore) > (config.techFull ?? 100) || normalizedScenarios.some(s => s.bidders.some(b => b.techScore == null || !Number.isFinite(Number(b.techScore)) || Number(b.techScore) < 0 || Number(b.techScore) > (config.techFull ?? 100))))) throw new Error('启用特殊满分条件时，请提供全部样本及目标的有效技术分');
    const searchParams = useTechnical ? params : { ...params, outlierSpecialFullScore: 0 };

    for (const price of candidatePrices) {
      const details = normalizedScenarios.map(scenario => {
        const allBidders = [
          { id: myBidderId, name: '目标方案', price, isMe: true, ...(useTechnical ? {techScore: Number(searchRange.targetTechScore)} : {}) },
          ...scenario.bidders.map(bidder => ({ ...bidder })),
        ];
        const result = strategy(allBidders, priceFull, searchParams);
        const me = result.find(bidder => bidder.id === myBidderId);
        const priceRank = 1 + result.filter(bidder => bidder.priceScore > me.priceScore + 1e-9).length;
        return {
          name: scenario.name,
          weight: scenario.weight,
          participantCount: result.filter(bidder => bidder.price > 0).length,
          priceScore: me.priceScore,
          priceRank,
          isTop: priceRank === 1,
          benchmark: me.benchmark ?? null,
          deviation: me.deviation ?? null,
          trimCount: me.trimCount ?? null,
          includedBidCount: me.includedBidCount ?? null,
          excludedHighBidCount: me.excludedHighBidCount ?? null,
          excludedHighBidderNames: me.excludedHighBidderNames ?? [],
          preliminaryAverage: me.preliminaryAverage ?? null,
          exclusionThreshold: me.exclusionThreshold ?? null,
          specialFullScore: me.specialFullScore ?? false,
        };
      });

      const scores = details.map(detail => detail.priceScore);
      const ranks = details.map(detail => detail.priceRank);
      candidates.push({
        price,
        topRate: round(details.filter(detail => detail.isTop).reduce((sum, d) => sum + d.weight, 0) / totalWeight * 100, 6),
        minScore: Math.min(...scores),
        avgScore: round(details.reduce((sum, d) => sum + d.priceScore * d.weight, 0) / totalWeight, 6),
        maxScore: Math.max(...scores),
        worstRank: Math.max(...ranks),
        avgRank: round(ranks.reduce((sum, rankValue) => sum + rankValue, 0) / ranks.length, 2),
        details,
      });
    }

    const compare = (left, right) =>
      left.topRate - right.topRate ||
      left.minScore - right.minScore ||
      left.avgScore - right.avgScore ||
      left.price - right.price;
    const objectiveCompare = (a, b) => objective === 'minScore' ? a.minScore - b.minScore || compare(a, b)
      : objective === 'avgScore' ? a.avgScore - b.avgScore || compare(a, b)
      : objective === 'threshold' ? a.price - b.price || compare(a, b) : compare(a, b);
    const eligible = candidates.filter(c => objective !== 'threshold' || c.minScore >= requiredScore);
    const best = eligible.reduce((currentBest, candidate) =>
      !currentBest || objectiveCompare(candidate, currentBest) > 0 ? candidate : currentBest, null);
    const ranges = [];
    let openRange = null;
    for (const c of candidates) {
      const qualifies = c.minScore >= requiredScore;
      if (qualifies) {
        if (!openRange) { openRange = {min: c.price, max: c.price}; ranges.push(openRange); }
        else openRange.max = c.price;
      } else openRange = null;
    }

    return {
      best,
      ranges,
      objective,
      step,
      specialMode: useTechnical ? 'technical' : 'priceOnly',
      candidates,
      scenarioCount: normalizedScenarios.length,
      participantCounts: [...new Set(normalizedScenarios.map(scenario => scenario.bidders.length + 1))].sort((a, b) => a - b),
    };
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
      const myBidder = { id: myBidderId, name: '目标方案', price };
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

  function describeRule(config) {
    const p = config.strategyParams || {}, full = config.priceFull ?? 100;
    const names = {lowestPrice:'最低价比例法',averagePrice:'平均价法',outlierFilteredBenchmark:'高价阈值剔除法',compositePrice:'复合基准价法',fixedBenchmark:'固定基准价法',trimmedAverage:'去高去低平均价法',tieredTrimmedBenchmark:'分档去高去低法',intervalScore:'区间得分法'};
    const s = config.priceStrategy;
    let formula = '';
    if(s==='lowestPrice')formula=`价格分 = ${full} × 最低有效报价 ÷ 本人报价`;
    if(s==='averagePrice')formula=`基准价为有效报价均值；基础分${p.avgBaseScore??80}；高于每1%扣${p.avgHighDeduct??1}，低于每1%加${p.avgLowAdd??1}；范围${p.avgMinScore??0}～${p.avgMaxScore??full}分`;
    if(s==='outlierFilteredBenchmark')formula=`初始均值×${p.outlierCutoffMultiple??1.5}及以上报价不纳入均价；其余均价×${p.outlierBenchmarkFactor??0.95}为基准价；偏差率先保留${p.outlierDeviationDecimals??2}位；高于每1%扣${p.outlierHighDeduct??0.8}，低于每1%扣${p.outlierLowDeduct??0.3}；范围${p.outlierMinScore??0}～${full}分；技术最高且报价最低特殊满分${p.outlierSpecialFullScore===0||p.outlierSpecialFullScore===false?'关闭':'启用'}`;
    if(s==='tieredTrimmedBenchmark')formula=`有效数大于${p.tierHighThreshold??10}两端各去${p.tierHighTrim??2}个；否则大于${p.tierMidThreshold??5}各去${p.tierMidTrim??1}个；其余全部纳入。均价×${p.benchmarkFactor??0.95}，基准价保留${p.benchmarkDecimals??6}位；基础分${p.tierBaseScore??35}，高于每1%扣${p.tierHighDeduct??0.5}、低于每1%加${p.tierLowAdd??0.5}；范围${p.tierMinScore??30}～${p.tierMaxScore??40}分`;
    if(s==='fixedBenchmark')formula=`基准价${p.benchmark??0}；高于每1%扣${p.deductHigh??0.5}、低于每1%扣${p.deductLow??0.3}`;
    if(s==='trimmedAverage')formula=`两端各去${p.trimCount??1}个后的均价为基准价；高于每1%扣${p.deductHigh??0.5}、低于每1%扣${p.deductLow??0.3}`;
    if(s==='compositePrice')formula=`基准价 = 最低价×${p.weightLow??0.5} + 均价×${p.weightAvg??0.5}；高于每1%扣${p.deductHigh??0.5}、低于每1%扣${p.deductLow??0.3}`;
    if(s==='intervalScore')formula=`基准价${p.benchmark??0}；下浮${p.lowerPct??3}%至上浮${p.upperPct??3}%为满分区间，超出每1%扣${p.deductOut??1}分`;
    return `${names[s]||'未选择规则'}：${formula}。价格得分保留两位小数，同分并列排名。`;
  }

  return {
    PriceStrategies,
    normalizePriceInput,
    summarizeBidValidity,
    validateStrategyConfig,
    validateComponentScoreConfig,
    validateConfig,
    evaluatePrice,
    describeRule,
    sortPriceResults,
    evaluate,
    findOptimalPrice,
    parsePriceScenarios,
    optimizePriceAcrossScenarios,
    sensitivityAnalysis,
    round,
    strategyNames: {
      lowestPrice:     '最低价法',
      averagePrice:    '平均价法',
      outlierFilteredBenchmark: '高价阈值剔除×系数平均价法',
      compositePrice:  '复合基准价法',
      fixedBenchmark:  '固定基准价法',
      trimmedAverage:  '去高去低平均价法',
      tieredTrimmedBenchmark: '分档去高去低×系数法',
      intervalScore:   '区间得分法',
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Scoring;
}
