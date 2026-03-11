# dev.jotive.com.co

Espacio técnico personal de Jotive. Backend, arquitectura de software, experimentos de código y notas de desarrollo.

## Stack

- [Astro 6](https://astro.build/) — generador de sitios estáticos
- [Tailwind CSS v4](https://tailwindcss.com/) — estilos
- [@tailwindcss/typography](https://tailwindcss.com/docs/typography-plugin) — prose para posts
- Tema claro/oscuro con `@custom-variant light`

## Estructura

```
src/
├── content/
│   └── blog/              # Entradas del blog (Markdown)
├── pages/
│   ├── index.astro        # Homepage
│   └── blog/
│       ├── index.astro    # Listado de posts
│       └── [slug].astro   # Vista individual de post
├── styles/
│   └── global.css         # Estilos globales + Tailwind
└── content.config.ts      # Esquema de colecciones
```

## Blog

Las entradas van en `src/content/blog/`:

```markdown
---
title: "Título del post"
description: "Descripción breve."
date: 2026-03-11
tags: ["backend", "arquitectura"]
---

Contenido en Markdown...
```

## Desarrollo local

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # genera dist/
npm run preview  # previsualiza el build
```

## Deploy

GitHub Actions despliega automáticamente a Hostinger vía `rsync` sobre SSH al hacer push a `main`.

**Secrets requeridos:**

| Secret | Descripción |
|--------|-------------|
| `HOSTINGER_HOST` | IP del servidor |
| `HOSTINGER_USER` | Usuario SSH |
| `HOSTINGER_PORT` | Puerto SSH (65002) |
| `HOSTINGER_SSH_KEY` | Clave privada ed25519 |
| `HOSTINGER_PATH` | Ruta destino en el servidor |
