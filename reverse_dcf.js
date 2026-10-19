"use strict";
/* Reverse DCF: which growth / margin does the CURRENT market price imply?
   Reuses the forward engine dcf() from valuation.js (same WACC build-up, tax, D&A, capex, ΔNWC, dilution,
   net debt, minority interest, terminal value). Two solves by bisection:
   (1) implied revenue CAGR for years 1-5 (flat), fading linearly to terminal g over years 6-10, at a chosen steady-state EBIT margin;
   (2) implied steady-state EBIT margin (reached by year 5) holding the Base-case revenue path. */
const RV={Q:null,st:{}};
async function loadRev(){if(RV.Q)return;try{RV.Q=await fetch("data/reverse_dcf.json").then(r=>r.json())}catch(e){RV.Q={quotes:{}}}
  try{RV.H=await fetch("data/revenue_history.json").then(r=>r.json())}catch(e){RV.H={companies:{}}}}
/* historical 5-year revenue CAGR (FY2020→FY2025, 5 compounding periods) from data/revenue_history.json */
const H5=tk=>RV.H?.companies?.[tk]||null;
const h5Ccy=h=>h.currency==="CNY"?"RMB (constant currency)":h.currency==="EUR"?"EUR (constant currency)":h.ars?"USD at year-end BCRA rates":h.currency;
const h5Foot=(tk,h)=>!h?"":`Historical 5-year revenue CAGR ${h.start}→${h.end} (5 compounding periods; fiscal years ending ${h.startEnd} and ${h.endEnd}): <b>${pct(h.cagr5)}</b> in ${h5Ccy(h)}${h.usd?`; ${pct(h.usd.cagr5)} in USD (${h.usd.note})`:""}${h.ars?`; <b>${pct(h.ars.realCagr5)}</b> in real ARS (FY2020 restated to Dec-2025 pesos with INDEC CPI ${h.ars.cpi["2020-12"].toFixed(1)}→${h.ars.cpi["2025-12"].toFixed(1)}); FX ${h.fx.FY2020[1]} (${h.fx.FY2020[0]}) and ${h.fx.FY2025[1]} (${h.fx.FY2025[0]}) ARS/USD${h.afterProvisions?`. After loan-loss provisions (net operating income): ${pct(h.afterProvisions.usdCagr5)} USD, ${pct(h.afterProvisions.realCagr5)} real ARS`:""}`:""}. Definition: ${h.definition}. Source: ${h.source}.${h.note?" "+h.note:""}`;
function addH5Row(tk){const h=H5(tk),kv=$("#vAssump .kv");if(!h||!kv||kv.querySelector(".h5"))return;
  kv.insertAdjacentHTML("beforeend",`<span class="h5" title="${h.source}">Revenue CAGR, 5y historical (${h.start}–${h.end})</span><span class="h5" title="${h.source}">${pct(h.cagr5)} ${h.currency==="CNY"?"(RMB)":h.currency==="EUR"?`(EUR) · ${pct(h.usd.cagr5)} in USD`:h.ars?`(USD) · ${pct(h.ars.realCagr5)} real ARS`:"(USD)"}${h.latest?` · ${h.latest.start}–${h.latest.end}: ${pct(h.latest.cagr5)}`:""}</span>`)}
function mktPx(tk){const q=RV.Q?.quotes?.[tk],c=V.D.companies[tk];return q?{p:q.price,d:q.priceDate,src:"yfinance close"}:{p:c.price,d:c.priceDate,src:"valuation snapshot"}}
function bisect(f,lo,hi,target,it=70){let flo=f(lo)-target,fhi=f(hi)-target;if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0)return null;
  for(let i=0;i<it;i++){const m=(lo+hi)/2,fm=f(m)-target;if(Math.abs(fm)<1e-7||hi-lo<1e-7)return m;if(fm*flo<0){hi=m;fhi=fm}else{lo=m;flo=fm}}return(lo+hi)/2}
function revOv(tk){const st=RV.st[tk]||{},ov={...(V.ov[tk]||{})};delete ov.gPath;if(st.wacc!=null)ov.wacc=st.wacc;if(st.g!=null)ov.g=st.g;return ov}
function reverse(tk){
  const ov=revOv(tk),base=dcf(tk,"base",ov),st=RV.st[tk]||{},mT=st.m??base.ebitT,px=mktPx(tk);
  const G=[-0.3,0.8],M=[-0.1,0.6];
  const fG=x=>dcf(tk,"base",{...ov,gPath:x,ebitT:mT}).ps,fM=x=>dcf(tk,"base",{...ov,ebitT:x}).ps;
  const gImp=bisect(fG,G[0],G[1],px.p),mImp=bisect(fM,M[0],M[1],px.p)??bisect(fM,M[1],0.95,px.p); // wider margin bracket only if needed (MU/ASML)
  const b=base.b,cagr=r=>Math.pow(r.rows[4].rev/b.rev0,1/5)-1,cagr10=r=>Math.pow(r.rows[9].rev/b.rev0,0.1)-1;
  const imp=gImp!=null?dcf(tk,"base",{...ov,gPath:gImp,ebitT:mT}):null;
  const H=b.hist||[],h0=H[0],hN=H.at(-1),nH=H.length>1?+hN.y-+h0.y:0,hist3=nH>0?Math.pow(hN.rev/h0.rev,1/nH)-1:null,h5=H5(tk);
  return{ov,base,mT,px,gImp,mImp,imp,baseCagr5:cagr(base),baseCagr10:cagr10(base),impCagr10:imp?cagr10(imp):null,
    histCagr:h5?h5.cagr5:hist3,histYrs:h5?`5y ${h5.start}–${h5.end}`:nH>0?`FY${h0.y}–FY${hN.y}`:"",hist3,hist3Yrs:nH>0?`FY${h0.y}–FY${hN.y}`:"",h5,G,M,fG,bank:!!base.bank}}
/* labels: operating companies (revenue CAGR × EBIT margin) vs banks (book-value growth × sustainable ROE, residual-income engine) */
const RVL=bk=>bk?{g:"Book-value CAGR, years 1-5",gS:"book-value CAGR",m:"Sustainable ROE (yr 5+)",mS:"sustainable ROE",unit:"ADR",model:"residual-income",rate:"Ke",ttl:"Reverse residual income"}
  :{g:"Revenue CAGR, years 1-5",gS:"revenue CAGR",m:"Steady-state EBIT margin (yr 5+)",mS:"EBIT margin",unit:"share",model:"DCF",rate:"WACC",ttl:"Reverse DCF"};
/* Adaptive heatmap axes, rebuilt around today's price on every redraw (sliders included):
   centre = implied point (implied CAGR at the target margin, target margin). Half-width per axis = 0.6 × the mean distance
   from the centre to the values where the DCF hits 0.3× and 3× the price, so the price contour runs through the middle and
   most cells sit roughly within 0.3×-3× price. A "nice" step keeps ~11 points per axis. Per-ticker extra bounds
   (RV_EXTRA, e.g. NIO margin up to 18%) widen the range and the step is enlarged to keep ≤12 rows. */
const RV_EXTRA={NIO:{mMax:0.18}},NICE=[0.0025,0.005,0.01,0.015,0.02,0.025,0.03,0.04,0.05,0.075,0.1];
const axFmt=v=>(v*100).toFixed(1)+"%";
function niceAxis(c,lo,hi,maxN=12){const st=NICE.find(x=>(hi-lo)/x<=maxN-2)||NICE.at(-1),k0=Math.floor((lo-c)/st+1e-9),k1=Math.ceil((hi-c)/st-1e-9),out=[];
  for(let k=k0;k<=k1;k++)out.push(+(c+k*st).toFixed(5));return out}
function rvAxes(tk,R){const P=R.px.p,ex=RV_EXTRA[tk]||{};
  const gc=R.bank?R.baseCagr5:(R.gImp??R.baseCagr5),mc=R.bank?(R.mImp??R.mT):R.mT; // banks: centre on (base book growth, implied ROE)
  const fg=x=>dcf(tk,"base",{...R.ov,gPath:x,ebitT:mc}).ps,fm=x=>dcf(tk,"base",{...R.ov,gPath:gc,ebitT:x}).ps;
  const span=(f,c,lo,hi)=>{const a=bisect(f,lo,c,0.3*P)??lo,b=bisect(f,c,hi,3*P)??hi;return 0.6*((c-a)+(b-c))/2};
  let hg=clamp(span(fg,gc,R.G[0],R.G[1]),0.01,0.25),hm=clamp(span(fm,mc,R.M[0],R.M[1]),0.005,0.2);
  let gLo=Math.max(gc-hg,R.G[0]),gHi=Math.min(gc+hg,R.G[1]),mLo=Math.max(mc-hm,R.M[0]),mHi=Math.min(mc+hm,R.M[1]);
  if(ex.mMax!=null)mHi=Math.max(mHi,ex.mMax);if(ex.mMin!=null)mLo=Math.min(mLo,ex.mMin);
  return{gc,mc,gs:niceAxis(gc,gLo,gHi,12),ms:niceAxis(mc,mLo,mHi,12)}}
function drawReverse(){const tk=V.tk,el=$("#rvBox");if(!el)return;const R=reverse(tk),b=R.base.b,c=b.c,fu=fx(),st=RV.st[tk]||{},gr=pct2,L=RVL(R.bank);
  $("#rvTitle").textContent=`${L.ttl}: what does ${tk} at ${usd(R.px.p)} imply?`;
  $("#rvGridT").innerHTML=`Implied value per ${L.unit}: ${L.gS} (yrs 1-5) × ${L.mS} <span class="muted">· yellow line = market price · ★ = Base case · axes centred on the implied point · colour on a log scale vs price</span>`;
  if(R.bank)return drawReverseBank(tk,R,b,c,fu,st,gr,L);
  renderKpis($("#rvK"),[kpi(`Market price (${R.px.d})`,R.px.p,R.px.src,usd),
    kpi("Implied revenue CAGR (yrs 1-5)",R.gImp==null?"n/a":R.gImp*100,`10y ${R.impCagr10==null?"—":pct(R.impCagr10)} · at ${pct(R.mT)} EBIT margin`,v=>typeof v==="number"?v.toFixed(1)+"%":v),
    ...(R.h5?[kpi(`Historical revenue CAGR (5y)`,R.h5.cagr5*100,`${R.h5.start}–${R.h5.end} · ${h5Ccy(R.h5)} · reported`,v=>v.toFixed(1)+"%")]:[]),
    kpi("Base-case CAGR (yrs 1-5)",R.baseCagr5*100,`10y ${pct(R.baseCagr10)} · ${b.a.g1!=null?"assumed":"consensus"} FY1-2, then scenario`,v=>v.toFixed(1)+"%"),
    kpi("Implied EBIT margin (yr 5+)",R.mImp==null?"n/a":R.mImp*100,`holding Base-case growth · base ${pct(R.base.ebitT)}`,v=>typeof v==="number"?v.toFixed(2)+"%":v),
    kpi("Base-case DCF value",R.base.ps,`WACC ${gr(R.base.wacc)} · g ${gr(R.base.g)}`,usd)]);
  const W0=dcf(tk,"base",{...(V.ov[tk]||{})});
  const sl=[["wacc","WACC",0.05,0.2,0.0025,R.base.wacc],["g","Terminal growth",0,0.045,0.0025,R.base.g],["m","Steady-state EBIT margin (for growth solve)",-0.05,0.3,0.0025,R.mT]];
  $("#rvSliders").innerHTML=sl.map(([k,l,mn,mx,s,v])=>`<div class="vsl"><label>${l}<b id="rv_${k}">${gr(v)}</b></label><input type="range" min="${mn}" max="${mx}" step="${s}" value="${v}" data-k="${k}"></div>`).join("")+`<p class="muted small">Defaults follow the DCF workbench above (model WACC ${gr(W0.wacc)}, g ${gr(W0.g)}, Base EBIT margin ${pct(W0.ebitT)}). These sliders only move the reverse DCF. <button class="chip" id="rvReset">Reset</button></p>`;
  $$("#rvSliders input").forEach(i=>i.oninput=()=>{$("#rv_"+i.dataset.k).textContent=gr(+i.value);RV.st[tk]=Object.assign(RV.st[tk]||{},{[i.dataset.k]:+i.value});clearTimeout(RV._t);RV._t=setTimeout(drawReverse,80)});
  // value vs growth curve
  const xs=[];for(let x=-0.1;x<=0.6001;x+=0.01)xs.push(x);
  plot("rvCurve",[{type:"scatter",mode:"lines",name:`Value/share at ${pct(R.mT)} margin`,x:xs,y:xs.map(x=>R.fG(x)*fu),line:{color:css("--ac"),width:2.5},hovertemplate:"CAGR %{x:.1%}<br>%{y:$.2f}/share<extra></extra>"}],
    {xaxis:{title:"Revenue CAGR, years 1-5",tickformat:".0%",gridcolor:css("--bd")},yaxis:{title:"Value per share",tickformat:"$,.2f",gridcolor:css("--bd"),rangemode:"tozero"},showlegend:false,margin:{l:60,r:14,t:16,b:46},
     shapes:[{type:"line",xref:"paper",x0:0,x1:1,y0:R.px.p*fu,y1:R.px.p*fu,line:{color:css("--dn"),dash:"dot",width:2}},...[[R.gImp,css("--dn")],[R.baseCagr5,css("--up")],[R.histCagr,"#22d3ee"],[R.h5?R.hist3:null,css("--mu")]].filter(x=>x[0]!=null).map(([x,col])=>({type:"line",x0:x,x1:x,yref:"paper",y0:0,y1:1,line:{color:col,width:col==="#22d3ee"?2:1.2,dash:col==="#22d3ee"?"dashdot":"dash"}}))],
     annotations:[{xref:"paper",x:0.01,y:R.px.p*fu,yanchor:"bottom",xanchor:"left",text:"Market price "+usd(R.px.p),showarrow:false,font:{color:css("--dn"),size:11}},
       ...(R.gImp!=null?[{x:R.gImp,yref:"paper",y:1,yanchor:"bottom",text:"Implied "+pct(R.gImp),showarrow:false,font:{color:css("--dn"),size:11}}]:[]),
       {x:R.baseCagr5,yref:"paper",y:0.92,text:"Base "+pct(R.baseCagr5),showarrow:false,font:{color:css("--up"),size:11}},
       ...(R.histCagr!=null?[{x:R.histCagr,yref:"paper",y:0.8,text:`Hist. ${R.histYrs} ${pct(R.histCagr)}`,showarrow:false,font:{color:"#22d3ee",size:11}}]:[]),
       ...(R.h5&&R.hist3!=null?[{x:R.hist3,yref:"paper",y:0.6,text:`Hist. 3y ${R.hist3Yrs} ${pct(R.hist3)}`,showarrow:false,font:{color:css("--mu"),size:10}}]:[])]});
  // sensitivity grid: growth x margin with market-price contour
  const {gs,ms,gc,mc}=rvAxes(tk,R);
  const z=ms.map(m=>gs.map(g=>dcf(tk,"base",{...R.ov,gPath:g,ebitT:m}).ps*fu));
  const P0=R.px.p*fu;
  // colour = log2(value / price), clipped to ±2 (¼× … 4× the price) so high-margin cells don't wash out; labels/hover show the true $ value
  const LC=2,lz=z.map(r=>r.map(v=>clamp(Math.log2(Math.max(v,1e-9)/P0),-LC,LC))),cur=S.ccy==="ARS"?"ARS ":"$",fv=v=>cur+(v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2));
  const tv=[-2,-1,0,1,2],tt=tv.map(k=>(k===-LC?"≤ ":k===LC?"≥ ":"")+fv(P0*Math.pow(2,k))+(k===0?" (price)":""));
  plot("rvGrid",[{type:"heatmap",x:gs,y:ms,z:lz,customdata:z,text:z.map(r=>r.map(v=>(S.ccy==="ARS"?"":"$")+v.toFixed(v>100?0:2))),texttemplate:"%{text}",textfont:{size:10},colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],zmin:-LC,zmax:LC,zauto:false,hovertemplate:"CAGR %{x:.1%} · EBIT margin %{y:.1%}<br>%{text}/share<extra></extra>",colorbar:{thickness:10,tickvals:tv,ticktext:tt,title:{text:"$/share (log scale)",side:"right"}}},
    {type:"contour",x:gs,y:ms,z,contours:{coloring:"none",start:R.px.p*fu,end:R.px.p*fu,size:1,showlabels:true,labelfont:{color:"#fff",size:11}},line:{color:"#fde047",width:3},showscale:false,hoverinfo:"skip",name:"Market price"},
    {type:"scatter",mode:"markers",x:[R.baseCagr5],y:[R.base.ebitT],marker:{symbol:"star",size:15,color:"#fff",line:{color:"#000",width:1}},name:"Base case",hovertemplate:"Base case<extra></extra>"}],
    {xaxis:{title:"Revenue CAGR, years 1-5",tickvals:gs,ticktext:gs.map(axFmt)},yaxis:{title:"Steady-state EBIT margin (yr 5+)",tickvals:ms,ticktext:ms.map(axFmt)},showlegend:false,margin:{l:64,r:10,t:10,b:50},...h5Shape(R,gs)});
  // interpretation
  const cons=c.revenueEstimate||{},ovr=b.a.g1!=null,c0=ovr?b.g1:cons["0y"]?.growth,c1=ovr?b.g2:cons["+1y"]?.growth,cLbl=ovr?"analyst-assumed":"consensus";
  const gTxt=R.gImp==null?`No revenue CAGR between ${pct(R.G[0],0)} and ${pct(R.G[1],0)} reconciles to the price at a ${pct(R.mT)} margin`:`At a ${pct(R.mT)} steady-state EBIT margin, ${usd(R.px.p)} implies revenue compounding at <b>${pct(R.gImp)}</b> a year for five years (then fading to ${pct(R.base.g)}), i.e. a 10-year CAGR of ${pct(R.impCagr10)}`;
  const d10=R.impCagr10==null?null:R.impCagr10-R.baseCagr10,rel=d10==null?"":Math.abs(d10)<0.005?"essentially <b>in line with</b>":d10<0?"<b>below</b>":"<b>above</b>";
  const vs=R.gImp==null?"":`On a like-for-like 10-year basis that is ${rel} the Base case (${pct(R.baseCagr10)} 10y; ${pct(R.baseCagr5)} over years 1-5, front-loaded by ${cLbl} ${c0!=null?sp(c0):"—"} / ${c1!=null?sp(c1):"—"} for the next two fiscal years)${R.histCagr!=null?`, and ${R.gImp<R.histCagr?"below":"above"} the ${R.histYrs} historical revenue CAGR of ${pct(R.histCagr)}`:""}.`;
  const mTxt=R.mImp==null?"Holding Base-case growth, no EBIT margin in the tested range matches the price.":`Holding Base-case growth instead, the price implies a steady-state EBIT margin of <b>${pct(R.mImp,2)}</b> vs ${pct(R.base.ebitT)} in the Base case (FY${b.hist.at(-1).y} actual: ${pct(b.ebit0/b.rev0)}).`;
  const pw=probWeighted(tk,R.ov).pw,cm=comps(tk),cMid=compMidOf(cm),tri=cMid!=null?0.6*pw+0.4*cMid:pw;
  const verdict=(R.base.ps>R.px.p?`The Base-case DCF of <b>${usd(R.base.ps)}</b> sits ${pct(R.base.ps/R.px.p-1)} above the price: the market is pricing a <b>less optimistic</b> path than the Base case.`:`The Base-case DCF of <b>${usd(R.base.ps)}</b> sits ${pct(1-R.base.ps/R.px.p)} below the price: the market is pricing a ${R.base.ps/R.px.p>0.9?"slightly ":""}<b>more optimistic</b> path than the Base case.`)+` The tab's triangulated fair value (<b>${usd(tri)}</b> = 60% probability-weighted DCF ${usd(pw)} + 40% comps ${cMid!=null?usd(cMid):"—"}) is ${tri>R.px.p?"above":"below"} the price; the comps leg is ${cMid==null?"n/a":cMid>pw?"above":"below"} the DCF leg${cMid!=null&&Math.abs(cMid/pw-1)>0.3?", so multiples and cash flows disagree materially":""}.`;
  const lev=(()=>{const lo=dcf(tk,"base",{...R.ov,ebitT:R.base.ebitT-0.01}).ps,hi=dcf(tk,"base",{...R.ov,ebitT:R.base.ebitT+0.01}).ps;return`Sensitivity: ±1pp of steady-state EBIT margin moves the Base-case value by about ${usd((hi-lo)/2)}/share (${pct((hi-lo)/2/R.base.ps)})${R.base.ebitT<0.1?", so for a thin-margin business the margin, not the growth rate, is the main swing factor.":"."}`})();
  $("#rvNote").innerHTML=`<p>${gTxt}. ${vs}</p><p>${mTxt} ${verdict}</p><p class="muted small">${lev} Same engine and inputs as the DCF above (tax ${pct(R.base.b.a.tax)}, D&amp;A/capex glide paths, ΔNWC, dilution ${pct(R.base.s.shareChange??R.base.b.a.shareChange)}/yr for 3 years, ${b.netDebt<0?"net cash "+bn(-b.netDebt):"net debt "+bn(b.netDebt)}, minority interest ${bn(b.minority)}). Solved by bisection. Price: ${R.px.src}, ${R.px.d}. Model estimates, not investment advice.</p>${R.h5?`<p class="muted small" id="rvH5">${h5Foot(tk,R.h5)}</p>`:""}`;rvH5Tip(tk,R);
}
function drawReverseBank(tk,R,b,c,fu,st,gr,L){
  const pb=R.px.p/b.bv0,justified=(R.mImp!=null)?(R.mImp-R.base.g)/(R.base.ke-R.base.g):null;
  renderKpis($("#rvK"),[kpi(`Market price (${R.px.d})`,R.px.p,`${R.px.src} · P/BV ${pb.toFixed(2)}x`,usd),
    kpi("Implied sustainable ROE",R.mImp==null?"n/a":R.mImp*100,`holding Base book growth ${pct(R.base.mid)} · base ROE ${pct(R.base.ebitT)}`,v=>typeof v==="number"?v.toFixed(2)+"%":v),
    kpi("Cost of equity (Ke)",R.base.ke*100,`rf + β×ERP + CRP ${pct2(b.a.crp)}`,v=>v.toFixed(2)+"%"),
    kpi("Implied book CAGR (yrs 1-5)",R.gImp==null?"n/a":R.gImp*100,`at ${pct(R.mT)} sustainable ROE`,v=>typeof v==="number"?v.toFixed(1)+"%":v),
    ...(R.h5?[kpi("Hist. net op. revenue CAGR (5y)",R.h5.cagr5*100,`${R.h5.start}–${R.h5.end} · USD at year-end BCRA · real ARS ${pct(R.h5.ars.realCagr5)}`,v=>v.toFixed(1)+"%")]:[]),
    kpi("Base-case RI value",R.base.ps,`Ke ${gr(R.base.ke)} · g ${gr(R.base.g)}`,usd)]);
  const W0=dcf(tk,"base",{...(V.ov[tk]||{})});
  const sl=[["wacc","Cost of equity (Ke)",0.08,0.25,0.0025,R.base.wacc],["g","Terminal growth",0,0.045,0.0025,R.base.g],["m","Sustainable ROE (for growth solve)",0,0.4,0.0025,R.mT]];
  $("#rvSliders").innerHTML=sl.map(([k,l,mn,mx,s,v])=>`<div class="vsl"><label>${l}<b id="rv_${k}">${gr(v)}</b></label><input type="range" min="${mn}" max="${mx}" step="${s}" value="${v}" data-k="${k}"></div>`).join("")+`<p class="muted small">Defaults follow the residual-income model above (Ke ${gr(W0.wacc)}, g ${gr(W0.g)}, Base sustainable ROE ${pct(W0.ebitT)}). These sliders only move the reverse analysis. <button class="chip" id="rvReset">Reset</button></p>`;
  $$("#rvSliders input").forEach(i=>i.oninput=()=>{$("#rv_"+i.dataset.k).textContent=gr(+i.value);RV.st[tk]=Object.assign(RV.st[tk]||{},{[i.dataset.k]:+i.value});clearTimeout(RV._t);RV._t=setTimeout(drawReverse,80)});
  // value vs sustainable ROE curve (holding base book growth)
  const xs=[];for(let x=0;x<=0.4001;x+=0.005)xs.push(x);const fM=x=>dcf(tk,"base",{...R.ov,ebitT:x}).ps;
  plot("rvCurve",[{type:"scatter",mode:"lines",x:xs,y:xs.map(x=>fM(x)*fu),line:{color:css("--ac"),width:2.5},hovertemplate:"ROE %{x:.1%}<br>%{y:$.2f}/ADR<extra></extra>"}],
    {xaxis:{title:"Sustainable ROE (yr 5+), Base book growth",tickformat:".0%",gridcolor:css("--bd")},yaxis:{title:"Value per ADR",tickformat:"$,.2f",gridcolor:css("--bd"),rangemode:"tozero"},showlegend:false,margin:{l:60,r:14,t:16,b:46},
     shapes:[{type:"line",xref:"paper",x0:0,x1:1,y0:R.px.p*fu,y1:R.px.p*fu,line:{color:css("--dn"),dash:"dot",width:2}},...[[R.mImp,css("--dn")],[R.base.ebitT,css("--up")],[R.base.ke,css("--mu")]].filter(x=>x[0]!=null).map(([x,col])=>({type:"line",x0:x,x1:x,yref:"paper",y0:0,y1:1,line:{color:col,width:1.5,dash:"dash"}}))],
     annotations:[{xref:"paper",x:0.01,y:R.px.p*fu,yanchor:"bottom",xanchor:"left",text:"Market price "+usd(R.px.p),showarrow:false,font:{color:css("--dn"),size:11}},
       ...(R.mImp!=null?[{x:R.mImp,yref:"paper",y:1,yanchor:"bottom",text:"Implied "+pct(R.mImp),showarrow:false,font:{color:css("--dn"),size:11}}]:[]),
       {x:R.base.ebitT,yref:"paper",y:0.92,text:"Base "+pct(R.base.ebitT),showarrow:false,font:{color:css("--up"),size:11}},
       {x:R.base.ke,yref:"paper",y:0.8,text:"Ke "+pct(R.base.ke),showarrow:false,font:{color:css("--mu"),size:11}}]});
  drawRvGrid(tk,R,fu,L);
  const pw=probWeighted(tk,R.ov).pw,cm=comps(tk),cMid=compMidOf(cm),tri=cMid!=null?0.6*pw+0.4*cMid:pw,roeTTM=b.ebit0/b.rev0;
  const t1=R.mImp==null?"No sustainable ROE between 0% and 40% reconciles to the price.":`At ${usd(R.px.p)} (${pb.toFixed(2)}x book of ${usd(b.bv0)}/ADR), the market is pricing a sustainable USD ROE of <b>${pct(R.mImp,1)}</b>, ${R.mImp<R.base.ke?"<b>below</b>":"<b>above</b>"} the ${pct(R.base.ke,1)} cost of equity (Base case ${pct(R.base.ebitT)}; consensus implies ${pct(b.roe1)} in FY2026 and ${pct(b.roe2)} in FY2027; TTM ${pct(roeTTM)}).`;
  const t2=R.gImp==null?`Holding a ${pct(R.mT)} ROE, no book-growth rate between ${pct(R.G[0],0)} and ${pct(R.G[1],0)} matches the price${R.mT>R.base.ke?" — with ROE above Ke, faster growth only adds value, so the price sits below every growth path":""}.`:`Holding a ${pct(R.mT)} sustainable ROE, the price implies book value compounding at <b>${pct(R.gImp)}</b> a year for five years.`;
  const verdict=`The Base-case residual-income value is <b>${usd(R.base.ps)}</b> (${R.base.ps>R.px.p?"+":""}${pct(R.base.ps/R.px.p-1)} vs price); the triangulated fair value is <b>${usd(tri)}</b> (60% probability-weighted RI ${usd(pw)} + 40% P/BV comps ${cMid!=null?usd(cMid):"—"}).`;
  const lo=fM(R.base.ebitT-0.01),hi=fM(R.base.ebitT+0.01);
  $("#rvNote").innerHTML=`<p>${t1} ${t2}</p><p>${verdict} A price below book means the market expects GGAL to earn less than its cost of equity on average: justified P/BV = (ROE − g)/(Ke − g)${justified!=null?` = ${justified.toFixed(2)}x at the implied ROE`:""}.</p><p class="muted small">Sensitivity: ±1pp of sustainable ROE moves the Base-case value by about ${usd((hi-lo)/2)}/ADR (${pct((hi-lo)/2/R.base.ps)}). Same residual-income engine and inputs as above (book ${usd(b.bv0)}/ADR at ${c.bank.bvDate}, BCRA ${c.bank.fxBv} ARS/USD; Ke includes the 6.48% Argentina EMBI). Solved by bisection. Price: ${R.px.src}, ${R.px.d}. Model estimates, not investment advice.</p>${R.h5?`<p class="muted small" id="rvH5">${h5Foot(tk,R.h5)}</p>`:""}`;rvH5Tip(tk,R)}
function h5Shape(R,gs){const x=R.h5?.cagr5;if(x==null||x<gs[0]||x>gs.at(-1))return{};
  return{shapes:[{type:"line",x0:x,x1:x,yref:"paper",y0:0,y1:1,line:{color:"#22d3ee",width:2,dash:"dashdot"}}],annotations:[{x,yref:"paper",y:1,yanchor:"bottom",text:`Hist. 5y ${R.h5.start}–${R.h5.end} ${pct(x)}${R.bank?" (net op. revenue, USD)":""}`,showarrow:false,font:{color:"#22d3ee",size:10}}]}}
function rvH5Tip(tk,R){if(!R.h5)return;const tip=h5Foot(tk,R.h5).replace(/<[^>]+>/g,"");$$("#rvK .kpi").forEach(k=>{if(/CAGR \(5y\)/.test(k.querySelector(".l").textContent))k.title=tip});addH5Row(tk)}
function drawRvGrid(tk,R,fu,L){
  const {gs,ms}=rvAxes(tk,R),z=ms.map(m=>gs.map(g=>dcf(tk,"base",{...R.ov,gPath:g,ebitT:m}).ps*fu)),P0=R.px.p*fu;
  const LC=2,lz=z.map(r=>r.map(v=>clamp(Math.log2(Math.max(v,1e-9)/P0),-LC,LC))),cur=S.ccy==="ARS"?"ARS ":"$",fv=v=>cur+(v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2));
  const tv=[-2,-1,0,1,2],tt=tv.map(k=>(k===-LC?"≤ ":k===LC?"≥ ":"")+fv(P0*Math.pow(2,k))+(k===0?" (price)":""));
  plot("rvGrid",[{type:"heatmap",x:gs,y:ms,z:lz,customdata:z,text:z.map(r=>r.map(v=>(S.ccy==="ARS"?"":"$")+v.toFixed(v>100?0:2))),texttemplate:"%{text}",textfont:{size:10},colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],zmin:-LC,zmax:LC,zauto:false,hovertemplate:`${L.gS} %{x:.1%} · ${L.mS} %{y:.1%}<br>%{text}/${L.unit}<extra></extra>`,colorbar:{thickness:10,tickvals:tv,ticktext:tt,title:{text:`$/${L.unit} (log scale)`,side:"right"}}},
    {type:"contour",x:gs,y:ms,z,contours:{coloring:"none",start:P0,end:P0,size:1,showlabels:true,labelfont:{color:"#fff",size:11}},line:{color:"#fde047",width:3},showscale:false,hoverinfo:"skip",name:"Market price"},
    {type:"scatter",mode:"markers",x:[R.baseCagr5],y:[R.base.ebitT],marker:{symbol:"star",size:15,color:"#fff",line:{color:"#000",width:1}},name:"Base case",hovertemplate:"Base case<extra></extra>"}],
    {xaxis:{title:L.g,tickvals:gs,ticktext:gs.map(axFmt)},yaxis:{title:L.m,tickvals:ms,ticktext:ms.map(axFmt)},showlegend:false,margin:{l:64,r:10,t:22,b:50},...h5Shape(R,gs)})}
const _dv2=drawVal;drawVal=function(full){_dv2(full);loadRev().then(drawReverse).catch(e=>console.error(e))};
document.addEventListener("click",e=>{if(e.target&&e.target.id==="rvReset"){delete RV.st[V.tk];drawReverse();toast("Reverse DCF reset")}});
