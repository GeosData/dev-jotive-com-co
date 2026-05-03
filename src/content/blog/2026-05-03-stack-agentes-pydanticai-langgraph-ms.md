---
title: "Como elegi mi stack de agentes Python en 2026 (y por que no fue LangChain)"
description: "Tres frameworks Python para agentes LLM en produccion compitieron: PydanticAI v1, LangGraph v1 y Microsoft Agent Framework 1.0 GA. Aqui mi decision con razones duras."
date: 2026-05-03
tags: ["agentes-llm", "pydanticai", "langgraph", "microsoft-agent-framework", "adr", "python"]
readTime: "7 min"
videoLength: "10 min"
youtube_id: ""
video_status: draft
script_version: 1
image: ./image.webp
imageAlt: "Diagrama tecnico comparando tres frameworks de agentes LLM Python: PydanticAI, LangGraph y Microsoft Agent Framework, con boxes-and-arrows en estilo editorial"
---

[B-ROLL: terminal con tres ventanas abiertas — codigo PydanticAI, codigo LangGraph, codigo MS Agent Framework, codigo cycling lento]

Necesitaba elegir un framework de agentes LLM para los proximos productos que voy a construir. Tenia tres candidatos en la mesa, y decidir entre ellos no era trivial.

[CAMERA: primer plano, expresion neutral, gesto explicativo]

Esta es la decision que tome y por que. Es un ADR honesto, no una recomendacion universal.

## El contexto

Construyo backends Python con FastAPI + Postgres. Los productos van a tener features LLM (extraccion estructurada, scoring, RAG, automatizacion multi-paso). El usuario final es no-tecnico, asi que estabilidad y costo predecible importan mas que features fancy.

Los candidatos eran tres:

- **PydanticAI v1** (sept 2025, hoy v1.89)
- **LangGraph v1** (oct 2025)
- **Microsoft Agent Framework 1.0 GA** (abril 2026, recien lanzado)

LangChain core lo descarte de entrada. Despues vuelvo a esa decision.

## Lo que mire

Para cada framework evalue cinco cosas:

1. **Alineacion con mi stack** (FastAPI + Pydantic ya invertido)
2. **Costo en tokens** por tarea equivalente
3. **Latencia P95** en agente simple
4. **Estabilidad de API** ultimos 6 meses
5. **DX** — onboarding, testing, debug

[B-ROLL: tabla comparativa side-by-side mostrando 3 columnas con metricas — perf, cost, LOC]

## PydanticAI — el match natural

Misma gente que mantiene Pydantic. La integracion con FastAPI es trivial — `RunContext[Deps]` se siente como Depends() de FastAPI, ya conocido.

Numeros que vi en blogs comparativos (caveat: no son benchmarks oficiales, son blogs secundarios):

- ~44% menos latencia P95 que LangChain
- ~2.7x menos tokens por tarea equivalente
- ~160 LOC para una app que en LangGraph cuesta ~280 LOC

Para producto donde el usuario paga COP 30-50K/mes, cada milagro de margen cuenta. Stack alineado + COGS predecible es el path.

## LangGraph — el caso valido pero no default

LangGraph es lo correcto cuando necesitas multi-agente real con handoffs, human-in-the-loop persistente, o state machine con checkpoints que sobreviva crashes.

Klarna, Replit, Elastic lo usan en produccion. No es framework de juguete.

Mi excepcion: ya tengo un repo (`ai-agents-workflow`, ClaimFlow) usando LangGraph para multi-step approval pipelines. Ese caso lo justifica. Lo dejo ahi.

[CAMERA: gesto que separa con manos — "este caso aqui, los demas alla"]

Pero LangGraph como **default** para todo? Overkill. 280 LOC vs 160 LOC para un agente simple sin payoff. Curva de aprendizaje empinada para algo que un agente single-purpose con tools no necesita.

## Microsoft Agent Framework — esperar 6 meses

Lanzo 1.0 GA hace dos semanas. A2A Protocol nativo, MCP integrado, soporta .NET y Python, viene con el peso de Microsoft detras.

[OVERLAY: badge "abril 2026 — GA" sobre logo MS]

Suena bien. Pero adoptar framework de produccion con menos de 6 meses publicos es asumir riesgo que mi caso no necesita. Re-evaluo Q1 2027.

## Por que NO LangChain core

Esta es la parte controvertida.

LangChain v1 lanzo oct 2025. La industria 2026 esta saliendo del LangChain core para nuevos proyectos:

- Octomind publicó "Why we no longer use LangChain"
- Equipos en HN reportan migraciones a SDKs nativos
- Overhead documentado: ~10-30ms por tool call + ~2.4K tokens "fantasma" por llamada

Esos 2.4K tokens fantasma matan el margen cuando facturas a Don Carlos en pesos colombianos.

LangGraph (mismo equipo) vale para casos especificos. LangChain core para nuevo proyecto en 2026 = deuda tecnica desde commit #1.

[B-ROLL: grafico simple mostrando "tokens overhead por framework" — LangChain barra alta, PydanticAI barra baja]

## La decision

**PydanticAI v1 como default para productos SaaS/backend nuevos desde mayo 2026.**

Excepciones documentadas:
- ClaimFlow mantiene LangGraph (multi-step HITL = caso valido)
- Productos existentes no migran forzados
- Vendor SDKs (OpenAI Agents, Claude Agent) solo si producto se compromete a un modelo

Anti-recomendacion explicita: NO LangChain core nuevo.

## Lo que va a pasar si la decision es mala

Tengo trigger explicito de revision:

- Si Microsoft Agent Framework demuestra production track record 6+ meses con casos LATAM reales (Q1 2027) → re-evaluo
- Si PydanticAI v2 lanza con breaking changes mayores → costo migracion
- Si producto necesita multi-agente real → agrego LangGraph aislado para ese producto, no migro todo

Cada 6 meses chequeo ecosystem + breaking changes + performance.

[CAMERA: cierre tranquilo, manos sobre teclado]

## Lo que hago manana

Empezar el primer producto con PydanticAI desde commit #1. Aprender en publico. Si en 3 meses descubro que me equivoque, el ADR lo dice y se ajusta. Asi funciona la disciplina senior — decision documentada, no decision oculta.

---

Si vas a evaluar tu propio stack de agentes, tres preguntas que valen la pena: ¿que stack ya tienes invertido? ¿el caso de uso necesita state machine real o es agente single-purpose? ¿cuanto te cuesta cada token sobre tu pricing al usuario final?
