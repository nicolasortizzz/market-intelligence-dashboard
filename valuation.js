"use strict";
/* Valuation & M&A tab: DCF, comps, precedents, scenarios, Monte Carlo, scorecard.
   All projections are ESTIMATES driven by data/valuation_assumptions.json + real financials in data/valuation.json */
const V={tk:"META",scen:"base",ov:{},A:null,D:null,mc:{}};
const VT=["META","UNH","DIS","NIO","YPF","GGAL","MU","ASML","VST","ABEV","UBER","BE","AVGO","VIST","TSM","SPCX","005930.KS","000660.KS","GOOGL","XOM","CVX","COP","EOG","OXY","DVN","SLB","PBR","PRIO3.SA","CEG","NRG","NEE","DUK","SO","AEP","EQTL3.SA","CMIG4.SA","CPFE3.SA","CPLE3.SA","TAEE11.SA","AXIA3.SA","EGIE3.SA","BEP","GEV","FSLR","CCJ","OKLO","SMR","MRK","BMY"];
const isBank=tk=>["bank","utility"].includes(V.A.companies[tk].model); // equity (residual-income) engine: banks and regulated utilities
const isUtil=tk=>V.A.companies[tk].model==="utility",UN=()=>isUtil(V.tk)?"share":"ADR";
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const median2=a=>{a=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!a.length)return null;const m=a.length/2;return a.length%2?a[m|0]:(a[m-1]+a[m])/2};
const quant=(a,q)=>{a=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*q,l=Math.floor(i);return a[l]+(a[Math.min(l+1,a.length-1)]-a[l])*(i-l)};
const last=(arr)=>{if(!arr)return null;for(let i=arr.length-1;i>=0;i--)if(arr[i]!=null)return arr[i];return null};
const lastIdx=(arr)=>{for(let i=arr.length-1;i>=0;i--)if(arr[i]!=null)return i;return -1};

async function loadVal(){if(V.D)return;const [d,a]=await Promise.all(["valuation","valuation_assumptions"].map(n=>fetch(`data/${n}.json`).then(r=>r.json())));V.D=d;V.A=a}

/* ---------- base inputs from real financials ---------- */
function inputs(tk){
  if(isBank(tk))return inputsBank(tk);
  const c=V.D.companies[tk],a=V.A.companies[tk],k=(c.financialCurrency&&c.financialCurrency!=="USD"&&V.D.fx[c.financialCurrency+"USD"])||1; // units of reporting currency per USD (CNY: Yahoo FX, EUR: ECB)
  const I=c.income,CF=c.cashflow,B=c.balance,iy=lastIdx(I["Total Revenue"]);
  const rev0=a.revBase0??I["Total Revenue"][iy]/k,ebit0=(I["Operating Income"]||I.EBIT)[iy]/k;
  const da0=(I["Reconciled Depreciation"]||[])[iy]/k||rev0*a.daPct0,capex0=-(CF["Capital Expenditure"]||[])[iy]/k;
  const fyEnd=new Date(I.years[iy]);
  const re=c.revenueEstimate||{},e0=re["0y"]?.avg,e1=re["+1y"]?.avg;
  const g1=a.g1??(e0?e0/k/rev0-1:0.05),g2=a.g2??(e0&&e1?e1/e0-1:g1*0.7);
  const shares=c.marketCap/c.price;
  const cash=(c.totalCash||0)/k,debt=(c.totalDebt||0)/k,minority=(last(B["Minority Interest"])||0)/k,nonOp=a.nonOpAssets?((last(B[a.nonOpAssets.row]||[])??a.nonOpAssets.fallback??0)/k):0; // non-operating equity stakes added in the EV bridge (UBER)
  // convertible notes (if-converted): in-the-money notes are treated as equity (conversion shares added, principal removed from debt);
  // out-of-the-money notes stay as debt. a.converts=[{name,principal,convPrice}] from the latest 10-Q (BE)
  let shares2=shares,debt2=debt,cvAdd=0,cvDebt=0;for(const n of a.converts||[]){if(c.price>n.convPrice){cvAdd+=n.principal/n.convPrice;cvDebt+=n.principal/k}}shares2+=cvAdd;debt2-=cvDebt;
  const rf=(S.x.treasury[0]?.["10 Yr"]||4.5)/100,rawBeta=c.beta??1;
  const beta=a.betaOverride??(a.betaAdj==="blume"?0.67*rawBeta+0.33:rawBeta);
  if(a.ddm){const u=c.marketCap/c.price,D=a.ddm.d0*u; // DDM through the FCFF engine (BEP): "revenue" = total distributions, 100% "margin", no tax/capex/debt, discounted at Ke
    return{c,a,k:1,rev0:D,ebit0:D,da0:0,capex0:0,fyEnd,g1:a.g1??0.05,g2:a.g2??0.05,cash:0,debt:0,shares:u,cvAdd:0,cvDebt:0,minority:0,nonOp:0,rf,rawBeta,beta,netDebt:0,lt:1,ddm:true,
      hist:I.years.map((y,i)=>({y:y.slice(0,4),fy:y,rev:I["Total Revenue"][i],ebit:(I["Operating Income"]||[])[i],ni:(I["Net Income"]||[])[i],fcf:(CF["Free Cash Flow"]||[])[i],capex:-(CF["Capital Expenditure"]||[])[i]})).filter(h=>h.rev)}}
  const LT=a.lookThrough; // look-through ownership (BEP): consolidated cash flows, partner-owned share of equity excluded via LT.share, economic units LT.units
  if(LT){shares2=LT.units}
  return{c,a,k,rev0,ebit0,da0,capex0,fyEnd,g1,g2,shares,cash,debt:debt2,shares:shares2,lt:LT?LT.share:1,cvAdd,cvDebt,minority,nonOp,rf,rawBeta,beta,netDebt:debt2-cash,
    hist:I.years.map((y,i)=>({y:y.slice(0,4),fy:y,rev:I["Total Revenue"][i]/k,ebit:(I["Operating Income"]||[])[i]/k,ni:(I["Net Income"]||[])[i]/k,fcf:(CF["Free Cash Flow"]||[])[i]/k,capex:-(CF["Capital Expenditure"]||[])[i]/k})).filter(h=>h.rev)}
}
/* Bank inputs (GGAL): per ADR in USD. Book value = IAS 29-restated equity / ADR-equivalent shares / BCRA rate on the balance-sheet date. */
function inputsBank(tk){if(isUtil(tk))return inputsUtil(tk);const c=V.D.companies[tk],a=V.A.companies[tk],bk=c.bank,bv0=bk.bvPerADR,shares=bk.adrShares;
  const rf=(S.x.treasury[0]?.["10 Yr"]||4.5)/100,rawBeta=c.beta??1,beta=a.betaOverride??rawBeta;
  const roe1=bk.eps0y?bk.eps0y/bv0:0.1,roe2=bk.eps1y?bk.eps1y/(bv0*1.1):roe1;
  return{c,a,k:V.D.fx.ARSUSD_BCRA,bank:true,bv0,shares,roe1,roe2,rev0:bv0,ebit0:bk.niTTMperADR,fyEnd:new Date(c.income.years[lastIdx(c.income["Total Revenue"])]),
    g1:0,g2:0,cash:0,debt:0,minority:0,netDebt:0,rf,rawBeta,beta,hist:[]}}
/* Regulated utilities: residual income on book equity, per listed share in USD (Brazil: B3 share/unit at PTAX). Regulated returns are earned on the
   regulated asset base, which book equity finances, so value = book + PV[(ROE - Ke) x book]; the dividend path (DDM view) is the implied payout
   NI - change in book. Book/share = price / P/B (both in the same currency), NI TTM and consensus EPS converted at the model's official rate. */
function inputsUtil(tk){const c=V.D.companies[tk],a=V.A.companies[tk],k=(c.financialCurrency&&c.financialCurrency!=="USD"&&V.D.fx[c.financialCurrency+"USD"])||1;
  if(!c.bank){const shares=c.marketCap/c.price,bv0=c.price/c.self.pb,E=c.earningsEstimate||{},cv=e=>{if(e?.avg==null)return null;const ec=e.currency||c.financialCurrency;return ec==="USD"?e.avg:ec===c.financialCurrency?e.avg/k:null};
    const L=r=>{const v=(c.cashflow?.[r]||[]).filter(x=>x!=null);return v.length?v.at(-1):null},dv=L("Cash Dividends Paid");
    c.bank={util:true,adrRatio:1,adrShares:shares,bvPerADR:bv0,bvDate:c.balanceDate||"latest quarter",niTTMperADR:(c.self.netIncome||0)/shares,
      eps0y:cv(E["0y"]),eps1y:cv(E["+1y"]),divTTMperADR:dv!=null?Math.abs(dv/k)/shares:null,fx:k,ccy:c.financialCurrency}}
  const bk=c.bank,bv0=bk.bvPerADR,rf=(S.x.treasury[0]?.["10 Yr"]||4.5)/100,rawBeta=c.beta??1,beta=a.betaOverride??(a.betaAdj==="blume"?0.67*rawBeta+0.33:rawBeta);
  const roe1=bk.eps0y?bk.eps0y/bv0:bk.niTTMperADR/bv0,roe2=bk.eps1y?bk.eps1y/(bv0*(1+(a.bookG1??0.04))):roe1;
  return{c,a,k,bank:true,util:true,bv0,shares:bk.adrShares,roe1,roe2,rev0:bv0,ebit0:bk.niTTMperADR,fyEnd:new Date(c.income.years[lastIdx(c.income["Total Revenue"])]),
    g1:0,g2:0,cash:0,debt:0,minority:0,netDebt:0,rf,rawBeta,beta,hist:[]}}
function scenario(tk,id){return V.A.companies[tk].scenarios.find(s=>s.id===id)}

/* ---------- DCF engine ---------- */
function dcf(tk,sid,ov={}){
  if(isBank(tk))return bankRI(tk,sid,ov);
  const b=inputs(tk),a=b.a,s=Object.assign({},scenario(tk,sid),ov.scen||{});
  const erp=ov.erp??V.A.erp,rf=ov.rf??b.rf,beta=ov.beta??b.beta,g=ov.g??(s.terminalG??a.terminalG);
  const ebitT=ov.ebitT??s.ebitT,mid=ov.mid??s.midGrowth,capexT=ov.capexT??(s.capexPctT??a.capexPctT),tax=a.tax,N=10;
  const ke=rf+beta*erp+(a.crp||0)+(s.crpAdd||0),kd=(rf+a.kdSpread)*(1-tax),E=b.c.marketCap,D=b.debt,wacc=ov.wacc??(ke*E+kd*D)/(E+D);
  const m0=b.ebit0/b.rev0,cap0=a.capexPct1,da0=b.da0/b.rev0;
  const today=new Date(S.m.asOf),rows=[];let rev=b.rev0,pv=0;
  for(let i=1;i<=N;i++){
    let gr=ov.gPath!=null?(i<=5?ov.gPath:ov.gPath+(g-ov.gPath)*(i-5)/5):i===1?(s.g1??b.g1+(s.growthAdj||0)):i===2?(s.g2??b.g2+(s.growthAdj||0)*.8):i<=5?mid:mid+(g-mid)*(i-5)/5; // gPath: flat yrs 1-5 growth (reverse DCF)
    gr=Math.max(gr,-0.5);const prev=rev;rev*=1+gr;
    const e1=s.ebit1??a.ebit1,m=i>=5?ebitT:e1!=null?e1+(ebitT-e1)*(i-1)/4:m0+(ebitT-m0)*i/5,ebit=rev*m,dap=i>=6?a.daPctT:da0+(a.daPctT-da0)*i/6,cpp=i>=6?capexT:cap0+(capexT-cap0)*(i-1)/5;
    const nopat=ebit>0?ebit*(1-tax):ebit,da=rev*dap,capex=rev*cpp,dnwc=(rev-prev)*a.nwcPct,fcf=nopat+da-capex-dnwc;
    const end=new Date(b.fyEnd);end.setFullYear(end.getFullYear()+i);
    const yrsToEnd=(end-today)/3.156e10,frac=clamp(yrsToEnd,0,1)>=1?1:clamp(yrsToEnd,0,1),t=Math.max(yrsToEnd-frac/2,0.05);
    const df=Math.pow(1+wacc,-t),pvi=fcf*frac*df;pv+=pvi;
    rows.push({i,fy:"FY"+end.getFullYear(),gr,rev,m,ebit,nopat,da,capex,dnwc,fcf,frac,df,pv:pvi,t});
  }
  const L=rows[N-1],ronic=a.ronic||0.15,fcfT=L.nopat*(1+g)*(1-g/ronic); // value-driver terminal FCF: reinvestment = g / RONIC
  const tvBase=Math.max(fcfT,0)/Math.max(wacc-g,0.01),pvTV=tvBase*L.df;
  const shares=b.shares*Math.pow(1+(s.shareChange??a.shareChange),3);
  const ev=pv+pvTV,eq=(ev-b.netDebt-(b.lt<1?0:b.minority)+(b.nonOp||0)+(s.oneOff||0)/1)*(b.lt||1);
  const ps=Math.max(eq,0)/shares;
  return{b,s,rows,wacc,ke,kd,g,erp,rf,beta,ebitT,mid,capexT,pv,pvTV,tv:tvBase,ev,eq,ps,shares,tvShare:pvTV/ev};
}
/* Residual-income (excess-return) model for banks, per ADR in USD:
   value = B0 + sum PV[(ROE_t - Ke) x B_(t-1)] + PV[(ROE_T - Ke) x B_10 / (Ke - g)]. ROE: consensus EPS for FY1-2 (+/- scenario adj.), then linear to the
   sustainable ROE (ebitT) by year 5. Book growth (mid) flat in years 1-5, fading to g by year 10; implied payout = NI - change in book. */
function bankRI(tk,sid,ov={}){
  const b=inputs(tk),a=b.a,s=Object.assign({},scenario(tk,sid),ov.scen||{});
  const erp=ov.erp??V.A.erp,rf=ov.rf??b.rf,beta=ov.beta??b.beta,g=ov.g??(s.terminalG??a.terminalG),N=10;
  const roeT=ov.ebitT??s.ebitT,mid=ov.mid??s.midGrowth,ke0=rf+beta*erp+(a.crp||0)+(s.crpAdd||0),ke=ov.wacc??ke0;
  const r1=b.roe1+(s.roeAdj||0),r2=b.roe2+(s.roeAdj||0)*.8,today=new Date(S.m.asOf),rows=[];let B=b.bv0,pv=0;
  for(let i=1;i<=N;i++){
    const gb=ov.gPath!=null?(i<=5?ov.gPath:ov.gPath+(g-ov.gPath)*(i-5)/5):(i<=5?mid:mid+(g-mid)*(i-5)/5);
    const roe=i===1?r1:i===2?r2:i>=5?roeT:r2+(roeT-r2)*(i-2)/3,B0=B,ni=roe*B0,ri=(roe-ke)*B0;B=B0*(1+gb);const div=ni-(B-B0);
    const end=new Date(b.fyEnd);end.setFullYear(end.getFullYear()+i);
    const yrsToEnd=(end-today)/3.156e10,frac=clamp(yrsToEnd,0,1),t=Math.max(yrsToEnd,0.05),df=Math.pow(1+ke,-t),pvi=ri*frac*df;pv+=pvi;
    rows.push({i,fy:"FY"+end.getFullYear(),gr:gb,rev:B,b0:B0,m:roe,ni,charge:ke*B0,ri,div,payout:ni>0?div/ni:null,frac,df,pv:pvi,t,fcf:ri});
  }
  const L=rows[N-1],tv=(roeT-ke)*L.rev/Math.max(ke-g,0.01),pvTV=tv*L.df,one=(s.oneOff||0)/b.shares;
  const eq=b.bv0+pv+pvTV+one,ps=Math.max(eq,0);
  return{b,s,rows,wacc:ke,ke,kd:0,g,erp,rf,beta,ebitT:roeT,mid,capexT:null,pv,pvTV,tv,ev:eq,eq,ps,shares:b.shares,tvShare:pvTV/Math.max(eq,1e-9),bank:true,one}}
function probWeighted(tk,ov){const sc=V.A.companies[tk].scenarios;let w=0,v=0;const out=sc.map(s=>{const r=dcf(tk,s.id,ov);v+=s.p*r.ps;w+=s.p;return{...s,ps:r.ps,r}});return{list:out,pw:v/w}}

/* ---------- comps & precedents ---------- */
function comps(tk){if(isBank(tk))return compsBank(tk);if(V.A.companies[tk].ddm){const c=V.D.companies[tk];return{peers:c.peers.filter(p=>p.marketCap),self:c.self,r:{},use:[],med:{},ddm:true}}const b=inputs(tk),c=b.c,ref=b.a.compsRef||[],peers=c.peers.filter(p=>p.marketCap).map(p=>ref.includes(p.ticker)?{...p,ref:1}:p),self=c.self;
  const clean=(arr,lo,hi)=>arr.filter(x=>x!=null&&x>lo&&x<hi),pS=peers.filter(p=>!p.ref&&!(b.a.compsExcludeNegEbitda&&!(p.ebitda>0))); // reference-only peers are shown but excluded from the statistics
  const evE=clean(pS.map(p=>p.evEbitda),0,60),evS=clean(pS.map(p=>p.evSales),0.02,30),pe=clean(pS.filter(p=>!(b.a.peExcludePeers||[]).includes(p.ticker)).map(p=>p.pe),0,80);
  let ebitda=(c.ebitdaTTM||0)/b.k,rev=(c.revenueTTM||0)/b.k,ni=self.netIncome!=null?self.netIncome-(b.a.peNIExclude||0):null; // peNIExclude: one-off items (e.g. tax valuation-allowance release) removed before P/E
  const toPS=ev=>Math.max(ev-b.netDebt-(b.lt<1?0:b.minority)+(b.nonOp||0),0)*(b.lt||1)/b.shares,r={};
  // compsCycle (per-ticker option for cyclicals, e.g. memory): peer TTM multiples are applied to THROUGH-CYCLE earnings = average of the
  // last N fiscal years plus TTM (each once), not peak TTM; only the listed metrics feed the comps value (EV/Sales off: mix differs).
  let cyc=null;const cc=b.a.compsCycle;
  if(cc){const I=c.income,n=cc.years||4,avg=(row,ttm)=>{const v=(I[row]||[]).filter(x=>x!=null).slice(-n).map(x=>x/b.k);v.push(ttm);return{v:v.reduce((p,q)=>p+q,0)/v.length,yrs:I.years.filter((y,i)=>(I[row]||[])[i]!=null).slice(-n).map(y=>"FY"+y.slice(0,4))}};
    const e=avg("EBITDA",ebitda),m=avg("Net Income",ni),ttmE=ebitda,ttmN=ni;ebitda=e.v;ni=m.v;
    cyc={yrs:e.yrs,ebitda,ni,ttmE,ttmN,use:cc.metrics||["evEbitda","pe"],note:cc.note||""}}
  if(ebitda>0&&evE.length>=2)r.evEbitda=[quant(evE,.25),median2(evE),quant(evE,.75)].map(m=>toPS(m*ebitda));
  if(rev>0&&evS.length>=2)r.evSales=[quant(evS,.25),median2(evS),quant(evS,.75)].map(m=>toPS(m*rev));
  if(ni>0&&pe.length>=2)r.pe=[quant(pe,.25),median2(pe),quant(pe,.75)].map(m=>m*ni/b.shares);
  return{peers,self,r,ebitda,rev,ni,cyc,use:cyc?.use,med:{evE:median2(evE),evS:median2(evS),pe:median2(pe)}}}
function compsBank(tk){const b=inputs(tk),c=b.c,peers=c.peers.filter(p=>p.marketCap),bk=c.bank;
  const self={...c.self,pb:c.price/b.bv0,pe:bk.niTTMperADR>0?c.price/bk.niTTMperADR:null,roe:bk.niTTMperADR/b.bv0,forwardPE:bk.eps0y?c.price/bk.eps0y:null};
  const clean=(arr,lo,hi)=>arr.filter(x=>x!=null&&x>lo&&x<hi),pb=clean(peers.map(p=>p.pb),0.1,6),pe=clean(peers.map(p=>p.pe),0,80),r={};
  if(pb.length>=2)r.pb=[quant(pb,.25),median2(pb),quant(pb,.75)].map(m=>m*b.bv0);
  if(pe.length>=2&&bk.eps0y>0)r.pe=[quant(pe,.25),median2(pe),quant(pe,.75)].map(m=>m*bk.eps0y);
  return{peers,self,r,use:isUtil(tk)?["pb","pe"]:["pb"],med:{pb:median2(pb),pe:median2(pe)},bank:true}}
const compMidOf=cm=>median2((cm.use||Object.keys(cm.r)).filter(k=>cm.r[k]).map(k=>cm.r[k][1]));
function precedent(tk){const b=inputs(tk),a=b.a,c=b.c,cp=a.controlPremium;let lo,hi,basis;
  if(a.ddm){[lo,hi]=[a.ddm.d0/0.065,a.ddm.d0/0.045];return{lo,hi,basis:"4.5-6.5% distribution yield (yieldco / renewables take-privates, e.g. TerraForm Power 2020, Atlantica 2024)",premLo:c.price*(1+cp[0]),premHi:c.price*(1+cp[1]),cp}}
  if(a.precedentPB){[lo,hi]=a.precedentPB.map(m=>m*b.bv0);return{lo,hi,basis:`${a.precedentPB[0]}-${a.precedentPB[1]}x P/BV (book ${money(b.bv0)}/${UN()})`,premLo:c.price*(1+cp[0]),premHi:c.price*(1+cp[1]),cp}}
  if(a.precedentEvEbitda&&(c.ebitdaTTM||0)>0){const e=c.ebitdaTTM/b.k;[lo,hi]=a.precedentEvEbitda.map(m=>Math.max(m*e-b.netDebt-b.minority+(b.nonOp||0),0)/b.shares);basis=`${a.precedentEvEbitda[0]}-${a.precedentEvEbitda[1]}x EV/EBITDA (TTM)`}
  else if(a.preRevenue||!a.precedentEvSales){const nc=Math.max(-b.netDebt,0)/b.shares;[lo,hi]=[nc,nc*3];basis="Pre-revenue: no meaningful transaction multiple; range = net cash per share (cash-shell floor) to 3x (strategic option value)"}
  else{const r=c.revenueTTM/b.k;[lo,hi]=a.precedentEvSales.map(m=>Math.max(m*r-b.netDebt-b.minority+(b.nonOp||0),0)/b.shares);basis=`${a.precedentEvSales[0]}-${a.precedentEvSales[1]}x EV/Sales (TTM)`}
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
function valTab(){loadVal().then(()=>{if(!$("#vSeg").dataset.init){$("#vSeg").dataset.init=1;$("#vSeg").innerHTML=VT.map(t=>`<button data-k="${t}" class="${t===V.tk?"on":""}">${t}</button>`).join("");seg("#vSeg",k=>{V.tk=k;V.scen="base";history.replaceState(null,"",location.search+"#valuation/"+k);renderVal()})}renderVal()}).catch(e=>{console.error(e);toast("Valuation data failed to load")})}
function renderVal(){const tk=V.tk,a=V.A.companies[tk],b=inputs(tk);
  $("#vScen").innerHTML=a.scenarios.map(s=>`<option value="${s.id}" ${s.id===V.scen?"selected":""}>${s.name} (${Math.round(s.p*100)}%)</option>`).join("");
  const r0=dcf(tk,V.scen,V.ov[tk]);
  const sl=[["rf","Risk-free (10Y UST)",0.02,0.07,0.0005,r0.rf,pct2],["erp","Equity risk premium",0.03,0.07,0.0025,r0.erp,pct2],["beta","Beta",0.4,2.5,0.05,r0.beta,v=>v.toFixed(2)],["g","Terminal growth",0.0,0.045,0.0025,r0.g,pct2],["ebitT","Target EBIT margin (yr 5+)",-0.05,0.5,0.0025,r0.ebitT,pct2],["mid","Revenue growth yrs 3-5",-0.05,0.3,0.0025,r0.mid,pct2],["capexT","Steady-state capex % rev",0.003,0.3,0.0025,r0.capexT,pct2]];
  if(isBank(tk)){sl.splice(4,3,["ebitT","Sustainable ROE (yr 5+)",0,0.4,0.0025,r0.ebitT,pct2],["mid","Book-value growth yrs 1-5 (USD)",-0.1,0.3,0.0025,r0.mid,pct2])}
  $("#vSliders").innerHTML=sl.map(([k,l,mn,mx,st,v,f])=>`<div class="vsl"><label>${l}<b id="vv_${k}">${f(v)}</b></label><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" data-k="${k}"></div>`).join("")+`<p class="muted small">Beta: Yahoo 5Y ${b.c.beta!=null?b.rawBeta.toFixed(2):"n/a"} → used ${b.beta.toFixed(2)} ${a.betaNote?"· "+a.betaNote:a.betaAdj==="blume"?"(Blume-adjusted)":""}${` · CRP ${a.crp?(a.crp*100).toFixed(2)+"%"+(a.crpLabel?` (${a.crpLabel})`:a.crp===0.0648?" (Argentina EMBI)":b.c.financialCurrency==="CNY"?" (assumed China CRP)":""):"none"}`}</p>`;
  $$("#vSliders input").forEach(i=>i.oninput=()=>{const f=sl.find(x=>x[0]===i.dataset.k)[6];$("#vv_"+i.dataset.k).textContent=f(+i.value);V.ov[tk]=Object.assign(V.ov[tk]||{},{[i.dataset.k]:+i.value});clearTimeout(V._t);V._t=setTimeout(()=>drawVal(false),70)});
  drawVal(true)}
const pct2=v=>(v*100).toFixed(2)+"%";
var drawVal=function(full){const tk=V.tk,a=V.A.companies[tk],ov=V.ov[tk]||{},r=dcf(tk,V.scen,ov),pw=probWeighted(tk,ov),cm=comps(tk),pr=precedent(tk),b=r.b,c=b.c;
  const BK=!!r.bank,compMid=compMidOf(cm),tri=compMid!=null?0.6*pw.pw+0.4*compMid:pw.pw,up=tri/c.price-1;
  a.score.valuation=Math.round(clamp(5+up*10,1,10));
  const total=((a.score.quality+a.score.growth+a.score.risk+a.score.valuation)/4);
  renderKpis($("#vK"),[kpi("Price ("+c.priceDate+")",c.price,a.displayName||c.name,usd),kpi(`${BK?"Residual income":"DCF"} · ${r.s.name}`,r.ps,`${BK?"Ke":"WACC"} ${pct2(r.wacc)} · g ${pct2(r.g)}`,usd),kpi(BK?"Prob-weighted RI":"Prob-weighted DCF",pw.pw,`${a.scenarios.length} scenarios`,usd),kpi("Triangulated fair value",tri,BK?(b.util?"60% RI(pw) + 40% P/BV & P/E comps":"60% RI(pw) + 40% P/BV comps"):"60% DCF(pw) + 40% comps",usd),kpi("Implied upside",up*100,"vs current price",v=>`<span class="${v>=0?"up":"dn"}">${v>=0?"+":""}${v.toFixed(1)}%</span>`),kpi("Composite score",total,"quality · growth · risk · valuation",v=>v.toFixed(1)+"/10")]);
  // projections chart
  const H=b.hist,R=r.rows,f=fx()/1e9,fu=fx();
  if(BK){drawBankProj(r,fu)}else{
  plot("vProj",[{type:"bar",name:"Revenue (actual)",x:H.map(h=>"FY"+h.y),y:H.map(h=>h.rev*f),marker:{color:css("--mu")}},
    {type:"bar",name:"Revenue (projected)",x:R.map(x=>x.fy),y:R.map(x=>x.rev*f),marker:{color:"rgba(91,140,255,.75)"}},
    {type:"scatter",mode:"lines+markers",name:"FCF (actual)",x:H.map(h=>"FY"+h.y),y:H.map(h=>h.fcf*f),line:{color:"#a3a3a3",dash:"dot"}},
    {type:"scatter",mode:"lines+markers",name:"FCFF (projected)",x:R.map(x=>x.fy),y:R.map(x=>x.fcf*f),line:{color:css("--up"),width:2.5}},
    {type:"scatter",mode:"lines",name:"EBIT margin",x:[...H.map(h=>"FY"+h.y),...R.map(x=>x.fy)],y:[...H.map(h=>h.ebit/h.rev),...R.map(x=>x.m)],yaxis:"y2",line:{color:"#f59e0b",width:2,shape:"spline"}}],
    {barmode:"overlay",hovermode:"x unified",yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",ticksuffix:"B",tickformat:",.0f",hoverformat:",.1f",gridcolor:css("--bd")},yaxis2:{overlaying:"y",side:"right",tickformat:".0%",showgrid:false},legend:{orientation:"h",y:-0.15,font:{size:10}},margin:{l:56,r:46,t:10,b:70}});
  }
  if(!BK)$("#vTable").innerHTML=`<thead><tr><th>Line item (USD, ESTIMATES)</th>${R.map(x=>`<th>${x.fy}</th>`).join("")}</tr></thead><tbody>${[["Revenue growth",x=>sp(x.gr)],["Revenue",x=>bn(x.rev)],["EBIT margin",x=>pct(x.m)],["EBIT",x=>bn(x.ebit)],["NOPAT",x=>bn(x.nopat)],["+ D&A",x=>bn(x.da)],["− Capex",x=>bn(x.capex)],["− ΔNWC",x=>bn(x.dnwc)],["= FCFF",x=>`<b>${bn(x.fcf)}</b>`],["Year fraction remaining",x=>x.frac.toFixed(2)],["Discount factor",x=>x.df.toFixed(3)],["PV of FCFF",x=>bn(x.pv)]].map(([l,fn])=>`<tr><td>${l}</td>${R.map(x=>`<td>${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  // bridge
  if(BK)drawBankBridge(r);else plot("vBridge",[{type:"waterfall",orientation:"v",x:["PV FCFF (10y)","PV terminal value","Enterprise value","− Net debt","− Minority int.",...(b.nonOp?["+ Equity stakes (non-op.)"]:[]),...(r.s.oneOff?["One-off (fine/settlement)"]:[]),"Equity value"],
    measure:["relative","relative","total","relative","relative",...(b.nonOp?["relative"]:[]),...(r.s.oneOff?["relative"]:[]),"total"],y:[r.pv*f,r.pvTV*f,0,-b.netDebt*f,-b.minority*f,...(b.nonOp?[b.nonOp*f]:[]),...(r.s.oneOff?[r.s.oneOff*f]:[]),0],
    connector:{line:{color:css("--bd")}},increasing:{marker:{color:css("--up")}},decreasing:{marker:{color:css("--dn")}},totals:{marker:{color:css("--ac")}},text:[bn(r.pv),bn(r.pvTV),bn(r.ev),bn(-b.netDebt),bn(-b.minority),...(b.nonOp?[bn(b.nonOp)]:[]),...(r.s.oneOff?[bn(r.s.oneOff)]:[]),bn(Math.max(r.eq,0))],textposition:"outside",cliponaxis:false,hoverinfo:"x+text"}],{yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",ticksuffix:"B",tickformat:",.0f",gridcolor:css("--bd")},margin:{l:64,r:10,t:44,b:60}});
  $("#vBridgeNote").innerHTML=BK?`Terminal residual income = ${pct(r.tvShare)} of value · Ke ${pct2(r.ke)} = rf ${pct2(r.rf)} + β ${r.beta.toFixed(2)} × ERP ${pct2(r.erp)} + CRP ${pct2((a.crp||0)+(r.s.crpAdd||0))} · ${b.util?`${(r.shares/1e6).toFixed(1)}M shares${b.c.sharesPerUnit?` (units of ${b.c.sharesPerUnit} shares)`:""}`:`${(r.shares/1e6).toFixed(1)}M ADR-equivalents (${b.c.bank.adrRatio} Class B shares per ADS)`}`:`Terminal value = ${pct(r.tvShare)} of EV · Ke ${pct2(r.ke)} · Kd after-tax ${pct2(r.kd)} · diluted shares ${(r.shares/1e9).toFixed(3)}B${a.scenarios.find(s=>s.id===V.scen).shareChange||a.shareChange>0?" (after assumed dilution)":""}`;
  // sensitivity
  const ws=[-0.02,-0.015,-0.01,-0.005,0,0.005,0.01,0.015,0.02].map(d=>r.wacc+d),gs=[-0.01,-0.005,0,0.005,0.01].map(d=>r.g+d);
  const z=gs.map(g=>ws.map(w=>g<w-0.01?dcf(tk,V.scen,{...ov,wacc:w,g}).ps*fu:null));
  plot("vSens",[{type:"heatmap",x:ws.map(w=>pct2(w)),y:gs.map(g=>pct2(g)),z,text:z.map(rw=>rw.map(v=>v==null?"n/a":(S.ccy==="ARS"?"":"$")+v.toFixed(v>100?0:2))),texttemplate:"%{text}",colorscale:[[0,"#b91c1c"],[.5,"#334155"],[1,"#15803d"]],zmid:c.price*fu,hovertemplate:"WACC %{x} · g %{y}<br>%{text}/share<extra></extra>",colorbar:{thickness:10}}],{xaxis:{title:BK?"Cost of equity":"WACC",type:"category"},yaxis:{title:"Terminal growth",type:"category"},margin:{l:70,r:10,t:10,b:50}});
  // comps table
  const P=[{...cm.self,ticker:tk+" (target)",isSelf:1},...cm.peers];
  if(BK)$("#vComps").innerHTML=`<thead><tr><th>Company</th><th>Mkt cap</th><th>Book (USD)</th><th>P/BV</th><th>P/E (TTM)</th><th>P/E FY26e</th><th>ROE (TTM)</th></tr></thead><tbody>${P.map(p=>`<tr class="${p.isSelf?"selfrow":""}"><td><span class="tkr">${p.ticker}</span> <span class="muted small">${(p.name||"").slice(0,24)}</span></td><td>${bn(p.marketCap)}</td><td>${p.isSelf?bn(b.bv0*b.shares):bn(p.book)}</td><td>${num(p.pb,2)}x</td><td>${p.pe?num(p.pe,1)+"x":"n.m."}</td><td>${p.isSelf&&p.forwardPE?num(p.forwardPE,1)+"x":"—"}</td><td>${pct(p.roe)}</td></tr>`).join("")}<tr class="medrow"><td>Peer median</td><td></td><td></td><td>${num(cm.med.pb,2)}x</td><td>${cm.med.pe?num(cm.med.pe,1)+"x":"n.m."}</td><td colspan="2"></td></tr></tbody>`;
  else $("#vComps").innerHTML=`<thead><tr><th>Company</th><th>Mkt cap</th><th>EV</th><th>EV/Sales</th><th>EV/EBITDA</th><th>P/E (TTM)</th><th>Fwd P/E</th><th>EBITDA mgn</th><th>Rev. growth</th></tr></thead><tbody>${P.map(p=>`<tr class="${p.isSelf?"selfrow":""}"><td><span class="tkr">${p.ticker}</span> <span class="muted small">${(p.name||"").slice(0,24)}${p.ref?" · ref. only":""}</span></td><td>${bn(p.marketCap)}</td><td>${bn(p.ev)}</td><td>${num(p.evSales,2)}x</td><td>${p.evEbitda?num(p.evEbitda,1)+"x":"n.m."}</td><td>${p.pe?num(p.pe,1)+"x":"n.m."}</td><td>${p.forwardPE?num(p.forwardPE,1)+"x":"—"}</td><td>${pct(p.ebitdaMargin)}</td><td>${sp(p.revenueGrowth)}</td></tr>`).join("")}<tr class="medrow"><td>Peer median</td><td></td><td></td><td>${num(cm.med.evS,2)}x</td><td>${cm.med.evE?num(cm.med.evE,1)+"x":"n.m."}</td><td>${cm.med.pe?num(cm.med.pe,1)+"x":"n.m."}</td><td colspan="3" class="muted small">Outliers excluded (EV/EBITDA > 60x, P/E > 80x, negatives)</td></tr></tbody>`;
  if(!BK&&cm.cyc){const y=cm.cyc,fmt=k=>cm.r[k]?`${k==="evEbitda"?"EV/EBITDA":k==="pe"?"P/E":"EV/Sales"} ${usd(cm.r[k][0])}–${usd(cm.r[k][2])} (median ${usd(cm.r[k][1])})`:"";
    $("#vComps").insertAdjacentHTML("beforeend",`<caption style="caption-side:bottom;text-align:left" class="muted small"><b>Cycle-adjusted comps:</b> peer median TTM multiples applied to through-cycle earnings, the average of ${y.yrs.join(", ")} and TTM: EBITDA ${bn(y.ebitda)} (TTM ${bn(y.ttmE)}), net income ${bn(y.ni)} (TTM ${bn(y.ttmN)}). Comps value = median of ${y.use.map(fmt).filter(Boolean).join(" and ")} → <b>${usd(compMidOf(cm))}</b>/share; EV/Sales is shown but not used. ${y.note}</caption>`)}
  $("#vPrec").innerHTML=`<p><b>Precedent / M&A view:</b> ${pr.basis} → <b>${usd(pr.lo)} – ${usd(pr.hi)}</b>/share. Control premium ${Math.round(pr.cp[0]*100)}–${Math.round(pr.cp[1]*100)}% on the unaffected price → <b>${usd(pr.premLo)} – ${usd(pr.premHi)}</b>.</p><p class="muted small">${a.precedentNote}</p>${a.compsNote?`<p class="muted small">${a.compsNote}</p>`:""}`;
  // football field
  const mc=monteCarlo(tk),scs=pw.list.map(x=>x.ps);
  const bars=[["52-week range",c.low52,c.high52],["Analyst targets",c.targetLow,c.targetHigh],...(cm.r.evEbitda?[["Comps EV/EBITDA (IQR)",cm.r.evEbitda[0],cm.r.evEbitda[2]]]:[]),...(cm.r.evSales?[["Comps EV/Sales (IQR)",cm.r.evSales[0],cm.r.evSales[2]]]:[]),...(cm.r.pb?[["Comps P/BV (IQR)",cm.r.pb[0],cm.r.pb[2]]]:[]),...(cm.r.pe?[[BK?"Comps P/E × FY26e EPS (ref.)":"Comps P/E (IQR)",cm.r.pe[0],cm.r.pe[2]]]:[]),["Precedent multiples",pr.lo,pr.hi],["Takeout (control premium)",pr.premLo,pr.premHi],[BK?"RI scenarios (min–max)":"DCF scenarios (min–max)",Math.min(...scs),Math.max(...scs)],["Monte Carlo P10–P90",quant(mc,.1),quant(mc,.9)]].filter(x=>x[1]!=null&&x[2]!=null);
  const CL=["#64748b","#a855f7","#22d3ee","#14b8a6","#0ea5e9","#f59e0b","#f97316","#5b8cff","#22c55e"];
  plot("vFF",[{type:"bar",orientation:"h",y:bars.map(x=>x[0]),x:bars.map(x=>(x[2]-x[1])*fu),base:bars.map(x=>x[1]*fu),marker:{color:bars.map((_,i)=>CL[i%CL.length]),opacity:.85},text:bars.map(x=>`${usd(x[1])} – ${usd(x[2])}`),textposition:"inside",insidetextanchor:"middle",textfont:{color:"#fff",size:11},hovertemplate:"%{y}<br>%{text}<extra></extra>"}],
    {xaxis:{tickformat:"$,.2~f",gridcolor:css("--bd"),range:(()=>{const lo=Math.min(...bars.map(x=>x[1]),c.price),hi=Math.max(...bars.map(x=>x[2]),c.price);return[Math.max(0,lo-(hi-lo)*.08)*fu,(hi+(hi-lo)*.08)*fu]})()},yaxis:{autorange:"reversed",automargin:true},margin:{l:10,r:20,t:30,b:30},
     shapes:[{type:"line",x0:c.price*fu,x1:c.price*fu,y0:-0.5,y1:bars.length-0.5,line:{color:css("--dn"),width:2,dash:"dot"}},{type:"line",x0:tri*fu,x1:tri*fu,y0:-0.5,y1:bars.length-0.5,line:{color:css("--up"),width:2}}],
     annotations:[{x:c.price*fu,y:-0.5,yanchor:"bottom",text:"Price "+usd(c.price),showarrow:false,font:{color:css("--dn"),size:11}},{x:tri*fu,y:bars.length-0.5,yanchor:"top",text:"Fair value "+usd(tri),showarrow:false,font:{color:css("--up"),size:11}}]});
  // scenarios table
  $("#vScenTbl").innerHTML=`<thead><tr><th>Scenario</th><th>Prob.</th><th>${BK?"Book CAGR (10y)":"Rev. CAGR (10y)"}</th><th>${BK?"Sust. ROE":"EBIT mgn (yr5+)"}</th><th>Fair value</th><th>vs price</th><th style="text-align:left">Thesis</th></tr></thead><tbody>${pw.list.map(s=>{const cagr=Math.pow(s.r.rows[9].rev/b.rev0,0.1)-1;return`<tr data-s="${s.id}" class="${s.id===V.scen?"selfrow":""}"><td><b>${s.name}</b></td><td>${Math.round(s.p*100)}%</td><td>${pct(cagr)}</td><td>${pct(s.r.ebitT)}</td><td><b>${usd(s.ps)}</b></td><td>${sp(s.ps/c.price-1)}</td><td class="wrap">${s.desc}</td></tr>`}).join("")}<tr class="medrow"><td>Probability-weighted</td><td>100%</td><td></td><td></td><td><b>${usd(pw.pw)}</b></td><td>${sp(pw.pw/c.price-1)}</td><td class="wrap muted">${V.A.probDefault}</td></tr></tbody>`;
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
  if(BK){drawBankAssump(r,a,b,c);return}
  $("#vTableNote").textContent="FCFF = EBIT×(1−t) + D&A − Capex − ΔNWC · mid-year discounting · stub-year adjusted";
  $("#vProjT").textContent="Revenue, EBIT margin & free cash flow: history + 10-year projection";$("#vSensT").textContent="Sensitivity: fair value per share (WACC × terminal growth)";
  $("#vAssump").innerHTML=(a.growthNote?`<p class="muted small" style="margin:0 0 8px">${a.growthNote}</p>`:"")+`<div class="kv">${[["Base fiscal year",(b.hist.at(-1)?.y??b.fyEnd.getFullYear())+" (FY end "+b.fyEnd.toISOString().slice(0,10)+")"],["Reporting currency",c.financialCurrency+(b.k!==1?(c.financialCurrency==="EUR"?` → USD at ${V.D.fx.EURUSD_ecb.toFixed(4)} USD/EUR (ECB reference rate, ${V.D.fx.EUR_date}); 1 ADR = 1 share`:c.financialCurrency==="BRL"?` → USD at ${b.k.toFixed(4)} BRL/USD (BCB PTAX, ${V.D.fx.BRL_date}); 1 ADR = 1 share`:c.financialCurrency==="TWD"?` → USD at ${b.k.toFixed(3)} NT$/US$ (Central Bank of the R.O.C. (Taiwan) closing rate, ${V.D.fx.TWD_date}); 1 ADR = ${a.adrRatio||5} common shares, values per ADR`:c.currencyLocal==="BRL"?` → USD at ${b.k.toFixed(4)} BRL/USD (BCB PTAX selling rate, ${V.D.fx.BRL_date}); B3 close R$${c.priceLocal.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} = ${usd(c.price)}; values per share`:c.financialCurrency==="KRW"?` → USD at ${b.k.toFixed(2)} KRW/USD (ECB reference-rate cross, ${V.D.fx.KRW_date}); KRX close ₩${Math.round(c.priceLocal).toLocaleString("en-US")} = ${usd(c.price)}${c.related?Object.entries(c.related).map(([t,r])=>` · ${t} ${r.label}: ${r.currency==="KRW"?"₩"+Math.round(r.price).toLocaleString("en-US")+" = "+usd(r.price/b.k):usd(r.price)}`).join(""):""}; values per ${c.related&&Object.keys(c.related).length?"common/preferred share":"common share"}`:` → USD at ${b.k.toFixed(4)} ${c.financialCurrency}/USD (Yahoo FX)`):"")+(c.yahooFinancialCurrency&&c.yahooFinancialCurrency!==c.financialCurrency?` (functional currency; Yahoo labels it ${c.yahooFinancialCurrency}; balance sheet ${c.balanceDate}, TTM = ${c.ttmQuarters?.length||4} quarters)`:"")],...(a.priceDeck?[["Commodity price deck (assumed)",a.priceDeck]]:[]),["Base revenue / EBIT margin",bn(b.rev0)+" / "+pct(b.ebit0/b.rev0)],[a.g1!=null?"Yr-1 / Yr-2 growth (analyst override)":a.g2!=null?"Yr-1 / Yr-2 growth (consensus / analyst override)":"Yr-1 / Yr-2 growth (consensus)",pct(b.g1)+" / "+pct(b.g2)],...(a.ebit1!=null?[["Yr-1 EBIT margin (override)",pct(r.s.ebit1??a.ebit1)]]:[]),["Country-risk premium",(a.crp?pct2(a.crp)+(r.s.crpAdd?` + ${pct2(r.s.crpAdd)} (scenario)`:"")+(a.crpLabel?" · "+a.crpLabel:a.crp===0.0648?" · Argentina EMBI 648 bp (2026-10-16)":c.financialCurrency==="CNY"?" · assumed China CRP":""):"none"+(r.s.crpAdd?` (scenario adds ${pct2(r.s.crpAdd)})`:""))],["Tax rate (assumed)",pct(a.tax)],["D&A % rev (now → yr 6)",pct(b.da0/b.rev0)+" → "+pct(a.daPctT)],["Capex % rev (yr 1 → yr 6)",pct(a.capexPct1)+" → "+pct(r.capexT)],["ΔNWC % of Δrevenue",pct(a.nwcPct)],["Net debt / Minority interest",bn(b.netDebt)+" / "+bn(b.minority)],...(b.cvAdd?[["Convertible notes (if-converted)",`${bn(b.cvDebt)} in-the-money principal treated as equity: +${(b.cvAdd/1e6).toFixed(2)}M shares, removed from debt`+(a.convertsNote?" · "+a.convertsNote:"")]]:[]),...(b.nonOp?[["Non-operating equity stakes (added)",bn(b.nonOp)+" · "+(a.nonOpAssets.label||a.nonOpAssets.row)]]:[]),...(a.peNIExclude?[["TTM net income for P/E",bn(b.c.self?.netIncome-a.peNIExclude)+" (excl. "+bn(a.peNIExclude)+" one-off: "+(a.peNIExcludeLabel||"one-off")+")"]]:[]),["Share count change (3y, p.a.)",pct(r.s.shareChange??a.shareChange)],["Cost of debt (pre-tax)",pct2(r.rf+a.kdSpread)],["Analyst consensus",`${c.recKey||"—"} · ${c.nAnalysts||"?"} analysts · mean target ${usd(c.targetMean)}`]].map(x=>`<span>${x[0]}</span><span>${x[1]}</span>`).join("")}</div>`;
}
/* ---------- bank-specific panels (residual income) ---------- */
function drawBankProj(r,fu){const R=r.rows,b=r.b,bk=b.c.bank;
  plot("vProj",[{type:"bar",name:"Book value / "+UN()+" (actual, "+bk.bvDate+")",x:["Now"],y:[b.bv0*fu],marker:{color:css("--mu")}},
    {type:"bar",name:"Book value / "+UN()+" (projected, year-end)",x:R.map(x=>x.fy),y:R.map(x=>x.rev*fu),marker:{color:"rgba(91,140,255,.75)"}},
    {type:"scatter",mode:"lines+markers",name:"Net income / "+UN(),x:R.map(x=>x.fy),y:R.map(x=>x.ni*fu),line:{color:css("--up"),width:2.5}},
    {type:"scatter",mode:"lines+markers",name:"Residual income / "+UN(),x:R.map(x=>x.fy),y:R.map(x=>x.ri*fu),line:{color:"#a855f7",width:2,dash:"dot"}},
    {type:"scatter",mode:"lines",name:"ROE",x:R.map(x=>x.fy),y:R.map(x=>x.m),yaxis:"y2",line:{color:"#f59e0b",width:2,shape:"spline"}},
    {type:"scatter",mode:"lines",name:"Cost of equity",x:R.map(x=>x.fy),y:R.map(()=>r.ke),yaxis:"y2",line:{color:css("--dn"),width:1.5,dash:"dash"}}],
    {barmode:"overlay",hovermode:"x unified",yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",tickformat:",.0f",hoverformat:",.2f",gridcolor:css("--bd")},yaxis2:{overlaying:"y",side:"right",tickformat:".0%",showgrid:false},legend:{orientation:"h",y:-0.15,font:{size:10}},margin:{l:56,r:46,t:10,b:70}});
  $("#vProjT").textContent="Book value, ROE vs cost of equity & residual income per "+UN()+": 10-year projection";
  $("#vTableNote").textContent="Residual income = (ROE − Ke) × opening book · implied dividends = net income − Δbook · per "+UN()+", USD";
  $("#vSensT").textContent="Sensitivity: fair value per "+UN()+" (cost of equity × terminal growth)";
  $("#vTable").innerHTML=`<thead><tr><th>Line item (USD per ${UN()}, ESTIMATES)</th>${R.map(x=>`<th>${x.fy}</th>`).join("")}</tr></thead><tbody>${[["Book growth",x=>sp(x.gr)],["Opening book value",x=>usd(x.b0)],["ROE",x=>pct(x.m)],["Net income",x=>usd(x.ni)],["− Equity charge (Ke × book)",x=>usd(x.charge)],["= Residual income",x=>`<b>${usd(x.ri)}</b>`],["Implied dividends",x=>usd(x.div)],["Payout ratio",x=>x.payout==null?"—":pct(x.payout)],["Year fraction remaining",x=>x.frac.toFixed(2)],["Discount factor",x=>x.df.toFixed(3)],["PV of residual income",x=>usd(x.pv)]].map(([l,fn])=>`<tr><td>${l}</td>${R.map(x=>`<td>${fn(x)}</td>`).join("")}</tr>`).join("")}</tbody>`}
function drawBankBridge(r){const f=fx()/1e9,sh=r.shares,b=r.b,one=r.one||0;
  plot("vBridge",[{type:"waterfall",orientation:"v",x:["Book value ("+b.c.bank.bvDate+")","PV residual income (10y)","PV terminal RI",...(one?["One-off (regulatory)"]:[]),"Equity value"],
    measure:["relative","relative","relative",...(one?["relative"]:[]),"total"],y:[b.bv0*sh*f,r.pv*sh*f,r.pvTV*sh*f,...(one?[one*sh*f]:[]),0],
    connector:{line:{color:css("--bd")}},increasing:{marker:{color:css("--up")}},decreasing:{marker:{color:css("--dn")}},totals:{marker:{color:css("--ac")}},
    text:[bn(b.bv0*sh),bn(r.pv*sh),bn(r.pvTV*sh),...(one?[bn(one*sh)]:[]),bn(Math.max(r.eq,0)*sh)+" · "+usd(r.ps)+"/"+UN()],textposition:"outside",cliponaxis:false,hoverinfo:"x+text"}],
    {yaxis:{tickprefix:S.ccy==="ARS"?"ARS ":"$",ticksuffix:"B",tickformat:",.1f",gridcolor:css("--bd")},margin:{l:64,r:10,t:44,b:60}})}
function drawUtilAssump(r,a,b,c){const bk=c.bank,cur=bk.ccy&&bk.ccy!=="USD";
  $("#vAssump").innerHTML=`<p class="muted small" style="margin:0 0 8px">Regulated utility: valued with a residual-income model on book equity (equivalent to a DDM with the dividend = net income − Δbook). Allowed returns are earned on the regulated asset base, so value = book + PV of (ROE − Ke) × book; EV-based multiples are shown for reference in the multiples card.</p><div class="kv">${[
    ["Book value / share",`${usd(b.bv0)} (price ÷ P/B ${num(c.self.pb,2)}x${cur?`; ${bk.ccy} statements at ${num(bk.fx,4)} ${bk.ccy}/USD`:""})`],
    ["TTM net income / share (ROE)",usd(bk.niTTMperADR)+" ("+pct(bk.niTTMperADR/b.bv0)+")"],
    ["Consensus EPS FY1 / FY2 (USD)",`${bk.eps0y!=null?usd(bk.eps0y):"—"} / ${bk.eps1y!=null?usd(bk.eps1y):"—"} → ROE ${pct(b.roe1)} / ${pct(b.roe2)}`],
    ["Dividends paid, last FY",bk.divTTMperADR!=null?usd(bk.divTTMperADR)+"/share ("+pct(bk.divTTMperADR/c.price)+" yield)":"—"],
    ["Allowed / regulatory return",a.regNote||"—"],
    ["Cost of equity",`${pct2(r.ke)} = ${pct2(r.rf)} + ${r.beta.toFixed(2)} × ${pct2(r.erp)}${a.crp?" + "+pct2(a.crp)+" CRP":""}${r.s.crpAdd?" + "+pct2(r.s.crpAdd)+" (scenario)":""}`],
    ["Analyst consensus",`${c.recKey||"—"} · ${c.nAnalysts||"?"} analysts · mean target ${usd(c.targetMean)}`]].map(x=>`<span>${x[0]}</span><span>${x[1]}</span>`).join("")}</div>`}
function drawBankAssump(r,a,b,c){if(c.bank.util)return drawUtilAssump(r,a,b,c);const bk=c.bank;
  $("#vAssump").innerHTML=`<p class="muted small" style="margin:0 0 8px">Banks are valued on equity, not FCFF: debt and deposits are raw material, so a residual-income (excess-return) model on book value replaces the DCF; EV-based multiples are replaced by P/BV and P/E.</p><div class="kv">${[
    ["Book value / ADR",`${usd(b.bv0)} (${bk.bvDate}; ARS ${(bk.equityARS/1e12).toFixed(2)}T equity / ${(bk.adrShares/1e6).toFixed(1)}M ADR-eq. / ${bk.fxBv} ARS/USD)`],
    ["ADR ratio","1 ADS = "+bk.adrRatio+" Class B shares ("+(bk.localShares/1e9).toFixed(3)+"B Class A+B shares)"],
    ["Inflation accounting","IAS 29: equity and P&L in homogeneous pesos of the statement date, converted at the BCRA A3500 rate of that date"],
    ["FX (BCRA A3500)",`${bk.fxBv} on ${bk.fxBvDate} · ${V.D.fx.ARSUSD_BCRA} on ${V.D.fx.ARS_date}`],
    ["P/BV at price",num(c.price/b.bv0,2)+"x"],
    ["TTM net income / ADR (ROE)",usd(bk.niTTMperADR)+" ("+pct(bk.niTTMperADR/b.bv0)+")"],
    ["Consensus EPS FY26e / FY27e (USD/ADR)",`${usd(bk.eps0y)} / ${usd(bk.eps1y)} → ROE ${pct(b.roe1)} / ${pct(b.roe2)}`],
    ["Dividends paid, last 12m",usd(bk.divTTMperADR)+"/ADR"],
    ["Cost of equity",`${pct2(r.ke)} = ${pct2(r.rf)} + ${r.beta.toFixed(2)} × ${pct2(r.erp)} + ${pct2(a.crp)} CRP${r.s.crpAdd?" + "+pct2(r.s.crpAdd)+" (scenario)":""}`],
    ["Country-risk premium",`${pct2(a.crp)} · Argentina EMBI 648 bp (2026-10-16)`],
    ["Analyst consensus",`${c.recKey||"—"} · ${c.nAnalysts||"?"} analysts · mean target ${usd(c.targetMean)}`]].map(x=>`<span>${x[0]}</span><span>${x[1]}</span>`).join("")}</div>`}
document.addEventListener("click",e=>{if(e.target&&e.target.id==="vReset"){delete V.ov[V.tk];V.scen="base";renderVal();toast("Assumptions reset")}});
document.addEventListener("change",e=>{if(e.target&&e.target.id==="vScen"){V.scen=e.target.value;renderVal()}});
function secTable(){const s=V.D.companies[V.tk].sec||{},tags=Object.keys(s).filter(k=>s[k]&&s[k].fy),yrs=[...new Set(tags.flatMap(t=>Object.keys(s[t].fy)))].sort().slice(-6);
  const nm={Revenues:"Revenues",RevenueFromContractWithCustomerExcludingAssessedTax:"Revenue (ASC 606)",OperatingIncomeLoss:"Operating income",NetIncomeLoss:"Net income",PaymentsToAcquirePropertyPlantAndEquipment:"Capex (PP&E)",NetCashProvidedByUsedInOperatingActivities:"Operating cash flow"};
  $("#vSec").innerHTML=tags.length?`<thead><tr><th>XBRL tag (${s.entity||""}, CIK ${s.cik||""})</th><th>Unit</th>${yrs.map(y=>`<th>CY${y}</th>`).join("")}</tr></thead><tbody>${tags.map(t=>`<tr><td>${nm[t]||t}</td><td>${s[t].unit}</td>${yrs.map(y=>`<td>${s[t].fy[y]!=null?(s[t].fy[y]/1e6).toLocaleString("en-US",{maximumFractionDigits:0}):"—"}</td>`).join("")}</tr>`).join("")}</tbody>`:'<tbody><tr><td class="muted">No XBRL facts available</td></tr></tbody>'}
const _dv=drawVal;drawVal=function(full){_dv(full);secTable()};
/* ---------- machine-readable summary (model defaults, no slider overrides) ----------
   Used by scripts/validate_dashboard.py --export to write data/valuation_summary.json, which external
   pages (e.g. the ModelosArgentina site) read; the numbers come from this same engine, so there is one source of truth. */
function valSummary(tk){const MX=multiplesOf(tk);const a=V.A.companies[tk],ov={},r=dcf(tk,"base",ov),pw=probWeighted(tk,ov),cm=comps(tk),b=r.b,c=b.c,BK=!!r.bank;
  const compMid=compMidOf(cm),tri=compMid!=null?0.6*pw.pw+0.4*compMid:pw.pw,fxd=V.D.fx||{},cc=c.financialCurrency,
    FXS={EUR:["EURUSD_ecb","EUR_date","EUR_source","USD per EUR"],BRL:["BRLUSD","BRL_date","BRL_source","BRL per USD"],TWD:["TWDUSD","TWD_date","TWD_source","TWD per USD"],KRW:["KRWUSD","KRW_date","KRW_source","KRW per USD"],CNY:["CNYUSD",null,null,"CNY per USD"],ARS:["ARSUSD_BCRA","ARS_date","BCRA_SRC","ARS per USD"]}[cc];
  const sc=a.scenarios.map(s=>{const x=dcf(tk,s.id,ov);return{id:s.id,name:s.name,p:s.p,value:x.ps}}),q=x=>Math.round(x*100)/100;
  const mcO=V.mc[tk+"{}"]||monteCarlo(tk),mq=p=>mcO[Math.min(mcO.length-1,Math.floor(p*mcO.length))];
  const h=RV.H?.companies?.[tk],R=(typeof reverse==="function")?reverse(tk):null,wh=WH.D?.companies?.[tk];
  const s=a.score,valS=Math.round(clamp(5+(tri/c.price-1)*10,1,10));
  return{ticker:tk,name:a.displayName||c.name,sector:a.sector||"",model:BK?(isUtil(tk)?"residual income (regulated utility)":"residual income (bank)"):"DCF (FCFF)",preRevenue:!!a.preRevenue,price:q(c.price),priceDate:c.priceDate,
    priceLocal:c.priceLocal??null,currencyLocal:c.currencyLocal??null,reportingCurrency:cc,
    fx:FXS&&b.k!==1?{rate:fxd[FXS[0]]??b.k,quote:FXS[3],date:FXS[1]?fxd[FXS[1]]:null,source:FXS[2]==="BCRA_SRC"?"BCRA official wholesale rate (Com. A 3500)":FXS[2]?fxd[FXS[2]]:"Yahoo Finance FX (CNY=X)"}:null,
    base:q(r.ps),probWeighted:q(pw.pw),comps:compMid!=null?q(compMid):null,compsCycleAdjusted:!!cm.cyc,triangulated:q(tri),upside:tri/c.price-1,
    wacc:BK?null:r.wacc,costOfEquity:BK?r.ke??r.wacc:null,terminalG:r.g,
    monteCarlo:{n:mcO.length,p10:q(mq(.1)),p50:q(mq(.5)),p90:q(mq(.9)),pAbovePrice:mcO.filter(v=>v>c.price).length/mcO.length},
    scenarios:sc.map(x=>({...x,value:q(x.value)})),
    reverse:R?{impliedGrowth5y:R.gImp??null,impliedMargin:R.mImp??null,baseMargin:R.base?.ebitT??null}:null,
    revenueCagr:h?{value:h.cagr5,currency:h.currency,usd:h.usd?.cagr5??null,start:h.start,end:h.end,periods:h.periods||5}:null,
    waccHistory:wh?wh.rows.map(x=>({year:x.year,date:x.date,value:BK?x.ke:x.wacc})):[],waccHistoryMetric:wh?.bank?"cost of equity":"WACC",
    score:{quality:s.quality,growth:s.growth,risk:s.risk,valuation:valS,total:(s.quality+s.growth+s.risk+valS)/4},
    analyst:{rec:c.recKey||null,n:c.nAnalysts||null,targetMean:c.targetMean??null},group:a.group||a.sector||"",priceDeck:a.priceDeck||null,multiples:MX,groupMultiples:mxGroup(a.group||a.sector||"")}}

/* ---------- valuation multiples (every ticker; USD-consistent, from the same inputs as the DCF) ----------
   EV = market cap + net debt + minority interest. EBITDA = TTM (Yahoo). FCF and dividends = last fiscal year statements
   (consistent across currencies). Forward P/E = price / next-fiscal-year consensus EPS (converted to USD). P/B = Yahoo book.
   Group statistics = median and mean of the covered tickers sharing a.group; peer median = this ticker's comps set. */
const MX_DEF=[["evEbitda","EV / EBITDA","TTM","x",1],["pe","P/E","TTM","x",1],["fpe","Forward P/E","next FY consensus","x",1],["pfcf","P / FCF","last FY","x",1],
  ["fcfY","FCF yield","last FY","%",-1],["divY","Dividend yield","last FY cash dividends","%",-1],["ndE","Net debt / EBITDA","TTM","x",0],["pb","P / B","latest book","x",1]];
function multiplesOf(tk){const c=V.D.companies[tk],a=V.A.companies[tk];if(!c)return null;const BK=a.model==="bank",k=(c.financialCurrency&&c.financialCurrency!=="USD"&&V.D.fx[c.financialCurrency+"USD"])||1;
  const L=(o,r)=>{const v=(o?.[r]||[]).filter(x=>x!=null);return v.length?v.at(-1):null},mc=c.marketCap,cash=(c.totalCash||0)/k,debt=(c.totalDebt||0)/k,mino=(L(c.balance,"Minority Interest")||0)/k;
  const ebitda=c.ebitdaTTM!=null?c.ebitdaTTM/k:null,fcf=L(c.cashflow,"Free Cash Flow"),div=L(c.cashflow,"Cash Dividends Paid"),ni=c.self?.netIncome;
  const e1=c.earningsEstimate?.["+1y"],ec=e1?.currency||c.financialCurrency,ek=!ec||ec==="USD"?1:ec===c.financialCurrency?k:(V.D.fx[ec+"USD"]??null),eps=e1?.avg!=null&&ek?e1.avg/ek*(ec===c.financialCurrency&&c.currency==="USD"&&c.financialCurrency!=="USD"&&!c.currencyLocal?(a.adrRatio||1):1):null;
  const ev=BK?null:mc+debt-cash+mino,nd=debt-cash,pos=x=>x!=null&&isFinite(x)&&x>0;
  return{ticker:tk,group:a.group||a.sector||"",bank:BK,marketCap:mc,ev,
    evEbitda:!BK&&pos(ebitda)?ev/ebitda:null,pe:pos(ni)?mc/ni:null,fpe:pos(eps)?c.price/eps:(pos(c.forwardPE)&&c.currency===c.financialCurrency?c.forwardPE:null),
    pfcf:!BK&&fcf!=null&&fcf/k>0?mc/(fcf/k):null,fcfY:!BK&&fcf!=null?(fcf/k)/mc:null,divY:div!=null?Math.abs(div/k)/mc:0,
    ndE:!BK&&pos(ebitda)?nd/ebitda:null,pb:pos(c.self?.pb)?c.self.pb:null}}
const mstat=v=>{v=v.filter(x=>x!=null&&isFinite(x));if(!v.length)return{med:null,mean:null,n:0};return{med:median2(v),mean:v.reduce((p,q)=>p+q,0)/v.length,n:v.length}};
function mxGroup(g){const T=VT.filter(t=>(V.A.companies[t].group||V.A.companies[t].sector)===g),M=T.map(multiplesOf).filter(Boolean),o={members:T};
  // groupPeersFromComps (Pharma): the comps-set peers of the covered names also enter the sector median/mean (comps-only: EV/EBITDA, P/E, forward P/E, P/B)
  const ex=[...new Set(T.filter(t=>V.A.companies[t].groupPeersFromComps).flatMap(t=>(V.D.companies[t].peers||[]).map(p=>p.ticker)))].filter(x=>!T.includes(x));
  if(ex.length){const P=ex.map(x=>T.map(t=>V.D.companies[t].peers.find(p=>p.ticker===x)).find(Boolean));o.extraPeers=ex;
    P.forEach(p=>M.push({evEbitda:p.evEbitda,pe:p.pe,fpe:p.forwardPE,pb:p.pb,pfcf:null,fcfY:null,divY:null,ndE:null}))}
  for(const [k] of MX_DEF){const cl=k==="evEbitda"||k==="pfcf"||k==="pe"||k==="fpe"?M.map(m=>m[k]).filter(x=>x!=null&&x<80):M.map(m=>m[k]);o[k]=mstat(cl)}return o}
function mxPeers(tk){const cm=comps(tk),P=(cm.peers||[]).filter(p=>!p.ref),o={};o.evEbitda=mstat(P.map(p=>p.evEbitda).filter(x=>x>0&&x<60));o.pe=mstat(P.map(p=>p.pe).filter(x=>x>0&&x<80));
  o.fpe=mstat(P.map(p=>p.forwardPE).filter(x=>x>0&&x<80));o.pb=mstat(P.map(p=>p.pb).filter(x=>x>0&&x<20));o.n=P.length;return o}
function drawMx(){const tk=V.tk,m=multiplesOf(tk),box=$("#mxBox");if(!m||!box)return;const g=mxGroup(m.group),p=mxPeers(tk);
  const fm=(v,u)=>v==null||!isFinite(v)?"n.m.":u==="%"?(v*100).toFixed(1)+"%":v.toFixed(1)+"x";
  const cls=(v,ref,dir)=>v==null||ref==null||!dir?"":(dir>0?(v<ref*0.85?"cheap":v>ref*1.15?"rich":""):(v>ref*1.15?"cheap":v<ref*0.85?"rich":""));
  $("#mxTitle").textContent=`Valuation multiples: ${tk} vs ${m.group}`;$("#mxSub").textContent=`${g.members.length} covered names in the group · green = cheaper than the group median by >15%`;
  $("#vMx").innerHTML=`<thead><tr><th>Multiple</th><th>${tk}</th><th>Group median</th><th>Group mean</th><th>Comps-set median</th></tr></thead><tbody>${MX_DEF.map(([k,l,d,u,dir])=>`<tr><td>${l}<span class="def">${d}</span></td><td class="self ${cls(m[k],g[k].med,dir)}">${fm(m[k],u)}</td><td>${fm(g[k].med,u)}</td><td>${fm(g[k].mean,u)}</td><td>${p[k]?fm(p[k].med,u):"—"}</td></tr>`).join("")}</tbody>`;
  $("#mxNote").innerHTML=`Group: ${g.members.join(", ")}${g.extraPeers?` + comps-only peers ${g.extraPeers.join(", ")} (EV/EBITDA, P/E, forward P/E, P/B only)`:""}. EV = market cap + net debt + minority interest; EBITDA TTM; FCF and dividends from the last fiscal-year cash-flow statement; forward P/E on next-fiscal-year consensus EPS; all in USD at the official rates used by the model. Group stats exclude P/E-type multiples above 80x. Comps-set median uses this ticker's peer list (TTM, Yahoo). Data in <code>data/multiples.json</code>.`}
const _dvMx=drawVal;drawVal=function(full){_dvMx(full);try{drawMx()}catch(e){console.error(e)}};

/* pre-revenue flag (OKLO, SMR): value rests on scenarios, not on current financials */
const _dvPre=drawVal;drawVal=function(full){_dvPre(full);const a=V.A.companies[V.tk],k=$("#vK");if(!k)return;let f=$("#preRevFlag");
  if(!a.preRevenue){if(f)f.remove();return}if(!f){k.insertAdjacentHTML("beforebegin",'<div id="preRevFlag" class="prerev"></div>');f=$("#preRevFlag")}
  f.innerHTML=`<b>⚠ Pre-revenue company.</b> ${a.preRevenue}`};
