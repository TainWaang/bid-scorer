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
    const normalized = String(value ?? '')
      .trim()
      .replace(/[,，\s¥￥]/g, '');
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
    const validBidders = normalizedBidders.filter(bidder => bidder.price > 0);
    const invalidBidders = normalizedBidders.filter(bidder => bidder.price <= 0);
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
    if (strategy !== 'outlierFilteredBenchmark') return [];
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

    const scoreBidders = strategyFiltersInvalidBids(config.priceStrategy)
      ? bidders.filter(bidder => normalizePriceInput(bidder.price) > 0)
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

  function strategyFiltersInvalidBids(strategy) {
    return strategy === 'tieredTrimmedBenchmark' || strategy === 'outlierFilteredBenchmark';
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
        const score = deviation > 0
          ? Math.max(minScore, baseScore - deviation * highDeduct)
          : Math.min(maxScore, baseScore + Math.abs(deviation) * lowAdd);
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
    return sorted.map((b, i) => ({ ...b, rank: i + 1 }));
  }

  /**
   * 完整评分流程
   */
  function evaluate(bidders, config) {
    const componentErrors = validateComponentScoreConfig(config, bidders);
    if (componentErrors.length > 0) throw new Error(componentErrors.join('；'));
    const strategy = config.priceStrategy;
    const params   = config.strategyParams || {};
    const priceFull = config.priceFull ?? 100;
    const { normalizedBidders } = summarizeBidValidity(bidders);
    const eligibleBidders = strategyFiltersInvalidBids(strategy)
      ? normalizedBidders.filter(b => b.price > 0)
      : normalizedBidders;

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
    const minPrice = Number(searchRange.minPrice);
    const maxPrice = Number(searchRange.maxPrice);
    const step = Number(searchRange.step);
    if (!(minPrice > 0) || !(maxPrice >= minPrice) || !(step > 0)) {
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
      return { name, bidders };
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

    const strategy = PriceStrategies[config.priceStrategy] || PriceStrategies.lowestPrice;
    const priceFull = config.priceFull ?? 100;
    const params = config.strategyParams || {};
    const candidates = [];

    for (const price of candidatePrices) {
      const details = normalizedScenarios.map(scenario => {
        const allBidders = [
          { id: myBidderId, name: '目标方案', price, isMe: true },
          ...scenario.bidders.map(bidder => ({ ...bidder })),
        ];
        const result = strategy(allBidders, priceFull, params);
        const me = result.find(bidder => bidder.id === myBidderId);
        const priceRank = 1 + result.filter(bidder => bidder.priceScore > me.priceScore + 1e-9).length;
        return {
          name: scenario.name,
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
        topRate: round(details.filter(detail => detail.isTop).length / details.length * 100, 2),
        minScore: Math.min(...scores),
        avgScore: round(scores.reduce((sum, score) => sum + score, 0) / scores.length, 4),
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
    const best = candidates.reduce((currentBest, candidate) =>
      !currentBest || compare(candidate, currentBest) > 0 ? candidate : currentBest, null);

    return {
      best,
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

  return {
    PriceStrategies,
    normalizePriceInput,
    summarizeBidValidity,
    validateStrategyConfig,
    validateComponentScoreConfig,
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
