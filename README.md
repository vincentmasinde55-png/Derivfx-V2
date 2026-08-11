# Trading Bot Template

> A white-label starter for building and deploying your own visual trading bot platform on top of the Deriv trading API. Fork it, brand it, deploy it.

![Prerequisite](https://img.shields.io/badge/node-22.x%20%7C%2024.x-blue.svg)
![Prerequisite](https://img.shields.io/badge/npm-9%2B-blue.svg)
![Build](https://img.shields.io/badge/build-RSBuild-green.svg)
![Framework](https://img.shields.io/badge/framework-React%2018-blue.svg)

This repository is a **template**, not a finished product. It is intended to be forked, customized with your own brand, and deployed to your own domain. The trading engine, OAuth flow, and WebSocket integration all point at Deriv's infrastructure out of the box — everything else (branding, theming, menu, logo, fonts, analytics, error reporting) is yours to configure.

---

## What You Get

- **Visual Bot Builder** — Drag-and-drop strategy builder powered by Blockly, with a library of pre-built trading blocks.
- **Integrated Charts** — SmartCharts with standard technical indicators.
- **Dashboard** — Bot performance, recent activity, and quick actions.
- **OAuth 2.0 with PKCE** — Production authentication against Deriv's OAuth server.
- **Authenticated WebSocket connection** — Real-time market data, balance, trade execution, and account switching.
- **White-label configuration** — Brand configuration controls colors, typography, logo, domain, menus, and theme.

## Deployment

The application builds to `dist/` and is suitable for Vercel or another static host. The production domain is `derivfx.site`.

The production OAuth and WebSocket endpoints must remain pointed at Deriv. The deployed hostname must match the registered OAuth redirect URL.

## Production restore

This file was updated only to trigger a fresh Vercel deployment from the known-good application commit. No application source files were changed.

## License

See [LICENSE](./LICENSE).
