"use strict";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const S={m:null,p:null,a:null,x:null,ccy:"USD",sel:"AAPL",tab:"overview",sort:{k:"marketCap",d:-1},w:{},chartType:"candle",ins:"",brush:null,drawn:{}};
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const fx=()=>S.ccy==="ARS"?(S.x.fx.ARS_BCRA||S.x.fx.ARS_market_yahoo):1;
const pct=(v,d=1)=>v==null?"—":(v*100).toFixed(d)+"%";
const sp=(v,d=1)=>v==null?"—":`<span class="${v>=0?"up":"dn"}">${v>=0?"+":""}${(v*100).toFixed(d)}%</span>`;
const big=v=>{if(v==null)return"—";v*=fx();const a=Math.abs(v),c=S.ccy==="ARS"?"ARS ":"$";return a>=1e12?c+(v/1e12).toFixed(2)+"T":a>=1e9?c+(v/1e9).toFixed(1)+"B":a>=1e6?c+(v/1e6).toFixed(1)+"M":c+v.toLocaleString("en-US",{maximumFractionDigits:2})};
const money=v=>v==null?"—":(S.ccy==="ARS"?"ARS ":"$")+(v*fx()).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const num=(v,d=2)=>v==null?"—":(+v).toFixed(d);
const co=t=>S.m.companies.find(c=>c.ticker===t);
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("show");clearTimeout(e._t);e._t=setTimeout(()=>e.classList.remove("show"),1800)}
function layout(extra={}){const tx=css("--tx"),mu=css("--mu"),bd=css("--bd");return Object.assign({paper_bgcolor:"rgba(0,0,0,0)",plot_bgcolor:"rgba(0,0,0,0)",font:{family:"Inter",color:tx,size:12},margin:{l:50,r:16,t:10,b:40},xaxis:{gridcolor:bd,zerolinecolor:bd,color:mu},yaxis:{gridcolor:bd,zerolinecolor:bd,color:mu},legend:{orientation:"h",y:1.08},hoverlabel:{font:{family:"Inter"}},transition:{duration:500,easing:"cubic-in-out"}},extra)}
const CFG={displaylogo:false,displayModeBar:false,responsive:true,modeBarButtonsToRemove:["lasso2d","autoScale2d","toggleSpikelines"]};
function plot(id,data,lay,cfg){const el=document.getElementById(id);el.classList.remove("sk");return Plotly.react(el,data,layout(lay),Object.assign({},CFG,cfg))}
function countUp(el,to,fmt){const t0=performance.now(),d=900;const f=n=>{const k=Math.min(1,(n-t0)/d),e=1-Math.pow(1-k,3);el.innerHTML=fmt(to*e);if(k<1)requestAnimationFrame(f);else el.innerHTML=fmt(to)};requestAnimationFrame(f)}
function kpi(l,v,s="",fmt){return{l,v,s,fmt}}
function renderKpis(el,arr){el.innerHTML=arr.map((k,i)=>`<div class="kpi" style="animation:fade .5s ${i*.06}s both"><div class="l">${k.l}</div><div class="v count" data-i="${i}"></div><div class="s">${k.s}</div></div>`).join("");arr.forEach((k,i)=>{const e=el.querySelector(`[data-i="${i}"]`);typeof k.v==="number"&&k.fmt?countUp(e,k.v,k.fmt):e.innerHTML=k.v})}

async function load(){
  const [m,p,a,x]=await Promise.all(["market","prices","activity","macro"].map(n=>fetch(`data/${n}.json`).then(r=>r.json())));
  Object.assign(S,{m,p,a,x});
  const d=new Date(m.generatedAt);
  $("#asof").textContent=`Market close ${m.asOf} · snapshot ${d.toISOString().slice(0,16).replace("T"," ")} UTC`;
  $("#foot").textContent=`Universe: ${m.companies.length} companies · ${a.filings.length} SEC filings · ${a.insiders.length} insider transactions · USD/ARS (BCRA) ${x.fx.ARS_BCRA??"n/a"} on ${x.fx.BCRA_date??"n/a"}`;
  m.companies.forEach(c=>{const s=S.p[c.ticker];c.spark=s.c.slice(-30)});
  ["AAPL","MSFT","JPM","XOM","MELI"].forEach(t=>S.w[t]=20);
  initUI();renderAll();
}
function tape(){const it=S.m.companies.map(c=>`<span data-t="${c.ticker}"><b>${c.ticker}</b> ${money(c.price)} ${sp(c.ret1d,2)}</span>`).join("");$("#tape").innerHTML=it+it;$$("#tape span").forEach(s=>s.onclick=()=>openCo(s.dataset.t))}
function initUI(){
  const tabs=$$("#tabs button");
  const ink=()=>{const b=$("#tabs .active");$("#ink").style.left=b.offsetLeft+"px";$("#ink").style.width=b.offsetWidth+"px"};
  tabs.forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));window.addEventListener("resize",ink);setTimeout(ink,50);S.ink=ink;
  $("#theme").onclick=()=>{const r=document.documentElement;r.dataset.theme=r.dataset.theme==="dark"?"light":"dark";localStorage.theme=r.dataset.theme;S.drawn={};renderTab()};
  if(localStorage.theme)document.documentElement.dataset.theme=localStorage.theme;
  $("#ccy").onclick=()=>{S.ccy=S.ccy==="USD"?"ARS":"USD";$("#ccy").textContent=S.ccy;toast(S.ccy==="ARS"?`Showing ARS at BCRA rate ${S.x.fx.ARS_BCRA}`:"Showing USD");S.drawn={};renderAll()};
  const q=$("#search"),sg=$("#sugg");let hi=0;
  const show=()=>{const v=q.value.trim().toLowerCase();if(!v){sg.style.display="none";return}
    const r=S.m.companies.filter(c=>c.ticker.toLowerCase().includes(v)||c.name.toLowerCase().includes(v)).slice(0,8);hi=0;
    sg.innerHTML=r.map((c,i)=>`<div data-t="${c.ticker}" class="${i?"":"hi"}"><span><b>${c.ticker}</b> ${c.name}</span><span class="muted">${c.sector}</span></div>`).join("")||'<div class="muted">No matches</div>';sg.style.display="block";
    $$("#sugg [data-t]").forEach(e=>e.onmousedown=()=>{openCo(e.dataset.t);q.value="";sg.style.display="none"})};
  q.oninput=show;q.onblur=()=>setTimeout(()=>sg.style.display="none",150);
  q.onkeydown=e=>{const it=$$("#sugg [data-t]");if(!it.length)return;if(e.key==="ArrowDown"||e.key==="ArrowUp"){hi=(hi+(e.key==="ArrowDown"?1:-1)+it.length)%it.length;it.forEach((x,i)=>x.classList.toggle("hi",i===hi));e.preventDefault()}if(e.key==="Enter"){openCo(it[hi].dataset.t);q.value="";sg.style.display="none"}};
  document.addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement.tagName!=="INPUT"){e.preventDefault();q.focus()}});
  const secs=[...new Set(S.m.companies.map(c=>c.sector))];$("#secFilter").innerHTML+=secs.map(s=>`<option>${s}</option>`).join("");
  $("#secFilter").onchange=$("#scrQ").oninput=screener;$("#tmMetric").onchange=treemap;
  seg("#moverSeg",k=>movers(k));seg("#chartType",k=>{S.chartType=k;priceChart()});seg("#insSeg",k=>{S.ins=k;insiders()});
  $("#ma50").onchange=$("#ma200").onchange=priceChart;$("#compare").onchange=priceChart;
  $("#pAdd").innerHTML=S.m.companies.map(c=>`<option>${c.ticker}</option>`).join("");
  $("#pAddBtn").onclick=()=>{const t=$("#pAdd").value;if(S.w[t]==null){S.w[t]=10;sliders();frontier();toast(`${t} added`)}};
  $("#pEq").onclick=()=>{const k=Object.keys(S.w);k.forEach(t=>S.w[t]=100/k.length);sliders();frontier()};
  $("#pMin").onclick=()=>applyOpt("min");$("#pMax").onclick=()=>applyOpt("max");
  const forms=[...new Set(S.a.filings.map(f=>f.form))];$("#fForm").innerHTML+=forms.map(f=>`<option>${f}</option>`).join("");
  $("#fTk").innerHTML+=S.m.corr.tickers.map(t=>`<option>${t}</option>`).join("");$("#fForm").onchange=$("#fTk").onchange=feed;
  if(location.hash){const [t,tk]=location.hash.slice(1).split("/");if(tk&&co(tk))S.sel=tk;if($(`[data-tab="${t}"]`))S.tab=t}
}
function seg(sel,cb){$$(sel+" button").forEach(b=>b.onclick=()=>{$$(sel+" button").forEach(x=>x.classList.remove("on"));b.classList.add("on");cb(b.dataset.k)})}
function switchTab(t){S.tab=t;$$("#tabs button").forEach(b=>b.classList.toggle("active",b.dataset.tab===t));$$(".tab").forEach(s=>s.classList.toggle("active",s.id===t));S.ink();history.replaceState(null,"",`#${t}${t==="company"?"/"+S.sel:""}`);setTimeout(renderTab,30)}
function openCo(t){S.sel=t;S.drawn.company=0;switchTab("company")}
function renderAll(){tape();switchTab(S.tab)}
function renderTab(){const t=S.tab;if(S.drawn[t])return void $$(`#${t} .js-plotly-plot`).forEach(e=>Plotly.Plots.resize(e));S.drawn[t]=1;
  ({overview:()=>{overviewK();treemap();movers("ret1d");screener()},company,risk:()=>{scatter();heat();selTable()},portfolio:()=>{sliders();frontier()},activity:()=>{activityK();feed();insiders();timeline();earnings()},macro,valuation:()=>valTab()})[t]()}

function overviewK(){const c=S.m.companies,cap=c.reduce((a,b)=>a+(b.marketCap||0),0),adv=c.filter(x=>x.ret1d>0).length;
  const spy=S.p.SPY.c,sr=spy.at(-1)/spy.at(-2)-1,s1y=spy.at(-1)/spy.at(-253)-1,mv=[...c].sort((a,b)=>b.ret1d-a.ret1d)[0];
  renderKpis($("#kpis"),[kpi("Universe market cap",cap,`${c.length} companies`,big),kpi("S&P 500 (SPY) 1D",`${sp(sr,2)}`,`1Y ${pct(s1y)}`),kpi("Breadth",`${adv}/${c.length}`,"advancing today"),kpi("Top gainer 1D",`${mv.ticker} ${sp(mv.ret1d)}`,mv.name),kpi("Median 1Y volatility",median(c.map(x=>x.vol))*100,"annualized",v=>v.toFixed(1)+"%"),kpi("Median P/E",median(c.map(x=>x.pe).filter(Boolean)),"trailing",v=>v.toFixed(1)+"x")])}
const median=a=>{a=[...a].filter(v=>v!=null).sort((x,y)=>x-y);return a[Math.floor(a.length/2)]};
function treemap(){const k=$("#tmMetric").value,c=S.m.companies.filter(x=>x.marketCap),secs=[...new Set(c.map(x=>x.sector))];
  const ids=[...secs,...c.map(x=>x.ticker)],par=[...secs.map(()=>""),...c.map(x=>x.sector)],val=[...secs.map(()=>0),...c.map(x=>x.marketCap)];
  const col=[...secs.map(s=>{const g=c.filter(x=>x.sector===s);return g.reduce((a,b)=>a+b[k]*b.marketCap,0)/g.reduce((a,b)=>a+b.marketCap,0)}),...c.map(x=>x[k])];
  const lim=Math.max(...col.map(Math.abs).filter(isFinite))||.01;
  plot("treemap",[{type:"treemap",ids,labels:ids,parents:par,values:val,branchvalues:"remainder",marker:{colors:col,colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],cmin:-lim,cmax:lim,line:{width:1.5,color:css("--bg")}},
    text:col.map(v=>(v>=0?"+":"")+(v*100).toFixed(2)+"%"),texttemplate:"<b>%{label}</b><br>%{text}",hovertemplate:"<b>%{label}</b><br>Cap: %{value:$.3s}<br>Return: %{text}<extra></extra>",pathbar:{visible:true}}],{margin:{l:0,r:0,t:24,b:0}});
  $("#treemap").on("plotly_click",e=>{const t=e.points[0].label;if(co(t))setTimeout(()=>openCo(t),300)})}
function movers(k){const c=[...S.m.companies].sort((a,b)=>b[k]-a[k]),top=c.slice(0,6),bot=c.slice(-6).reverse(),mx=Math.max(...c.map(x=>Math.abs(x[k])));
  const r=(x,i)=>`<div class="mv" style="animation-delay:${i*.04}s" data-t="${x.ticker}"><div><span class="tkr">${x.ticker}</span> <span class="muted small">${x.name.slice(0,22)}</span><div class="bar" style="width:${Math.abs(x[k])/mx*160}px;background:${x[k]>=0?"var(--up)":"var(--dn)"}"></div></div><b>${sp(x[k],2)}</b></div>`;
  $("#movers").innerHTML=`<div><p class="muted small">Leaders</p>${top.map(r).join("")}</div><div><p class="muted small">Laggards</p>${bot.map(r).join("")}</div>`;$$("#movers .mv").forEach(e=>e.onclick=()=>openCo(e.dataset.t))}
function spark(a){const mn=Math.min(...a),mx=Math.max(...a),w=80,h=22,pts=a.map((v,i)=>`${i/(a.length-1)*w},${h-(v-mn)/(mx-mn||1)*h}`).join(" ");return`<svg width="${w}" height="${h}"><polyline fill="none" stroke="${a.at(-1)>=a[0]?css("--up"):css("--dn")}" stroke-width="1.6" points="${pts}"/></svg>`}
const COLS=[["ticker","Ticker"],["name","Company"],["price","Price",money],["ret1d","1D",v=>sp(v,2)],["ret1m","1M",sp],["retYtd","YTD",sp],["ret1y","1Y",sp],["marketCap","Mkt cap",big],["pe","P/E",v=>num(v,1)],["netMargin","Net margin",pct],["revGrowth","Rev. growth",sp],["vol","Vol 1Y",pct],["beta","Beta",num],["maxDD","Max DD",sp],["spark","30D",spark]];
function table(el,rows,cols){el.innerHTML=`<thead><tr>${cols.map(c=>`<th data-k="${c[0]}">${c[1]}${S.sort.k===c[0]?(S.sort.d>0?" ▲":" ▼"):""}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr data-t="${r.ticker}">${cols.map(c=>`<td>${c[0]==="ticker"?`<span class="tkr">${r.ticker}</span>`:c[0]==="name"?`${r.name} <span class="badge">${r.sector}</span>`:c[2]?c[2](r[c[0]]):r[c[0]]}</td>`).join("")}</tr>`).join("")}</tbody>`;
  el.querySelectorAll("th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;if(k==="spark")return;S.sort={k,d:S.sort.k===k?-S.sort.d:-1};screener();selTable()});el.querySelectorAll("tbody tr").forEach(tr=>tr.onclick=()=>openCo(tr.dataset.t))}
const sorted=r=>[...r].sort((a,b)=>{const x=a[S.sort.k],y=b[S.sort.k];return typeof x==="string"?S.sort.d*x.localeCompare(y):S.sort.d*((x??-1e18)-(y??-1e18))});
function screener(){const s=$("#secFilter").value,q=$("#scrQ").value.toLowerCase();table($("#screener"),sorted(S.m.companies.filter(c=>(!s||c.sector===s)&&(!q||(c.ticker+c.name).toLowerCase().includes(q)))),COLS)}

const ma=(a,n)=>a.map((_,i)=>i<n-1?null:a.slice(i-n+1,i+1).reduce((x,y)=>x+y,0)/n);
function company(){const c=co(S.sel),p=S.p[S.sel];
  $("#coHead").innerHTML=`<div><div class="muted small">${c.sector} · ${c.industry||""}</div><h2 style="margin:4px 0">${c.name} <span class="tkr muted">${c.ticker}</span></h2><div class="big">${money(c.price)} <span style="font-size:18px">${sp(c.ret1d,2)}</span></div></div>
   <div class="kpis mini" style="min-width:min(520px,100%)">${[["Mkt cap",big(c.marketCap)],["1Y",sp(c.ret1y)],["Volatility",pct(c.vol)],["Beta",num(c.beta)]].map(x=>`<div class="kpi"><div class="l">${x[0]}</div><div class="v">${x[1]}</div></div>`).join("")}</div>`;
  priceChart();
  $("#fund").innerHTML=[["Market cap",big(c.marketCap)],["P/E (trailing)",num(c.pe,1)],["P/E (forward)",num(c.fwdPe,1)],["Gross margin",pct(c.grossMargin)],["Operating margin",pct(c.opMargin)],["Net margin",pct(c.netMargin)],["Revenue growth (YoY)",sp(c.revGrowth)],["Dividend yield",c.divYield!=null?c.divYield.toFixed(2)+"%":"—"],["YTD return",sp(c.retYtd)],["Max drawdown (1Y)",sp(c.maxDD)],["Current drawdown",sp(c.currDD)],["Next earnings",c.earningsDates[0]||"—"]].map(x=>`<span>${x[0]}</span><span>${x[1]}</span>`).join("");
  const r=c.recommendations||[],K=["strongBuy","buy","hold","sell","strongSell"],C=["#15803d","#22c55e","#94a3b8","#f97316","#dc2626"],L=["Strong buy","Buy","Hold","Sell","Strong sell"];
  r.length?plot("recs",K.map((k,i)=>({type:"bar",name:L[i],x:r.map(x=>({"0m":"Current","-1m":"-1M","-2m":"-2M","-3m":"-3M"})[x.period]||x.period),y:r.map(x=>x[k]),marker:{color:C[i]}})),{barmode:"stack",legend:{orientation:"h",y:-0.2,font:{size:10}},margin:{l:30,r:6,t:6,b:50}}):($("#recs").classList.remove("sk"),$("#recs").innerHTML='<p class="muted">No analyst data</p>');
  $("#target").innerHTML=c.targetPrice?`Mean target ${money(c.targetPrice)} (${sp(c.targetPrice/c.price-1)} vs price) · ${c.nAnalysts||"?"} analysts · consensus <b>${(c.recKey||"").replace("_"," ")}</b>`:"";
  const dv=c.dividends.filter(d=>d.d>=S.p[S.sel].d[0]);
  dv.length?plot("divs",[{type:"bar",x:dv.map(d=>d.d),y:dv.map(d=>d.a*fx()),marker:{color:css("--ac2")},hovertemplate:"%{x}<br>%{y:.3f}<extra></extra>"}],{margin:{l:44,r:6,t:6,b:40}}):($("#divs").classList.remove("sk"),$("#divs").innerHTML='<p class="muted">No dividends paid in the last 2 years</p>');
  const cl=p.c;let pk=-1;const dd=cl.map(v=>(pk=Math.max(pk,v),v/pk-1));
  plot("dd",[{type:"scatter",x:p.d,y:dd,fill:"tozeroy",line:{color:css("--dn"),width:1.4},fillcolor:"rgba(239,68,68,.18)",hovertemplate:"%{x}<br>%{y:.1%}<extra></extra>"}],{yaxis:{tickformat:".0%",gridcolor:css("--bd")},margin:{l:50,r:10,t:6,b:30}})}
function priceChart(){const p=S.p[S.sel],f=fx(),up=css("--up"),dn=css("--dn");let tr=[];
  const cmp=$("#compare").value.toUpperCase().split(/[ ,]+/).filter(t=>S.p[t]&&t!==S.sel);
  if(cmp.length){const base=S.p[S.sel].c,i0=Math.max(0,p.d.length-252);[S.sel,...cmp].forEach((t,j)=>{const q=S.p[t],o=q.d.length-p.d.length;tr.push({type:"scatter",mode:"lines",name:t,x:p.d.slice(i0),y:q.c.slice(i0+o).map(v=>(v/q.c[i0+o]-1)),line:{width:j?1.6:2.4},hovertemplate:t+" %{y:.1%}<extra></extra>"})});
    return plot("price",tr,{yaxis:{tickformat:".0%",gridcolor:css("--bd")},xaxis:{gridcolor:css("--bd")},hovermode:"x unified"})}
  tr.push(S.chartType==="candle"?{type:"candlestick",name:S.sel,x:p.d,open:p.o.map(v=>v*f),high:p.h.map(v=>v*f),low:p.l.map(v=>v*f),close:p.c.map(v=>v*f),increasing:{line:{color:up}},decreasing:{line:{color:dn}},yaxis:"y2"}
    :{type:"scatter",mode:"lines",name:S.sel,x:p.d,y:p.c.map(v=>v*f),line:{color:css("--ac"),width:2},fill:"tozeroy",fillcolor:"rgba(91,140,255,.08)",yaxis:"y2"});
  if($("#ma50").checked)tr.push({type:"scatter",mode:"lines",name:"MA50",x:p.d,y:ma(p.c,50).map(v=>v&&v*f),line:{color:"#f59e0b",width:1.3},yaxis:"y2"});
  if($("#ma200").checked)tr.push({type:"scatter",mode:"lines",name:"MA200",x:p.d,y:ma(p.c,200).map(v=>v&&v*f),line:{color:"#a855f7",width:1.3},yaxis:"y2"});
  tr.push({type:"bar",name:"Volume",x:p.d,y:p.v,marker:{color:p.c.map((v,i)=>i&&v<p.c[i-1]?"rgba(239,68,68,.45)":"rgba(34,197,94,.45)")},yaxis:"y",showlegend:false});
  const bd=css("--bd"),start=p.d[Math.max(0,p.d.length-126)];
  plot("price",tr,{hovermode:"x unified",yaxis:{domain:[0,.2],gridcolor:bd,showticklabels:false},yaxis2:{domain:[.25,1],gridcolor:bd,side:"right"},
    xaxis:{gridcolor:bd,range:[start,p.d.at(-1)],rangeslider:{visible:true,thickness:.06},type:"date",rangebreaks:[{bounds:["sat","mon"]}],
    rangeselector:{bgcolor:css("--bg2"),activecolor:css("--ac"),font:{color:css("--tx")},buttons:[{count:1,label:"1M",step:"month",stepmode:"backward"},{count:3,label:"3M",step:"month",stepmode:"backward"},{count:6,label:"6M",step:"month",stepmode:"backward"},{step:"year",stepmode:"todate",label:"YTD"},{count:1,label:"1Y",step:"year",stepmode:"backward"},{step:"all",label:"2Y"}]}},margin:{l:10,r:56,t:30,b:20}})}

const SC=["#5b8cff","#22d3ee","#f59e0b","#a855f7","#22c55e","#ef4444","#ec4899","#14b8a6","#eab308","#64748b","#f97316","#8b5cf6"];
function scatter(){const c=S.m.companies,secs=[...new Set(c.map(x=>x.sector))],rf=rfRate();
  const tr=secs.map((s,i)=>{const g=c.filter(x=>x.sector===s);return{type:"scatter",mode:"markers+text",name:s,x:g.map(x=>x.vol),y:g.map(x=>x.annRet),text:g.map(x=>x.ticker),customdata:g.map(x=>x.ticker),textposition:"top center",textfont:{size:10},
    marker:{size:g.map(x=>Math.max(9,Math.sqrt((x.marketCap||1e10)/1e9)*.55)),color:SC[i%SC.length],opacity:.85,line:{width:1,color:"#fff3"}},hovertemplate:"<b>%{customdata}</b><br>Vol %{x:.1%}<br>Return %{y:.1%}<extra>"+s+"</extra>"}});
  const mx=Math.max(...c.map(x=>x.vol))*1.05;
  plot("scatter",tr,{dragmode:"select",xaxis:{title:"Annualized volatility",tickformat:".0%",gridcolor:css("--bd")},yaxis:{title:"Annualized return (mean)",tickformat:".0%",gridcolor:css("--bd")},legend:{orientation:"h",y:-0.18,font:{size:10}},margin:{l:60,r:10,t:10,b:90},
    shapes:[{type:"line",x0:0,y0:rf,x1:mx,y1:rf+mx*.8,line:{dash:"dot",color:css("--mu"),width:1}}],annotations:[{x:mx*.85,y:rf+mx*.68,text:"Sharpe 0.8",showarrow:false,font:{size:10,color:css("--mu")}}]});
  const el=$("#scatter");el.on("plotly_selected",e=>{S.brush=e&&e.points.length?e.points.map(p=>p.customdata):null;selTable()});el.on("plotly_deselect",()=>{S.brush=null;selTable()});el.on("plotly_click",e=>openCo(e.points[0].customdata))}
function selTable(){const r=S.brush?S.m.companies.filter(c=>S.brush.includes(c.ticker)):S.m.companies,rf=rfRate();r.forEach(c=>c.sharpe=(c.annRet-rf)/c.vol);
  table($("#selTable"),sorted(r),[["ticker","Ticker"],["name","Company"],["annRet","Ann. return",sp],["vol","Volatility",pct],["sharpe","Sharpe",num],["beta","Beta",num],["maxDD","Max DD",sp],["ret1y","1Y",sp]])}
function heat(){const {tickers:t,m}=S.m.corr;plot("heat",[{type:"heatmap",x:t,y:t,z:m,zmin:-1,zmax:1,colorscale:[[0,"#2563eb"],[.5,css("--bg2")],[1,"#dc2626"]],hovertemplate:"%{y} vs %{x}<br>ρ = %{z:.2f}<extra></extra>",colorbar:{thickness:10}}],{margin:{l:56,r:10,t:10,b:56},xaxis:{tickfont:{size:9},showgrid:false},yaxis:{tickfont:{size:9},autorange:"reversed",showgrid:false}})}

const rfRate=()=>{const t=S.x.treasury[0];return t?(t["3 Mo"]||4)/100:.04};
function stats(tk,w){const T=S.m.corr.tickers,ix=tk.map(t=>T.indexOf(t));let mu=0,v=0;ix.forEach((a,i)=>{mu+=w[i]*S.m.mu[a];ix.forEach((b,j)=>v+=w[i]*w[j]*S.m.cov[a][b])});const sd=Math.sqrt(v);return{mu,sd,sh:(mu-rfRate())/sd}}
function rnd(n){const a=Array.from({length:n},()=>-Math.log(Math.random()));const s=a.reduce((x,y)=>x+y);return a.map(x=>x/s)}
function optimize(tk,kind){let best=null;for(let i=0;i<6000;i++){const w=rnd(tk.length),s=stats(tk,w),sc=kind==="min"?-s.sd:s.sh;if(!best||sc>best.sc)best={w,sc}}
  let w=best.w;for(let it=0;it<3000;it++){const i=Math.floor(Math.random()*tk.length),j=Math.floor(Math.random()*tk.length),d=Math.min(w[i],.02*Math.random());if(i===j)continue;const n=[...w];n[i]-=d;n[j]+=d;const s=stats(tk,n),sc=kind==="min"?-s.sd:s.sh;if(sc>best.sc){best={w:n,sc};w=n}}return w}
function applyOpt(k){const tk=Object.keys(S.w);if(tk.length<2)return toast("Add at least 2 assets");const w=optimize(tk,k);tk.forEach((t,i)=>S.w[t]=w[i]*100);sliders();frontier();toast(k==="min"?"Minimum-variance weights applied":"Max-Sharpe weights applied")}
function sliders(){const tk=Object.keys(S.w),tot=tk.reduce((a,t)=>a+S.w[t],0)||1;
  $("#sliders").innerHTML=tk.map(t=>`<div class="sl"><span class="tkr">${t}</span><input type="range" min="0" max="100" step="0.5" value="${S.w[t]}" data-t="${t}"><span>${(S.w[t]/tot*100).toFixed(1)}%</span><button class="x" data-x="${t}">×</button></div>`).join("");
  $$("#sliders input").forEach(i=>i.oninput=()=>{S.w[i.dataset.t]=+i.value;const tt=Object.values(S.w).reduce((a,b)=>a+b,0)||1;$$("#sliders .sl").forEach(r=>{const t=r.querySelector("input").dataset.t;r.children[2].textContent=(S.w[t]/tt*100).toFixed(1)+"%"});clearTimeout(S._ft);S._ft=setTimeout(()=>frontier(true),60)});
  $$("#sliders .x").forEach(b=>b.onclick=()=>{delete S.w[b.dataset.x];sliders();frontier()})}
function frontier(fast){const tk=Object.keys(S.w);if(tk.length<2){$("#pK").innerHTML="";return plot("frontier",[],{})}
  const tot=tk.reduce((a,t)=>a+S.w[t],0)||1,w=tk.map(t=>S.w[t]/tot),cur=stats(tk,w),rf=rfRate();
  if(!fast||!S.cloud||S.cloudKey!==tk.join()){const pts=[];for(let i=0;i<2500;i++){const ww=rnd(tk.length).map(x=>Math.pow(x,1+Math.random()*2));const s=ww.reduce((a,b)=>a+b);pts.push(stats(tk,ww.map(x=>x/s)))}
    const mv=stats(tk,optimize(tk,"min")),ms=stats(tk,optimize(tk,"max"));S.cloud={pts,mv,ms};S.cloudKey=tk.join()}
  const {pts,mv,ms}=S.cloud,indiv=tk.map(t=>stats([t],[1]));
  renderKpis($("#pK"),[kpi("Exp. return",cur.mu*100,"annualized",v=>v.toFixed(1)+"%"),kpi("Volatility",cur.sd*100,"annualized",v=>v.toFixed(1)+"%"),kpi("Sharpe",cur.sh,`rf ${(rf*100).toFixed(2)}% (3M T-bill)`,v=>v.toFixed(2)),kpi("Parametric VaR 95% (1D)",(1.645*cur.sd/Math.sqrt(252)-cur.mu/252)*100,"of portfolio value",v=>v.toFixed(2)+"%")]);
  plot("frontier",[{type:"scattergl",mode:"markers",name:"Random portfolios",x:pts.map(p=>p.sd),y:pts.map(p=>p.mu),marker:{size:4,color:pts.map(p=>p.sh),colorscale:"Viridis",opacity:.55,colorbar:{title:"Sharpe",thickness:10}},hovertemplate:"Vol %{x:.1%}<br>Ret %{y:.1%}<extra></extra>"},
    {type:"scatter",mode:"markers+text",name:"Assets",x:indiv.map(s=>s.sd),y:indiv.map(s=>s.mu),text:tk,textposition:"top center",marker:{size:9,color:css("--mu"),symbol:"diamond"}},
    {type:"scatter",mode:"markers",name:"Min variance",x:[mv.sd],y:[mv.mu],marker:{size:15,color:"#22d3ee",symbol:"star",line:{width:1,color:"#fff"}}},
    {type:"scatter",mode:"markers",name:"Max Sharpe",x:[ms.sd],y:[ms.mu],marker:{size:15,color:"#f59e0b",symbol:"star",line:{width:1,color:"#fff"}}},
    {type:"scatter",mode:"lines",name:"Capital market line",x:[0,ms.sd*1.6],y:[rf,rf+ms.sh*ms.sd*1.6],line:{dash:"dot",color:"#f59e0b",width:1}},
    {type:"scatter",mode:"markers",name:"Your portfolio",x:[cur.sd],y:[cur.mu],marker:{size:18,color:"#ef4444",line:{width:2,color:"#fff"}}}],
    {xaxis:{title:"Volatility",tickformat:".0%",gridcolor:css("--bd"),rangemode:"tozero"},yaxis:{title:"Expected return",tickformat:".0%",gridcolor:css("--bd")},legend:{orientation:"h",y:-0.2,font:{size:10}},margin:{l:56,r:10,t:10,b:80}})}

function activityK(){const f=S.a.filings,d30=new Date(S.m.asOf);d30.setDate(d30.getDate()-30);const r=f.filter(x=>new Date(x.date)>=d30),ins=S.a.insiders,sell=ins.filter(i=>i.ad==="D"&&i.code==="S").reduce((a,i)=>a+(i.shares||0)*(i.price||0),0),buy=ins.filter(i=>i.code==="P").reduce((a,i)=>a+(i.shares||0)*(i.price||0),0);
  renderKpis($("#aK"),[kpi("Filings, last 30 days",r.length,"SEC EDGAR",v=>Math.round(v)),kpi("8-K current reports",r.filter(x=>x.form==="8-K").length,"material events, 30 days",v=>Math.round(v)),kpi("Insider open-market sales",sell,"sampled Form 4s",big),kpi("Insider open-market buys",buy,"sampled Form 4s",big)])}
const FORMCLS=f=>({"8-K":"f8K","10-Q":"f10Q","10-K":"f10K","4":"f4"})[f]||"fo";
const ITEMS={"1.01":"Material agreement","2.02":"Results of operations","5.02":"Officer/director change","5.07":"Shareholder vote","7.01":"Reg FD disclosure","8.01":"Other events","9.01":"Exhibits","2.03":"Financial obligation","1.02":"Agreement terminated","3.02":"Unregistered equity sale","5.03":"Bylaw amendment"};
function feed(){const fm=$("#fForm").value,tk=$("#fTk").value,r=S.a.filings.filter(f=>(!fm||f.form===fm)&&(!tk||f.ticker===tk)).slice(0,250);
  $("#feed").innerHTML=r.map((f,i)=>`<a class="ev" href="${f.url}" target="_blank" rel="noopener" style="animation:fade .35s ${Math.min(i,20)*.02}s both"><span class="muted">${f.date}</span><span class="f ${FORMCLS(f.form)}">${f.form}</span><span><b class="tkr">${f.ticker}</b> ${f.items?f.items.split(",").map(x=>ITEMS[x]||x).filter(x=>x!=="Exhibits").join(" · "):(FDESC[f.form]||f.desc)}</span></a>`).join("")||'<p class="muted">No filings match</p>'}
const FDESC={"4":"Insider transaction report (Form 4)","10-Q":"Quarterly report (10-Q)","10-K":"Annual report (10-K)","20-F":"Annual report, foreign issuer (20-F)","6-K":"Foreign issuer current report (6-K)","DEF 14A":"Proxy statement","SC 13G":"Beneficial ownership >5% (passive)","SC 13D":"Beneficial ownership >5% (active)","8-K":"Current report"};
const CODES={P:"Open-market buy",S:"Open-market sale",A:"Grant/award",M:"Option exercise",F:"Tax withholding",G:"Gift",C:"Conversion",D:"Disposition to issuer"};
function insiders(){const r=S.a.insiders.filter(i=>!S.ins||i.ad===S.ins).sort((a,b)=>b.date.localeCompare(a.date));
  $("#insFeed").innerHTML=r.slice(0,150).map(i=>`<a class="ev" href="${i.url}" target="_blank" rel="noopener"><span class="muted">${i.date}</span><span class="f ${i.ad==="A"?"f4":"f8K"}">${i.code||"?"}</span><span><b class="tkr">${i.ticker}</b> ${i.owner||""} <span class="muted">${i.title||""}</span> — ${CODES[i.code]||i.code} ${i.shares?Math.round(i.shares).toLocaleString("en-US")+" sh":""}${i.price?" @ "+money(i.price):""}</span></a>`).join("")||'<p class="muted">None</p>';
  const by={};r.forEach(i=>{const v=(i.shares||0)*(i.price||0)*(i.ad==="D"?-1:1);by[i.ticker]=(by[i.ticker]||0)+v});const k=Object.keys(by).sort((a,b)=>by[a]-by[b]);
  plot("insChart",[{type:"bar",orientation:"h",y:k,x:k.map(t=>by[t]*fx()),marker:{color:k.map(t=>by[t]>=0?css("--up"):css("--dn"))},hovertemplate:"%{y}: %{x:$.3s}<extra>net value</extra>"}],{margin:{l:56,r:10,t:6,b:30},xaxis:{tickformat:"$.2s",gridcolor:css("--bd")},yaxis:{tickfont:{size:10}}})}
function timeline(){const f=S.a.filings.filter(x=>["8-K","10-Q","10-K","20-F","6-K"].includes(x.form)),forms=[...new Set(f.map(x=>x.form))];
  plot("timeline",forms.map((fm,i)=>{const g=f.filter(x=>x.form===fm);return{type:"scatter",mode:"markers",name:fm,x:g.map(x=>x.date),y:g.map(x=>x.ticker),customdata:g.map(x=>x.url),marker:{size:fm==="8-K"?8:12,symbol:fm==="8-K"?"circle":"diamond",color:SC[i]},hovertemplate:"%{y} · "+fm+"<br>%{x}<extra></extra>"}}),{margin:{l:56,r:10,t:20,b:30},yaxis:{tickfont:{size:9},gridcolor:css("--bd")},height:560});
  $("#timeline").style.height="560px";$("#timeline").on("plotly_click",e=>window.open(e.points[0].customdata,"_blank"))}
function earnings(){const r=S.m.companies.filter(c=>c.earningsDates[0]).sort((a,b)=>a.earningsDates[0].localeCompare(b.earningsDates[0]));
  $("#earn").innerHTML=r.map(c=>{const d=Math.round((new Date(c.earningsDates[0])-new Date(S.m.asOf))/864e5);return`<div class="ec" data-t="${c.ticker}"><b>${c.ticker}</b><div>${c.earningsDates[0]}</div><div class="muted small">${d>=0?"in "+d+" days":Math.abs(d)+" days ago"}</div></div>`}).join("");$$("#earn .ec").forEach(e=>e.onclick=()=>openCo(e.dataset.t))}

function macro(){const t=S.x.treasury,mats=["1 Mo","3 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"];if(!t.length)return;
  const now=t[0],m1=t[Math.min(21,t.length-1)],m6=t[Math.min(126,t.length-1)],fxv=S.x.fx;
  renderKpis($("#mK"),[kpi("10Y Treasury",now["10 Yr"],now.Date,v=>v.toFixed(2)+"%"),kpi("2Y Treasury",now["2 Yr"],now.Date,v=>v.toFixed(2)+"%"),kpi("10Y–2Y spread",(now["10 Yr"]-now["2 Yr"])*100,"basis points",v=>Math.round(v)+" bp"),kpi("USD/ARS (BCRA)",fxv.ARS_BCRA||0,fxv.BCRA_date||"",v=>v.toLocaleString("en-US",{maximumFractionDigits:2}))]);
  plot("curve",[[now,"Latest "+now.Date,css("--ac"),3],[m1,"~1M ago "+m1.Date,css("--ac2"),1.5],[m6,"~6M ago "+m6.Date,css("--mu"),1.5]].map(([r,n,c,w])=>({type:"scatter",mode:"lines+markers",name:n,x:mats,y:mats.map(k=>r[k]),line:{color:c,width:w,shape:"spline"}})),{yaxis:{title:"Yield (%)",gridcolor:css("--bd")},xaxis:{type:"category"}});
  const rv=[...t].reverse();plot("spread",[{type:"scatter",name:"10Y",x:rv.map(r=>new Date(r.Date)),y:rv.map(r=>r["10 Yr"]),line:{color:css("--ac")}},{type:"scatter",name:"2Y",x:rv.map(r=>new Date(r.Date)),y:rv.map(r=>r["2 Yr"]),line:{color:"#f59e0b"}},{type:"bar",name:"Spread (bp)",x:rv.map(r=>new Date(r.Date)),y:rv.map(r=>(r["10 Yr"]-r["2 Yr"])*100),yaxis:"y2",marker:{color:"rgba(34,211,238,.25)"}}],{hovermode:"x unified",yaxis:{title:"%",gridcolor:css("--bd")},yaxis2:{overlaying:"y",side:"right",title:"bp",showgrid:false}})}

load().catch(e=>{console.error(e);document.querySelector("main").innerHTML='<div class="card"><h3>Could not load data</h3><p class="muted">'+e+"</p></div>"});
