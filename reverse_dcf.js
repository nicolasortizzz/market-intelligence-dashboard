"use strict";
/* Reverse DCF: which growth / margin does the CURRENT market price imply?
   Reuses the forward engine dcf() from valuation.js (same WACC build-up, tax, D&A, capex, ΔNWC, dilution,
   net debt, minority interest, terminal value). Two solves by bisection:
   (1) implied revenue CAGR for years 1-5 (flat), fading linearly to terminal g over years 6-10, at a chosen steady-state EBIT margin;
   (2) implied steady-state EBIT margin (reached by year 5) holding the Base-case revenue path. */
const RV={Q:null,st:{}};
async function loadRev(){if(RV.Q)return;try{RV.Q=await fetch("data/reverse_dcf.json").then(r=>r.json())}catch(e){RV.Q={quotes:{}}}}
function mktPx(tk){const q=RV.Q?.quotes?.[tk],c=V.D.companies[tk];return q?{p:q.price,d:q.priceDate,src:"yfinance close"}:{p:c.price,d:c.priceDate,src:"valuation snapshot"}}
function bisect(f,lo,hi,target,it=70){let flo=f(lo)-target,fhi=f(hi)-target;if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0)return null;
  for(let i=0;i<it;i++){const m=(lo+hi)/2,fm=f(m)-target;if(Math.abs(fm)<1e-7||hi-lo<1e-7)return m;if(fm*flo<0){hi=m;fhi=fm}else{lo=m;flo=fm}}return(lo+hi)/2}
function revOv(tk){const st=RV.st[tk]||{},ov={...(V.ov[tk]||{})};delete ov.gPath;if(st.wacc!=null)ov.wacc=st.wacc;if(st.g!=null)ov.g=st.g;return ov}
function reverse(tk){
  const ov=revOv(tk),base=dcf(tk,"base",ov),st=RV.st[tk]||{},mT=st.m??base.ebitT,px=mktPx(tk);
  const G=[-0.3,0.8],M=[-0.1,0.6];
  const fG=x=>dcf(tk,"base",{...ov,gPath:x,ebitT:mT}).ps,fM=x=>dcf(tk,"base",{...ov,ebitT:x}).ps;
  const gImp=bisect(fG,G[0],G[1],px.p),mImp=bisect(fM,M[0],M[1],px.p);
  const b=base.b,cagr=r=>Math.pow(r.rows[4].rev/b.rev0,1/5)-1,cagr10=r=>Math.pow(r.rows[9].rev/b.rev0,0.1)-1;
  const imp=gImp!=null?dcf(tk,"base",{...ov,gPath:gImp,ebitT:mT}):null;
  const H=b.hist,h0=H[0],hN=H.at(-1),nH=+hN.y-+h0.y,histCagr=nH>0?Math.pow(hN.rev/h0.rev,1/nH)-1:null;
  return{ov,base,mT,px,gImp,mImp,imp,baseCagr5:cagr(base),baseCagr10:cagr10(base),impCagr10:imp?cagr10(imp):null,histCagr,histYrs:`FY${h0.y}–FY${hN.y}`,G,M,fG}}
function drawReverse(){const tk=V.tk,el=$("#rvBox");if(!el)return;const R=reverse(tk),b=R.base.b,c=b.c,fu=fx(),st=RV.st[tk]||{},gr=pct2;
  $("#rvTitle").textContent=`Reverse DCF: what does ${tk} at ${usd(R.px.p)} imply?`;
  renderKpis($("#rvK"),[kpi(`Market price (${R.px.d})`,R.px.p,R.px.src,usd),
    kpi("Implied revenue CAGR (yrs 1-5)",R.gImp==null?"n/a":R.gImp*100,`10y ${R.impCagr10==null?"—":pct(R.impCagr10)} · at ${pct(R.mT)} EBIT margin`,v=>typeof v==="number"?v.toFixed(1)+"%":v),
    kpi("Base-case CAGR (yrs 1-5)",R.baseCagr5*100,`10y ${pct(R.baseCagr10)} · consensus FY1-2, then scenario`,v=>v.toFixed(1)+"%"),
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
     shapes:[{type:"line",xref:"paper",x0:0,x1:1,y0:R.px.p*fu,y1:R.px.p*fu,line:{color:css("--dn"),dash:"dot",width:2}},...[[R.gImp,css("--dn")],[R.baseCagr5,css("--up")],[R.histCagr,css("--mu")]].filter(x=>x[0]!=null).map(([x,col])=>({type:"line",x0:x,x1:x,yref:"paper",y0:0,y1:1,line:{color:col,width:1.5,dash:"dash"}}))],
     annotations:[{xref:"paper",x:0.01,y:R.px.p*fu,yanchor:"bottom",xanchor:"left",text:"Market price "+usd(R.px.p),showarrow:false,font:{color:css("--dn"),size:11}},
       ...(R.gImp!=null?[{x:R.gImp,yref:"paper",y:1,yanchor:"bottom",text:"Implied "+pct(R.gImp),showarrow:false,font:{color:css("--dn"),size:11}}]:[]),
       {x:R.baseCagr5,yref:"paper",y:0.92,text:"Base "+pct(R.baseCagr5),showarrow:false,font:{color:css("--up"),size:11}},
       ...(R.histCagr!=null?[{x:R.histCagr,yref:"paper",y:0.8,text:`Hist. ${R.histYrs} ${pct(R.histCagr)}`,showarrow:false,font:{color:css("--mu"),size:11}}]:[])]});
  // sensitivity grid: growth x margin with market-price contour
  const gs=[],ms=[];for(let x=-0.05;x<=0.4001;x+=0.05)gs.push(+x.toFixed(4));for(let m=-0.02;m<=0.18001;m+=0.01)ms.push(+m.toFixed(4));
  const z=ms.map(m=>gs.map(g=>dcf(tk,"base",{...R.ov,gPath:g,ebitT:m}).ps*fu));
  const P0=R.px.p*fu;
  // colour = log2(value / price), clipped to ±3 (⅛× … 8× the price) so high-margin cells don't wash out; labels/hover show the true $ value
  const LC=3,lz=z.map(r=>r.map(v=>clamp(Math.log2(Math.max(v,1e-9)/P0),-LC,LC))),cur=S.ccy==="ARS"?"ARS ":"$",fv=v=>cur+(v>=100?v.toFixed(0):v>=10?v.toFixed(1):v.toFixed(2));
  const tv=[-3,-2,-1,0,1,2,3],tt=tv.map(k=>(k===-LC?"≤ ":k===LC?"≥ ":"")+fv(P0*Math.pow(2,k))+(k===0?" (price)":""));
  plot("rvGrid",[{type:"heatmap",x:gs,y:ms,z:lz,customdata:z,text:z.map(r=>r.map(v=>(S.ccy==="ARS"?"":"$")+v.toFixed(v>100?0:2))),texttemplate:"%{text}",textfont:{size:10},colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],zmin:-LC,zmax:LC,zauto:false,hovertemplate:"CAGR %{x:.1%} · EBIT margin %{y:.1%}<br>%{text}/share<extra></extra>",colorbar:{thickness:10,tickvals:tv,ticktext:tt,title:{text:"$/share (log scale)",side:"right"}}},
    {type:"contour",x:gs,y:ms,z,contours:{coloring:"none",start:R.px.p*fu,end:R.px.p*fu,size:1,showlabels:true,labelfont:{color:"#fff",size:11}},line:{color:"#fde047",width:3},showscale:false,hoverinfo:"skip",name:"Market price"},
    {type:"scatter",mode:"markers",x:[R.baseCagr5],y:[R.base.ebitT],marker:{symbol:"star",size:15,color:"#fff",line:{color:"#000",width:1}},name:"Base case",hovertemplate:"Base case<extra></extra>"}],
    {xaxis:{title:"Revenue CAGR, years 1-5",tickformat:".0%",dtick:0.05},yaxis:{title:"Steady-state EBIT margin (yr 5+)",tickformat:".0%",dtick:0.01},showlegend:false,margin:{l:64,r:10,t:10,b:50}});
  // interpretation
  const cons=c.revenueEstimate||{},c0=cons["0y"]?.growth,c1=cons["+1y"]?.growth;
  const gTxt=R.gImp==null?`No revenue CAGR between ${pct(R.G[0],0)} and ${pct(R.G[1],0)} reconciles to the price at a ${pct(R.mT)} margin`:`At a ${pct(R.mT)} steady-state EBIT margin, ${usd(R.px.p)} implies revenue compounding at <b>${pct(R.gImp)}</b> a year for five years (then fading to ${pct(R.base.g)}), i.e. a 10-year CAGR of ${pct(R.impCagr10)}`;
  const d10=R.impCagr10==null?null:R.impCagr10-R.baseCagr10,rel=d10==null?"":Math.abs(d10)<0.005?"essentially <b>in line with</b>":d10<0?"<b>below</b>":"<b>above</b>";
  const vs=R.gImp==null?"":`On a like-for-like 10-year basis that is ${rel} the Base case (${pct(R.baseCagr10)} 10y; ${pct(R.baseCagr5)} over years 1-5, front-loaded by consensus ${c0!=null?sp(c0):"—"} / ${c1!=null?sp(c1):"—"} for the next two fiscal years)${R.histCagr!=null?`, and ${R.gImp<R.histCagr?"below":"above"} the ${R.histYrs} historical revenue CAGR of ${pct(R.histCagr)}`:""}.`;
  const mTxt=R.mImp==null?"Holding Base-case growth, no EBIT margin in the tested range matches the price.":`Holding Base-case growth instead, the price implies a steady-state EBIT margin of <b>${pct(R.mImp,2)}</b> vs ${pct(R.base.ebitT)} in the Base case (FY${b.hist.at(-1).y} actual: ${pct(b.ebit0/b.rev0)}).`;
  const pw=probWeighted(tk,R.ov).pw,cm=comps(tk),cMid=median2(Object.values(cm.r).map(x=>x[1])),tri=cMid!=null?0.6*pw+0.4*cMid:pw;
  const verdict=(R.base.ps>R.px.p?`The Base-case DCF of <b>${usd(R.base.ps)}</b> sits ${pct(R.base.ps/R.px.p-1)} above the price: the market is pricing a <b>less optimistic</b> path than the Base case.`:`The Base-case DCF of <b>${usd(R.base.ps)}</b> sits ${pct(1-R.base.ps/R.px.p)} below the price: the market is pricing a slightly <b>more optimistic</b> path than the Base case.`)+` The tab's triangulated fair value (<b>${usd(tri)}</b> = 60% probability-weighted DCF ${usd(pw)} + 40% comps ${cMid!=null?usd(cMid):"—"}) is ${tri>R.px.p?"above":"below"} the price mainly because of the ${Math.abs(cMid-pw)>Math.abs(pw-R.base.ps)?"comps leg":"scenario skew"}, not because the Base-case cash flows are undervalued.`;
  const lev=(()=>{const lo=dcf(tk,"base",{...R.ov,ebitT:R.base.ebitT-0.01}).ps,hi=dcf(tk,"base",{...R.ov,ebitT:R.base.ebitT+0.01}).ps;return`Sensitivity: ±1pp of steady-state EBIT margin moves the Base-case value by about ${usd((hi-lo)/2)}/share (${pct((hi-lo)/2/R.base.ps)}), so for a thin-margin business the margin, not the growth rate, is the main swing factor.`})();
  $("#rvNote").innerHTML=`<p>${gTxt}. ${vs}</p><p>${mTxt} ${verdict}</p><p class="muted small">${lev} Same engine and inputs as the DCF above (tax ${pct(R.base.b.a.tax)}, D&amp;A/capex glide paths, ΔNWC, dilution ${pct(R.base.s.shareChange??R.base.b.a.shareChange)}/yr for 3 years, ${b.netDebt<0?"net cash "+bn(-b.netDebt):"net debt "+bn(b.netDebt)}, minority interest ${bn(b.minority)}). Solved by bisection. Price: ${R.px.src}, ${R.px.d}. Model estimates, not investment advice.</p>`;
}
const _dv2=drawVal;drawVal=function(full){_dv2(full);loadRev().then(drawReverse).catch(e=>console.error(e))};
document.addEventListener("click",e=>{if(e.target&&e.target.id==="rvReset"){delete RV.st[V.tk];drawReverse();toast("Reverse DCF reset")}});
