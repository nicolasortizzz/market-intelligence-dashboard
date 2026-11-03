/* Tesis / Decisión: asistente de COMPRA paso a paso (conclusión tesina Ortiz Armesto: Ciclo → DCF → Markowitz sirve para comprar, no para vender).
   Static; nunca inventa valores: si falta un dato muestra "sin DCF / no verificado". */
const FV_BAND=-0.10;          // "cerca del fair value": upside ≥ −10% (cerca o debajo del valor intrínseco)
const ADD_W=0.05;             // peso hipotético de la nueva posición para medir el fit
const FIT={good:{corr:0.35,sector:25},bad:{corr:0.6,sector:35}}; // bueno si ρ̄<0,35 y sector<25%; malo si ρ̄>0,6 o sector>35%
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
const PHL={reflacion:"Reflación",recuperacion:"Recuperación",sobrecalentamiento:"Sobrecalentamiento",estanflacion:"Estanflación"};
const ARW={up:"↑",down:"↓",flat:"→"};
const pc=v=>v==null?"–":(v>0?"+":"")+(v*100).toFixed(1)+"%",mo=v=>v==null?"–":v.toLocaleString("en-US",{maximumFractionDigits:2});
const TS=()=>{const T=S.T||(S.T={});if(T.step==null){T.step=0;T.max=0;T.hz={now:true,y1:false,y2:false};T.sel=null}return T};
function secOf(t){const C=S.clock||{};return C.tickerSector?.[t]||S.m.companies.find(c=>c.ticker===t)?.sector||null}
function bymaOf(t){const B=S.byma;if(!B)return null;const code=B.alias?.[t]||t;if(B.cedears?.[code])return{code,kind:"CEDEAR",ratio:B.cedears[code].ratio};if(B.local?.[t])return{code:t,kind:"Acción local",ratio:null};return null}
function horizons(){const M=S.mclock||{},C=S.clock||{},sm=p=>C.sectorMap?.[p]||{favored:[],avoided:[]};
  const now=M.now||{phase:C.phase,phaseLabel:C.phaseLabel};
  return{now:{k:"now",lbl:"Hoy",phase:now.phase,favored:sm(now.phase).favored,avoided:sm(now.phase).avoided,note:sm(now.phase).note},
    y1:{k:"y1",lbl:`Año+1 (${M.forecasts?.y1?.year??"?"})`,...(M.forecasts?.y1||{})},
    y2:{k:"y2",lbl:`Año+2 (${M.forecasts?.y2?.year??"?"})`,...(M.forecasts?.y2||{})}}}
function favSet(){const H=horizons(),T=TS(),s=new Map();["now","y1","y2"].forEach(k=>T.hz[k]&&(H[k].favored||[]).forEach(x=>{s.has(x)||s.set(x,[]);s.get(x).push(H[k].lbl)}));return s}
function candidates(){const vs=S.vsum?.companies||{},fav=favSet(),out=[],nv=[];
  const tick=new Set([...Object.keys(S.clock?.tickerSector||{}),...Object.keys(vs)]);
  tick.forEach(t=>{const sec=secOf(t);if(!fav.has(sec))return;const b=bymaOf(t);if(!b)return;const c=vs[t];
    if(!c||typeof c.upside!=="number"){nv.push({t,sec,b,name:c?.name||""});return}
    if(c.upside>=FV_BAND)out.push({t,name:c.name,sec,b,price:c.price,pDate:c.priceDate,fair:c.triangulated??c.base,up:c.upside,model:c.model,hz:fav.get(sec),inPx:S.m.corr.tickers.includes(t)})});
  return{rows:out.sort((a,b)=>b.up-a.up),nv}}
function fitOf(t){const H=S.hold?.holdings||[],T=S.m.corr.tickers,i=T.indexOf(t),tot=H.reduce((a,h)=>a+h.weightPct,0)||100;
  let cs=0,cw=0;if(i>=0)H.forEach(h=>{const j=T.indexOf(h.ticker);if(j>=0&&h.ticker!==t){cs+=h.weightPct*S.m.corr.m[i][j];cw+=h.weightPct}});
  const rho=cw?cs/cw:null,sec=secOf(t),held=H.find(h=>h.ticker===t);
  const secNow=H.filter(h=>secOf(h.ticker)===sec).reduce((a,h)=>a+h.weightPct,0)/tot*100;
  const secAfter=(secNow/100*(1-ADD_W)+ADD_W)*100;
  let dSh=null;try{const hw=H.filter(h=>T.includes(h.ticker));if(i>=0&&hw.length&&typeof stats==="function"){const tk0=hw.map(h=>h.ticker),w0=hw.map(h=>h.weightPct),s0=w0.reduce((a,b)=>a+b,0);
    const base=stats(tk0,w0.map(w=>w/s0));const tk1=tk0.includes(t)?tk0:[...tk0,t],w1=tk1.map(x=>(x===t?ADD_W:0)+(1-ADD_W)*((hw.find(h=>h.ticker===x)?.weightPct||0)/s0));dSh=stats(tk1,w1).sh-base.sh}}catch(e){}
  const lab=rho==null?"sin datos":(rho>FIT.bad.corr||secAfter>FIT.bad.sector)?"malo":(rho<FIT.good.corr&&secAfter<FIT.good.sector)?"bueno":"neutro";
  return{rho,sec,secNow,secAfter,dSh,lab,held}}
function smartOf(t){const E=S.smart?.tickers?.[t],d=S.smart?.default||"no verificado";
  const part=(x,l)=>{if(!x)return`<div><b>${l}:</b> <span class="muted">${esc(d)}</span></div>`;
    return`<div><b>${l}:</b> <span class="muted">${esc(x.status)}</span>${x.items.length?`<ul class="sm-list">${x.items.map(i=>`<li>${esc(i.who)} — ${esc(i.action)}${i.amount?` (${esc(i.amount)})`:""}${i.date?` · ${esc(i.date)}`:""}</li>`).join("")}</ul>`:""}</div>`};
  return part(E?.politicians,"Políticos (STOCK Act)")+part(E?.superinvestors,"Superinvestors (13F)")}
const STEPS=[["Hoy","Ciclo actual"],["Año+1","Proyección"],["Año+2","Proyección"],["Fair value","CEDEARs BYMA"],["Fit + smart money","Tu cartera"]];
function hzCard(h,isNow){const M=S.mclock||{},src=isNow?M.now:h;
  const drv=isNow?[["Inflación",M.now?.inflation],["Output gap",M.now?.gap],["PIB",M.now?.gdp]]:[["Inflación",h.inflation],["Crecimiento / gap",h.growthOrGap]];
  const comp=isNow&&M.now?.computed;
  return`<div class="wz-phase"><span class="muted small">Fase</span><b>${esc(isNow?(M.now?.phaseLabel||PHL[h.phase]):h.phase?PHL[h.phase]:"sin dato / no verificado")}</b></div>
   ${h.phaseNote?`<p class="small">${esc(h.phaseNote)}</p>`:""}
   <div class="tesis-drv">${drv.map(([l,x])=>`<div><b>${l}</b><br>${x&&x.value!=null?`${mo(x.value)} ${esc(x.unit||"")} ${ARW[x.dir]||""}${x.period?` · ${esc(x.period)}`:""}`:`<span class="muted">no verificado</span>`}${x?.note?`<br><span class="muted small">${esc(x.note)}</span>`:""}${x?.alt?`<br><span class="muted small">${esc(x.alt)}</span>`:""}</div>`).join("")}</div>
   ${comp?`<p class="small muted">Automático (FRED): CPI ${comp.cpiYoY}% (${comp.cpiPeriod}, Δ3m ${comp.cpiChange3m}) · gap ${comp.gap}% (${comp.gapPeriod}, Δ ${comp.gapChangeQ}) → ${esc(PHL[comp.phase])}</p>`:""}
   <h4 style="margin:12px 0 4px">Sectores</h4>
   <div>${(h.favored||[]).map(s=>`<span class="tesis-badge fav">▲ ${esc(s)}</span>`).join("")||`<span class="muted small">sin sectores (fase sin dato)</span>`}${(h.avoided||[]).map(s=>`<span class="tesis-badge avo">▼ ${esc(s)}</span>`).join("")}</div>
   ${h.note?`<p class="muted small">${esc(h.note)}</p>`:""}
   <p class="muted small">Fuente: ${esc(src?.source||"–")} · al ${esc(isNow?M.asOf:h.asOf||"–")}</p>`}
function tesisTab(){const T=TS(),el=$("#tWiz");if(!S.clock){el.innerHTML=`<p class="muted">No se pudo cargar data/investment_clock.json.</p>`;return}
  const H=horizons(),st=T.step;
  $("#tSteps").innerHTML=STEPS.map((s,i)=>`<li class="${i<st?"done":""}${i===st?" cur":""}" data-s="${i}">${i+1}. ${s[0]}<small>${s[1]}</small></li>`).join("");
  $$("#tSteps li").forEach(li=>li.onclick=()=>{const i=+li.dataset.s;if(i<=T.max){T.step=i;tesisTab()}});T.max=Math.max(T.max||0,st);
  let body="";
  if(st===0)body=`<h3>1. ¿Dónde estamos hoy?</h3><p class="muted small">${esc(S.mclock?.method||"")}</p>${hzCard(H.now,true)}`;
  if(st===1||st===2){const h=H[st===1?"y1":"y2"],k=st===1?"y1":"y2";
    body=`<h3>${st+1}. ${esc(h.lbl)}: ¿qué se proyecta?</h3>${hzCard(h,false)}
     <label class="wz-inc"><input type="checkbox" id="tInc" ${T.hz[k]?"checked":""} ${(h.favored||[]).length?"":"disabled"}> Sumar los sectores de ${esc(h.lbl)} al filtro de fair value</label>`}
  if(st===3){const D=candidates(),fav=favSet();if(!T.sel)T.sel=new Set(D.rows.filter(r=>r.inPx).map(r=>r.t));
    body=`<h3>4. Fair value: CEDEARs en sectores favorecidos</h3>
     <p class="small">Sectores: ${[...fav].map(([s,h])=>`<span class="tesis-badge fav">${esc(s)} <small>(${esc(h.join(", "))})</small></span>`).join("")||"ninguno"}</p>
     <p class="muted small">Filtro: cotiza en BYMA (CEDEAR o acción local) y precio cerca o debajo del valor intrínseco (upside ≥ ${(FV_BAND*100).toFixed(0)}%). Valor = triangulado (o base) de valuation_summary.json.</p>
     <ul class="wz-list">${D.rows.map(r=>`<li><label><input type="checkbox" data-t="${esc(r.t)}" ${T.sel.has(r.t)?"checked":""}>
       <b>${esc(r.t)}</b> <span class="muted small">${esc(r.b.kind)} ${esc(r.b.code)}${r.b.ratio?" "+esc(r.b.ratio):""}</span></label>
       <div class="small">${esc(r.name)} · ${esc(r.sec)}</div>
       <div class="small">Precio ${mo(r.price)} · valor ${mo(r.fair)} · <b style="color:${r.up>=0?"#16a34a":"#d97706"}">${pc(r.up)}</b> ${r.up<0?"(cerca)":"(debajo)"} · ${esc(r.model)}${r.inPx?"":" · <span class='muted'>sin precios p/ Markowitz</span>"}</div></li>`).join("")||`<li class="muted">Ninguna empresa cumple el filtro.</li>`}</ul>
     ${D.nv.length?`<details><summary class="small">CEDEARs del sector sin DCF (${D.nv.length})</summary><ul class="wz-list">${D.nv.map(r=>`<li class="muted small">${esc(r.t)} · ${esc(r.sec)} — sin DCF / no verificado</li>`).join("")}</ul></details>`:""}`}
  if(st===4){const list=[...(T.sel||[])];
    body=`<h3>5. ¿Cómo encaja con tu cartera?</h3>
     <p class="muted small">Fit con ${ADD_W*100}% hipotético: ρ̄ = correlación promedio ponderada por peso contra tus tenencias${S.hold?` (al ${esc(S.hold.asOf)})`:""}; sector = peso del sector después de sumar. <b>Bueno</b>: ρ̄ &lt; ${FIT.good.corr} y sector &lt; ${FIT.good.sector}% · <b>Malo</b>: ρ̄ &gt; ${FIT.bad.corr} o sector &gt; ${FIT.bad.sector}% · resto neutro. ΔSharpe = Sharpe histórico con vs sin la posición.</p>
     <ul class="wz-list">${list.map(t=>{const f=fitOf(t);return`<li><div><b>${esc(t)}</b> <span class="fit fit-${f.lab}">${f.lab}</span>${f.held?` <span class="muted small">ya en cartera (${f.held.weightPct}%)</span>`:""}</div>
       <div class="small">ρ̄ ${f.rho==null?"sin datos":f.rho.toFixed(2)} · ${esc(f.sec)} ${f.secNow.toFixed(1)}% → ${f.secAfter.toFixed(1)}% · ΔSharpe ${f.dSh==null?"–":(f.dSh>=0?"+":"")+f.dSh.toFixed(2)}</div>
       <div class="small sm">${smartOf(t)}</div></li>`}).join("")||`<li class="muted">No elegiste empresas en el paso 4.</li>`}</ul>
     <p class="muted small">Smart money: ${esc(S.smart?.lag||"")} Fuentes: ${esc(S.smart?.sources?.politicians||"")}; ${esc(S.smart?.sources?.superinvestors||"")}.</p>
     <div class="tesis-cta"><button class="chip primary" id="tOpt" ${list.length?"":"disabled"}>▶ Rebalancear con Markowitz (cartera actual + shortlist)</button>
      <button class="chip" id="tOnly" ${list.length<2?"disabled":""}>Solo shortlist</button></div>
     <div class="tesis-warn">Venta: según la tesina, los tres métodos no se complementan para vender. Este asistente es solo de compra.</div>`}
  el.innerHTML=body+`<div class="wz-nav"><button class="chip" id="tBack" ${st?"":"disabled"}>← Atrás</button><span class="muted small">Paso ${st+1} de 5</span><button class="chip primary" id="tNext" ${st<4?"":"disabled"}>Siguiente →</button></div>`;
  $("#tBack").onclick=()=>{T.step--;tesisTab()};$("#tNext").onclick=()=>{if(st===2||st===1)T.sel=null;T.step++;tesisTab();el.scrollIntoView({behavior:"smooth",block:"start"})};
  const inc=$("#tInc");if(inc)inc.onchange=()=>{T.hz[st===1?"y1":"y2"]=inc.checked;T.sel=null};
  $$("#tWiz input[data-t]").forEach(c=>c.onchange=()=>{c.checked?T.sel.add(c.dataset.t):T.sel.delete(c.dataset.t)});
  const list=[...(T.sel||[])].filter(t=>S.m.corr.tickers.includes(t));
  if($("#tOpt"))$("#tOpt").onclick=()=>{const nw=list.filter(t=>S.w[t]==null),w=nw.length?Math.max(2,10/nw.length):0;nw.forEach(t=>S.w[t]=w);S.drawn.portfolio=0;switchTab("portfolio");toast(nw.length?`Cartera actual + ${nw.length} nuevas (${nw.join(", ")}) a ${w.toFixed(1)}% c/u. Aplicá Max-Sharpe o Min-Var.`:"La shortlist ya está en tu cartera. Aplicá Max-Sharpe o Min-Var.")};
  if($("#tOnly"))$("#tOnly").onclick=()=>{S.w={};list.forEach(t=>S.w[t]=100/list.length);S.drawn.portfolio=0;switchTab("portfolio");toast(`Solo shortlist (${list.length}) a pesos iguales`)};
  $$("#tHub [data-go]").forEach(b=>b.onclick=()=>switchTab(b.dataset.go));
}
