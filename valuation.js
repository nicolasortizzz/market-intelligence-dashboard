"use strict";
/* Valuation & M&A tab: DCF, comps, precedents, scenarios, Monte Carlo, scorecard.
   All projections are ESTIMATES driven by data/valuation_assumptions.json + real financials in data/valuation.json */
const V={tk:"META",scen:"base",ov:{},A:null,D:null,mc:{}};
const VT=["META","UNH","DIS","NIO"];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median2=a=>{a=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length/2;return a.length%2?a[m|0]:(a[m-1]+a[m])/2};
const quant=(a,q)=>{a=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*q,l=Math.floor(i);return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*(i-l)};
const last=(arr)=>{if(!arr)return null;for(let i=arr.length-1;i>=0;i--)if(arr[i]!=null)return arr[i];return null};
const lastIdx=(arr)=>{for(let i=arr.length-1;i>=0;i--)if(arr[i]!=null)return i;return -1};

async function loadVal(){if(V.D)return;const [d,a]=await Promise.all(["valuation","valuation_assumptions"].map(n=>fetch(`data/${n}.json`).then(r=>r.json())));V.D=d;V.A=a}

/* ---------- base inputs from real financials ---------- */
function inputs(tk){
  const c=V.D.companies[tk],a=V.A.companies[tk],k=c.financialCurrency==="CNY"?V.D.fx.CNYUSD:1;
  const I=c.income,CF=c.cashflow,B=c.balance,iy=lastIdx(I["Total Revenue"]);
  const rev0=I["Total Revenue"][iy]/k,ebit0=(I["Operating Income"]||I.EBIT)[iy]/k;
  const da0=(I["Reconciled Depreciation"]||[])[iy]/k||rev0*a.daPct0,capex0=-(CF["Capital Expenditure"]||[])[iy]/k;
  const fyEnd=new Date(I.years[iy]);
  const re=c.revenueEstimate||{},e0=re["0y"]?.avg,e1=re["+1y"]?.avg;
  const g1=e0?e0/k/rev0-1:0.05,g2=e0&&e1?e1/e0-1:g1*0.7;
  const shares=c.marketCap/c.price;
  const cash=(c.totalCash||0)/k,debt=(c.totalDebt||0)/k,minority=(last(B["Minority Interest"])||0)/k;
  const rf=(S.x.treasury[0]?.["10 Yr"]||4.5)/100,rawBeta=c.beta??1;
  const beta=a.betaOverride??(a.betaAdj==="blume"?0.67*rawBeta+0.33:rawBeta);
  return{c,a,k,rev0,ebit0,da0,capex0,fyEnd,g1,g2,shares,cash,debt,minority,rf,rawBeta,beta,netDebt:debt-cash,
    hist:I.years.map((y,i)=>({y:y.slice(0,4),fy:y,rev:I["Total Revenue"][i]/k,ebit:(I["Operating Income"]||[])[i]/k,ni:(I["Net Income"]||[])[i]/k,fcf:(CF["Free Cash Flow"]||[])[i]/k,capex:-(CF["Capital Expenditure"]||[])[i]/k})).filter(h=>h.rev)}
}
function scenario(tk,id){return V.A.companies[tk].scenarios.find(s=>s.id===id)}

/* ---------- DCF engine ---------- */
function dcf(tk,sid,ov={}){
  const b=inputs(tk),a=b.a,s=Object.assign({},scenario(tk,sid),ov.scen||{});
  const erp=ov.erp??V.A.erp,rf=ov.rf??b.rf,beta=ov.beta??b.beta,g=ov.g??(s.terminalG??a.terminalG);
  const ebitT=ov.ebitT??s.ebitT,mid=ov.mid??s.midGrowth,capexT=ov.capexT??(s.capexPctT??a.capexPctT),tax=a.tax,N=10;
  const ke=rf+beta*erp+(a.crp||0),kd=(rf+a.kdSpread)*(1-tax),E=b.c.marketCap,D=b.debt,wacc=ov.wacc??(ke*E+kd*D)/(E+D);
  const m0=b.ebit0/b.rev0,cap0=a.capexPct1,da0=b.da0/b.rev0;
  const today=new Date(S.m.asOf),rows=[];let rev=b.rev0,pv=0;
  for(let i=1;i<=N;i++){
    let gr=ov.gPath!=null?(i<=5?ov.gPath:ov.gPath+(g-ov.gPath)*(i-5)/5):i===1?b.g1+(s.growthAdj||0):i===2?b.g2+(s.growthAdj||0)*.8:i<=5?mid:mid+(g-mid)*(i-5)/5; // gPath: flat yrs 1-5 growth (reverse DCF)
    gr=Math.max(gr,-0.5);const prev=rev;rev*=1+gr;
    const m=i>=5?ebitT:m0+(ebitT-m0)*i/5,ebit=rev*m,dap=i>=6?a.daPctT:da0+(a.daPctT-da0)*i/6,cpp=i>=6?capexT:cap0+(capexT-cap0)*(i-1)/5;
    const nopat=ebit>0?ebit*(1-tax):ebit,da=rev*dap,capex=rev*cpp,dnwc=(rev-prev)*a.nwcPct,fcf=nopat+da-capex-dnwc;
    const end=new Date(b.fyEnd);end.setFullYear(end.getFullYear()+i);
    const yrsToEnd=(end-today)/3.156e10,frac=clamp(yrsToEnd,0,1)>=1?1:clamp(yrsToEnd,0,1),t=Math.max(yrsToEnd-frac/2,0.05);
    const df=Math.pow(1+wacc,-t),pvi=fcf*frac*df;pv+=pvi;
    rows.push({i,fy:"FY"+end.getFullYear(),gr,rev,m,ebit,nopat,da,capex,dnwc,fcf,frac,df,pv:pvi,t});
  }
  const L=rows[N-1],ronic=a.ronic||0.15,fcfT=L.nopat*(1+g)*(1-g/ronic); // value-driver terminal FCF: reinvestment = g / RONIC
  const tvBase=Math.max(fcfT,0)/Math.max(wacc-g,0.01),pvTV=tvBase*L.df;
  const shares=b.shares*Math.pow(1+(s.shareChange??a.shareChange),3);
  const ev=pv+pvTV,eq=ev-b.netDebt-b.minority+(s.oneOff||0)/1;
  const ps=Math.max(eq,0)/shares;
  return{b,s,rows,wacc,ke,kd,g,erp,rf,beta,ebitT,mid,capexT,pv,pvTV,tv:tvBase,ev,eq,ps,shares,tvShare:pvTV/ev};
}
function probWeighted(tk,ov){const sc=V.A.companies[tk].scenarios;let w=0,v=0;const out=sc.map(s=>{const r=dcf(tk,s.id,ov);v+=s.p*r.ps;w+=s.p;return{...s,ps:r.ps,r}});return{list:out,pw:v/w}}

/* ---------- comps & precedents ---------- */
function comps(tk){const b=inputs(tk),c=b.c,peers=c.peers.filter(p=>p.marketCap),self=c.self;
  const clean=(arr,lo,hi)=>arr.filter(x=>x!=null&&x>lo&&x<hi);
  const evE=clean(peers.map(p=>p.evEbitda),0,60),evS=clean(peers.map(p=>p.evSales),0.02,30),pe=clean(peers.map(p=>p.pe),0,80);
  const ebitda=(c.ebitdaTTM||0)/b.k,rev=(c.revenueTTM||0)/b.k,ni=self.netIncome;
  const toPS=ev=>Math.max(ev-b.netDebt-b.minority,0)/b.shares,r={};
  if(ebitda>0&&evE.length>=2)r.evEbitda=[quant(evE,.25),median2(evE),quant(evE,.75)].map(m=>toPS(m*ebitda));
  if(rev>0&&evS.length>=2)r.evSales=[quant(evS,.25),median2(evS),quant(evS,.75)].map(m=>toPS(m*rev));
  if(ni>0&&pe.length>=2)r.pe=[quant(pe,.25),median2(pe),quant(pe,.75)].map(m=>m*ni/b.shares);
  return{peers,self,r,ebitda,rev,ni,med:{evE:median2(evE),evS:median2(evS),pe:median2(pe)}}}
function precedent(tk){const b=inputs(tk),a=b.a,c=b.c,cp=a.controlPremium;let lo,hi,basis;
  if(a.precedentEvEbitda&&(c.ebitdaTTM||0)>0){const e=c.ebitdaTTM/b.k;[lo,hi]=a.precedentEvEbitda.map(m=>Math.max(m*e-b.netDebt-b.minority,0)/b.shares);basis=`${a.precedentEvEbitda[0]}-${a.precedentEvEbitda[1]}x EV/EBITDA (TTM)`}
  else{const r=c.revenueTTM/b.k;[lo,hi]=a.precedentEvSales.map(m=>Math.max(m*r-b.netDebt-b.minority,0)/b.shares);basis=`${a.precedentEvSales[0]}-${a.precedentEvSales[1]}x EV/Sales (TTM)`}
  return{lo,hi,basis,premLo:c.price*(1+cp[0]),premHi:c.price*(1+cp[1]),cp}}

/* ---------- Monte Carlo ---------- */
function randn(){let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function monteCarlo(tk,n=4000){const key=tk+JSON.stringify(V.ov[tk]||{});if(V.mc[key])return V.mc[key];
  const sc=V.A.companies[tk].scenarios,cum=[];let acc=0;sc.forEach(s=>cum.push(acc+=s.p));const out=[],base=dcf(tk,"base",V.ov[tk]);
  for(let i=0;i<n;i++){const u=Math.random()*acc,s=sc[cum.findIndex(c=>u<=c)];
    const wacc=base.wacc+randn()*0.0075,g=Math.min((s.terminalG??V.A.companies[tk].terminalG)+randn()*0.004,wacc-0.015);
    const r=dcf(tk,s.id,{...(V.ov[tk]||{}),wacc,g,ebitT:s.ebitT+randn()*Math.max(0.01,Math.abs(s.ebitT)*0.12),mid:s.midGrowth+randn()*0.015});out.push(r.ps)}
  out.sort((a,b)=>a-b);return V.mc[key]=out}

/* ---------- rendering ---------- */
const usd=v=>money(v),bn=v=>big(v);
function valTab(){loadVal().then(()=>{if(!$("#vSeg").dataset.init){$("#vSeg").dataset.init=1;$("#vSeg").innerHTML=VT.map(t=>`<button data-k="${t}" class="${t===V.tk?"on":""}">${t}</button>`).join("");seg("#vSeg",k=>{V.tk=k;V.scen="base";renderVal()})}renderVal()}).catch(e=>{console.error(e);toast("Valuation data failed to load")})}
function renderVal(){const tk=V.tk,a=V.A.companies[tk],b=inputs(tk);
  $("#vScen").innerHTML=a.scenarios.map(s=>`<option value="${s.id}" ${s.id===V.scen?"selected":""}>${s.name} (${Math.round(s.p*100)}%)</option>`).join("");
  const r0=dcf(tk,V.scen,V.ov[tk]);
  const sl=[["rf","Risk-free (10Y UST)",0.02,0.07,0.0005,r0.rf,pct2],["erp","Equity risk premium",0.03,0.07,0.0025,r0.erp,pct2],["beta","Beta",0.4,2.5,0.05,r0.beta,v=>v.toFixed(2)],["g","Terminal growth",0.0,0.045,0.0025,r0.g,pct2],["ebitT","Target EBIT margin (yr 5+)",-0.05,0.5,0.0025,r0.ebitT,pct2],["mid","Revenue growth yrs 3-5",-0.05,0.3,0.0025,r0.mid,pct2],["capexT","Steady-state capex % rev",0.003,0.3,0.0025,r0.capexT,pct2]];
  $("#vSliders").innerHTML=sl.map(([k,l,mn,mx,st,v,f])=>`<div class="vsl"><label>${l}<b id="vv_${k}">${f(v)}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" data-k="${k}"></div>`).join("")+`<p class="muted small">Beta: Yahoo 5Y ${b.rawBeta?.toFixed(2)} → used ${b.beta.toFixed(2)} ${a.betaNote?"· "+a.betaNote:a.betaAdj==="blume"?"(Blume-adjusted)":""}${a.crp?` · CRP ${(a.crp*100).toFixed(1)}%`:""}</p>`;
  $$("#vSliders input").forEach(i=>i.oninput=()=>{const f=sl.find(x=>x[0]===i.dataset.k)[6];$("#vv_"+i.dataset.k).textContent=f(+i.value);V.ov[tk]=Object.assign(V.ov[tk]||{},{[i.dataset.k]:+i.value});clearTimeout(V._t);V._t=setTimeout(()=>drawVal(false),70)});
  drawVal(true)}
const pct2=v=>(v*100).toFixed(2)+"%";
var drawVal=function(full){const tk=V.tk,a=V.A.companies[tk],ov=V.ov[tk]||{},r=dcf(tk,V.scen,ov),pw=probWeighted(tk,ov),cm=comps(tk),pr=precedent(tk),b=r.b,c=b.c;
  const compMid=median2(Object.values(cm.r).map(x=>x[1])),tri=compMid!=null?0.6*pw.pw+0.4*compMid:pw.pw,up=tri/c.price-1;
  a.score.valuation=Math.round(clamp(5+up*10,1,10));
  const total=((a.score.quality+a.score.growth+a.score.risk+a.score.valuation)/4);
  renderKpis($("#vK"),[kpi("Price ("+c.priceDate+")",c.price,c.name,usd),kpi(`DCF · ${r.s.name}`,r.ps,`WACC ${pct2(r.wacc)} · g ${pct2(r.g)}`,usd),kpi("Prob-weighted DCF",pw.pw,`${a.scenarios.length} scenarios`,usd),kpi("Triangulated fair value",tri,"60% DCF(pw) + 40% comps",usd),kpi("Implied upside",up*100,"vs current price",v=>`<span class="${v>=0?"up":"dn"}">${v>=0?"+":""}${v.toFixed(1)}%</span>`),kpi("Composite score",total,"quality · growth · risk · valuation",v=>v.toFixed(1)+"/10")]);
  // projections chart
  const H=b.hist,R=r.rows,f=fx()/1e9,fu=fx();
  plot("vProj",[{type:"bar",name:"Revenue (actual)",x:H.map(h=>"FY"+h.y),y:H.map(h=>h.rev*f),marker:{color:css("--mu")}},
    {type:"bar",name:"Revenue (projected)",x:R.map(x=>x.fy),y:R.map(x=>x.rev*f),marker:{color:"rgba(91,140,255,.75)"}},
    {type:"scatter",mode:"lines+markers",name:"FCF (actual)",x:H.map(h=>"FY"+h.y),y:H.map(h=>h.fcf*f),line:{color:"#a3a3a3",dash:"dot"}},
    {type:"scatter",mode:"lines+markers",name:"FCFF (projected)",x:R.map(x=>x.fy),y:R.map(x=>x.fcf*f),line:{color:css("--up"),width:2.5}},
    {type:"scatter",mode:"lines",name:"EBIT margin",x:[...H.map(h=>"FY"+h.y),...R.map(x=>x.fy)],y:[...H.map(h=>h.ebit/h.rev),...R.map(x=>x.m)],yaxis:"y2",line:{color:"#f59e0b",width:2,shape:"spline"}}],
    {barmode:"overlay",hovermode:"x unified",yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",ticksuffix:"B",tickformat:",.0f",hoverformat:",.1f",gridcolor:css("--bd")},yaxis2:{overlaying:"y",side:"right",tickformat:".0%",showgrid:false},legend:{orientation:"h",y:-0.15,font:{size:10}},margin:{l:56,r:46,t:10,b:70}});
  $("#vTable").innerHTML=`<thead><tr><th>Line item (USD, ESTIMATES)</th>${R.map(x=>`<th>${x.fy}</th>`).join("")}</tr></thead><tbody>${[["Revenue growth",x=>sp(x.gr)],["Revenue",x=>bn(x.rev)],["EBIT margin",x=>pct(x.m)],["EBIT",x=>bn(x.ebit)],["NOPAT",x=>bn(x.nopat)],["+ D&A",x=>bn(x.da)],["− Capex",x=>bn(x.capex)],["− ΔNWC",x=>bn(x.dnwc)],["= FCFF",x=>`<b>${bn(x.fcf)}</b>`],["Year fraction remaining",x=>x.frac.toFixed(2)],["Discount factor",x=>x.df.toFixed(3)],["PV of FCFF",x=>bn(x.pv)]].map(([l,fn])=>`<tr><td>${l}</td>${R.map(x=>`<td>${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  // bridge
  plot("vBridge",[{type:"waterfall",orientation:"v",x:["PV FCFF (10y)","PV terminal value","Enterprise value","− Net debt","− Minority int.",...(r.s.oneOff?["One-off (fine/settlement)"]:[]),"Equity value"],
    measure:["relative","relative","total","relative","relative",...(r.s.oneOff?["relative"]:[]),"total"],y:[r.pv*f,r.pvTV*f,0,-b.netDebt*f,-b.minority*f,...(r.s.oneOff?[r.s.oneOff*f]:[]),0],
    connector:{line:{color:css("--bd")}},increasing:{marker:{color:css("--up")}},decreasing:{marker:{color:css("--dn")}},totals:{marker:{color:css("--ac")}},text:[bn(r.pv),bn(r.pvTV),bn(r.ev),bn(-b.netDebt),bn(-b.minority),...(r.s.oneOff?[bn(r.s.oneOff)]:[]),bn(Math.max(r.eq,0))],textposition:"outside",cliponaxis:false,hoverinfo:"x+text"}],{yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",ticksuffix:"B",tickformat:",.0f",gridcolor:css("--bd")},margin:{l:64,r:10,t:44,b:60}});
  $("#vBridgeNote").innerHTML=`Terminal value = ${pct(r.tvShare)} of EV · Ke ${pct2(r.ke)} · Kd after-tax ${pct2(r.kd)} · diluted shares ${(r.shares/1e9).toFixed(3)}B${a.scenarios.find(s=>s.id===V.scen).shareChange||a.shareChange>0?" (after assumed dilution)":""}`;
  // sensitivity
  const ws=[-0.02,-0.015,-0.01,-0.005,0,0.005,0.01,0.015,0.02].map(d=>r.wacc+d),gs=[-0.01,-0.005,0,0.005,0.01].map(d=>r.g+d);
  const z=gs.map(g=>ws.map(w=>g<w-0.01?dcf(tk,V.scen,{...ov,wacc:w,g}).ps*fu:null));
  plot("vSens",[{type:"heatmap",x:ws.map(w=>pct2(w)),y:gs.map(g=>pct2(g)),z,text:z.map(rw=>rw.map(v=>v==null?"n/a":(S.ccy==="ARS"?"":"$")+v.toFixed(v>100?0:2))),texttemplate:"%{text}",colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],zmid:c.price*fu,hovertemplate:"WACC %{x} · g %{y}<br>%{text}/share<extra></extra>",colorbar:{thickness:10}}],{xaxis:{title:"WACC",type:"category"},yaxis:{title:"Terminal growth",type:"category"},margin:{l:70,r:10,t:10,b:50}});
  // comps table
  const P=[{...cm.self,ticker:tk+" (target)",isSelf:1},...cm.peers];
  $("#vComps").innerHTML=`<thead><tr><th>Company</th><th>Mkt cap</th><th>EV</th><th>EV/Sales</th><th>EV/EBITDA</th><th>P/E (TTM)</th><th>Fwd P/E</th><th>EBITDA mgn</th><th>Rev. growth</th></tr></thead><tbody>${P.map(p=>`<tr class="${p.isSelf?"selfrow":""}"><td><span class="tkr">${p.ticker}</span> <span class="muted small">${(p.name||"").slice(0,24)}</span></td><td>${bn(p.marketCap)}</td><td>${bn(p.ev)}</td><td>${num(p.evSales,2)}x</td><td>${p.evEbitda?num(p.evEbitda,1)+"x":"n.m."}</td><td>${p.pe?num(p.pe,1)+"x":"n.m."}</td><td>${p.forwardPE?num(p.forwardPE,1)+"x":"—"}</td><td>${pct(p.ebitdaMargin)}</td><td>${sp(p.revenueGrowth)}</td></tr>`).join("")}<tr class="medrow"><td>Peer median</td><td></td><td></td><td>${num(cm.med.evS,2)}x</td><td>${cm.med.evE?num(cm.med.evE,1)+"x":"n.m."}</td><td>${cm.med.pe?num(cm.med.pe,1)+"x":"n.m."}</td><td colspan="3" class="muted small">Outliers excluded (EV/EBITDA > 60x, P/E > 80x, negatives)</td></tr></tbody>`;
  $("#vPrec").innerHTML=`<p><b>Precedent / M&A view:</b> ${pr.basis} → <b>${usd(pr.lo)} – ${usd(pr.hi)}</b>/share. Control premium ${Math.round(pr.cp[0]*100)}–${Math.round(pr.cp[1]*100)}% on the unaffected price → <b>${usd(pr.premLo)} – ${usd(pr.premHi)}</b>.</p><p class="muted small">${a.precedentNote}</p>`;
  // football field
  const mc=monteCarlo(tk),scs=pw.list.map(x=>x.ps);
  const bars=[["52-week range",c.low52,c.high52],["Analyst targets",c.targetLow,c.targetHigh],...(cm.r.evEbitda?[["Comps EV/EBITDA (IQR)",cm.r.evEbitda[0],cm.r.evEbitda[2]]]:[]),...(cm.r.evSales?[["Comps EV/Sales (IQR)",cm.r.evSales[0],cm.r.evSales[2]]]:[]),...(cm.r.pe?[["Comps P/E (IQR)",cm.r.pe[0],cm.r.pe[2]]]:[]),["Precedent multiples",pr.lo,pr.hi],["Takeout (control premium)",pr.premLo,pr.premHi],["DCF scenarios (min–max)",Math.min(...scs),Math.max(...scs)],["Monte Carlo P10–P90",quant(mc,.1),quant(mc,.9)]].filter(x=>x[1]!=null&&x[2]!=null);
  const CL=["#64748b","#a855f7","#22d3ee","#14b8a6","#0ea5e9","#f59e0b","#f97316","#5b8cff","#22c55e"];
  plot("vFF",[{type:"bar",orientation:"h",y:bars.map(x=>x[0]),x:bars.map(x=>(x[2]-x[1])*fu),base:bars.map(x=>x[1]*fu),marker:{color:bars.map((_,i)=>CL[i%CL.length]),opacity:.85},text:bars.map(x=>`${usd(x[1])} – ${usd(x[2])}`),textposition:"inside",insidetextanchor:"middle",textfont:{color:"#fff",size:11},hovertemplate:"%{y}<br>%{text}<extra></extra>"}],
    {xaxis:{tickformat:"$,.2~f",gridcolor:css("--bd"),range:(()=>{const lo=Math.min(...bars.map(x=>x[1]),c.price),hi=Math.max(...bars.map(x=>x[2]),c.price);return[Math.max(0,lo-(hi-lo)*.08)*fu,(hi+(hi-lo)*.08)*fu]})()},yaxis:{autorange:"reversed",automargin:true},margin:{l:10,r:20,t:30,b:30},
     shapes:[{type:"line",x0:c.price*fu,x1:c.price*fu,y0:-0.5,y1:bars.length-0.5,line:{color:css("--dn"),width:2,dash:"dot"}},{type:"line",x0:tri*fu,x1:tri*fu,y0:-0.5,y1:bars.length-0.5,line:{color:css("--up"),width:2}}],
     annotations:[{x:c.price*fu,y:-0.5,yanchor:"bottom",text:"Price "+usd(c.price),showarrow:false,font:{color:css("--dn"),size:11}},{x:tri*fu,y:bars.length-0.5,yanchor:"top",text:"Fair value "+usd(tri),showarrow:false,font:{color:css("--up"),size:11}}]});
  // scenarios table
  $("#vScenTbl").innerHTML=`<thead><tr><th>Scenario</th><th>Prob.</th><th>Rev. CAGR (10y)</th><th>EBIT mgn (yr5+)</th><th>Fair value</th><th>vs price</th><th style="text-align:left">Thesis</th></tr></thead><tbody>${pw.list.map(s=>{const cagr=Math.pow(s.r.rows[9].rev/b.rev0,0.1)-1;return`<tr data-s="${s.id}" class="${s.id===V.scen?"selfrow":""}"><td><b>${s.name}</b></td><td>${Math.round(s.p*100)}%</td><td>${pct(cagr)}</td><td>${pct(s.r.ebitT)}</td><td><b>${usd(s.ps)}</b></td><td>${sp(s.ps/c.price-1)}</td><td class="wrap">${s.desc}</td></tr>`}).join("")}<tr class="medrow"><td>Probability-weighted</td><td>100%</td><td></td><td></td><td><b>${usd(pw.pw)}</b></td><td>${sp(pw.pw/c.price-1)}</td><td class="wrap muted">${V.A.probDefault}</td></tr></tbody>`;
  $$("#vScenTbl tr[data-s]").forEach(t=>t.onclick=()=>{V.scen=t.dataset.s;renderVal()});
  // monte carlo histogram
  const p10=quant(mc,.1),p50=quant(mc,.5),p90=quant(mc,.9),pUp=mc.filter(x=>x>c.price).length/mc.length,cap=quant(mc,.985);
  plot("vMC",[{type:"histogram",x:mc.filter(x=>x<=cap).map(x=>x*fu),nbinsx:60,marker:{color:"rgba(91,140,255,.7)",line:{color:css("--bg"),width:.5}},hovertemplate:"%{x}<br>%{y} sims<extra></extra>"}],
    {bargap:.02,xaxis:{tickformat:"$,.0f",title:"Fair value per share",gridcolor:css("--bd")},yaxis:{title:"Simulations",gridcolor:css("--bd")},margin:{l:56,r:10,t:24,b:50},
     shapes:[[c.price,css("--dn")],[p50,css("--up")],[p10,css("--mu")],[p90,css("--mu")]].map(([x,col])=>({type:"line",x0:x*fu,x1:x*fu,yref:"paper",y0:0,y1:1,line:{color:col,width:2,dash:col===css("--mu")?"dot":"solid"}})),
     annotations:[{x:c.price*fu,yref:"paper",y:1.04,text:"Price",showarrow:false,font:{color:css("--dn")}},{x:p50*fu,yref:"paper",y:1.04,text:"Median",showarrow:false,font:{color:css("--up")}}]});
  $("#vMCNote").innerHTML=`${mc.length.toLocaleString()} simulations: scenario drawn by probability, then WACC ±0.75pp, g ±0.4pp, margin ±12% (relative) and growth ±1.5pp (1σ). P10 <b>${usd(p10)}</b> · median <b>${usd(p50)}</b> · P90 <b>${usd(p90)}</b> · P(value > price) <b>${(pUp*100).toFixed(0)}%</b>`;
  // catalysts
  $("#vCat").innerHTML=a.catalysts.map((k,i)=>`<div class="cat" style="animation:fade .4s ${i*.05}s both"><span class="muted small">${k.date}</span><span class="badge">${k.q}</span><span>${k.event}</span><span class="imp imp${k.impact}">${k.impact} ${k.dir}</span></div>`).join("");
  if(a.boxOffice){$("#vQ").parentElement.style.display="";const bo=a.boxOffice,inc=(bo.hitWW-bo.baseWW)*bo.studioShare;
    const segs=[["Studio (theatrical)",inc,bo.studioMargin,"studio","#5b8cff"],["Home ent. / Disney+",bo.homeRev,bo.homeMargin,"home","#22d3ee"],["Consumer Products",bo.cpRev,bo.cpMargin,"cp","#f59e0b"],["Experiences",bo.expRev,bo.expMargin,"exp","#a855f7"]];
    plot("vQ",[...segs.map(([n,rv,mg,k,col])=>({type:"bar",name:n,x:bo.quarters.map(q=>q.q.split(" (")[0]),y:bo.quarters.map(q=>q[k]*rv*fu/1e6),marker:{color:col},customdata:bo.quarters.map(q=>q.q+" · reported "+q.report),hovertemplate:"%{customdata}<br>"+n+": $%{y:,.0f}M<extra></extra>"})),
      {type:"scatter",mode:"lines+markers",name:"Incremental operating income",x:bo.quarters.map(q=>q.q.split(" (")[0]),y:bo.quarters.map(q=>segs.reduce((s,[,rv,mg,k])=>s+q[k]*rv*mg,0)*fu/1e6),line:{color:css("--up"),width:3}}],
      {barmode:"stack",yaxis:{tickprefix:"$",ticksuffix:"M",tickformat:",.0f",title:"Incremental vs base",gridcolor:css("--bd")},legend:{orientation:"h",y:-0.2,font:{size:10}},margin:{l:56,r:10,t:10,b:70}});
    const totR=segs.reduce((s,[,rv,,k])=>s+bo.quarters.reduce((a2,q)=>a2+q[k],0)*rv,0),totOI=segs.reduce((s,[,rv,mg,k])=>s+bo.quarters.reduce((a2,q)=>a2+q[k],0)*rv*mg,0);
    const tailV=pw.list.find(s=>s.id==="marvelTail").ps,baseV=pw.list.find(s=>s.id==="base").ps,oneOffPS=totOI*(1-a.tax)/b.shares;
    $("#vQNote").innerHTML=`Worldwide gross ${bn(bo.hitWW)} vs ${bn(bo.baseWW)} base → FY2027 incremental revenue ≈ <b>${bn(totR)}</b>, operating income ≈ <b>${bn(totOI)}</b> (≈ ${usd(oneOffPS)}/share after tax, one-off). With the franchise halo (higher growth and margin) the tail fair value is <b>${usd(tailV)}</b> vs base <b>${usd(baseV)}</b>. ${bo.note}`}
  else $("#vQ").parentElement.style.display="none";
  // scorecard radar
  const sc=a.score,cats=["Quality","Growth","Risk (10 = low)","Valuation"],vals=[sc.quality,sc.growth,sc.risk,sc.valuation];
  plot("vRadar",[{type:"scatterpolar",r:[...vals,vals[0]],theta:[...cats,cats[0]],fill:"toself",fillcolor:"rgba(91,140,255,.25)",line:{color:css("--ac"),width:2},name:tk}],{polar:{bgcolor:"rgba(0,0,0,0)",radialaxis:{range:[0,10],gridcolor:css("--bd"),color:css("--mu")},angularaxis:{gridcolor:css("--bd"),color:css("--tx")}},margin:{l:70,r:70,t:30,b:30},showlegend:false});
  $("#vScore").innerHTML=`<div class="scores">${cats.map((c2,i)=>`<div><span class="muted small">${c2}</span><div class="sbar"><i style="width:${vals[i]*10}%"></i></div><b>${vals[i]}/10</b></div>`).join("")}</div><p>${sc.rationale.replace("Valuation: scored from the model's implied upside.",`Valuation: ${sc.valuation}/10, with triangulated fair value ${usd(tri)} vs price ${usd(c.price)} (${up>=0?"+":""}${(up*100).toFixed(1)}%).`)}</p>`;
  // assumptions
  $("#vAssump").innerHTML=`<div class="kv">${[["Base fiscal year",b.hist.at(-1).y+" (FY end "+b.fyEnd.toISOString().slice(0,10)+")"],["Reporting currency",c.financialCurrency+(b.k!==1?` → USD at ${b.k.toFixed(4)} CNY/USD (Yahoo FX)`:"")],["Base revenue / EBIT margin",bn(b.rev0)+" / "+pct(b.ebit0/b.rev0)],["Yr-1 / Yr-2 growth (consensus)",pct(b.g1)+" / "+pct(b.g2)],["Tax rate (assumed)",pct(a.tax)],["D&A % rev (now → yr 6)",pct(b.da0/b.rev0)+" → "+pct(a.daPctT)],["Capex % rev (yr 1 → yr 6)",pct(a.capexPct1)+" → "+pct(r.capexT)],["ΔNWC % of Δrevenue",pct(a.nwcPct)],["Net debt / Minority interest",bn(b.netDebt)+" / "+bn(b.minority)],["Share count change (3y, p.a.)",pct(r.s.shareChange??a.shareChange)],["Cost of debt (pre-tax)",pct2(r.rf+a.kdSpread)],["Analyst consensus",`${c.recKey||"—"} · ${c.nAnalysts||"?"} analysts · mean target ${usd(c.targetMean)}`]].map(x=>`<span>${x[0]}</span><span>${x[1]}</span>`).join("")}</div>`;
}
document.addEventListener("click",e=>{if(e.target&&e.target.id==="vReset"){delete V.ov[V.tk];V.scen="base";renderVal();toast("Assumptions reset")}});
document.addEventListener("change",e=>{if(e.target&&e.target.id==="vScen"){V.scen=e.target.value;renderVal()}});
function secTable(){const s=V.D.companies[V.tk].sec||{},tags=Object.keys(s).filter(k=>s[k]&&s[k].fy),yrs=[...new Set(tags.flatMap(t=>Object.keys(s[t].fy)))].sort().slice(-6);
  const nm={Revenues:"Revenues",RevenueFromContractWithCustomerExcludingAssessedTax:"Revenue (ASC 606)",OperatingIncomeLoss:"Operating income",NetIncomeLoss:"Net income",PaymentsToAcquirePropertyPlantAndEquipment:"Capex (PP&E)",NetCashProvidedByUsedInOperatingActivities:"Operating cash flow"};
  $("#vSec").innerHTML=tags.length?`<thead><tr><th>XBRL tag (${s.entity||""}, CIK ${s.cik||""})</th><th>Unit</th>${yrs.map(y=>`<th>CY${y}</th>`).join("")}</tr></thead><tbody>${tags.map(t=>`<tr><td>${nm[t]||t}</td><td>${s[t].unit}</td>${yrs.map(y=>`<td>${s[t].fy[y]!=null?(s[t].fy[y]/1e6).toLocaleString("en-US",{maximumFractionDigits:0}):"—"}</td>`).join("")}</tr>`).join("")}</tbody>`:'<tbody><tr><td class="muted">No XBRL facts available</td></tr></tbody>'}
const _dv=drawVal;drawVal=function(full){_dv(full);secTable()};
