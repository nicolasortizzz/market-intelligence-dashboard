/* Forward P/E vs subsequent returns (EWZ / EWY). Data: data/fpe_returns.json
   Own tab: both tickers rendered stacked, no toggle. All available Damodaran
   / Siblis years — no invented points; incomplete return windows stay off-scatter. */
(function () {
  const TICKERS = ["EWZ", "EWY"];
  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || undefined; }
  function pct(x, d = 1) { return x == null || !isFinite(x) ? "—" : (x * 100).toFixed(d) + "%"; }
  function num(x, d = 2) { return x == null || !isFinite(x) ? "—" : Number(x).toFixed(d); }
  function yr(asof) { return (asof || "").slice(0, 4); }

  function panel(elId, pointsDam, pointsSib, reg, cur, yTitle) {
    const el = document.getElementById(elId);
    if (!el || typeof Plotly === "undefined") return;
    const traces = [];
    if (pointsDam && pointsDam.length) {
      traces.push({
        type: "scatter", mode: "markers+text", name: "Damodaran anual",
        x: pointsDam.map(p => p.fpe), y: pointsDam.map(p => p.ret),
        text: pointsDam.map(p => yr(p.asof)),
        textposition: "top center",
        textfont: { size: 10, color: css("--tx") || "#e2e8f0" },
        customdata: pointsDam.map(p => [p.asof, p.window_end, p.fpe_method || ""]),
        marker: { size: 9, color: css("--ac") || "#5b8cff", opacity: 0.85 },
        hovertemplate: "%{customdata[0]} (%{text})<br>FPE %{x:.2f}x<br>Ret %{y:.1%}<br>→%{customdata[1]}<extra>Damodaran</extra>",
      });
    }
    if (pointsSib && pointsSib.length) {
      traces.push({
        type: "scatter", mode: "markers+text", name: "Siblis índice",
        x: pointsSib.map(p => p.fpe), y: pointsSib.map(p => p.ret),
        text: pointsSib.map(p => (p.asof || "").slice(0, 7)),
        textposition: "bottom center",
        textfont: { size: 9, color: "#f59e0b" },
        customdata: pointsSib.map(p => [p.asof, p.window_end]),
        marker: { size: 8, symbol: "square", color: "#f59e0b", opacity: 0.9 },
        hovertemplate: "%{customdata[0]}<br>FPE %{x:.2f}x<br>Ret %{y:.1%}<br>→%{customdata[1]}<extra>Siblis</extra>",
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
    const yCur = reg && reg.implied_at_current != null ? reg.implied_at_current : 0;
    traces.push({
      type: "scatter", mode: "markers+text", name: `Hoy MSCI ${num(cur.fpe, 2)}x (${cur.date})`,
      x: [cur.fpe], y: [yCur],
      text: [`hoy ${num(cur.fpe, 2)}x`], textposition: "top center",
      textfont: { size: 10, color: "#ef4444" },
      marker: { symbol: "diamond", size: 14, color: "#ef4444", line: { width: 1.5, color: "#fff" } },
      hovertemplate: `MSCI FPE %{x:.2f}x @ ${cur.date}<br>OLS implícito %{y:.1%}<extra>actual</extra>`,
    });
    Plotly.newPlot(el, traces, {
      margin: { l: 56, r: 16, t: 28, b: 56 },
      paper_bgcolor: "transparent", plot_bgcolor: "transparent",
      font: { color: css("--tx") || "#e2e8f0", size: 11, family: "Inter" },
      xaxis: { title: "Forward P/E (proxy)", gridcolor: css("--bd") || "#334155", zeroline: false },
      yaxis: { title: yTitle, tickformat: ".0%", gridcolor: css("--bd") || "#334155", zeroline: true, zerolinecolor: "#64748b" },
      legend: { orientation: "h", y: -0.28, font: { size: 10 } },
      hovermode: "closest",
    }, { displayModeBar: false, responsive: true });
  }

  function table(tk, t) {
    const byAsof = {};
    (t.damodaran_fpe || []).forEach(r => {
      byAsof[r.date] = { asof: r.date, fpe: r.fpe, r1: null, r5: null, series: "Damodaran", pending: true };
    });
    (t.points_1y_damodaran || []).forEach(p => {
      const row = byAsof[p.asof] || { asof: p.asof, fpe: p.fpe, series: "Damodaran" };
      row.r1 = p.ret; row.fpe = p.fpe; row.pending = false; byAsof[p.asof] = row;
    });
    (t.points_5y_damodaran || []).forEach(p => {
      const row = byAsof[p.asof] || { asof: p.asof, fpe: p.fpe, series: "Damodaran" };
      row.r5 = p.ret; row.fpe = p.fpe; byAsof[p.asof] = row;
    });
    (t.siblis_fpe || []).forEach(r => {
      const key = "sib:" + r.date;
      byAsof[key] = { asof: r.date, fpe: r.fpe, r1: null, r5: null, series: "Siblis", pending: true };
    });
    (t.points_1y_siblis || []).forEach(p => {
      const key = "sib:" + p.asof;
      const row = byAsof[key] || { asof: p.asof, fpe: p.fpe, series: "Siblis" };
      row.r1 = p.ret; row.fpe = p.fpe; row.pending = false; byAsof[key] = row;
    });
    (t.points_5y_siblis || []).forEach(p => {
      const key = "sib:" + p.asof;
      const row = byAsof[key] || { asof: p.asof, fpe: p.fpe, series: "Siblis" };
      row.r5 = p.ret; row.fpe = p.fpe; byAsof[key] = row;
    });
    const rows = Object.values(byAsof).sort((a, b) => a.asof < b.asof ? 1 : -1);
    const el = document.getElementById("fpeTbl" + tk);
    if (!el) return;
    el.innerHTML = `<thead><tr><th>Año / as-of</th><th>Serie FPE</th><th>Forward P/E</th><th>Retorno 1Y</th><th>Retorno 5Y ann.</th></tr></thead>` +
      `<tbody>${rows.map(r => {
        const y = yr(r.asof);
        const pending = (r.r1 == null && r.r5 == null) ? ' <span class="muted">(ventana incompleta)</span>' : '';
        return `<tr><td><b>${y}</b> <span class="muted small">${r.asof}</span>${pending}</td><td>${r.series}</td><td>${num(r.fpe, 2)}x</td><td>${pct(r.r1)}</td><td>${pct(r.r5)}</td></tr>`;
      }).join("")}</tbody>`;
  }

  function renderOne(tk) {
    const box = document.getElementById("fpeBox" + tk);
    if (!box) return;
    const t = S.fpe && S.fpe.tickers && S.fpe.tickers[tk];
    const noteEl = document.getElementById("fpeNote" + tk);
    if (!t) {
      if (noteEl) noteEl.innerHTML = `Sin datos para <b>${tk}</b> en <code>data/fpe_returns.json</code>.`;
      return;
    }
    const cur = t.current_msci;
    const yt = t.yahoo_trailing || {};
    const reg1 = t.regression_1y_damodaran, reg5 = t.regression_5y_damodaran;
    const yearsDam = (t.years && t.years.damodaran_all) || (t.damodaran_fpe || []).map(r => r.date.slice(0, 4));
    const years1 = (t.years && t.years.damodaran_1y_scatter) || (t.points_1y_damodaran || []).map(p => p.asof.slice(0, 4));
    const years5 = (t.years && t.years.damodaran_5y_scatter) || (t.points_5y_damodaran || []).map(p => p.asof.slice(0, 4));

    const sub = document.getElementById("fpeSub" + tk);
    if (sub) {
      sub.textContent = `Damodaran ${yearsDam[0] || "—"}–${yearsDam.at(-1) || "—"} (todos los XLS públicos) · MSCI ${num(cur.fpe, 2)}x @ ${cur.date}`;
    }

    let note =
      `<b>Proxy documentado:</b> ${t.proxy}. ` +
      `<b>Años Damodaran (todos los disponibles):</b> ${yearsDam.join(", ") || "—"}. ` +
      `Scatter 1Y = ${years1.join(", ") || "—"} (n=${t.n["1y_dam"]}); scatter 5Y = ${years5.join(", ") || "—"} (n=${t.n["5y_dam"]}). ` +
      `Gap real: sin ene-2014; sin archivos pre-2012 en el archive público. ` +
      `Marcador actual = <b>${num(cur.fpe, 2)}x</b> (${cur.date}, ${cur.source}). ` +
      `Yahoo trailing P/E del ETF (no forward): <b>${num(yt.trailingPE, 2)}x</b>. ` +
      `Siblis índice: ${(t.n && t.n.siblis) || (t.siblis_fpe || []).length} snapshots (scatter 1Y n=${t.n["1y_sib"]}). ` +
      `Cada punto del gráfico lleva su año en la etiqueta. No inventamos puntos.`;

    const oos = [];
    [reg1, reg5].forEach((r, i) => {
      if (r && (cur.fpe < r.x_min || cur.fpe > r.x_max))
        oos.push((i ? "5Y" : "1Y") + ` (muestra Damodaran ${num(r.x_min, 1)}–${num(r.x_max, 1)}x)`);
    });
    if (oos.length) {
      note += ` <b style="color:#f59e0b">Aviso:</b> el FPE MSCI actual (${num(cur.fpe, 2)}x) queda fuera del rango histórico Damodaran en ${oos.join(" y ")}; el OLS implícito es extrapolación, no interpolación.`;
    }
    if (noteEl) noteEl.innerHTML = note;

    const k = document.getElementById("fpeK" + tk);
    if (k) {
      k.innerHTML = [
        [`MSCI FPE hoy`, `${num(cur.fpe, 2)}x`, cur.date],
        [`OLS 1Y @ hoy`, reg1 ? pct(reg1.implied_at_current) : "—", reg1 ? `n=${reg1.n} · R²=${num(reg1.r2, 2)} · slope ${num(reg1.slope, 3)}` : "n insuficiente"],
        [`OLS 5Y ann. @ hoy`, reg5 ? pct(reg5.implied_at_current) : "—", reg5 ? `n=${reg5.n} · R²=${num(reg5.r2, 2)} · slope ${num(reg5.slope, 3)}` : "n insuficiente"],
        [`Años en scatter`, `${t.n["1y_dam"]} pts 1Y / ${t.n["5y_dam"]} pts 5Y`, `Damodaran ${yearsDam[0]}–${yearsDam.at(-1)} · +${t.n["1y_sib"]} Siblis 1Y`],
      ].map(([a, b, c]) => `<div class="kpi"><div class="k-l">${a}</div><div class="k-v">${b}</div><div class="k-s">${c}</div></div>`).join("");
    }

    panel("fpe" + tk + "1y", t.points_1y_damodaran, t.points_1y_siblis, reg1, cur, "Retorno total 1 año");
    panel("fpe" + tk + "5y", t.points_5y_damodaran, t.points_5y_siblis, reg5, cur, "Retorno anualizado 5 años");
    table(tk, t);
  }

  window.fpeTab = function fpeTab() {
    if (!S.fpe || !S.fpe.tickers) {
      TICKERS.forEach(tk => {
        const noteEl = document.getElementById("fpeNote" + tk);
        if (noteEl) noteEl.innerHTML = "No se pudo cargar <code>data/fpe_returns.json</code>.";
      });
      return;
    }
    TICKERS.forEach(renderOne);

    const src = document.getElementById("fpeSrc");
    if (src) {
      const links = (S.fpe.sources || []).map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.name}</a>`).join(" · ");
      const gaps = (S.fpe.gaps || []).map(g => `<li>${g}</li>`).join("");
      src.innerHTML = `Fuentes: ${links}. Generado ${S.fpe.generatedAt || "—"}. <b>No es asesoramiento.</b>` +
        (gaps ? `<ul class="muted small" style="margin:6px 0 0;padding-left:18px">${gaps}</ul>` : "");
    }
  };
})();
