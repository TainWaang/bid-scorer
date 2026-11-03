async function openDesktopTools(page) {const d=page.locator('#desktop-project-tools');if(await d.count() && !await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
async function openDesktopSearch(page) {const d=page.locator('#desktop-search');if(await d.count() && !await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
// Responsive layout acceptance uses isolated storage and synthetic long names.
module.exports = async function({browser,base,checks,errors,dir}) {
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true,locale:'en-US'});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  const data={
    config:{projectName:'布局验收：数字化综合服务平台建设与运维一体化项目',businessWeight:10,priceWeight:35,techWeight:55,businessFull:10,priceFull:100,techFull:55,priceStrategy:'qualifiedMeanBenchmark',strategyParams:{meanBenchmarkFactor:.9,meanHighDeduct:.5,meanLowDeduct:.25}},
    bidders:[1250000,1160000,980000,1215000,1250000,1395000,1460000].map((price,i)=>({id:i===0?'my':'b'+i,name:i===1?'LongCompanyName'.repeat(12):'第'+i+'家用于验证长名称换行的信息技术与咨询服务有限公司',price,businessScore:8,techScore:50,isMe:i===0})),
    scenarios:[],search:{useTable:true,rows:[]},
  };
  data.search.rows=[{name:'基准情景：全部已知有效样本及长名称复验',weight:1,bidders:data.bidders.slice(1)},{name:'报价上浮情景：验证场景名称与排名的间距',weight:2,bidders:data.bidders.slice(1).map(b=>({...b,price:b.price*1.02}))}];
  const layouts=[];
  async function layout(selector,label) {
    const result=await page.locator(selector).evaluate(el=>{
      const visible=n=>n.getBoundingClientRect().width>0 && n.getBoundingClientRect().height>0;
      const overflow=[el,...el.querySelectorAll('.card,.ws-panel,.ws-scenario,.ws-controls,.bidder-name-row,.field-row,.form-row,.form-grid,.ws-param-grid,.rank-card,.scenario-card,.bidder-card,.opt-result')]
        .filter(n=>visible(n)&&n.scrollWidth>n.clientWidth+2).map(n=>({node:n.id||n.className,width:n.clientWidth,scroll:n.scrollWidth}));
      const overlaps=[];
      for(const group of el.querySelectorAll('.ws-row,.ws-actions,.form-grid,.field-row,.ws-param-grid,.sc-head,.sc-details,.rank-card-head,.rank-meta,.sens-row')) {
        const children=[...group.children].filter(visible).map(n=>n.getBoundingClientRect());
        for(let i=0;i<children.length;i++)for(let j=i+1;j<children.length;j++) {
          const a=children[i],b=children[j];
          if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)overlaps.push(group.className);
        }
      }
      const cells=[...el.querySelectorAll('th,td')].filter(n=>visible(n)&&n.scrollWidth>n.clientWidth+2).map(n=>n.textContent.slice(0,60));
      return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow,overlaps,cells};
    });
    layouts.push({label,...result});
    if(result.documentWidth>result.viewport+1 && dir) {
      fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(path.join(dir,'layout-overflow.json'),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('.ws-panel,.ws-panel details,.ws-scroll,.ws-row,.container,.tab-panel.active')].filter(el=>el.getBoundingClientRect().width).map(el=>({node:el.id||el.className||el.tagName,width:el.clientWidth,scroll:el.scrollWidth,minWidth:getComputedStyle(el).minWidth}))),null,2));
    }
    assert.ok(result.documentWidth<=result.viewport+1,`${label}: page expands beyond viewport`);
    assert.deepEqual(result.overflow,[],`${label}: a panel expands beyond its container`);
    assert.deepEqual(result.overlaps,[],`${label}: controls overlap`);
    assert.deepEqual(result.cells,[],`${label}: table content overlaps adjacent columns`);
  }
  async function scrollable(selector) {
    const node=page.locator(selector).first();
    const box=await node.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
    assert.ok(box.scroll>box.width+1,`${selector} should scroll in a narrow viewport`);
    await node.evaluate(el=>el.scrollLeft=el.scrollWidth);
    assert.ok(await node.evaluate(el=>el.scrollLeft>0));
    await node.evaluate(el=>el.scrollLeft=0);
  }
  async function capture(name,selector) {
    if(!dir)return;
    fs.mkdirSync(dir,{recursive:true});
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,name+'.png')});
  }
  async function search(mobile=false) {
    if(!mobile)await openDesktopSearch(page);
    for(const [id,value] of [['min','1200000'],['max','1300000'],['step','10000']])await page.locator('#'+(mobile?'m-opt-':'opt-')+id).fill(value);
    await page.getByRole('button',{name:'搜索最优报价',exact:true}).click();
    await page.locator('#ws-search-status').filter({hasText:'测算完成'}).waitFor();
    if(!mobile){await page.locator('#desktop-search-details').evaluate(el=>el.open=true);await page.locator('#sensitivity-card').evaluate(el=>el.open=true);}
  }
  try {
    await page.goto(base);
    await page.evaluate(data=>localStorage.setItem('bid-scorer-workspace-v2',JSON.stringify({version:2,revision:1,activeId:'layout',projects:[{id:'layout',data}],templates:[]})),data);
    await page.reload();
    await page.locator('[data-tab=tab-scenario]').click();
    await page.locator('#scenario-name').fill('方案：超长名称验证方案保存、对比及快照恢复的排版间距');
    await page.locator('#scenario-my-price').fill('1250000');
    await page.locator('#scenario-my-biz').fill('8');await page.locator('#scenario-my-tech').fill('50');
    await page.locator('#btn-save-scenario').click();
    // Historical timestamps keep their original locale when a project is reopened.
    await page.evaluate(()=>{
      const key='bid-scorer-workspace-v2',db=JSON.parse(localStorage.getItem(key));
      const current=db.projects.find(p=>p.id===db.activeId).data;
      current.scenarios.push({...current.scenarios[0],name:'中文时间格式的历史方案',timestamp:'2026/11/02 23:59:59'});
      localStorage.setItem(key,JSON.stringify(db));
    });
    await page.reload();
    for(const width of [1365,1024,768,390]) {
      await page.setViewportSize({width,height:1000});
      await page.locator('[data-tab=tab-config]').click();
      await page.locator('.desktop-workspace details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
      await page.locator('#ws-paste').fill('批量预览的长名称测试样本\t1234567\t8\t50');await page.locator('#ws-preview').click();
      await layout('#tab-config','desktop config '+width);
      await layout('.desktop-workspace','desktop project tools '+width);
      if(width===390)await scrollable('#ws-preview-result .ws-scroll');
      if(width===1365||width===390)await capture('layout-desktop-'+width+'-config','#strategy-params-container');
      await page.locator('[data-tab=tab-result]').click();
      assert.match(await page.locator('#result-table-body tr.my-row').innerText(),/94\.19/);
      assert.match(await page.locator('#result-table-body tr.my-row').innerText(),/32\.9665/);
      await layout('#tab-result','desktop results '+width);
      if(width<=768)await scrollable('#result-table-body >> xpath=ancestor::div[contains(@class,"table-wrap")]');
      if(width===1365)await capture('layout-desktop-result','#result-table-body');
      await page.locator('[data-tab=tab-scenario]').click();await layout('#tab-scenario','desktop scenarios '+width);
      if(width<=768)await scrollable('#scenario-table-wrap .table-wrap');
      if(width===768)await capture('layout-desktop-scenarios','#scenario-table-wrap');
      await page.locator('[data-tab=tab-optimize]').click();await page.locator('#btn-predict-calc').click();
      await page.locator('#ws-search details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await search();
      await layout('#tab-optimize','desktop prediction and search '+width);
      if(width===390)await scrollable('#optimize-result-box .table-wrap');
    }
    // Every strategy editor must fit, including long labels and multiline nodes.
    await page.locator('[data-tab=tab-config]').click();
    const strategies=await page.locator('#cfg-strategy option').evaluateAll(nodes=>nodes.map(n=>n.value));
    for(const width of [1024,390]) {
      await page.setViewportSize({width,height:1000});
      for(const strategy of strategies){await page.locator('#cfg-strategy').selectOption(strategy);await layout('#strategy-params-container','desktop '+strategy+' '+width);}
    }
    await page.locator('#cfg-strategy').selectOption('qualifiedMeanBenchmark');
    checks.push('responsive desktop pages and all strategy editors: long names, no overflow/overlap, local table scrolling');

    const savedWorkspace=await page.evaluate(()=>localStorage.getItem('bid-scorer-workspace-v2'));
    await page.evaluate(raw=>{
      const db=JSON.parse(raw),current=db.projects.find(p=>p.id===db.activeId).data;
      current.config.priceStrategy='lowestPrice';current.config.strategyParams={};
      current.bidders=current.bidders.slice(0,3).map(b=>({...b,price:100,businessScore:9,techScore:50}));
      localStorage.setItem('bid-scorer-workspace-v2',JSON.stringify(db));
    },savedWorkspace);
    await page.reload();
    for(const width of [1365,1024,390]) {
      await page.setViewportSize({width,height:1000});await page.locator('[data-tab=tab-result]').click();
      assert.equal(await page.locator('#result-table-body tr[data-scored]').count(),3);
      assert.match(await page.locator('#result-table-body tr').first().locator('td').first().innerText(),/1.*并列/);
      await layout('#tab-result','tied first place with trophy '+width);
      await page.locator('[data-tab=tab-optimize]').click();await page.locator('#btn-predict-calc').click();
      await layout('#predict-result-box','tied price first place with trophy '+width);
    }
    await page.evaluate(raw=>localStorage.setItem('bid-scorer-workspace-v2',raw),savedWorkspace);await page.reload();
    checks.push('tied first place and trophy remain within both ranking tables at desktop and narrow widths');

    const waiting=page.waitForEvent('download');await openDesktopTools(page);await page.locator('#ws-report').click();
    const html=fs.readFileSync(await (await waiting).path(),'utf8'),report=await context.newPage();
    report.on('pageerror',e=>errors.push(e.message));await report.setContent(html);
    assert.match(await report.locator('table').innerText(),/32\.9665/);
    for(const width of [1365,768,390]) {
      await report.setViewportSize({width,height:1000});
      assert.ok(await report.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      if(width===390){assert.ok(await report.locator('.report-table-wrap').evaluate(el=>el.scrollWidth>el.clientWidth));if(dir)await report.screenshot({path:path.join(dir,'layout-report-390.png')});}
    }
    await report.emulateMedia({media:'print'});await report.setViewportSize({width:1123,height:794});
    assert.ok(await report.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await report.locator('button').isVisible(),false);await report.close();
    checks.push('exported report fits narrow screens and print layout without changing scores');

    await page.goto(base+'/mobile.html');
    for(const width of [390,320,768]) {
      await page.setViewportSize({width,height:844});
      for(let idx=0;idx<5;idx++) {
        await page.locator('.nav-item').nth(idx).click();
        await page.waitForFunction(idx=>Math.abs(document.getElementById('page-'+idx).getBoundingClientRect().left)<2,idx);
        await page.locator('#page-'+idx+' details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
        if(idx===3)await search(true);
        await layout('#page-'+idx,'mobile page '+idx+' '+width);
        if(idx===2){assert.match(await page.locator('.my-summary').innerText(),/94\.19/);assert.match(await page.locator('.my-summary').innerText(),/32\.9665/);}
        if(idx===3)assert.ok(await page.locator('.sens-bar-wrap').first().evaluate(el=>el.clientWidth>=80),'sensitivity bar must retain usable width');
        if(width===320&&idx===2)await capture('layout-mobile-rank','.rank-card');
        if(width===320&&idx===3)await capture('layout-mobile-sensitivity','#sens-list');
        if(width===390&&idx===4)await capture('layout-mobile-scenarios','#scenario-list');
      }
    }
    await page.locator('.nav-item').first().click();
    for(const width of [768,320]) {
      await page.setViewportSize({width,height:844});
      for(const strategy of strategies){await page.locator('#m-strategy').selectOption(strategy);await layout('#m-strat-params','mobile '+strategy+' '+width);}
    }
    checks.push('all five mobile pages and strategy editors fit 320/390/768 widths with readable result and sensitivity grids');
    if(dir)fs.writeFileSync(path.join(dir,'layout-checks.json'),JSON.stringify(layouts,null,2));
  } finally {await context.close();}
};
