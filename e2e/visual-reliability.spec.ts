import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

const routes=['/','/why','/marketplace','/registry','/taskboard','/work','/observe','/docs','/proof','/auth/login','/auth/register','/auth/forgot-password']

for(const width of [1440,1024,768,390,320])test(`public typography and layout stay reliable with external fonts unavailable at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000})
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort())
  const failedFonts:string[]=[]
  page.on('requestfailed',request=>{if(request.resourceType()==='font')failedFonts.push(request.url())})
  for(const route of routes){
    await page.goto(route,{waitUntil:'load'})
    await page.evaluate(()=>document.fonts.ready)
    await expect(page.locator('main')).toBeVisible()
    const actual=await page.evaluate(()=>({
      fonts:[...document.fonts].filter(face=>face.status==='loaded').map(face=>face.family.replaceAll('"','').replaceAll("'",'')),
      fontUrls:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('.woff2')).map(entry=>entry.name),
      overflow:document.documentElement.scrollWidth-innerWidth,
      controls:[...document.querySelectorAll('main input:not([type="checkbox"]):not([type="radio"]),main select,main textarea')].filter(element=>element.getBoundingClientRect().width>0).map(element=>parseFloat(getComputedStyle(element).fontSize)),
      smallText:[...document.querySelectorAll('main *')].filter(element=>{
        const bounds=element.getBoundingClientRect(),style=getComputedStyle(element)
        const text=[...element.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('')
        return bounds.width>0&&bounds.height>0&&style.visibility!=='hidden'&&/[a-z]{2}/i.test(text)&&parseFloat(style.fontSize)<12
      }).map(element=>element.textContent?.trim().slice(0,50)),
      heading:document.querySelector('main h1')?.getBoundingClientRect().top,
      header:document.querySelector('header')?.getBoundingClientRect().bottom,
      filledControls:[...document.querySelectorAll('main button,main a')].filter(element=>element.getBoundingClientRect().width>0&&getComputedStyle(element).backgroundColor==='rgb(255, 92, 53)').map(element=>({text:element.textContent,color:getComputedStyle(element).color})),
      selectedFilterWidths:location.pathname==='/marketplace'?[...document.querySelectorAll('main select')].filter(element=>element.getBoundingClientRect().width>0).map(element=>{
        const select=element as HTMLSelectElement,canvas=document.createElement('canvas'),context=canvas.getContext('2d')!
        context.font=getComputedStyle(select).font
        return {text:select.selectedOptions[0]?.text,textWidth:context.measureText(select.selectedOptions[0]?.text||'').width,width:select.clientWidth}
      }):[],
    }))
    for(const family of ['Plus Jakarta Sans','Space Grotesk','JetBrains Mono'])expect.soft(actual.fonts,`${route}: ${family} must actually load`).toContain(family)
    expect.soft(actual.fontUrls.length,`${route}: bundled fonts must be requested`).toBeGreaterThanOrEqual(3)
    for(const url of actual.fontUrls)expect.soft(new URL(url).origin).toBe(new URL(page.url()).origin)
    expect.soft(failedFonts,`${route}: font resources must succeed`).toEqual([])
    expect.soft(actual.overflow,`${route}: page must fit ${width}px`).toBeLessThanOrEqual(1)
    expect.soft(actual.smallText,`${route}: status and explanatory text must be readable`).toEqual([])
    if(actual.heading!==undefined&&actual.header!==undefined)expect.soft(actual.heading,`${route}: fixed navigation must not cover the heading`).toBeGreaterThanOrEqual(actual.header)
    if(width<720)for(const size of actual.controls)expect.soft(size,`${route}: mobile fields should avoid browser zoom`).toBeGreaterThanOrEqual(16)
    if(width<=390)for(const selected of actual.selectedFilterWidths)expect.soft(selected.width,`${route}: selected filter ${selected.text} must fit without truncation`).toBeGreaterThanOrEqual(selected.textWidth+20)
    for(const control of actual.filledControls)expect.soft(control.color,`${route}: ${control.text} needs readable text on the signal background`).toBe('rgb(8, 10, 9)')
    if(['/','/marketplace','/docs','/auth/login','/auth/register'].includes(route))await testInfo.attach(`${route.replaceAll('/','-')||'home'}-${width}`,{body:await page.screenshot(),contentType:'image/png'})
  }
})

test('shared navigation preserves visible keyboard focus and reduced-motion layout',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/')
  await page.keyboard.press('Tab')
  const focus=await page.evaluate(()=>({width:getComputedStyle(document.activeElement!).outlineWidth,style:getComputedStyle(document.activeElement!).outlineStyle,scroll:getComputedStyle(document.documentElement).scrollBehavior}))
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2)
  expect(focus.style).toBe('solid')
  expect(focus.scroll).toBe('auto')
})

for(const width of [390,320])test(`mobile navigation stays readable and within the viewport at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000})
  await page.goto('/')
  const menu=page.getByRole('button',{name:'Open navigation'})
  await expect(menu).toBeVisible()
  const bounds=await menu.boundingBox()
  expect(bounds!.width).toBeGreaterThanOrEqual(44)
  expect(bounds!.height).toBeGreaterThanOrEqual(44)
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width-16)
  await menu.click()
  await expect(page.getByRole('button',{name:'Close navigation'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1)
  await page.getByRole('button',{name:'Close navigation'}).click()
  await expect(menu).toBeVisible()
  await page.route('**/api/auth/me',route=>route.fulfill({status:200,json:{authenticated:true,user:{id:'visual-buyer',role:'human',name:'Visual buyer'}}}))
  await page.reload()
  await expect(page.getByRole('link',{name:'Dashboard',exact:true})).toBeVisible()
  const signedInBounds=await menu.boundingBox()
  expect(signedInBounds!.x+signedInBounds!.width).toBeLessThanOrEqual(width-16)
})

test('login fields retain a visible keyboard focus indicator',async({page})=>{
  await page.goto('/auth/login')
  const field=page.locator('input[type="email"]')
  await field.focus()
  const outline=await field.evaluate(element=>getComputedStyle(element).outlineWidth)
  expect(parseFloat(outline)).toBeGreaterThanOrEqual(2)
})
