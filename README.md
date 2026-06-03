# Launch OS

Sistema operativo de lanzamientos para campañas de marketing digital. Diseñado para gestionar, analizar y proyectar resultados de campañas multicanal.

## Features

- **Workspaces aislados** — cada lanzamiento es un workspace independiente con métricas, integraciones y datos separados
- **Multi-channel** — Meta Ads, TikTok Ads, Google Ads, WhatsApp, SendFlow, GoHighLevel
- **Launch Revenue Simulator** — dos modos: Reverse Planning (meta → leads necesarios) y Forward Planning (budget → resultados)
- **KPIs en tiempo real** — CPL, ROAS, CAC, Show Rate, Close Rate, Profit, con safe math (sin NaN/Infinity)
- **Leads por día y canal** — gráfica multicanal con entrada manual de datos diarios
- **Integraciones simuladas** — Meta, TikTok, SendFlow, GHL con sync simulado
- **IA integrada** — resumen ejecutivo via Anthropic API
- **Tema light/dark/system** — colores sólidos, sin transparencias, persistente
- **Delete seguro** — modal con type-to-confirm (escribe DELETE para confirmar)
- **Responsive** — sidebar adaptativa, grids que colapsan, mobile-first
- **Persistencia** — datos guardados en localStorage (standalone) o window.storage (Claude artifacts)

## Tech Stack

- React 18
- Recharts (gráficas)
- Vite (build)
- Inter font (Google Fonts)

## Setup

```bash
npm install
npm run dev
```

## Estructura

```
launch-os/
├── index.html          # Entry point HTML
├── package.json        # Dependencies
├── vite.config.js      # Vite config
└── src/
    ├── main.jsx        # React mount
    └── App.jsx         # Aplicación completa
```

## Arquitectura

- **Safe Math**: `sN()`, `sI()`, `sD()`, `sP()` previenen NaN, Infinity, y división por cero
- **Error Boundary**: componente class que atrapa errores de rendering
- **Storage Adapter**: funciona con `window.storage` (Claude) y `localStorage` (standalone)
- **Module-level components**: `DailyModal`, `LaunchModal`, `CalcPage`, `ConfigPage` definidos fuera de App para cumplir las reglas de hooks de React
- **No `confirm()`**: todos los diálogos de confirmación usan modales custom (bloqueado en sandboxes)

## Branding

- Accent: `#FF006E` (magenta)
- Success: `#00D084`
- Warning: `#FFB800`
- Error: `#FF5A5F`
- Dark BG: `#050505`
- Light BG: `#F5F5F7`

## License

Private — Growins
