import { useState, useEffect, useCallback, useMemo, Component } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, Cell
} from "recharts";

/* ═══ SAFE MATH ═══ */
const sN = (v, f = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : f; };
const sI = (v, f = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : f; };
const sD = (a, b, f = 0) => { const nb = sN(b); return nb !== 0 ? sN(a) / nb : f; };
const sP = (a, b) => sD(a, b) * 100;
const fmt = (n) => "$" + Math.round(sN(n)).toLocaleString("en-US");
const fD = (n) => "$" + sN(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fP = (n) => sN(n).toFixed(1) + "%";
const fN = (n) => sI(n).toLocaleString("en-US");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const td = () => new Date().toISOString().split("T")[0];

/* ═══ THEMES ═══ */
const DK = { bg: "#050505", bg2: "#0B0B0F", crd: "#101014", bd: "#1a1a22", tx: "#FFFFFF", tx2: "#A1A1AA", mt: "#71717A", inp: "#151519", shadow: "0 8px 24px rgba(0,0,0,.4)" };
const LT = { bg: "#F5F5F7", bg2: "#FFFFFF", crd: "#FFFFFF", bd: "#E2E2E8", tx: "#111111", tx2: "#555566", mt: "#8E8E9E", inp: "#F0F0F5", shadow: "0 8px 24px rgba(0,0,0,.06)" };
const AC = "#FF006E", OK = "#00D084", WN = "#FFB800", ER = "#FF5A5F";

/* ═══ ERROR BOUNDARY ═══ */
class EB extends Component {
  constructor(p) { super(p); this.state = { err: false, msg: "" }; }
  static getDerivedStateFromError(e) { return { err: true, msg: e?.message || "Error" }; }
  componentDidCatch(e) { console.error("[LaunchOS]", e); }
  render() {
    if (this.state.err) return (
      <div style={{ padding: 60, textAlign: "center", fontFamily: "Inter,system-ui", color: "#fff", background: "#050505", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: ER, marginBottom: 8 }}>Error del sistema</div>
        <div style={{ fontSize: 13, color: "#71717A", marginBottom: 20, maxWidth: 400 }}>{this.state.msg}</div>
        <button onClick={() => this.setState({ err: false, msg: "" })} style={{ padding: "10px 24px", borderRadius: 10, border: `1px solid ${ER}`, background: "transparent", color: ER, cursor: "pointer", fontWeight: 600 }}>Reintentar</button>
      </div>
    );
    return this.props.children;
  }
}

/* ═══ STORAGE ADAPTER (works in Claude artifacts + standalone) ═══ */
const hasWinStorage = typeof window !== "undefined" && window.storage?.get;
const storageGet = async (key) => {
  if (hasWinStorage) { const r = await window.storage.get(key); return r?.value || null; }
  try { return localStorage.getItem(key); } catch { return null; }
};
const storageSet = async (key, value) => {
  if (hasWinStorage) { await window.storage.set(key, value); return; }
  try { localStorage.setItem(key, value); } catch {}
};
const storageDel = async (key) => {
  if (hasWinStorage) { await window.storage.delete(key); return; }
  try { localStorage.removeItem(key); } catch {}
};
const SK = "launchos_v10", TK = "launchos_th4";
const ldS = async () => { try { const raw = await storageGet(SK); if (!raw) return null; const d = JSON.parse(raw); if (!Array.isArray(d.launches)) d.launches = []; d.launches = d.launches.filter(l => l?.id && l?.name).map(l => ({ ...nL(), ...l })); if (!d.config) d.config = { businessName: "Growins" }; if (!Array.isArray(d.auditLog)) d.auditLog = []; return d; } catch { return null; } };
const svS = async d => { try { await storageSet(SK, JSON.stringify(d)); } catch {} };
const ldT = async () => { try { return (await storageGet(TK)) || "dark"; } catch { return "dark"; } };
const svT = async m => { try { await storageSet(TK, m); } catch {} };

/* ═══ CONSTANTS ═══ */
const DEF = { launches: [], auditLog: [], config: { businessName: "Growins" } };
const STATES = ["Activo", "Escalando", "Finalizado", "Evergreen"];
const LTYPES = ["En Vivo", "Automatizado", "Replay"];
const PLATS = ["Facebook", "Instagram", "Tiktok", "Youtube", "Email"];
const ST_C = { Activo: OK, Escalando: WN, Finalizado: "#71717A", Evergreen: "#c084fc" };
const SRC_C = { manual: "#71717A", meta: "#4285F4", sendflow: "#25D366", ghl: "#FF6B35", tiktok: "#FF0050" };
const SRC_L = { manual: "Manual", meta: "Meta Ads", sendflow: "SendFlow", ghl: "GHL", tiktok: "TikTok" };
const CHANNELS = ["Meta Ads", "Google Ads", "TikTok Ads", "Orgánico", "WhatsApp", "Referidos", "Otro"];
const CH_C = { "Meta Ads": "#4285F4", "Google Ads": "#34A853", "TikTok Ads": "#FF0050", "Orgánico": "#c084fc", "WhatsApp": "#25D366", "Referidos": "#FF6B35", "Otro": "#71717A" };

const defInt = () => ({ meta: { connected: false, accountId: "", lastSync: null, status: "disconnected" }, sendflow: { connected: false, workspaceId: "", lastSync: null, status: "disconnected" }, ghl: { connected: false, subaccountId: "", lastSync: null, status: "disconnected" }, tiktok: { connected: false, advertiserId: "", lastSync: null, status: "disconnected" } });
const defSrc = () => ({ metaInvestment: "manual", metaLeads: "manual", googleLeads: "manual", tiktokLeads: "manual", contactosAPI: "manual", ingresosWhatsApp: "manual", registrados: "manual", asistentes: "manual", ventasTotal: "manual", revenue: "manual" });
function nL() { return { id: uid(), name: "", date: td(), type: "En Vivo", status: "Activo", platforms: [], metaInvestment: "", metaClicks: "", metaLeads: "", googleInvestment: "", googleClicks: "", googleLeads: "", tiktokInvestment: "", tiktokClicks: "", tiktokLeads: "", contactosAPI: "", ingresosWhatsApp: "", registrados: "", asistentes: "", hastaPitch: "", ventasTotal: "", ventasMensuales: "", ventasAnuales: "", revenue: "", dailyData: [], integrations: defInt(), sources: defSrc() }; }

function calcK(l) {
  if (!l) return { mi: 0, ml: 0, gi: 0, gl: 0, ti: 0, tl: 0, api: 0, waRev: 0, rev: 0, reg: 0, att: 0, pitch: 0, sales: 0, totalLeads: 0, cplMeta: 0, cplGoogle: 0, cplTiktok: 0, waPercent: 0, totalInv: 0, roas: 0, cac: 0, showRate: 0, closeRate: 0, profit: 0 };
  const mi = sN(l.metaInvestment), ml = sI(l.metaLeads), gi = sN(l.googleInvestment), gl = sI(l.googleLeads);
  const ti = sN(l.tiktokInvestment), tl = sI(l.tiktokLeads), api = sI(l.contactosAPI), waRev = sN(l.ingresosWhatsApp);
  const rev = sN(l.revenue), reg = sI(l.registrados), att = sI(l.asistentes), pitch = sI(l.hastaPitch), sales = sI(l.ventasTotal);
  const totalLeads = ml + gl + tl, totalInv = mi + gi + ti;
  return { mi, ml, gi, gl, ti, tl, api, waRev, rev, reg, att, pitch, sales, totalLeads, cplMeta: sD(mi, ml), cplGoogle: sD(gi, gl), cplTiktok: sD(ti, tl), waPercent: sP(waRev, rev), totalInv, roas: sD(rev, totalInv), cac: sD(totalInv, sales), showRate: sP(att, reg), closeRate: sP(sales, att), profit: rev - totalInv };
}

const ic = (p, s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{p.map((d, i) => <path key={i} d={d} />)}</svg>;
const IC = {
  home: ic(["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"]),
  rocket: ic(["M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z", "M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"]),
  calc: ic(["M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M8 6h8", "M8 18h8"]),
  chart: ic(["M18 20V10", "M12 20V4", "M6 20V14"]),
  gear: ic(["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"]),
  plus: ic(["M12 5v14", "M5 12h14"]), x: ic(["M18 6L6 18", "M6 6l12 12"]),
  edit: ic(["M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7", "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"]),
  trash: ic(["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]),
  menu: ic(["M3 6h18", "M3 12h18", "M3 18h18"]), chev: ic(["M6 9l6 6 6-6"]),
  copy: ic(["M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"]),
  brain: ic(["M12 2a5 5 0 0 1 5 5c0 1.5-.5 3-2 4l-3 2v3", "M12 22v-4", "M7 7a5 5 0 0 1 10 0", "M9 18h6"]),
  sun: ic(["M12 12m-5 0a5 5 0 1 0 10 0 5 5 0 1 0-10 0", "M12 1v2", "M12 21v2", "M4.22 4.22l1.42 1.42", "M18.36 18.36l1.42 1.42", "M1 12h2", "M21 12h2"]),
  moon: ic(["M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"]),
  monitor: ic(["M2 3h20a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M8 21h8", "M12 17v4"]),
  target: ic(["M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0", "M12 12m-6 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0"]),
  alert: ic(["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"]),
};

/* ═══════════════════════════════════════════
   COMPONENTS WITH HOOKS — defined at MODULE
   level to avoid React Error #310
   ═══════════════════════════════════════════ */

/* ─── DAILY MODAL (has useState) ─── */
function DailyModal({ sel, updateL, closeM, T, mob }) {
  const sinp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.inp, color: T.tx, fontSize: 13, outline: "none" };
  const [f, sf] = useState(() => ({ date: td(), ...Object.fromEntries(CHANNELS.map(c => [c, ""])) }));
  return (
    <div onClick={closeM} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: mob ? 10 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.crd, borderRadius: 20, padding: mob ? "20px" : "28px 32px", width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", border: `1px solid ${T.bd}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.tx }}>Registrar leads por día</h3>
          <button onClick={closeM} style={{ background: "none", border: "none", cursor: "pointer", color: T.mt }}>{IC.x}</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <div><label style={{ fontSize: 11, fontWeight: 600, color: T.mt, display: "block", marginBottom: 5 }}>FECHA</label><input type="date" value={f.date} onChange={e => sf(p => ({ ...p, date: e.target.value }))} style={sinp} /></div>
          {CHANNELS.map(ch => (
            <div key={ch} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: CH_C[ch], flexShrink: 0 }} />
              <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.mt, display: "block", marginBottom: 5 }}>{ch.toUpperCase()}</label><input type="number" value={f[ch]} onChange={e => sf(p => ({ ...p, [ch]: e.target.value }))} style={sinp} placeholder="0" /></div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <button onClick={closeM} style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.bd}`, background: "transparent", color: T.tx, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <button onClick={() => { if (!sel) return; const entry = { date: f.date }; CHANNELS.forEach(c => { entry[c] = sI(f[c]); }); const ex = [...(sel.dailyData || [])]; const idx = ex.findIndex(d => d.date === f.date); if (idx >= 0) ex[idx] = entry; else ex.push(entry); ex.sort((a, b) => a.date > b.date ? 1 : -1); updateL(sel.id, { dailyData: ex }); closeM(); }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: AC, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── LAUNCH MODAL (has useState) ─── */
function LaunchModal({ editItem, closeM, onSave, T, mob }) {
  const sinp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.inp, color: T.tx, fontSize: 13, outline: "none" };
  const [f, sf] = useState(() => editItem ? { ...editItem } : nL());
  const cols3 = mob ? "1fr 1fr" : "1fr 1fr 1fr";
  const Fld = ({ label, span, children }) => <div style={{ gridColumn: span && !mob ? `span ${span}` : undefined }}><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 5, textTransform: "uppercase" }}>{label}</label>{children}</div>;
  const Sec = ({ children }) => <div style={{ gridColumn: "1/-1", fontSize: 10, fontWeight: 700, color: AC, textTransform: "uppercase", letterSpacing: "1px", margin: "12px 0 4px", padding: "6px 0", borderBottom: `1px solid ${AC}15` }}>{children}</div>;
  const Chip = ({ options, selected, onChange }) => <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{options.map(o => { const on = (selected || []).includes(o); return <button key={o} onClick={() => onChange(on ? selected.filter(x => x !== o) : [...(selected || []), o])} style={{ padding: "5px 12px", borderRadius: 20, border: `1px solid ${on ? AC : T.bd}`, background: on ? AC + "12" : "transparent", color: on ? AC : T.mt, fontSize: 11, cursor: "pointer" }}>{o}</button>; })}</div>;

  return (
    <div onClick={closeM} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: mob ? 10 : 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.crd, borderRadius: 20, padding: mob ? "20px" : "28px 32px", width: "100%", maxWidth: 780, maxHeight: "90vh", overflowY: "auto", border: `1px solid ${T.bd}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: T.tx }}>{editItem ? "Editar" : "Nuevo lanzamiento"}</h3>
          <button onClick={closeM} style={{ background: "none", border: "none", cursor: "pointer", color: T.mt }}>{IC.x}</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: mob ? 10 : 14 }}>
          <Fld label="Nombre *" span={2}><input value={f.name} onChange={e => sf(p => ({ ...p, name: e.target.value }))} style={sinp} /></Fld>
          <Fld label="Fecha"><input type="date" value={f.date} onChange={e => sf(p => ({ ...p, date: e.target.value }))} style={sinp} /></Fld>
          <Fld label="Estado"><select value={f.status} onChange={e => sf(p => ({ ...p, status: e.target.value }))} style={sinp}>{STATES.map(s => <option key={s}>{s}</option>)}</select></Fld>
          <Fld label="Tipo"><select value={f.type} onChange={e => sf(p => ({ ...p, type: e.target.value }))} style={sinp}>{LTYPES.map(t => <option key={t}>{t}</option>)}</select></Fld>
          <Fld label="Plataformas" span={2}><Chip options={PLATS} selected={f.platforms || []} onChange={v => sf(p => ({ ...p, platforms: v }))} /></Fld>
          <Sec>Meta Ads</Sec>
          <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: cols3, gap: 8 }}>
            {[["Inversión", "metaInvestment"], ["Clicks", "metaClicks"], ["Leads", "metaLeads"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={f[k]} onChange={e => sf(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
          </div>
          <Sec>TikTok Ads</Sec>
          <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: cols3, gap: 8 }}>
            {[["Inversión", "tiktokInvestment"], ["Clicks", "tiktokClicks"], ["Leads", "tiktokLeads"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={f[k]} onChange={e => sf(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
          </div>
          <Sec>Google Ads</Sec>
          <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: cols3, gap: 8 }}>
            {[["Inversión", "googleInvestment"], ["Clicks", "googleClicks"], ["Leads", "googleLeads"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={f[k]} onChange={e => sf(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
          </div>
          <Sec>WhatsApp</Sec>
          <Fld label="Contactos API"><input type="number" value={f.contactosAPI} onChange={e => sf(p => ({ ...p, contactosAPI: e.target.value }))} style={sinp} /></Fld>
          <Fld label="Ingresos WA"><input type="number" value={f.ingresosWhatsApp} onChange={e => sf(p => ({ ...p, ingresosWhatsApp: e.target.value }))} style={sinp} /></Fld>
          <Sec>Webinar</Sec>
          <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: cols3, gap: 8 }}>
            {[["Registrados", "registrados"], ["Asistentes", "asistentes"], ["Pitch", "hastaPitch"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={f[k]} onChange={e => sf(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
          </div>
          <Sec>Ventas</Sec>
          <div style={{ gridColumn: "1/-1", display: "grid", gridTemplateColumns: cols3, gap: 8 }}>
            {[["Total", "ventasTotal"], ["Mensuales", "ventasMensuales"], ["Anuales", "ventasAnuales"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={f[k]} onChange={e => sf(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
          </div>
          <Fld label="Revenue ($)" span={2}><input type="number" value={f.revenue} onChange={e => sf(p => ({ ...p, revenue: e.target.value }))} style={sinp} /></Fld>
          <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <button onClick={closeM} style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.bd}`, background: "transparent", color: T.tx, cursor: "pointer", fontWeight: 600 }}>Cancelar</button>
            <button onClick={() => { if (!f.name?.trim()) return; onSave(f); }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: AC, color: "#fff", cursor: "pointer", fontWeight: 600 }}>{editItem ? "Guardar" : "Crear"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── CALCULATOR (has useState) ─── */
function CalcPage({ T, mob, calcMode, setCalcMode }) {
  const sinp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.inp, color: T.tx, fontSize: 13, outline: "none" };
  const autoGrid = (min = 155) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${mob ? 130 : min}px,1fr))`, gap: mob ? 8 : 12 });
  const Fld = ({ label, children }) => <div><label style={{ display: "block", fontSize: 11, fontWeight: 600, color: T.mt, marginBottom: 5, textTransform: "uppercase" }}>{label}</label>{children}</div>;
  const Sec = ({ children }) => <div style={{ fontSize: 10, fontWeight: 700, color: AC, textTransform: "uppercase", letterSpacing: "1px", margin: "14px 0 8px", padding: "6px 0", borderBottom: `1px solid ${AC}15` }}>{children}</div>;
  const Kpi = ({ label, value, color }) => <div style={{ background: T.crd, borderRadius: 14, padding: mob ? "12px 14px" : "16px 18px", border: `1px solid ${T.bd}`, position: "relative", overflow: "hidden" }}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${color}33,transparent)` }} /><div style={{ fontSize: 10, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 5 }}>{label}</div><div style={{ fontSize: mob ? 20 : 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div></div>;

  const [r, sR] = useState({ revenueGoal: "100000", ticket: "2000", roasTarget: "4", asistClase1: "55", asistOferta: "60", convOfertaApp: "25", convAppVenta: "20", cpl: "3.50", costoEquipo: "", costoOp: "", comisiones: "" });
  const [f, sF] = useState({ adBudget: "5000", cpl: "3", showUp: "40", closeRate: "10", ticket: "997" });
  const rv = k => sN(r[k]), fv = k => sN(f[k]);

  // Reverse calcs
  const rV = Math.ceil(sD(rv("revenueGoal"), rv("ticket")));
  const rA = Math.ceil(sD(rV, rv("convAppVenta") / 100));
  const rAO = Math.ceil(sD(rA, rv("convOfertaApp") / 100));
  const rAC1 = Math.ceil(sD(rAO, rv("asistOferta") / 100));
  const rL = Math.ceil(sD(rAC1, rv("asistClase1") / 100));
  const rInv = sD(rv("revenueGoal"), rv("roasTarget"));
  const rBud = rL * rv("cpl");
  const rTC = rBud + rv("costoEquipo") + rv("costoOp") + rv("comisiones");
  const rProf = rv("revenueGoal") - rTC;
  const rMarg = sP(rProf, rv("revenueGoal"));
  const rRoas = sD(rv("revenueGoal"), rBud);
  const rBE = sD(rTC, rBud);
  const funnel = [{ n: "Leads", v: rL, c: T.mt }, { n: "Clase 1", v: rAC1, c: WN }, { n: "Oferta", v: rAO, c: OK }, { n: "Apps", v: rA, c: "#38bdf8" }, { n: "Ventas", v: rV, c: AC }];

  // Forward calcs
  const fLd = fv("cpl") > 0 ? Math.floor(sD(fv("adBudget"), fv("cpl"))) : 0;
  const fAt = Math.floor(fLd * fv("showUp") / 100);
  const fSl = Math.floor(fAt * fv("closeRate") / 100);
  const fRv = fSl * fv("ticket"), fPr = fRv - fv("adBudget"), fRo = sD(fRv, fv("adBudget"));

  return (
    <div>
      <h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, margin: "0 0 4px", color: T.tx }}>Launch Revenue Simulator</h1>
      <p style={{ color: T.mt, margin: "0 0 20px", fontSize: 13 }}>Modela escenarios completos antes de ejecutar</p>
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        <button onClick={() => setCalcMode("reverse")} style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${calcMode === "reverse" ? AC : T.bd}`, background: calcMode === "reverse" ? AC + "15" : "transparent", color: calcMode === "reverse" ? AC : T.tx, cursor: "pointer", fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>{IC.target} Reverse</button>
        <button onClick={() => setCalcMode("forward")} style={{ padding: "8px 16px", borderRadius: 10, border: `1px solid ${calcMode === "forward" ? AC : T.bd}`, background: calcMode === "forward" ? AC + "15" : "transparent", color: calcMode === "forward" ? AC : T.tx, cursor: "pointer", fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>{IC.chart} Forward</button>
      </div>
      {calcMode === "reverse" ? (
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "340px 1fr", gap: mob ? 16 : 20, alignItems: "flex-start" }}>
          <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 18 : 22, border: `1px solid ${T.bd}`, position: mob ? "static" : "sticky", top: 72 }}>
            <Fld label="Revenue Goal ($)"><input type="number" value={r.revenueGoal} onChange={e => sR(p => ({ ...p, revenueGoal: e.target.value }))} style={{ ...sinp, fontSize: 16, fontWeight: 700, color: AC }} /></Fld>
            <Sec>Funnel</Sec>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Fld label="Ticket ($)"><input type="number" value={r.ticket} onChange={e => sR(p => ({ ...p, ticket: e.target.value }))} style={sinp} /></Fld><Fld label="ROAS Obj"><input type="number" value={r.roasTarget} onChange={e => sR(p => ({ ...p, roasTarget: e.target.value }))} style={sinp} /></Fld></div>
              {[["Asist. Clase 1 %", "asistClase1"], ["Asist. Oferta %", "asistOferta"], ["Conv. Oferta→App %", "convOfertaApp"], ["Conv. App→Venta %", "convAppVenta"], ["CPL ($)", "cpl"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={r[k]} onChange={e => sR(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
            </div>
            <Sec>Costos</Sec>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[["Equipo", "costoEquipo"], ["OpEx", "costoOp"], ["Comis.", "comisiones"]].map(([l, k]) => <Fld key={k} label={l}><input type="number" value={r[k]} onChange={e => sR(p => ({ ...p, [k]: e.target.value }))} style={sinp} /></Fld>)}
            </div>
          </div>
          <div>
            <div style={autoGrid()}>{[["Ventas", rV, AC], ["Apps", rA, "#38bdf8"], ["Asist. Oferta", rAO, OK], ["Asist. Clase 1", rAC1, WN], ["Leads", fN(rL), T.tx], ["Lead Intent", fN(rA), "#c084fc"], ["Inv. máx", fmt(rInv), ER], ["Budget", fmt(rBud), ER], ["CPL máx", fD(sD(rInv, rL)), OK], ["CPA máx", fD(sD(rInv, rV)), WN], ["ROAS proy", rRoas.toFixed(2) + "x", rRoas >= 1 ? OK : ER], ["BE ROAS", rBE.toFixed(2) + "x", WN], ["Profit", fmt(rProf), rProf >= 0 ? OK : ER], ["Margen", fP(rMarg), rMarg > 0 ? OK : ER]].map(([l, v, c], i) => <Kpi key={i} label={l} value={v} color={c} />)}</div>
            <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 14 : 18, border: `1px solid ${T.bd}`, marginTop: 16 }}>
              <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: T.tx }}>Funnel proyectado</h3>
              {funnel.map((item, i, a) => { const mx = Math.max(...a.map(x => x.v), 1); return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: mob ? "80px 1fr 55px" : "110px 1fr 70px", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < a.length - 1 ? `1px solid ${T.bd}` : "none" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: item.c }}>{item.n}</div>
                  <div style={{ background: T.bd, borderRadius: 8, height: 24, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 8, background: `${item.c}66`, width: `${Math.max(3, item.v / mx * 100)}%` }} /></div>
                  <div style={{ fontSize: mob ? 14 : 16, fontWeight: 800, textAlign: "right", color: T.tx }}>{fN(item.v)}</div>
                </div>
              ); })}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "320px 1fr", gap: mob ? 16 : 20, alignItems: "flex-start" }}>
          <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 18 : 22, border: `1px solid ${T.bd}` }}>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Fld label="Budget ($)"><input type="number" value={f.adBudget} onChange={e => sF(p => ({ ...p, adBudget: e.target.value }))} style={sinp} /></Fld><Fld label="CPL ($)"><input type="number" value={f.cpl} onChange={e => sF(p => ({ ...p, cpl: e.target.value }))} style={sinp} /></Fld></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}><Fld label="Show Up %"><input type="number" value={f.showUp} onChange={e => sF(p => ({ ...p, showUp: e.target.value }))} style={sinp} /></Fld><Fld label="Close %"><input type="number" value={f.closeRate} onChange={e => sF(p => ({ ...p, closeRate: e.target.value }))} style={sinp} /></Fld></div>
              <Fld label="Ticket ($)"><input type="number" value={f.ticket} onChange={e => sF(p => ({ ...p, ticket: e.target.value }))} style={sinp} /></Fld>
            </div>
          </div>
          <div style={autoGrid(145)}><Kpi label="Leads" value={fLd} color={T.mt} /><Kpi label="Asistentes" value={fAt} color={WN} /><Kpi label="Ventas" value={fSl} color={AC} /><Kpi label="Revenue" value={fmt(fRv)} color={OK} /><Kpi label="Profit" value={fmt(fPr)} color={fPr >= 0 ? OK : ER} /><Kpi label="ROAS" value={fRo.toFixed(2) + "x"} color={fRo >= 1 ? OK : ER} /></div>
        </div>
      )}
    </div>
  );
}

/* ─── CONFIG PAGE (has useState) ─── */
function ConfigPage({ D, up, T, mob, theme, toggleTheme, requestDelete }) {
  const sinp = { width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.inp, color: T.tx, fontSize: 13, outline: "none" };
  const [cfg, sCfg] = useState(D.config);
  const [saved, sSaved] = useState(false);
  return (
    <div>
      <h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, margin: "0 0 24px", color: T.tx }}>Configuración</h1>
      <div style={{ display: "grid", gap: 16, maxWidth: 500 }}>
        <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 16 : 20, border: `1px solid ${T.bd}` }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: T.tx }}>General</h3>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.mt, display: "block", marginBottom: 5 }}>NOMBRE</label><input value={cfg.businessName} onChange={e => sCfg(p => ({ ...p, businessName: e.target.value }))} style={sinp} /></div>
          <button onClick={() => { up("config", cfg); sSaved(true); setTimeout(() => sSaved(false), 1500); }} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: AC, color: "#fff", cursor: "pointer", fontWeight: 600 }}>{saved ? "Guardado ✓" : "Guardar"}</button>
        </div>
        <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 16 : 20, border: `1px solid ${T.bd}` }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: T.tx }}>Apariencia</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[{ m: "light", ic: IC.sun, lb: "Claro" }, { m: "dark", ic: IC.moon, lb: "Oscuro" }, { m: "system", ic: IC.monitor, lb: "Sistema" }].map(({ m, ic: icon, lb }) => (
              <button key={m} onClick={() => toggleTheme(m)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: `1px solid ${theme === m ? AC : T.bd}`, background: theme === m ? AC + "15" : T.inp, color: theme === m ? AC : T.mt, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{icon} {lb}</button>
            ))}
          </div>
        </div>
        <div style={{ background: T.crd, borderRadius: 16, padding: mob ? 16 : 20, border: `1px solid ${ER}33` }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 13, fontWeight: 700, color: T.tx }}>Danger Zone</h3>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontWeight: 600, color: T.tx }}>Resetear todo</div><div style={{ fontSize: 12, color: T.mt }}>Elimina todos los datos</div></div>
            <button onClick={() => requestDelete("__RESET__")} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: ER, color: "#fff", cursor: "pointer", fontWeight: 600 }}>Eliminar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN APP — no hooks in render functions
   ═══════════════════════════════════════════ */
export default function App() {
  const [D, setD] = useState(DEF);
  const [pg, setPg] = useState("dashboard");
  const [side, setSide] = useState(true);
  const [modal, setModal] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [ready, setReady] = useState(false);
  const [selId, setSelId] = useState(null);
  const [wsTab, setWsTab] = useState("overview");
  const [selOpen, setSelOpen] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiLoad, setAiLoad] = useState(false);
  const [syncing, setSyncing] = useState(null);
  const [theme, setTheme] = useState("dark");
  const [sysTheme, setSysTheme] = useState("dark");
  const [calcMode, setCalcMode] = useState("reverse");
  const [mob, setMob] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("idle");
  const [toast, setToast] = useState(null);

  const resolved = theme === "system" ? sysTheme : theme;
  const T = resolved === "light" ? LT : DK;

  useEffect(() => { const c = () => setMob(window.innerWidth < 768); c(); window.addEventListener("resize", c); return () => window.removeEventListener("resize", c); }, []);
  useEffect(() => { const mq = window.matchMedia?.("(prefers-color-scheme:dark)"); if (mq) { setSysTheme(mq.matches ? "dark" : "light"); const h = e => setSysTheme(e.matches ? "dark" : "light"); mq.addEventListener?.("change", h); return () => mq.removeEventListener?.("change", h); } }, []);
  useEffect(() => { Promise.all([ldS(), ldT()]).then(([d, t]) => { if (d) { setD(d); if (d.launches?.length) setSelId(d.launches[0].id); } if (t) setTheme(t); setReady(true); }); }, []);
  useEffect(() => { if (ready) { const t = setTimeout(() => svS(D), 300); return () => clearTimeout(t); } }, [D, ready]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => { if (mob) setSide(false); }, [mob]);

  const up = useCallback((k, v) => setD(p => ({ ...p, [k]: typeof v === "function" ? v(p[k]) : v })), []);
  const sel = useMemo(() => D.launches.find(l => l.id === selId) || null, [D.launches, selId]);
  const k = useMemo(() => calcK(sel), [sel]);
  const selectL = useCallback(id => { setSelId(id); setSelOpen(false); setWsTab("overview"); setAiText(""); if (mob) setSide(false); }, [mob]);
  const updateL = useCallback((id, u) => up("launches", p => p.map(l => l.id === id ? { ...l, ...u } : l)), [up]);
  const addLog = useCallback((a, d = "") => up("auditLog", p => [{ id: uid(), ts: new Date().toISOString(), action: a, detail: d }, ...(p || []).slice(0, 99)]), [up]);
  const toggleTheme = useCallback(m => { setTheme(m); svT(m); }, []);
  const openM = useCallback((t, it = null) => { setEditItem(it); setModal(t); }, []);
  const closeM = useCallback(() => { setModal(null); setEditItem(null); }, []);

  const requestDelete = id => { setDeleteTarget(id); setDeleteText(""); setDeleteStatus("idle"); };
  const executeDelete = () => {
    if (!deleteTarget) return;
    const launch = D.launches.find(l => l.id === deleteTarget);
    if (!launch) return;
    setDeleteStatus("deleting");
    setTimeout(() => {
      const rem = D.launches.filter(l => l.id !== deleteTarget);
      setD(prev => ({ ...prev, launches: rem }));
      if (selId === deleteTarget) { setSelId(rem.length > 0 ? rem[0].id : null); setWsTab("overview"); }
      addLog("DELETE", launch.name);
      setDeleteStatus("success");
      setToast({ msg: `"${launch.name}" eliminado`, type: "ok" });
      setTimeout(() => { setDeleteTarget(null); setDeleteText(""); setDeleteStatus("idle"); }, 800);
    }, 500);
  };

  const doSync = useCallback(async plat => {
    if (!sel) return; setSyncing(plat);
    try {
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
      const ts = new Date().toISOString(), src = { ...(sel.sources || defSrc()) }, u = {};
      if (plat === "meta") { const sp = Math.round(2000 + Math.random() * 8000); u.metaInvestment = String(sp); u.metaLeads = String(Math.round(sp / (1 + Math.random() * 3))); src.metaInvestment = "meta"; src.metaLeads = "meta"; u.integrations = { ...(sel.integrations || defInt()), meta: { ...(sel.integrations?.meta || {}), connected: true, lastSync: ts, status: "synced" } }; }
      else if (plat === "tiktok") { const sp = Math.round(1000 + Math.random() * 6000); u.tiktokInvestment = String(sp); u.tiktokLeads = String(Math.round(sp / (2 + Math.random() * 4))); src.tiktokInvestment = "tiktok"; src.tiktokLeads = "tiktok"; u.integrations = { ...(sel.integrations || defInt()), tiktok: { ...(sel.integrations?.tiktok || {}), connected: true, lastSync: ts, status: "synced" } }; }
      else if (plat === "sendflow") { u.contactosAPI = String(Math.round(1000 + Math.random() * 5000)); u.ingresosWhatsApp = String(Math.round(5000 + Math.random() * 30000)); src.contactosAPI = "sendflow"; src.ingresosWhatsApp = "sendflow"; u.integrations = { ...(sel.integrations || defInt()), sendflow: { ...(sel.integrations?.sendflow || {}), connected: true, lastSync: ts, status: "synced" } }; }
      else if (plat === "ghl") { const ld = Math.round(500 + Math.random() * 3000), at = Math.round(ld * .4), sl = Math.round(at * .08); u.registrados = String(ld); u.asistentes = String(at); u.ventasTotal = String(sl); u.revenue = String(Math.round(sl * (500 + Math.random() * 2000))); src.registrados = "ghl"; src.asistentes = "ghl"; src.ventasTotal = "ghl"; src.revenue = "ghl"; u.integrations = { ...(sel.integrations || defInt()), ghl: { ...(sel.integrations?.ghl || {}), connected: true, lastSync: ts, status: "synced" } }; }
      u.sources = src; updateL(sel.id, u); addLog("Sync " + plat); setToast({ msg: `${plat} sync OK`, type: "ok" });
    } catch { setToast({ msg: "Error sync", type: "err" }); }
    setSyncing(null);
  }, [sel, updateL, addLog]);

  const genAI = useCallback(async () => {
    if (!sel) return; setAiLoad(true); setAiText("");
    try { const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: `Analiza "${sel.name}". Revenue:$${k.rev}, ROAS:${k.roas.toFixed(2)}x, Leads:${k.totalLeads}, Ventas:${k.sales}. Resumen ejecutivo español breve.` }] }) }); if (!res.ok) throw new Error(`${res.status}`); const data = await res.json(); setAiText(data.content?.map(b => b.type === "text" ? b.text : "").join("\n") || "—"); } catch (e) { setAiText("Error: " + e.message); }
    setAiLoad(false);
  }, [sel, k]);

  /* ═══ INLINE STYLES ═══ */
  const sinp = { width: "100%", padding: mob ? "9px 12px" : "10px 14px", borderRadius: 10, border: `1px solid ${T.bd}`, background: T.inp, color: T.tx, fontSize: 13, outline: "none" };
  const sibtn = { background: "none", border: "none", cursor: "pointer", color: T.mt, padding: 4 };
  const stt = { contentStyle: { background: T.crd, border: `1px solid ${T.bd}`, borderRadius: 12, fontSize: 12, color: T.tx }, itemStyle: { color: T.tx } };
  const autoGrid = (min = 180) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fill,minmax(${mob ? 140 : min}px,1fr))`, gap: mob ? 8 : 12 });

  const Kpi = ({ label, value, color = AC, source }) => { const sc = source ? SRC_C[source] || T.mt : null; return <div style={{ background: T.crd, borderRadius: 14, padding: mob ? "14px" : "18px 20px", border: `1px solid ${T.bd}`, position: "relative", overflow: "hidden" }}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${color}33,transparent)` }} />{source && <div style={{ position: "absolute", top: 8, right: 10, display: "flex", alignItems: "center", gap: 3 }}><div style={{ width: 5, height: 5, borderRadius: 3, background: sc }} /><span style={{ fontSize: 7, fontWeight: 600, color: sc, textTransform: "uppercase" }}>{SRC_L[source] || source}</span></div>}<div style={{ fontSize: mob ? 9 : 10, fontWeight: 600, color: T.mt, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>{label}</div><div style={{ fontSize: mob ? 22 : 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div></div>; };
  const Badge = ({ color, children }) => <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, background: color + "18", color }}>{children}</span>;
  const Card = ({ title, children, glow, actions }) => <div style={{ background: T.crd, borderRadius: mob ? 12 : 16, padding: mob ? "14px 16px" : "18px 20px", border: `1px solid ${T.bd}`, position: "relative", overflow: "hidden" }}>{glow && <div style={{ position: "absolute", top: -1, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${AC}55,transparent)` }} />}{title && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: mob ? 12 : 16 }}><h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.tx }}>{title}</h3>{actions}</div>}{children}</div>;

  const nav = [{ g: "Operaciones", items: [{ id: "dashboard", lb: "Dashboard", ic: IC.home }, { id: "launches", lb: "Lanzamientos", ic: IC.rocket }, { id: "calculator", lb: "Simulador", ic: IC.calc }] }, { g: "Análisis", items: [{ id: "performance", lb: "Rendimiento", ic: IC.chart }] }, { g: "Sistema", items: [{ id: "config", lb: "Config", ic: IC.gear }] }];

  const saveLaunch = (f) => {
    if (editItem) { up("launches", p => p.map(x => x.id === editItem.id ? { ...x, ...f } : x)); addLog("Editar", f.name); setToast({ msg: "Actualizado", type: "ok" }); }
    else { const nl = { ...f, id: uid() }; up("launches", p => [...p, nl]); setSelId(nl.id); addLog("Crear", f.name); setToast({ msg: "Creado", type: "ok" }); }
    setModal(null); setEditItem(null);
  };

  /* ═══ LOADING ═══ */
  if (!ready) return <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: DK.bg, color: DK.tx, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet" /><div style={{ textAlign: "center" }}><div style={{ width: 48, height: 48, borderRadius: 14, background: `linear-gradient(135deg,${AC},#c026d3)`, margin: "0 auto 16px", animation: "pulse 1.4s ease-in-out infinite" }} /><div style={{ fontWeight: 600, fontSize: 12, color: "#71717A", letterSpacing: "1.5px", textTransform: "uppercase" }}>Launch OS</div><style>{`@keyframes pulse{0%,100%{opacity:.3;transform:scale(.92)}50%{opacity:1;transform:scale(1)}}`}</style></div></div>;

  /* ═══ RENDER ═══ */
  const src = sel?.sources || defSrc();
  const daily = sel?.dailyData || [];

  return (
    <EB>
      <div style={{ fontFamily: "'Inter',system-ui,sans-serif", background: T.bg, color: T.tx, minHeight: "100vh", display: "flex", fontSize: 14, transition: "background .3s,color .3s" }} onClick={() => selOpen && setSelOpen(false)}>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />

        {/* SIDEBAR */}
        <aside style={{ width: side ? 220 : 0, minHeight: "100vh", background: T.bg2, borderRight: side ? `1px solid ${T.bd}` : "none", transition: "width .25s", overflow: "hidden", flexShrink: 0, position: mob ? "fixed" : "sticky", top: 0, height: "100vh", zIndex: mob ? 200 : 1 }}>
          {mob && side && <div onClick={() => setSide(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: -1 }} />}
          <div style={{ padding: "18px 14px", borderBottom: `1px solid ${T.bd}`, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg,${AC},#c026d3)`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13, color: "#fff" }}>G</div>
            <div><div style={{ fontWeight: 700, fontSize: 12, color: T.tx }}>{D.config.businessName}</div><div style={{ fontSize: 9, color: T.mt }}>LAUNCH OS</div></div>
          </div>
          <nav style={{ padding: "8px 6px" }}>
            {nav.map(g => <div key={g.g}><div style={{ fontSize: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1.5px", color: T.mt, padding: "14px 10px 4px" }}>{g.g}</div>{g.items.map(it => <button key={it.id} onClick={() => { setPg(it.id); if (mob) setSide(false); }} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", borderRadius: 10, border: "none", background: pg === it.id ? AC + "15" : "transparent", color: pg === it.id ? AC : T.tx2, cursor: "pointer", fontSize: 12, fontWeight: pg === it.id ? 600 : 400, textAlign: "left" }}><span style={{ opacity: pg === it.id ? .9 : .4, flexShrink: 0 }}>{it.ic}</span>{it.lb}</button>)}</div>)}
          </nav>
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, minWidth: 0 }}>
          <header style={{ padding: mob ? "10px 14px" : "12px 24px", borderBottom: `1px solid ${T.bd}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: T.bg2, position: "sticky", top: 0, zIndex: 150 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: mob ? 8 : 14 }}>
              <button onClick={() => setSide(!side)} style={sibtn}>{IC.menu}</button>
              {/* SELECTOR */}
              <div style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
                <button onClick={() => setSelOpen(!selOpen)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 12, border: `1px solid ${T.bd}`, background: T.bg2, cursor: "pointer", color: T.tx, minWidth: mob ? 160 : 260 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: sel ? ST_C[sel.status] || T.mt : T.mt }} />
                  <div style={{ flex: 1, textAlign: "left", fontSize: mob ? 12 : 13 }}><div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel?.name || "Seleccionar"}</div></div>{IC.chev}
                </button>
                {selOpen && <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 280, background: T.crd, border: `1px solid ${T.bd}`, borderRadius: 14, padding: 6, zIndex: 200, boxShadow: T.shadow, maxHeight: 320, overflowY: "auto" }}>
                  {D.launches.map(l => <button key={l.id} onClick={() => selectL(l.id)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 14px", borderRadius: 10, border: "none", background: l.id === selId ? AC + "15" : "transparent", color: l.id === selId ? AC : T.tx, cursor: "pointer", fontSize: 13, textAlign: "left" }}><div style={{ width: 8, height: 8, borderRadius: 4, background: ST_C[l.status] || T.mt }} /><div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{l.name}</div><div style={{ fontSize: 10, color: T.mt }}>{l.status}</div></div></button>)}
                  <div style={{ borderTop: `1px solid ${T.bd}`, marginTop: 4, paddingTop: 4 }}><button onClick={() => { setSelOpen(false); openM("launch"); }} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "10px 14px", borderRadius: 10, border: "none", background: "transparent", color: AC, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{IC.plus} Nuevo</button></div>
                </div>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: mob ? 6 : 12 }}>
              <div style={{ display: "flex", background: T.inp, borderRadius: 10, border: `1px solid ${T.bd}`, padding: 2 }}>
                {[{ m: "light", ic: IC.sun }, { m: "dark", ic: IC.moon }, { m: "system", ic: IC.monitor }].map(({ m, ic: icon }) => <button key={m} onClick={() => toggleTheme(m)} style={{ padding: "5px 7px", borderRadius: 8, border: "none", background: theme === m ? AC + "15" : "transparent", color: theme === m ? AC : T.mt, cursor: "pointer", display: "flex", alignItems: "center" }}>{icon}</button>)}
              </div>
              {!mob && <span style={{ fontSize: 12, color: T.mt }}>{new Date().toLocaleDateString("es", { day: "numeric", month: "short" })}</span>}
            </div>
          </header>

          <div style={{ padding: mob ? "16px 14px 48px" : "28px 28px 64px", maxWidth: 1140 }}>
            {/* ═══ DASHBOARD ═══ */}
            {pg === "dashboard" && (!sel ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center", padding: mob ? "24px 16px" : "40px" }}>
                <div style={{ fontSize: 11, color: AC, fontWeight: 600, textTransform: "uppercase", letterSpacing: "2px", marginBottom: 12 }}>Launch OS</div>
                <h1 style={{ fontSize: mob ? 26 : 36, fontWeight: 800, margin: "0 0 8px", color: T.tx }}>Centro de Operaciones</h1>
                <p style={{ color: T.mt, margin: "0 0 32px", fontSize: 14, maxWidth: 400 }}>Selecciona o crea un lanzamiento</p>
                {D.launches.length > 0 ? <div style={autoGrid(300)}>{D.launches.map(l => { const lk = calcK(l); return <div key={l.id} onClick={() => selectL(l.id)} style={{ background: T.crd, borderRadius: 16, padding: mob ? 16 : 20, border: `1px solid ${T.bd}`, cursor: "pointer", textAlign: "left" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: 4, background: ST_C[l.status] }} /><span style={{ fontWeight: 700, color: T.tx }}>{l.name}</span></div><Badge color={ST_C[l.status]}>{l.status}</Badge></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}><div><div style={{ fontSize: 10, color: T.mt }}>Revenue</div><div style={{ fontWeight: 700, color: OK }}>{fmt(lk.rev)}</div></div><div><div style={{ fontSize: 10, color: T.mt }}>ROAS</div><div style={{ fontWeight: 700, color: lk.roas >= 1 ? OK : ER }}>{lk.roas.toFixed(2)}x</div></div><div><div style={{ fontSize: 10, color: T.mt }}>Leads</div><div style={{ fontWeight: 700, color: T.tx }}>{fN(lk.totalLeads)}</div></div></div></div>; })}</div> : <button onClick={() => openM("launch")} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: AC, color: "#fff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>{IC.plus} Crear primer lanzamiento</button>}
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: mob ? 10 : 14, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{ width: 10, height: 10, borderRadius: 5, background: ST_C[sel.status] }} />
                  <div><div style={{ fontSize: 10, color: AC, fontWeight: 600, textTransform: "uppercase" }}>Workspace</div><h1 style={{ fontSize: mob ? 20 : 26, fontWeight: 800, margin: 0, color: T.tx }}>{sel.name}</h1></div>
                  <Badge color={ST_C[sel.status]}>{sel.status}</Badge>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
                    <button onClick={() => openM("launch", sel)} style={{ ...sibtn, padding: "6px 10px", border: `1px solid ${T.bd}`, borderRadius: 10 }}>{IC.edit}</button>
                    <button onClick={() => { const dup = { ...JSON.parse(JSON.stringify(sel)), id: uid(), name: sel.name + " (copia)" }; up("launches", p => [...p, dup]); selectL(dup.id); }} style={{ ...sibtn, padding: "6px 10px", border: `1px solid ${T.bd}`, borderRadius: 10 }}>{IC.copy}</button>
                    <button onClick={() => requestDelete(sel.id)} style={{ padding: "6px 10px", borderRadius: 10, border: `1px solid ${ER}33`, background: ER + "12", color: ER, cursor: "pointer" }}>{IC.trash}</button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 2, marginBottom: 20, borderBottom: `1px solid ${T.bd}`, overflowX: "auto" }}>
                  {[["overview", "Overview"], ["embudo", "Embudo"], ["trafico", "Tráfico"], ["integraciones", "Sync"], ["ai", "IA"]].map(([id, lb]) => <button key={id} onClick={() => { setWsTab(id); if (id === "ai" && !aiText) genAI(); }} style={{ padding: mob ? "8px 14px" : "10px 18px", borderRadius: "8px 8px 0 0", border: "none", background: wsTab === id ? AC + "15" : "transparent", color: wsTab === id ? AC : T.mt, cursor: "pointer", fontSize: 12, fontWeight: 600, borderBottom: wsTab === id ? `2px solid ${AC}` : "2px solid transparent", whiteSpace: "nowrap" }}>{lb}</button>)}
                </div>
                {wsTab === "overview" && <div>
                  <div style={autoGrid(180)}>{[["Inversión META", fD(k.mi), AC, src.metaInvestment], ["Contactos API", fN(k.api), OK, src.contactosAPI], ["Ingresos WA", fN(Math.round(k.waRev)), OK], ["% WA", fP(k.waPercent), k.waPercent > 50 ? OK : WN], ["Leads META", fN(k.ml), "#4285F4", src.metaLeads], ["CPL META", fD(k.cplMeta), k.cplMeta > 0 ? (k.cplMeta < 3 ? OK : k.cplMeta < 7 ? WN : ER) : T.mt], ["Leads TikTok", fN(k.tl), "#FF0050", src.tiktokLeads], ["Leads Google", fN(k.gl), OK], ["Leads Total", fN(k.totalLeads), T.tx]].map(([l, v, c, s], i) => <Kpi key={i} label={l} value={v} color={c} source={s} />)}</div>
                  <div style={{ marginTop: 16 }}><Card title="Leads por día y canal" glow actions={<button onClick={() => openM("daily")} style={{ ...sibtn, padding: "5px 10px", border: `1px solid ${T.bd}`, borderRadius: 8, fontSize: 11, fontWeight: 600, color: T.tx }}>{IC.plus} Día</button>}>{daily.length > 0 ? <ResponsiveContainer width="100%" height={mob ? 180 : 240}><LineChart data={daily}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="date" tick={{ fontSize: 9, fill: T.mt }} /><YAxis tick={{ fontSize: 10, fill: T.mt }} width={30} /><Tooltip {...stt} /><Legend wrapperStyle={{ fontSize: 10 }} />{CHANNELS.filter(ch => daily.some(d => sI(d[ch]) > 0)).map(ch => <Line key={ch} type="monotone" dataKey={ch} stroke={CH_C[ch]} strokeWidth={2} dot={{ r: 2 }} connectNulls />)}</LineChart></ResponsiveContainer> : <div style={{ padding: 24, textAlign: "center", color: T.mt }}>Agrega datos con "+ Día"</div>}</Card></div>
                </div>}
                {wsTab === "embudo" && <Card title="Funnel" glow>{[{ s: "Registrados", v: k.reg, c: WN }, { s: "Asistentes", v: k.att, c: OK, p: k.reg ? fP(k.showRate) : "" }, { s: "Pitch", v: k.pitch, c: "#38bdf8" }, { s: "Ventas", v: k.sales, c: AC, p: k.att ? fP(k.closeRate) : "" }].map((f, i, a) => { const mx = Math.max(...a.map(x => x.v), 1); return <div key={i} style={{ display: "grid", gridTemplateColumns: mob ? "100px 1fr 50px" : "120px 1fr 60px 50px", alignItems: "center", gap: mob ? 8 : 12, padding: "10px 0", borderBottom: i < a.length - 1 ? `1px solid ${T.bd}` : "none" }}><div style={{ fontSize: 12, fontWeight: 600, color: f.c }}>{f.s}</div><div style={{ background: T.bd, borderRadius: 8, height: 22, overflow: "hidden" }}><div style={{ height: "100%", borderRadius: 8, background: `${f.c}66`, width: `${Math.max(2, f.v / mx * 100)}%` }} /></div><div style={{ fontSize: 14, fontWeight: 700, textAlign: "right", color: T.tx }}>{fN(f.v)}</div>{!mob && <div style={{ fontSize: 11, color: T.mt, textAlign: "right" }}>{f.p || ""}</div>}</div>; })}</Card>}
                {wsTab === "trafico" && <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 14 }}>{[["Meta Ads", [["Inversión", fmt(k.mi), AC], ["Leads", fN(k.ml), "#4285F4"], ["CPL", fD(k.cplMeta)]]], ["TikTok", [["Inversión", fmt(k.ti), "#FF0050"], ["Leads", fN(k.tl), "#FF0050"], ["CPL", fD(k.cplTiktok)]]], ["Google", [["Inversión", fmt(sN(sel.googleInvestment)), T.tx], ["Leads", fN(k.gl), OK]]], ["Performance", [["Revenue", fmt(k.rev), OK], ["ROAS", k.roas.toFixed(2) + "x", k.roas >= 1 ? OK : ER], ["Profit", fmt(k.profit), k.profit >= 0 ? OK : ER]]]].map(([t, rows]) => <Card key={t} title={t}><div style={{ display: "grid", gap: 6, fontSize: 13 }}>{rows.map(([l, v, c], i) => <div key={i} style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.mt }}>{l}</span><strong style={{ color: c || T.tx }}>{v}</strong></div>)}</div></Card>)}</div>}
                {wsTab === "integraciones" && <div style={{ display: "grid", gap: 12 }}>{[{ id: "meta", name: "Meta Ads", icon: "M", color: SRC_C.meta, cfg: sel.integrations?.meta, flds: [["accountId", "Account ID"]] }, { id: "tiktok", name: "TikTok", icon: "T", color: "#FF0050", cfg: sel.integrations?.tiktok, flds: [["advertiserId", "Advertiser ID"]] }, { id: "sendflow", name: "SendFlow", icon: "S", color: SRC_C.sendflow, cfg: sel.integrations?.sendflow, flds: [["workspaceId", "Workspace"]] }, { id: "ghl", name: "GHL", icon: "G", color: SRC_C.ghl, cfg: sel.integrations?.ghl, flds: [["subaccountId", "Subaccount"]] }].map(p => { const cn = p.cfg?.connected; return <div key={p.id} style={{ background: T.bg2, borderRadius: 14, padding: mob ? 16 : 20, border: `1px solid ${cn ? p.color + "33" : T.bd}` }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 36, height: 36, borderRadius: 10, background: p.color + "18", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, color: p.color }}>{p.icon}</div><div><div style={{ fontWeight: 700, color: T.tx, fontSize: 13 }}>{p.name}</div><div style={{ fontSize: 10, color: T.mt }}>{p.cfg?.status || "—"}</div></div></div><div style={{ width: 8, height: 8, borderRadius: 4, background: cn ? OK : T.mt }} /></div>{p.flds.map(([fk, fl]) => <div key={fk} style={{ marginBottom: 8 }}><label style={{ fontSize: 10, fontWeight: 600, color: T.mt }}>{fl}</label><input value={p.cfg?.[fk] || ""} onChange={e => { const intg = sel.integrations || defInt(); updateL(sel.id, { integrations: { ...intg, [p.id]: { ...(intg[p.id] || {}), [fk]: e.target.value } } }); }} style={{ ...sinp, fontSize: 12, marginTop: 3 }} /></div>)}<button onClick={() => doSync(p.id)} disabled={syncing === p.id} style={{ padding: "6px 14px", borderRadius: 10, border: cn ? `1px solid ${T.bd}` : "none", background: cn ? "transparent" : AC, color: cn ? T.tx : "#fff", cursor: "pointer", fontWeight: 600, fontSize: 12, opacity: syncing === p.id ? .5 : 1 }}>{syncing === p.id ? "Syncing..." : cn ? "Re-sync" : "Conectar"}</button></div>; })}</div>}
                {wsTab === "ai" && <Card title="Resumen IA" glow actions={<button onClick={genAI} style={{ ...sibtn, padding: "5px 10px", border: `1px solid ${T.bd}`, borderRadius: 8, fontSize: 11, fontWeight: 600, color: T.tx }}>{IC.brain} Regenerar</button>}>{aiLoad ? <div style={{ padding: 40, textAlign: "center" }}><div style={{ width: 20, height: 20, border: `2px solid ${AC}33`, borderTop: `2px solid ${AC}`, borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto 12px" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div> : aiText ? <div style={{ fontSize: 13, lineHeight: 1.8, color: T.tx2, whiteSpace: "pre-wrap" }}>{aiText}</div> : <div style={{ padding: 24, textAlign: "center", color: T.mt }}>Genera análisis</div>}</Card>}
              </div>
            ))}

            {/* ═══ LAUNCHES ═══ */}
            {pg === "launches" && <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}><h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, margin: 0, color: T.tx }}>Lanzamientos</h1><button onClick={() => openM("launch")} style={{ padding: "8px 16px", borderRadius: 10, border: "none", background: AC, color: "#fff", cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>{IC.plus} Nuevo</button></div>
              {D.launches.length === 0 ? <div style={{ textAlign: "center", padding: 60, color: T.mt }}>Crea tu primer lanzamiento</div> : <div style={{ display: "grid", gap: 10 }}>{[...D.launches].reverse().map(l => { const lk = calcK(l); return <div key={l.id} onClick={() => { selectL(l.id); setPg("dashboard"); }} style={{ background: T.crd, borderRadius: 14, padding: mob ? "14px 16px" : "16px 22px", border: `1px solid ${selId === l.id ? AC + "44" : T.bd}`, cursor: "pointer", display: "grid", gridTemplateColumns: mob ? "1fr auto" : "2fr 1fr 1fr 1fr auto", alignItems: "center", gap: mob ? 10 : 16 }}><div><div style={{ fontWeight: 700, color: T.tx }}>{l.name}</div><div style={{ fontSize: 11, color: T.mt }}>{l.date} · {l.status}</div>{mob && <div style={{ display: "flex", gap: 12, marginTop: 6 }}><span style={{ color: OK, fontWeight: 600, fontSize: 12 }}>{fmt(lk.rev)}</span><span style={{ color: lk.roas >= 1 ? OK : ER, fontWeight: 600, fontSize: 12 }}>{lk.roas.toFixed(2)}x</span></div>}</div>{!mob && <><div><div style={{ fontSize: 10, color: T.mt }}>Revenue</div><div style={{ fontWeight: 700, color: OK }}>{fmt(lk.rev)}</div></div><div><div style={{ fontSize: 10, color: T.mt }}>ROAS</div><div style={{ fontWeight: 700, color: lk.roas >= 1 ? OK : ER }}>{lk.roas.toFixed(2)}x</div></div><div><div style={{ fontSize: 10, color: T.mt }}>Leads</div><div style={{ fontWeight: 700, color: T.tx }}>{fN(lk.totalLeads)}</div></div></>}<div style={{ display: "flex", gap: 4 }} onClick={e => e.stopPropagation()}><button onClick={() => openM("launch", l)} style={sibtn}>{IC.edit}</button><button onClick={() => requestDelete(l.id)} style={{ ...sibtn, color: ER }}>{IC.trash}</button></div></div>; })}</div>}
            </div>}

            {/* ═══ CALCULATOR — proper component ═══ */}
            {pg === "calculator" && <CalcPage T={T} mob={mob} calcMode={calcMode} setCalcMode={setCalcMode} />}

            {/* ═══ PERFORMANCE ═══ */}
            {pg === "performance" && (D.launches.length < 2 ? <div><h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, color: T.tx }}>Rendimiento</h1><div style={{ textAlign: "center", padding: 60, color: T.mt }}>Mínimo 2 lanzamientos</div></div> : <div><h1 style={{ fontSize: mob ? 22 : 28, fontWeight: 800, margin: "0 0 24px", color: T.tx }}>Rendimiento</h1><div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 14 }}>{(() => { const data = D.launches.map(l => { const lk = calcK(l); return { name: l.name, cpl: lk.cplMeta, roas: lk.roas }; }); return <><Card title="CPL"><ResponsiveContainer width="100%" height={180}><BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="name" tick={{ fontSize: 9, fill: T.mt }} /><YAxis tick={{ fontSize: 10, fill: T.mt }} width={35} /><Tooltip {...stt} formatter={v => "$" + sN(v).toFixed(2)} /><Bar dataKey="cpl" fill={WN} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></Card><Card title="ROAS"><ResponsiveContainer width="100%" height={180}><BarChart data={data}><CartesianGrid strokeDasharray="3 3" stroke={T.bd} /><XAxis dataKey="name" tick={{ fontSize: 9, fill: T.mt }} /><YAxis tick={{ fontSize: 10, fill: T.mt }} width={25} /><Tooltip {...stt} formatter={v => sN(v).toFixed(2) + "x"} /><Bar dataKey="roas" radius={[6, 6, 0, 0]}>{data.map((e, i) => <Cell key={i} fill={e.roas >= 1 ? OK : ER} />)}</Bar></BarChart></ResponsiveContainer></Card></>; })()}</div></div>)}

            {/* ═══ CONFIG — proper component ═══ */}
            {pg === "config" && <ConfigPage D={D} up={up} T={T} mob={mob} theme={theme} toggleTheme={toggleTheme} requestDelete={requestDelete} />}
          </div>
        </main>

        {/* MODALS — proper components with hooks */}
        {modal === "launch" && <LaunchModal editItem={editItem} closeM={closeM} onSave={saveLaunch} T={T} mob={mob} />}
        {modal === "daily" && <DailyModal sel={sel} updateL={updateL} closeM={closeM} T={T} mob={mob} />}

        {/* DELETE MODAL — no hooks, uses parent state */}
        {deleteTarget && deleteTarget !== "__RESET__" && (() => { const launch = D.launches.find(l => l.id === deleteTarget); if (!launch) return null; const canDel = deleteText === "DELETE"; return <div onClick={() => { setDeleteTarget(null); setDeleteText(""); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: mob ? 10 : 20 }}><div onClick={e => e.stopPropagation()} style={{ background: T.crd, borderRadius: 20, padding: mob ? 24 : "32px 36px", width: "100%", maxWidth: 480, border: `1px solid ${ER}33` }}>{deleteStatus === "success" ? <div style={{ textAlign: "center", padding: 20 }}><div style={{ fontSize: 40, color: OK, marginBottom: 12 }}>✓</div><div style={{ fontSize: 16, fontWeight: 700, color: T.tx }}>Eliminado</div></div> : <><div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}><div style={{ width: 44, height: 44, borderRadius: 14, background: ER + "15", display: "flex", alignItems: "center", justifyContent: "center", color: ER }}>{IC.alert}</div><div><div style={{ fontSize: 18, fontWeight: 800, color: ER }}>Eliminar lanzamiento</div><div style={{ fontSize: 13, color: T.mt }}>Permanente e irreversible</div></div></div><div style={{ background: ER + "08", borderRadius: 12, padding: 16, marginBottom: 20, border: `1px solid ${ER}22` }}><div style={{ fontSize: 14, fontWeight: 700, color: T.tx, marginBottom: 6 }}>"{launch.name}"</div><div style={{ fontSize: 12, color: T.mt }}>Se eliminarán todas las métricas, datos e integraciones.</div></div><div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.mt, marginBottom: 8 }}>Escribe <span style={{ color: ER, fontWeight: 800, fontFamily: "monospace", background: ER + "12", padding: "2px 6px", borderRadius: 4 }}>DELETE</span> para confirmar</label><input value={deleteText} onChange={e => setDeleteText(e.target.value)} autoFocus style={{ ...sinp, fontFamily: "monospace", textAlign: "center", letterSpacing: "2px", fontSize: 15 }} /></div><div style={{ display: "flex", gap: 10 }}><button onClick={() => { setDeleteTarget(null); setDeleteText(""); }} style={{ flex: 1, padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.bd}`, background: "transparent", color: T.tx, cursor: "pointer", fontWeight: 600 }}>Cancelar</button><button disabled={!canDel || deleteStatus === "deleting"} onClick={executeDelete} style={{ flex: 1, padding: "8px 16px", borderRadius: 10, border: "none", background: ER, color: "#fff", cursor: canDel ? "pointer" : "not-allowed", fontWeight: 600, opacity: canDel ? 1 : .4 }}>{deleteStatus === "deleting" ? "Eliminando..." : "Eliminar"}</button></div></>}</div></div>; })()}

        {/* RESET MODAL */}
        {deleteTarget === "__RESET__" && <div onClick={() => setDeleteTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 20 }}><div onClick={e => e.stopPropagation()} style={{ background: T.crd, borderRadius: 20, padding: "28px 32px", maxWidth: 480, width: "100%", border: `1px solid ${ER}33` }}><div style={{ fontSize: 18, fontWeight: 800, color: ER, marginBottom: 12 }}>Resetear todo</div><div style={{ fontSize: 13, color: T.mt, marginBottom: 20 }}>Todos los datos serán eliminados.</div><div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 12, color: T.mt, marginBottom: 6 }}>Escribe <span style={{ color: ER, fontWeight: 800, fontFamily: "monospace" }}>DELETE</span></label><input value={deleteText} onChange={e => setDeleteText(e.target.value)} autoFocus style={{ ...sinp, fontFamily: "monospace", textAlign: "center", letterSpacing: "2px" }} /></div><div style={{ display: "flex", gap: 10 }}><button onClick={() => setDeleteTarget(null)} style={{ flex: 1, padding: "8px 16px", borderRadius: 10, border: `1px solid ${T.bd}`, background: "transparent", color: T.tx, cursor: "pointer", fontWeight: 600 }}>Cancelar</button><button disabled={deleteText !== "DELETE"} onClick={() => { setD(DEF); setSelId(null); storageDel(SK).catch(() => {}); setDeleteTarget(null); setDeleteText(""); setToast({ msg: "Datos eliminados", type: "ok" }); }} style={{ flex: 1, padding: "8px 16px", borderRadius: 10, border: "none", background: ER, color: "#fff", cursor: deleteText === "DELETE" ? "pointer" : "not-allowed", fontWeight: 600, opacity: deleteText === "DELETE" ? 1 : .4 }}>Eliminar todo</button></div></div></div>}

        {/* TOAST */}
        {toast && <div style={{ position: "fixed", bottom: mob ? 16 : 24, right: mob ? 16 : 24, zIndex: 3000, padding: "12px 20px", borderRadius: 12, background: toast.type === "ok" ? OK : ER, color: "#fff", fontWeight: 600, fontSize: 13, boxShadow: "0 8px 24px rgba(0,0,0,.3)", animation: "slideIn .3s ease" }}>{toast.type === "ok" ? "✓" : "!"} {toast.msg}<style>{`@keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style></div>}
      </div>
    </EB>
  );
}
