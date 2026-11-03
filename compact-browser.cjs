// Compact desktop acceptance: real inputs, stable sample identity and bounded page height.
module.exports = async function({browser,base,checks,errors,dir}) {
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});
  const page=await context.newPage(),dialogs=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>{dialogs.push(d.message());return d.accept();});
  const fixture={config:{projectName:'紧凑布局验收',businessWeight:10,priceWeight:35,techWeight:55,businessFull:10,priceFull:100,techFull:55,priceStrategy:'qualifiedMeanBenchmark',strategyParams:{meanBenchmarkFactor:.9,meanHighDeduct:.5,meanLowDeduct:.25}},bidders:[1250000,1160000,980000,1215000,1250000,1395000,1460000].map((price,i)=>({id:i===0?'my':'b'+i,name:'验收样本'+i,price,businessScore:8,techScore:50,isMe:i===0})),scenarios:[],search:{}};
  const heights=[];
  const explanationAlignment=[];
  async function checkExplanationAlignment(tab,width) {
    const selector=tab==='tab-optimize'?'#predict-result-box .compact-explanations':'#result-explanations';
    const entries=await page.locator(selector).evaluate(el=>[...el.querySelectorAll(':scope > details > summary')].map(summary=>{
      const range=document.createRange();range.selectNodeContents(summary);
      const rect=summary.getBoundingClientRect(),text=range.getClientRects()[0],style=getComputedStyle(summary);
      return {label:summary.textContent,top:rect.top,textTop:text.top,lineHeight:parseFloat(style.lineHeight),fontSize:style.fontSize,paddingTop:style.paddingTop,paddingBottom:style.paddingBottom};
    }));
    assert.equal(entries.length,2);
    explanationAlignment.push({tab,width,entries});
    if(dir){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'explanation-alignment.json'),JSON.stringify(explanationAlignment,null,2));}
    assert.equal(entries[0].fontSize,entries[1].fontSize,'disclosure summaries must use the same text size');
    assert.equal(entries[0].lineHeight,entries[1].lineHeight,'disclosure summaries must use the same line height');
    if(Math.abs(entries[0].top-entries[1].top)<1)assert.ok(Math.abs(entries[0].textTop-entries[1].textTop)<.5,'adjacent disclosure labels must share a text baseline');
  }
  const target=()=>page.locator('#predict-result-box tr.my-row');
  async function openWorkspace() {const drawer=page.locator('#desktop-project-tools');if(!await drawer.evaluate(el=>el.open))await drawer.locator(':scope > summary').click();}
  try {
    await page.goto(base);
    await page.evaluate(data=>localStorage.setItem('bid-scorer-workspace-v2',JSON.stringify({version:2,revision:1,activeId:'compact',projects:[{id:'compact',data}],templates:[]})),fixture);
    await page.reload();
    await page.locator('[data-tab=tab-optimize]').click();
    await target().locator('input').fill('1250000');
    assert.equal(await page.locator('#predict-result-box .ws-stale-note').count(),0,'inputs without a prior calculation must not claim there is an old result');
    await page.locator('#btn-predict-calc').click();
    assert.equal(await page.locator('#predict-result-box .predict-price-input').count(),7,'each price input must share its row with computed scores');
    assert.equal(await page.locator('#tab-optimize table:visible').count(),1,'one editable price table replaces duplicate input/result tables');
    assert.match(await target().innerText(),/94\.19/);assert.match(await target().innerText(),/32\.9665/);
    await page.getByRole('button',{name:'按假设报价排序',exact:true}).click();
    await target().locator('input').fill('1200000.123456');
    assert.match(await page.locator('#predict-result-box .ws-stale-note').innerText(),/旧结果/);
    await page.getByRole('button',{name:'按价格排名排序',exact:true}).click();
    assert.equal(await target().locator('input').inputValue(),'1200000.123456');
    assert.match(await target().innerText(),/94\.19/,'sorting must not recompute stale scores');
    await page.locator('#btn-predict-calc').click();
    assert.equal(await page.locator('#predict-result-box .ws-stale-note').count(),0);
    await target().locator('input').fill('broken');await page.locator('#btn-predict-calc').click();
    assert.equal(await target().locator('input').inputValue(),'broken','a rejected calculation must keep the input available to repair');
    await target().locator('input').fill('1250000');await page.locator('#btn-predict-calc').click();
    await page.locator('[data-tab=tab-result]').click();
    const totalTarget=page.locator('#result-table-body tr.my-row');
    assert.equal(await totalTarget.locator('input[type=text]').inputValue(),'1250000');
    assert.equal(await page.locator('#tab-result table:visible').count(),1);
    assert.match(await totalTarget.innerText(),/94\.19/);assert.match(await totalTarget.innerText(),/32\.9665/);
    await totalTarget.locator('input[type=number]').first().fill('9');
    assert.match(await page.locator('#result-area .ws-stale-note').innerText(),/旧结果/);
    await page.locator('#ws-result-sort').selectOption('priceDesc');
    assert.match(await page.locator('#result-area .ws-stale-note').innerText(),/旧结果/);
    await page.locator('#btn-calc-result').click();assert.match(await totalTarget.innerText(),/91\.9665/);
    checks.push('single editable scoring tables preserve precision, identity, validation recovery and stale snapshots across sorting');
    await page.getByRole('button',{name:'保存为方案 →',exact:true}).click();
    await page.locator('#scenario-name').fill('已保存方案展示');await page.locator('#btn-save-scenario').click();
    for(const width of [1366,1920,1024]) {
      await page.setViewportSize({width,height:768});
      for(const tab of ['tab-config','tab-optimize','tab-result','tab-scenario']) {
        await page.locator('[data-tab='+tab+']').click();
        if(tab==='tab-optimize')await page.locator('#btn-predict-calc').click();
        if(tab==='tab-result'||tab==='tab-optimize')await checkExplanationAlignment(tab,width);
        await page.evaluate(()=>scrollTo(0,0));
        const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}));
        heights.push({width,tab,...size});
        if(tab==='tab-result')assert.ok(await page.locator('#result-tools label').evaluateAll(labels=>labels.every(label=>label.getBoundingClientRect().height<=34)),'desktop sort and find labels should remain on one line beside their controls');
        if(tab==='tab-optimize')assert.ok(await page.locator('#predict-result-box tbody tr').evaluateAll(rows=>rows.every(row=>row.getBoundingClientRect().height<=50)),'regular price rows must remain compact');
        assert.ok(size.scroll<=width+1,tab+' must not expand the page');
        assert.ok(size.height<=1536,tab+' must fit within two desktop screens for seven samples: '+size.height);
        if(dir&&width===1366){fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'compact-'+tab+'.png'),fullPage:true});}
      }
    }
    for(const width of [768,390,320]) {
      await page.setViewportSize({width,height:768});
      for(const tab of ['tab-optimize','tab-result']){
        await page.locator('[data-tab='+tab+']').click();
        if(tab==='tab-optimize')await page.locator('#btn-predict-calc').click();
        await checkExplanationAlignment(tab,width);
      }
    }
    await page.setViewportSize({width:1366,height:768});
    await page.locator('[data-tab=tab-optimize]').click();
    assert.equal(await page.locator('#desktop-search').evaluate(el=>el.open),false);
    await page.locator('#desktop-search > summary').click();
    heights.push({width:1366,tab:'search-setup',height:await page.evaluate(()=>document.documentElement.scrollHeight)});
    for(const [id,value] of [['min','1200000'],['max','1300000'],['step','10000']])await page.locator('#opt-'+id).fill(value);
    await page.locator('#btn-search-optimal').click();await page.locator('#ws-search-status').filter({hasText:'测算完成'}).waitFor();
    assert.match(await page.locator('#optimize-result-box').innerText(),/优选报价/);
    heights.push({width:1366,tab:'search-results',height:await page.evaluate(()=>document.documentElement.scrollHeight)});
    if(dir)await page.screenshot({path:path.join(dir,'compact-search-results.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=1536),'search with summary results should fit within two desktop screens');
    await page.locator('#desktop-search-details > summary').click();
    assert.match(await page.locator('#desktop-search-details').innerText(),/计入综合分/);
    await page.locator('#sensitivity-card > summary').click();
    assert.equal(await page.locator('#sensitivity-tbody tr').count(),11);
    await page.locator('#desktop-search-details > summary').click();await page.locator('#sensitivity-card > summary').click();
    await page.locator('#desktop-search > summary').click();
    await page.locator('[data-tab=tab-result]').click();await page.getByRole('button',{name:'保存为方案 →',exact:true}).click();
    await page.locator('#scenario-name').fill('紧凑表格方案');await page.locator('#btn-save-scenario').click();
    assert.match(await page.locator('#scenario-table-wrap').innerText(),/紧凑表格方案/);
    await openWorkspace();await page.locator('#ws-new').click();
    await page.locator('#desktop-project-tools > summary').click();
    await page.locator('[data-tab=tab-optimize]').click();
    assert.equal(await page.locator('#predict-result-box input').count(),1);
    assert.equal(await target().locator('input').inputValue(),'');
    assert.doesNotMatch(await page.locator('#predict-result-box').innerText(),/94\.19|32\.9665/,'new project must not inherit prior scores');
    checks.push('compact search and scenario actions remain usable; switching projects resets scoring snapshots');
    if(dir)fs.writeFileSync(path.join(dir,'compact-heights.json'),JSON.stringify(heights,null,2));
  } finally {await context.close();}
};
