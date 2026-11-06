/* Forward P/E vs subsequent returns (EWZ / EWY). Data: data/fpe_returns.json */
(function () {
  let tk = "EWZ";
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || undefined; }
  function pct(x, d = 1) { return x == null || !isFinite(x) ? "—" : (x * 100).toFixed(d) + "%"; }
  function num(x, d = 2) { return x == null || !isFinite(x) ? "—" : Number(x).toFixed(d); }

  function T() {
    return (S.fpe && S.fpe.tickers && S.fpe.tickers[tk]) || null;
  }

  function panel(elId, pointsDam, pointsSib, reg, cur, yTitle) {
    const el = document.getElementById(elId);
    if (!el || typeof Plotly === "undefined") return;
    const traces = [];
    if (pointsDam && pointsDam.length) {
      traces.push({
        type: "scatter", mode: "markers", name: "Damodaran anual",
        x: pointsDam.map(p => p.fpe), y: pointsDam.map(p => p.ret),
        text: pointsDam.map(p => p.asof.slice(0, 4)),
        customdata: pointsDam.map(p => [p.asof, p.window_end, p.fpe_method || ""]),
        marker: { size: 9, color: css("--ac") || "#5b8cff", opacity: 0.85 },
        hovertemplate: "%{customdata[0]}<br>FPE %{x:.2f}x<br>Ret %{y:.1%}<br>→%{customdata[1]}<extra>Damodaran</extra>",
      });
    }
    if (pointsSib && pointsSib.length) {
      traces.push({
        type: "scatter", mode: "markers", name: "Siblis índice (reciente)",
        x: pointsSib.map(p => p.fpe), y: pointsSib.map(p => p.ret),
        text: pointsSib.map(p => p.asof),
        marker: { size: 8, symbol: "square", color: "#f59e0b", opacity: 0.9 },
        hovertemplate: "%{text}<br>FPE %{x:.2f}x<br>Ret %{y:.1%}<extra>Siblis</extra>",
      });
    }
    if (reg && reg.n >= 5) {
      const x0 = Math.min(reg.x_min, cur.fpe) * 0.92;
      const x1 = Math.max(reg.x_max, cur.fpe) * 1.08;
      traces.push({
        type: "scatter", mode: "lines", name: `OLS Damodaran (n=${reg.n}, R²=${num(reg.r2, 2)})`,
        x: [x0, x1], y: [reg.intercept + reg.slope * x0, reg.intercept + reg.slope * x1],
        line: { color: "#94a3b8", width: 2, dash: "dot" },
        hoverinfo: "skip",
      });
    }
    // Current MSCI FPE marker (no completed subsequent return yet)
    const yCur = reg && reg.implied_at_current != null ? reg.implied_at_current : 0;
    traces.push({
      type: "scatter", mode: "markers+text", name: `Hoy MSCI ${num(cur.fpe, 2)}x (${cur.date})`,
      x: [cur.fpe], y: [yCur],
      text: [`hoy ${num(cur.fpe, 2)}x`], textposition: "top center",
      marker: { symbol: "diamond", size: 14, color: "#ef4444", line: { width: 1.5, color: "#fff" } },
      hovertemplate: `MSCI FPE %{x:.2f}x @ ${cur.date}<br>OLS implícito %{y:.1%}<extra>actual</extra>`,
    });
    Plotly.newPlot(el, traces, {
      margin: { l: 56, r: 16, t: 10, b: 48 },
      paper_bgcolor: "transparent", plot_bgcolor: "transparent",
      font: { color: css("--tx") || "#e2e8f0", size: 11, family: "Inter" },
      xaxis: { title: "Forward P/E (proxy)", gridcolor: css("--bd") || "#334155", zeroline: false },
      yaxis: { title: yTitle, tickformat: ".0%", gridcolor: css("--bd") || "#334155", zeroline: true, zerolinecolor: "#64748b" },
      legend: { orientation: "h", y: -0.22, font: { size: 10 } },
      hovermode: "closest",
    }, { displayModeBar: false, responsive: true });
  }

  function table(t) {
    const rows = [];
    (t.points_1y_damodaran || []).forEach(p => {
      const p5 = (t.points_5y_damodaran || []).find(x => x.asof === p.asof);
      rows.push({ asof: p.asof, fpe: p.fpe, r1: p.ret, r5: p5 ? p5.ret : null, series: "Damodaran" });
    });
    (t.points_1y_siblis || []).forEach(p => {
      rows.push({ asof: p.asof, fpe: p.fpe, r1: p.ret, r5: null, series: "Siblis" });
    });
    rows.sort((a, b) => a.asof < b.asof ? 1 : -1);
    const el = document.getElementById("fpeTbl");
    if (!el) return;
    el.innerHTML = `<thead><tr><th>As-of</th><th>Serie FPE</th><th>Forward P/E</th><th>Retorno 1Y</th><th>Retorno 5Y ann.</th></tr></thead>` +
      `<tbody>${rows.map(r => `<tr><td>${r.asof}</td><td>${r.series}</td><td>${num(r.fpe, 2)}x</td><td>${pct(r.r1)}</td><td>${pct(r.r5)}</td></tr>`).join("")}</tbody>`;
  }

  window.fpeTab = function fpeTab() {
    const box = document.getElementById("fpeBox");
    if (!box) return;
    if (!S.fpe || !S.fpe.tickers) {
      box.querySelector("#fpeNote").innerHTML = "No se pudo cargar <code>data/fpe_returns.json</code>.";
      return;
    }
    const t = T();
    if (!t) return;
    const cur = t.current_msci;
    const yt = t.yahoo_trailing || {};
    document.getElementById("fpeNote").innerHTML =
      `<b>Proxy documentado:</b> ${t.proxy}. ` +
      `Marcador actual = <b>${num(cur.fpe, 2)}x</b> (${cur.date}, ${cur.source}). ` +
      `Yahoo trailing P/E del ETF (no forward): <b>${num(yt.trailingPE, 2)}x</b>. ` +
      `Histórico anual = Damodaran firm avg/median Forward PE (gap sin ene-2014). ` +
      `Puntos recientes índice = Siblis IBOV/KOSPI. Retornos = Yahoo total return de ${tk}. ` +
      `Muestra chica — no inventamos puntos.`;

    const reg1 = t.regression_1y_damodaran, reg5 = t.regression_5y_damodaran;
    const k = document.getElementById("fpeK");
    if (k) {
      k.innerHTML = [
        [`MSCI FPE hoy`, `${num(cur.fpe, 2)}x`, cur.date],
        [`OLS 1Y @ hoy`, reg1 ? pct(reg1.implied_at_current) : "—", reg1 ? `n=${reg1.n} · R²=${num(reg1.r2, 2)} · slope ${num(reg1.slope, 3)}` : "n insuficiente"],
        [`OLS 5Y ann. @ hoy`, reg5 ? pct(reg5.implied_at_current) : "—", reg5 ? `n=${reg5.n} · R²=${num(reg5.r2, 2)} · slope ${num(reg5.slope, 3)}` : "n insuficiente"],
        [`Muestra`, `${t.n["1y_dam"]} pts 1Y / ${t.n["5y_dam"]} pts 5Y`, `Damodaran · +${t.n["1y_sib"]} Siblis 1Y`],
      ].map(([a, b, c]) => `<div class="kpi"><div class="k-l">${a}</div><div class="k-v">${b}</div><div class="k-s">${c}</div></div>`).join("");
    }

    panel("fpe1y", t.points_1y_damodaran, t.points_1y_siblis, reg1, cur, "Retorno total 1 año");
    panel("fpe5y", t.points_5y_damodaran, t.points_5y_siblis, reg5, cur, "Retorno anualizado 5 años");
    table(t);

    const src = document.getElementById("fpeSrc");
    if (src) {
      const links = (S.fpe.sources || []).map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(" · ");
      const gaps = (S.fpe.gaps || []).map(g => `<li>${g}</li>`).join("");
      src.innerHTML = `Fuentes: ${links}. Generado ${S.fpe.generatedAt || "—"}. <b>No es asesoramiento.</b>` +
        (gaps ? `<ul class="muted small" style="margin:6px 0 0;padding-left:18px">${gaps}</ul>` : "");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const seg = document.getElementById("fpeSeg");
    if (!seg) return;
    seg.addEventListener("click", e => {
      const b = e.target.closest("button[data-k]");
      if (!b) return;
      tk = b.dataset.k;
      [...seg.querySelectorAll("button")].forEach(x => x.classList.toggle("on", x === b));
      fpeTab();
    });
  });
})();
