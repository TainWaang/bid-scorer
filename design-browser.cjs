async function openDesktopTools(page) {const d=page.locator('#desktop-project-tools');if(await d.count() && !await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
async function openDesktopSearch(page) {const d=page.locator('#desktop-search');if(await d.count() && !await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
async function openPresets(page) {const d=page.locator('#tab-config details:has(.preset-actions)');if(await d.count() && !await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
// Design regression cases use an isolated browser context and synthetic project data only.
module.exports = async function({browser,base,checks,errors,dir}) {
  const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
  const context=await browser.newContext({viewport:{width:1365,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',d=>d.accept());
  const fixture=()=>({
    config:{projectName:'口径验收',businessWeight:10,priceWeight:35,techWeight:55,businessFull:10,priceFull:100,techFull:55,priceStrategy:'qualifiedMeanBenchmark',strategyParams:{meanBenchmarkFactor:.9,meanHighDeduct:.5,meanLowDeduct:.25}},
    bidders:[1250000,1160000,980000,1215000,1250000,1395000,1460000].map((price,i)=>({id:i===0?'my':`b${i}`,name:`测试样本${i}`,price,businessScore:0,techScore:0,isMe:i===0})),scenarios:[],search:{},
  });
  const install=async data=>{
    await page.evaluate(data=>localStorage.setItem('bid-scorer-workspace-v2',JSON.stringify({version:2,revision:1,activeId:'test',projects:[{id:'test',data}],templates:[]})),data);
    await page.reload();
  };
  try {
    await page.goto(base);
    const saved=fixture();saved.config.priceStrategy='outlierFilteredBenchmark';saved.config.priceFull=60;saved.config.strategyParams={outlierFullScore:46,outlierSpecialFullScore:0};
    await install(saved);
    assert.equal(await page.locator('#cfg-price-full').inputValue(),'60');
    await page.locator('#cfg-strategy').selectOption('tieredTrimmedBenchmark');
    await page.locator('#cfg-price-full').fill('60');
    await page.locator('#sp-tierMaxScore').fill('40');
    assert.equal(await page.locator('#cfg-price-full').inputValue(),'60');
    await page.reload();assert.equal(await page.locator('#cfg-price-full').inputValue(),'60');
    await page.goto(base+'/mobile.html');await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#m-pf').inputValue(),'60');
    await page.locator('#m-bf').fill('10');
    assert.equal(await page.locator('[data-key=tierMaxScore]').inputValue(),'40');
    await page.reload();assert.equal(await page.locator('#m-pf').inputValue(),'60');
    checks.push('custom formula full and tier cap survive desktop/mobile reload');

    await page.goto(base);await page.setViewportSize({width:1365,height:1000});
    await openDesktopTools(page);await page.getByText('批量录入与参与状态',{exact:true}).click();
    await page.locator('#ws-paste').fill('上一项目预览\t999\t1\t1');await page.locator('#ws-preview').click();
    assert.equal(await page.locator('#ws-append').isEnabled(),true);
    await page.locator('[data-tab=tab-scenario]').click();await page.locator('#scenario-my-price').fill('999');
    await page.locator('[data-tab=tab-config]').click();await openDesktopTools(page);await page.locator('#ws-new').click();
    assert.equal(await page.locator('#scenario-my-price').inputValue(),'');
    assert.equal(await page.locator('#ws-append').isDisabled(),true);
    assert.equal(await page.locator('#ws-paste').inputValue(),'');
    assert.equal(await page.locator('#ws-preview-result').innerText(),'');
    await openPresets(page);await page.getByRole('button',{name:'价格权重较高',exact:true}).click();
    assert.equal(await page.locator('#sp-deductHigh').inputValue(),'1');
    assert.equal(await page.locator('#sp-deductLow').inputValue(),'0.5');
    await page.goto(base+'/mobile.html');await page.setViewportSize({width:390,height:844});
    await page.locator('[data-key=deductHigh]').fill('9');
    await openPresets(page);await page.getByRole('button',{name:'价格权重较高',exact:true}).click();
    assert.equal(await page.locator('[data-key=deductHigh]').inputValue(),'1');
    assert.equal(await page.locator('[data-key=deductLow]').inputValue(),'0.5');
    await page.locator('.nav-item').nth(4).click();await page.locator('#m-scenario-name').fill('上一项目方案名');
    await page.locator('.nav-item').first().click();await openDesktopTools(page);await page.locator('#ws-new').click();
    assert.equal(await page.locator('#m-scenario-name').inputValue(),'');
    checks.push('project switch clears scenario draft and presets agree across layouts');

    await page.goto(base);await page.setViewportSize({width:1365,height:1000});
    const precise=fixture();precise.config.priceStrategy='lowestPrice';precise.bidders=precise.bidders.slice(0,3);precise.bidders[0].price=100.123456;
    await install(precise);
    await page.locator('[data-tab=tab-optimize]').click();
    assert.equal(Number((await page.locator('.predict-price-input[data-id=\"my\"]').inputValue()).replaceAll(',','')),100.123456);
    await page.locator('#btn-predict-calc').click();
    const exportData=async()=>{await page.locator('[data-tab=tab-config]').click();const waiting=page.waitForEvent('download');await openDesktopTools(page);await page.locator('#ws-export').click();const data=JSON.parse(fs.readFileSync(await (await waiting).path(),'utf8')).data;await page.locator('[data-tab=tab-optimize]').click();return data;};
    assert.equal((await exportData()).bidders[0].price,100.123456);
    await page.locator('.predict-price-input[data-id=\"my\"]').fill('broken');
    await page.reload();await page.locator('[data-tab=tab-optimize]').click();
    assert.equal(await page.locator('.predict-price-input[data-id=\"my\"]').inputValue(),'broken');
    await page.locator('.predict-price-input[data-id=\"my\"]').fill('100.123456');await page.locator('#btn-predict-calc').click();
    await page.locator('.predict-price-input[data-id=\"my\"]').fill('101');
    assert.equal(await page.locator('#predict-result-box .ws-stale-note').count(),1);
    await page.getByRole('button',{name:'按假设报价排序'}).click();
    assert.equal(await page.locator('#predict-result-box .ws-stale-note').count(),1);
    await page.locator('#btn-predict-calc').click();
    assert.equal(await page.locator('#predict-result-box .ws-stale-note').count(),0);
    checks.push('price precision and invalid input survive reload; sorting retains stale notice');

    await page.locator('[data-tab=tab-config]').click();await install(fixture());
    await page.locator('#cfg-price-full').fill('35');
    assert.match(await page.locator('#price-scale-note').innerText(),/100/);
    assert.equal(await page.locator('#cfg-price-full').inputValue(),'35');
    await page.locator('#cfg-price-full').fill('100');
    await page.locator('[data-tab=tab-result]').click();
    const target=page.locator('#result-table-body tr.my-row');
    assert.match(await target.innerText(),/94\.19/);assert.match(await target.innerText(),/32\.9665/);
    await page.locator('[data-tab=tab-optimize]').click();await page.locator('#btn-predict-calc').click();
    assert.match(await page.locator('#predict-result-box tr.my-row').innerText(),/32\.9665/);
    await openDesktopSearch(page);await page.locator('#opt-min').fill('1250000');await page.locator('#opt-max').fill('1250000');await page.locator('#opt-step').fill('1');
    await page.locator('#btn-search-optimal').click();await page.locator('#ws-search-status').filter({hasText:'测算完成'}).waitFor();
    assert.match(await page.locator('#optimize-result-box').innerText(),/32\.9665/);
    await page.locator('[data-tab=tab-config]').click();
    const waiting=page.waitForEvent('download');await openDesktopTools(page);await page.locator('#ws-report').click();const report=fs.readFileSync(await (await waiting).path(),'utf8');
    assert.match(report,/价格原始分/);assert.match(report,/32\.9665/);
    if(dir){fs.mkdirSync(dir,{recursive:true});await page.screenshot({path:path.join(dir,'design-desktop-config.png')});await page.locator('[data-tab=tab-result]').click();await page.locator('#result-summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(dir,'design-desktop-result.png')});}
    await page.goto(base+'/mobile.html');await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#m-pf').inputValue(),'100');
    assert.match(await page.locator('#m-price-scale-note').innerText(),/35/);
    await page.getByRole('button',{name:'立即计算',exact:true}).click();
    assert.match(await page.locator('.my-summary').innerText(),/94\.19/);assert.match(await page.locator('.my-summary').innerText(),/32\.9665/);
    if(dir){await page.waitForFunction(()=>Math.abs(document.getElementById('page-2').getBoundingClientRect().left)<2);await page.screenshot({path:path.join(dir,'design-mobile-result.png')});}
    checks.push('100-point tender and 35-point contribution match both pages, Worker and report');

    const damaged=JSON.stringify({version:2,revision:1,activeId:'bad',projects:[{id:'bad',data:{...fixture(),search:{rows:[{}]}}}],templates:[]});
    await page.evaluate(raw=>localStorage.setItem('bid-scorer-workspace-v2',raw),damaged);await page.goto(base);
    assert.match(await page.locator('#ws-status').innerText(),/搜索|情景/);
    const recovery=page.waitForEvent('download');await openDesktopTools(page);await page.locator('#ws-export-recovery').click();
    assert.equal(fs.readFileSync(await (await recovery).path(),'utf8'),damaged);
    checks.push('malformed saved search shows recovery and preserves original storage');
  } finally {await context.close();}
};
