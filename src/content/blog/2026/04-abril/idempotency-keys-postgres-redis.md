---
title: "Idempotency keys: la implementación con Postgres unique constraint y Redis lock que sí soporta producción"
description: "Por qué un endpoint de creación de orden no puede confiar solo en el cliente, qué falla cuando se implementa idempotency con un solo mecanismo, y cómo combinar lock distribuido (Redis) con unique constraint (Postgres) para cubrir tanto carrera concurrente como retry tardío."
date: 2026-04-28
tags: ["backend", "fastapi", "postgresql", "redis", "idempotency", "api-design", "adr"]
---

Un cliente reintenta una llamada a `POST /orders` porque el primer request tardó 31 segundos y su HTTP client tenía timeout en 30. Tu backend ya creó la orden, pero el cliente no se enteró. Si tu API no es idempotente, acabas de cobrarle dos veces.

Esta es la historia que está detrás del header `Idempotency-Key`. La parte interesante no es la teoría — es lo que falla cuando se implementa "rápido" con un solo mecanismo, y por qué la solución que sostiene producción combina dos capas que parecen redundantes y no lo son.

Lo siguiente vive en código en [`order-processing-platform`](https://github.com/jotive/order-processing-platform), formalizado como `ADR-004`.

## El problema concreto

Una API que recibe pedidos tiene tres formas de duplicar trabajo:

1. **Retry del cliente** (timeout, error de red transitorio, usuario impaciente).
2. **Carrera concurrente** (dos requests entran al mismo tiempo con la misma key — no es retry, es bug en el cliente o en un orquestador con paralelismo agresivo).
3. **Replay tardío** (el cliente reintentó, recibió 200, y mucho después un proxy o cola desempacha el request original guardado).

Una solución que cubra solo (1) y (2) deja (3) sin defensa, y al revés.

## Intento 1 — solo Postgres unique constraint

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  ...
);
```

Funciona para (1) y (3): si dos `INSERT` llegan con la misma key, el segundo revienta con `UniqueViolation` y el handler retorna la orden existente.

El problema es (2). Bajo concurrencia real:

- Request A llega, ejecuta lógica de validación (cobro a Stripe, reserva de inventario), antes del `INSERT`.
- Request B llega, ejecuta la misma lógica de validación en paralelo.
- A inserta primero. B revienta en el `INSERT`.

El `INSERT` falla, sí — pero **ya cobraste dos veces a Stripe**. El unique constraint protege la base de datos, no los efectos colaterales.

## Intento 2 — solo Redis lock

```python
async def create_order(key: str):
    if not await redis.set(f"idem:{key}", "1", nx=True, ex=86400):
        return await get_existing_response(key)
    # ...lógica + DB insert...
```

El `SET NX` (set if not exists) atómico bloquea la concurrencia. (2) cubierto.

Pero Redis no es persistencia. Si la key expira a las 24h y el cliente reintenta a las 25h por una razón legítima — un job de retry asíncrono que estuvo encolado — el segundo request **no encuentra el lock, ejecuta todo de nuevo, y duplica**. (3) sin protección.

Tampoco te ayuda si Redis se cae entre el `SET NX` y el `INSERT`: el lock evapora, requests posteriores pasan, el `INSERT` no protege porque no hay constraint.

## La combinación que sí funciona

Las dos capas cubren cosas distintas:

| Mecanismo | Cubre | No cubre |
|---|---|---|
| Redis `SET NX` | Concurrencia simultánea (carrera) | Replay tardío post-expiración |
| Postgres unique constraint | Replay tardío + protección persistente | Carrera con efectos colaterales antes del INSERT |

**Combinadas:** Redis bloquea durante la ventana donde el efecto colateral está en vuelo. Postgres bloquea para siempre cuando la fila ya existe.

```python
async def create_order(idempotency_key: str, payload: OrderIn):
    lock_key = f"idem:{idempotency_key}"

    # Capa 1 — Redis: previene la carrera mientras procesamos
    acquired = await redis.set(lock_key, "processing", nx=True, ex=600)
    if not acquired:
        existing = await fetch_response_by_key(idempotency_key)
        if existing:
            return existing
        # Otro request está en vuelo — el cliente debe reintentar
        raise HTTPException(409, "Request in progress, retry shortly")

    try:
        # ...validación + cobro Stripe + reserva inventario...
        async with db.begin():
            try:
                order = await insert_order(idempotency_key, payload)
            except UniqueViolation:
                # Capa 2 — Postgres: alguien ya completó esto antes
                # (replay tardío, key expiró en Redis, etc.)
                return await fetch_response_by_key(idempotency_key)

            await store_response_for_idempotency(idempotency_key, order)
            return order
    finally:
        await redis.delete(lock_key)
```

Tres detalles que me costaron entender:

**TTL del lock Redis ≠ tiempo de retención de la respuesta.** El lock dura el tiempo máximo que toma procesar un request (10 minutos en mi caso, generoso). La respuesta se guarda 24-48h para que retries tardíos legítimos obtengan el mismo body de respuesta sin re-ejecutar.

**El handler debe ser tolerante a `UniqueViolation` después de adquirir el lock Redis.** Esto suena imposible — si tienes el lock, ¿cómo puede haber una fila ya? Caso real: nodo A adquirió el lock, falló a mitad de procesamiento, lock expiró, nodo B lo retomó y completó, request original ahora retorna y trata de insertar. La capa Postgres lo cacha.

**El error que retornas al cliente cuando el lock está tomado importa.** `409 Conflict` con `Retry-After` evita que el cliente entre en busy loop. `429 Too Many Requests` es semánticamente incorrecto — no es rate limiting, es coordinación.

## Por qué dos capas no es over-engineering

La pregunta razonable: "¿no es duplicación de mecanismos?"

No, porque cubren ventanas de tiempo distintas:

- Redis cubre **el momento del procesamiento** (segundos a minutos).
- Postgres cubre **la vida del recurso** (siempre).

Quitarle uno deja agujeros que aparecen en producción a las 2am, no en el local.

## Trade-off rechazado: lock distribuido tipo etcd / Zookeeper

Considerado y rechazado en `ADR-004` por overhead operacional desproporcionado al problema. Si la infraestructura ya tiene Redis (cache, sessions, rate limit), reusarlo para idem-lock cuesta cero. Adoptar una pieza nueva solo para esto requiere justificación que no tengo.

Es la disciplina del ADR completo: **no es la mejor solución teórica, es la mejor para este sistema, este equipo, y este nivel de carga**.

## Cierre

Si tu API recibe dinero, contratos, o cualquier cosa con efectos colaterales irreversibles, el header `Idempotency-Key` no es opcional. Y la implementación que parece simple — un solo mecanismo — esconde escenarios que descubres en producción. Las dos capas se ven redundantes hasta el día que solo tienes una y descubres por qué no.

El código completo, las migraciones de Alembic, y el ADR-004 con las alternativas rechazadas viven en [`order-processing-platform`](https://github.com/jotive/order-processing-platform).
