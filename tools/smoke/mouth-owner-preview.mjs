import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const out=fileURLToPath(new URL('../evals/out/mouth-owner-preview/',import.meta.url));mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:900,height:760},deviceScaleFactor:1,reducedMotion:'reduce'});
await page.goto(process.argv[2],{waitUntil:'load'});await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.getElementById('state')?.textContent==='state: idle');await page.addStyleTag({content:'.intro,.outro{visibility:hidden}'});await page.evaluate(()=>window.__hologlyphEngine.setMotionFrozen(true));
const poses=[['open',{viseme_aa:1}],['teeth',{viseme_ee:1}],['tongue-out',{viseme_th:1,tongue_out:.7}],['tongue-up',{viseme_dd:1,tongue_up:.75}]];
for(const [name,weights] of poses){await page.evaluate((weights)=>{const e=window.__hologlyphEngine;for(const m of e.avatar.morphMeshes)m.morphTargetInfluences?.fill(0);for(const [k,v] of Object.entries(weights))e.avatar.setMorph(k,v);const c=e.sysRenderer.camera;c.position.set(0,.05,1.72);c.lookAt(0,0,0)},weights);await page.waitForTimeout(450);await page.locator('#holo').screenshot({path:`${out}${name}.png`});}
await browser.close();
