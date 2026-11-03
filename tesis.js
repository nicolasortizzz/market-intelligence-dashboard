/* Tesis / Decisión: embudo Ciclo → DCF → Markowitz (tesina Ortiz Armesto). Static; no inventa valores. */
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
function tesisData(){const C=S.clock,ph=S.T.phase||C.phase,map=C.sectorMap[ph]||{favored:[],avoided:[]},fav=new Set(map.favored);
  const mk=Object.fromEntries(S.m.companies.map(c=>[c.ticker,c])),vs=(S.vsum&&S.vsum.companies)||{};
  const sec=t=>C.tickerSector[t]||mk[t]?.sector||null;
  const dcf=Object.values(vs).filter(c=>fav.has(sec(c.ticker))&&typeof c.upside==="number"&&c.upside>0).sort((a,b)=>b.upside-a.upside)
    .map(c=>({t:c.ticker,name:c.name,sector:sec(c.ticker),price:c.price,fair:c.triangulated??c.base,up:c.upside,model:c.model,inPx:S.m.corr.tickers.includes(c.ticker)}));
  const nv=S.m.companies.filter(c=>fav.has(c.sector)&&!vs[c.ticker]).map(c=>({t:c.ticker,name:c.name,sector:c.sector}));
  return {ph,map,fav,dcf,nv}}
function tesisTab(){const el=$("#tClock");if(!S.clock){el.innerHTML=`<p class="muted">No se pudo cargar data/investment_clock.json.</p>`;return}
  const C=S.clock,D=tesisData();if(!S.T.sel){S.T.sel=new Set(D.dcf.filter(r=>r.inPx).map(r=>r.t));S.T.focus=D.dcf[0]?.t||null}
  const cur=C.phase,ov=S.T.phase&&S.T.phase!==cur;
  $("#tAsof").textContent=`Clock al ${C.asOf} · fuente: clock_2026_fechado.md`;
  el.innerHTML=`<div><b style="font-size:18px">${esc(C.phaseLabel)}</b>${ov?` <span class="tesis-badge">Simulando: ${esc(C.phases[D.ph])}</span>`:""}</div>
   <p class="muted small" style="margin:6px 0">${esc(C.transitionNote)}</p>
   <div class="tesis-phases" role="group" aria-label="Elegir fase">${Object.entries(C.phases).map(([k,l])=>`<button class="chip${k===D.ph?" active":""}" data-ph="${k}">${esc(l)}${k===cur?" · actual":""}</button>`).join("")}</div>
   <div>${D.map.favored.map(s=>`<span class="tesis-badge fav">▲ ${esc(s)}</span>`).join("")}${D.map.avoided.map(s=>`<span class="tesis-badge avo">▼ ${esc(s)}</span>`).join("")}</div>
   <p class="muted small" style="margin:6px 0 0">${esc(D.map.note||"")}</p>
   <div class="tesis-drv">${Object.entries(C.drivers).map(([k,v])=>`<div><b>${k.toUpperCase()}</b><br>${esc(v)}</div>`).join("")}</div>
   <details style="margin-top:10px"><summary class="small">Historial mensual de fases</summary><div class="tesis-phases">${C.history.map(h=>`<span class="tesis-badge" title="${esc(h.label)}">${h.m}: ${esc(h.label)}</span>`).join("")}</div></details>`;
  $$("#tClock [data-ph]").forEach(b=>b.onclick=()=>{S.T.phase=b.dataset.ph===cur?null:b.dataset.ph;S.T.sel=null;S.drawn.tesis=0;tesisTab()});
  const sel=S.T.sel,pc=v=>(v*100).toFixed(1)+"%",mo=v=>v==null?"–":v.toLocaleString("en-US",{maximumFractionDigits:2});
  $("#tCount").textContent=`${D.dcf.length} con DCF y upside > 0 · ${sel.size} seleccionadas`;
  $("#tShort").innerHTML=(S.vsum?"":`<p class="muted">No se pudo cargar valuation_summary.json.</p>`)+`<table class="tesis-tbl"><thead><tr><th></th><th>Ticker</th><th>Empresa</th><th>Sector</th><th>Precio</th><th>Valor intrínseco</th><th>Upside</th><th>Modelo</th></tr></thead><tbody>
   ${D.dcf.map(r=>`<tr data-t="${esc(r.t)}" class="${r.t===S.T.focus?"focus":""}"><td><input type="checkbox" ${sel.has(r.t)?"checked":""} ${r.inPx?"":"disabled title='Fuera del universo de covarianzas: no entra en Markowitz'"} aria-label="Incluir ${esc(r.t)}"></td><td><b>${esc(r.t)}</b></td><td>${esc(r.name)}</td><td>${esc(r.sector)}</td><td>${mo(r.price)}</td><td>${mo(r.fair)}</td><td style="color:#16a34a">+${pc(r.up)}</td><td class="small">${esc(r.model)}${r.inPx?"":" · <span class='muted'>sin precios p/ Markowitz</span>"}</td></tr>`).join("")||`<tr><td colspan="8" class="muted">Ninguna empresa con DCF queda bajo su valor intrínseco en estos sectores.</td></tr>`}
   ${D.nv.map(r=>`<tr class="nv"><td></td><td>${esc(r.t)}</td><td>${esc(r.name)}</td><td>${esc(r.sector)}</td><td colspan="4" class="muted small">sin DCF / no verificado</td></tr>`).join("")}</tbody></table>
   <p class="muted small">Valor intrínseco = triangulado (o base) de valuation_summary.json; upside vs. precio. Sector asignado según investment_clock.json.</p>`;
  $$("#tShort tr[data-t]").forEach(tr=>{const t=tr.dataset.t;tr.onclick=e=>{if(e.target.type==="checkbox"){e.target.checked?sel.add(t):sel.delete(t)}S.T.focus=t;tesisTab()}});
  const f=S.T.focus,inVT=typeof VT!=="undefined"&&VT.includes(f),inCo=!!co(f),list=[...sel];
  $("#tSteps").innerHTML=[["1. Ciclo",esc(C.phases[D.ph])],["2. Shortlist",`${list.length} firmas`],["3. Acción",list.length>1?"listo para optimizar":"elegí ≥ 2"]].map((s,i)=>`<li class="${i<2||list.length>1?"done":""}">${s[0]}<small>${s[1]}</small></li>`).join("");
  $("#tCta").innerHTML=`<div class="tesis-cta">
    <button class="chip primary" id="tOpt" ${list.length?"":"disabled"}>▶ Rebalancear con Markowitz (cartera + shortlist)</button>
    <button class="chip" id="tOnly" ${list.length<2?"disabled":""}>Solo shortlist (sin cartera)</button>
    <button class="chip" id="tDcf" ${inVT?"":"disabled"}>Abrir DCF${f?" de "+esc(f):""}</button>
    <button class="chip" id="tCo" ${inCo?"":"disabled"} title="${inCo?"":"No está en el universo de Company"}">Ver empresa${f?" "+esc(f):""}</button>
    <button class="chip" id="tCopy" ${list.length?"":"disabled"}>Copiar shortlist</button></div>
   <p class="muted small">Rebalancear mantiene tu cartera actual${S.hold?` (al ${esc(S.hold.asOf)})`:""} y suma las nuevas de la shortlist con un 10% repartido (mín. 2% c/u); después aplicá Max-Sharpe o mínima varianza sobre el libro combinado.${S.holdOut?.length?` Fuera del universo de covarianzas (no entran al optimizador): ${esc(S.holdOut.join(", "))}.`:""}</p>
   <div class="tesis-warn">⚠ Venta: según la tesis, para <b>vender</b> los tres métodos no se complementan (horizontes distintos: el ciclo rota por fase, el DCF converge en años, Markowitz rebalancea por riesgo). No hay una señal de venta unificada; evaluá cada método por separado.</div>`;
  $("#tOpt").onclick=()=>{const nw=list.filter(t=>S.w[t]==null),w=nw.length?Math.max(2,10/nw.length):0;nw.forEach(t=>S.w[t]=w);S.drawn.portfolio=0;switchTab("portfolio");toast(nw.length?`Cartera actual + ${nw.length} nuevas (${nw.join(", ")}) a ${w.toFixed(1)}% c/u. Aplicá Max-Sharpe o Min-Var.`:"La shortlist ya está en tu cartera. Aplicá Max-Sharpe o Min-Var.")};
  $("#tOnly").onclick=()=>{S.w={};list.forEach(t=>S.w[t]=100/list.length);S.drawn.portfolio=0;switchTab("portfolio");toast(`Solo shortlist (${list.length}) a pesos iguales, sin tu cartera`)};
  $("#tDcf").onclick=()=>{V.tk=f;S.drawn.valuation=0;switchTab("valuation")};
  $("#tCo").onclick=()=>openCo(f);
  $("#tCopy").onclick=()=>{const txt=D.dcf.filter(r=>sel.has(r.t)).map(r=>`${r.t}\t${r.sector}\t+${pc(r.up)}`).join("\n");navigator.clipboard.writeText(`Fase: ${C.phases[D.ph]}\n${txt}`).then(()=>toast("Shortlist copiada"),()=>toast("No se pudo copiar"))};
}
