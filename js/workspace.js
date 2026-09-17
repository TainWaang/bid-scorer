/* Shared, versioned browser storage. Legacy data is retained as a recovery source. */
const Workspace = (() => {
  const KEY = 'bid-scorer-workspace-v2';
  const LEGACY = 'bid-scorer-desktop-state-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  function validateSnapshot(value, depth = 0) {
    if (depth > 1) throw new Error('方案嵌套层级无效');
    if (!value || typeof value !== 'object' || !value.config || !Array.isArray(value.bidders) || !Array.isArray(value.scenarios || [])) throw new Error('项目文件结构无效');
    if (!value.bidders.length || value.bidders.length > 1000 || (value.scenarios || []).length > 500) throw new Error('项目样本或方案数量超限');
    const data = clone(value);
    for (const key of ['businessWeight','priceWeight','techWeight','businessFull','priceFull','techFull']) {
      if (data.config[key] != null && !Number.isFinite(Number(data.config[key]))) throw new Error('规则数值无效：'+key);
      if (data.config[key] != null) data.config[key] = Number(data.config[key]);
    }
    if (!['lowestPrice','averagePrice','outlierFilteredBenchmark','compositePrice','fixedBenchmark','trimmedAverage','tieredTrimmedBenchmark','intervalScore'].includes(data.config.priceStrategy)) throw new Error('价格策略无效');
    data.config.strategyParams ||= {};
    for (const [key,v] of Object.entries(data.config.strategyParams)) {
      if (!Number.isFinite(Number(v)) || (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string')) throw new Error('规则参数无效：'+key);
      data.config.strategyParams[key] = Number(v);
    }
    const ids = new Set();
    data.bidders.forEach((b, index) => {
      if (!b || typeof b !== 'object') throw new Error('样本结构无效');
      b.id = typeof b.id === 'string' && /^[\w-]+$/.test(b.id) && !ids.has(b.id) ? b.id : 'import-' + index;
      while (ids.has(b.id)) b.id += '-copy';
      ids.add(b.id);
      b.name = String(b.name || `样本${index + 1}`).slice(0, 200);
      for (const key of ['price', 'businessScore', 'techScore']) {
        if (b[key] == null || b[key] === '') b[key] = 0;
        if (!Number.isFinite(Number(b[key]))) throw new Error(`“${b.name}”的${key}不是有效数字`);
        b[key] = Number(b[key]);
      }
    });
    if (data.bidders.filter(b => b.isMe).length !== 1) throw new Error('项目必须有且只有一个目标样本');
    data.scenarios = data.scenarios || [];
    data.scenarios = data.scenarios.map(s => {
      if (!s || typeof s !== 'object') throw new Error('方案结构无效');
      const clean = {name:String(s.name||'方案'),strategy:String(s.strategy||''),timestamp:String(s.timestamp||'')};
      for (const key of ['price','businessScore','techScore','priceScore','total']) {
        if (!Number.isFinite(Number(s[key]))) throw new Error('方案分数无效');
        clean[key] = Number(s[key]);
      }
      clean.rank = Number.isFinite(Number(s.rank)) ? Number(s.rank) : '-';
      if (s.snapshot) clean.snapshot = validateSnapshot(s.snapshot, depth + 1);
      return clean;
    });
    data.config.projectName = String(data.config.projectName || '未命名项目').slice(0, 200);
    return data;
  }

  function createStore(storage, defaults) {
    let db;
    let revision;
    function open() {
      const raw = storage.getItem(KEY);
      if (raw) {
        db = JSON.parse(raw);
        if (db.version !== 2 || !Array.isArray(db.projects) || !db.projects.some(p => p.id === db.activeId)) throw new Error('保存数据无法读取，请先导出备份后处理');
        revision = db.revision;
      } else {
        const legacy = storage.getItem(LEGACY);
        const data = legacy ? validateSnapshot(JSON.parse(legacy)) : clone(defaults);
        const projectId = id();
        db = {version: 2, revision: 0, activeId: projectId, projects: [{id: projectId, data, savedAt: null}], templates: []};
        revision = null;
      }
      return current();
    }
    function current() { return clone(db.projects.find(p => p.id === db.activeId).data); }
    function commit(next) {
      const raw = storage.getItem(KEY);
      const currentRevision = raw ? JSON.parse(raw).revision : null;
      if (currentRevision !== revision) throw new Error('另一页面已更新项目。请先导出当前内容，再重新加载，避免覆盖');
      next.revision = (revision || 0) + 1;
      storage.setItem(KEY, JSON.stringify(next)); // Keep memory unchanged if quota/write fails.
      db = next;
      revision = next.revision;
    }
    function save(data) {
      const next = clone(db);
      const p = next.projects.find(p => p.id === next.activeId);
      p.data = clone(data);
      p.savedAt = new Date().toISOString();
      commit(next);
      return p.savedAt;
    }
    function add(data) {
      const next = clone(db);
      const projectId = id();
      next.projects.push({id: projectId, data: validateSnapshot(data), savedAt: new Date().toISOString()});
      next.activeId = projectId;
      commit(next);
      return current();
    }
    function select(projectId) {
      const next = clone(db);
      if (!next.projects.some(p => p.id === projectId)) throw new Error('项目不存在');
      next.activeId = projectId;
      commit(next);
      return current();
    }
    function list() { return db.projects.map(p => ({id:p.id, name:p.data.config.projectName || '未命名项目', active:p.id === db.activeId})); }
    function saveTemplate(name, config) {
      const next = clone(db);
      next.templates ||= [];
      next.templates.push({id:id(),name:String(name).slice(0,200),config:clone(config)});
      commit(next);
    }
    return {open, current, save, add, select, list, saveTemplate, templates:()=>clone(db.templates || [])};
  }

  function exportProject(data) { return JSON.stringify({format:'bid-scorer-project',version:2,data:clone(data)}, null, 2); }
  function importProject(text) {
    if (text.length > 10 * 1024 * 1024) throw new Error('项目文件不能大于10MB');
    const envelope = JSON.parse(text);
    if (envelope.format !== 'bid-scorer-project' || envelope.version !== 2) throw new Error('不支持此项目文件版本');
    return validateSnapshot(envelope.data);
  }
  function parseTable(text) {
    const rows = text.trim().split(/\r?\n/).filter(line => line.trim());
    if (!rows.length || rows.length > 1000) throw new Error('请粘贴1到1000行数据');
    const price = text => {
      const value = String(text).trim();
      if (!/^(?:\d+(?:\.\d+)?|\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?)$/.test(value)) throw new Error('报价必须是正数，可使用规范千位分隔符');
      const n = Number(value.replace(/[,，]/g, ''));
      if (!Number.isFinite(n) || n <= 0) throw new Error('报价必须大于0');
      return n;
    };
    return rows.map((line,i) => {
      const fields = line.split('\t');
      if (i === 0 && /名称|样本/.test(fields[0]) && /报价/.test(fields[1] || '')) return null;
      if (fields.length < 2 || fields.length > 4 || !fields[0].trim()) throw new Error(`第${i+1}行需为：名称、报价、商务分、技术分（制表符分列）`);
      const b = {id:id(),name:fields[0].trim(),price:price(fields[1]),businessScore:0,techScore:0,isMe:false};
      ['businessScore','techScore'].forEach((key,j) => {
        const v = fields[j+2]?.trim();
        if (v) {
          if (!/^\d+(?:\.\d+)?$/.test(v) || !Number.isFinite(Number(v))) throw new Error(`第${i+1}行分数无效`);
          b[key] = Number(v);
        }
      });
      return b;
    }).filter(Boolean);
  }
  return {KEY, clone, id, createStore, exportProject, importProject, validateSnapshot, parseTable};
})();
if (typeof module !== 'undefined') module.exports = Workspace;
