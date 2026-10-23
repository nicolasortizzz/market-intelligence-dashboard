"use strict";
/* Historical WACC (FY2021-FY2025 year-ends + today) from data/wacc_history.json (scripts/fetch_wacc_history.py).
   Banks (model:"bank") show the cost of equity instead. The current model WACC/Ke from the DCF engine is highlighted.
   Standard template: any ticker present in valuation_assumptions.json gets this card automatically. */
const WH={D:null};
async function loadWH(){if(WH.D)return;try{WH.D=await fetch("data/wacc_history.json").then(r=>r.json())}catch(e){WH.D={companies:{}}}}
function drawWH(){const tk=V.tk,box=$("#whBox"),h=WH.D?.companies?.[tk];if(!box)return;
  if(!h){box.style.display="none";return}box.style.display="";
  const BK=h.bank,m=dcf(tk,"base",V.ov[tk]||{}),mv=BK?m.ke:m.wacc,lbl=BK?"Cost of equity":"WACC",p2=x=>x==null?"—":pct2(x);
  $("#whTitle").textContent=`${BK?(isUtil(tk)?"Historical cost of equity (residual-income model)":"Historical cost of equity (bank: WACC not meaningful)"):"Historical WACC"}: ${tk}, FY2021–FY2025 year-ends + today`;
  const R=h.rows,yl=r=>r.year==="current"?`Today (${r.date})`:`FY${r.year} (${r.date})`;
  $("#whTbl").innerHTML=`<thead><tr><th>Date</th><th>Risk-free (10Y UST)</th><th>Beta adj. (raw, months)</th><th>ERP</th><th>CRP</th><th>Cost of equity</th>${BK?"":"<th>Kd pre-tax → after-tax</th><th>E / (D+E)</th><th>WACC</th>"}</tr></thead><tbody>${R.map(r=>`<tr${r.flag?` title="${r.flag}"`:""}><td>${yl(r)}${r.estimated?" (estimated)":""}${r.flag?" *":""}</td><td>${p2(r.rf)}</td><td>${r.beta!=null?r.beta.toFixed(2)+(r.estimated?" (est., peer proxy)":` (${r.betaRaw.toFixed(2)}, ${r.months}m)`):"—"}</td><td>${p2(r.erp)}</td><td title="${r.crpSrc}">${r.crp?p2(r.crp):"none"}</td><td>${BK?`<b>${p2(r.ke)}</b>`:p2(r.ke)}</td>${BK?"":`<td title="${r.kdSrc}">${p2(r.kdPre)} → ${p2(r.kd)}</td><td>${pct(r.wE)}</td><td><b>${p2(r.wacc)}</b></td>`}</tr>`).join("")}<tr class="selfrow"><td>Current model (Base)</td><td>${p2(m.rf)}</td><td>${m.beta.toFixed(2)} (model)</td><td>${p2(m.erp)}</td><td>${(V.A.companies[tk].crp||0)?p2(V.A.companies[tk].crp):"none"}</td><td>${p2(m.ke)}</td>${BK?"":`<td>${p2(m.rf+V.A.companies[tk].kdSpread)} → ${p2(m.kd)}</td><td>—</td><td><b>${p2(m.wacc)}</b></td>`}</tr></tbody>`;
  const x=R.map(r=>r.year==="current"?"Today":"FY"+r.year),y=R.map(r=>BK?r.ke:r.wacc);
  plot("whChart",[{x,y:y.map(v=>v*100),type:"scatter",mode:"lines+markers+text",text:y.map(v=>pct(v)),textposition:"top center",line:{color:css("--ac")||"#5b8cff",width:2},name:`${lbl} (historical method)`,hovertemplate:"%{x}: %{y:.2f}%<extra></extra>"},
    {x:["Today"],y:[mv*100],type:"scatter",mode:"markers+text",text:[`model ${pct(mv)}`],textposition:"bottom center",marker:{symbol:"star",size:16,color:css("--up")},name:`Current model ${lbl}`,hovertemplate:`Current model ${lbl}: %{y:.2f}%<extra></extra>`}],
    {yaxis:{ticksuffix:"%",title:lbl},margin:{l:56,r:10,t:24,b:36},showlegend:true,legend:{orientation:"h",y:-0.2}});
  const M=WH.D.method,fl=R.filter(r=>r.flag).map(r=>`${yl(r)}: ${r.flag}`);
  $("#whNote").innerHTML=`Method (same for every ticker; ${M.currency}). Risk-free: ${M.rf}. Beta: ${M.beta}. ERP: ${M.erp}. CRP: ${M.crp}. ${BK?"Banks: cost of equity only (Ke = rf + β × ERP + CRP).":`Cost of debt: ${M.kd}. Weights: ${M.weights}.`} The highlighted model ${lbl} uses the DCF's own assumptions (beta overrides, ERP ${pct2(V.A.erp)}, credit spread), so it can differ from the historical-method value for today. Market inputs are taken at calendar year-ends; balance-sheet items at the fiscal year ending in that year.${fl.length?" * "+fl.join(" · "):""}`}
const _dv3=drawVal;drawVal=function(full){_dv3(full);loadWH().then(drawWH).catch(e=>console.error(e))};
