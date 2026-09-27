# BLACKGRID

**AI Automation & Digital Technology Startup**

> AI systems built to make businesses run smarter.

## What We Do

- **AI Automation** — Intelligent automation systems that reduce repetitive business work
- **AI Agents** — Agents for support, lead qualification, and customer experiences
- **SaaS Development** — Scalable, production-ready SaaS platforms
- **Business Automation** — Connect tools, data and workflows for less manual work
- **Landing Pages** — High-impact pages designed to communicate value and drive action
- **UI/UX Design** — Digital products that feel intuitive, premium and effortless
- **Website Revamps** — Transform outdated sites into modern, high-performance websites
- **AI Product Prototyping** — Rapidly turn AI ideas into testable functional prototypes

## Live Site

<https://blackgrid-orpin.vercel.app/>

## Project Layout

```
index.html              Document shell: metadata, critical CSS, adaptive perf CSS
assets/app.js           The whole React application (plain React.createElement — no JSX)
assets/blackgrid.css    Tailwind utilities, pre-compiled (generated — do not edit by hand)
vendor/                 Pinned, self-hosted production builds of React / ReactDOM / Framer Motion
build/                  Tailwind build tooling (dev-only, not deployed)
vercel.json             Static caching policy
```

## Running Locally

It is a static site — no server-side build step is required to view it.

```bash
python3 -m http.server 3000     # then open http://localhost:3000
```

Opening `index.html` straight off the filesystem also works.

## Rebuilding the Stylesheet

`assets/blackgrid.css` is generated. Regenerate it **whenever you add or change a
Tailwind class** in `index.html` or `assets/app.js`, otherwise the new class will
have no CSS behind it:

```bash
cd build
npm install
npm run css
```

The config in `build/tailwind.config.js` mirrors the theme extensions the site
previously declared inline for the Tailwind Play CDN, so the output is visually
identical to the old runtime-compiled CSS.

## Performance Architecture

The site deliberately runs **no transpiler, no CSS compiler and no third-party
script at runtime**. The application source is plain `React.createElement`, so
there is no JSX and nothing to compile in the browser.

Rendering cost adapts to the device through a single profile object (`PERF` in
`assets/app.js`), measured once at boot from pointer type, viewport, network
conditions, device memory, core count and `prefers-reduced-motion`. Desktop keeps
the original experience verbatim; mobile keeps the same design language and
choreography with cheaper GPU and decoder work:

| | Desktop | Mobile |
|---|---|---|
| Animated blur radius | full | 40% (0 on low-end / reduced-motion) |
| Video scrub rate | 60 Hz | 15 Hz |
| Header backdrop blur | 24px | 10px |
| Entrance reveals | replay on re-entry | play once |
| Hover-only glow layers | mounted | not mounted |

Both background videos are scrubbed by a shared `useScrubbedVideo` hook that
caches layout geometry, parks its `requestAnimationFrame` loop as soon as the
value settles, and suspends entirely when the section is offscreen or the tab is
hidden.

## Tech Stack

- React 18 (self-hosted UMD production build)
- Framer Motion 11 (self-hosted UMD production build)
- Tailwind CSS 3, compiled ahead of time
- No build step required to deploy

## Contact

- **WhatsApp:** [+91 7420823984](https://wa.me/917420823984)
- **GitHub:** [vedant2011-byte](https://github.com/vedant2011-byte)
- **Instagram:** [@vedant_chavan____](https://www.instagram.com/vedant_chavan____)
