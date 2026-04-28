---
title: "Quota-aware pipelines: cómo no quemar 10.000 unidades de YouTube API ni perder análisis Claude a mitad de scan"
description: "Detectar 403 quotaExceeded temprano, abortar limpio en lugar de seguir pegando contra una pared, y diseñar el background task para que el frontend muestre estado real (no spinner infinito). Patrones extraídos de una herramienta interna que escanea videos y los analiza con Claude vision."
date: 2026-04-28
tags: ["backend", "fastapi", "youtube-api", "anthropic-claude", "background-tasks", "rate-limiting"]
---

Una herramienta interna que tengo escanea YouTube por keywords y canales, detecta videos "outliers" (views muy por encima de la mediana del canal), y luego pasa los candidatos por un análisis de Claude Sonnet con visión sobre el thumbnail. La idea es producir briefs accionables sin que yo mire 200 videos a mano.

El detalle que no se ve en los tutoriales: tanto YouTube Data API v3 como cualquier proveedor LLM tienen límites duros, y un pipeline que no los respete falla feo a la mitad. Este es el patrón que terminé adoptando, sacado de [`factory-video`](https://github.com/jotive/factory-video) (privado, pero los conceptos son portables).

## El reto concreto

YouTube Data API v3 te da 10.000 unidades de quota por día, gratis. No es mucho:

- `search.list` cuesta 100 unidades.
- `videos.list` cuesta 1 unidad por video.
- `playlistItems.list` cuesta 1 unidad.

Una sola operación `scan_keyword("python tutorials")` que retorne 50 videos consume:
- 100 (search) + 50 (videos.list batch) = **150 unidades**.

50 keywords como esa al día = 7.500 unidades. Una semana de scans = excedido. Y el día que el scan falla a mitad porque el `403 quotaExceeded` aparece tras quemar 9.997 unidades, **pierdes los 9.997 de igual modo** — el resto del scan no se completa, los datos parciales son inútiles.

Claude tiene un patrón parecido: rate limit por minuto + tier. Una serie de análisis encadenados es vulnerable al mismo tipo de fallo.

## Patrón 1 — detectar el `403 quotaExceeded` y abortar inmediato

La librería `google-api-python-client` levanta `HttpError` cuando YouTube responde 403. Hay que distinguir el caso de quota agotada de otros 403 (videos privados, etc.):

```python
from googleapiclient.errors import HttpError

class QuotaExceededError(Exception):
    """Daily quota agotada. No retry — esperar al reset del día siguiente."""

def is_quota_exceeded(err: HttpError) -> bool:
    if err.resp.status != 403:
        return False
    body = err.content.decode("utf-8") if isinstance(err.content, bytes) else err.content
    return "quotaExceeded" in body or "dailyLimitExceeded" in body

def call_or_raise(api_call):
    try:
        return api_call.execute()
    except HttpError as e:
        if is_quota_exceeded(e):
            raise QuotaExceededError(f"YouTube quota exhausted: {e}")
        raise
```

Toda llamada al cliente YouTube pasa por `call_or_raise`. Una vez `QuotaExceededError` se levanta, no hay retry, no hay backoff — la quota es por día, no por minuto.

## Patrón 2 — cortar el scan limpio (no seguir pegando contra la pared)

El scan de un brand suele iterar:

```python
for keyword in brand.keywords:
    candidates = scan_keyword(keyword)
    save_to_db(candidates)
```

Si `scan_keyword` revienta a mitad por quota agotada, no quiero que el siguiente keyword también queme la misma 403 (ya que cada call cuesta unidades — sí, 403 también consume). Más importante: quiero que el frontend lo vea inmediato.

```python
async def scan_brand(brand_id: int):
    brand = await load_brand(brand_id)
    state = ScanState(brand_id=brand_id, status="running")
    await save_state(state)

    try:
        for keyword in brand.keywords:
            try:
                candidates = await scan_keyword(keyword)
                await save_to_db(candidates)
            except QuotaExceededError as e:
                state.status = "quota_exceeded"
                state.error = str(e)
                state.processed_keywords = brand.keywords.index(keyword)
                state.total_keywords = len(brand.keywords)
                await save_state(state)
                return  # No raise — el estado ya está persistido
        state.status = "done"
    except Exception as e:
        state.status = "error"
        state.error = str(e)
    finally:
        await save_state(state)
```

Dos cosas importantes:

**El estado persiste antes del `return`.** Si el proceso muere después, el frontend sigue viendo `quota_exceeded` con el último keyword procesado. No es un spinner infinito.

**El `return` no es `raise`.** Quota exceeded no es un bug; es una condición de negocio. El caller quiere saber qué pasó pero no necesita un stack trace.

## Patrón 3 — throttle del scan en el caller

YouTube Data API quota se resetea a medianoche Pacific Time. Si un usuario aprieta "Scan" 5 veces en 5 minutos, la única defensa real es no permitir el scan.

En `factory-video` cada `source` (config de scan por brand) tiene `last_scanned_at`. El endpoint `POST /scan`:

```python
SCAN_THROTTLE_HOURS = 6

async def trigger_scan(brand_id: int, force: bool = False):
    source = await load_source(brand_id)
    if not force and source.last_scanned_at:
        elapsed = datetime.utcnow() - source.last_scanned_at
        if elapsed < timedelta(hours=SCAN_THROTTLE_HOURS):
            raise HTTPException(
                429,
                detail=f"Scan throttled. Next allowed in {SCAN_THROTTLE_HOURS - elapsed.seconds // 3600}h"
            )
    background_tasks.add_task(scan_brand, brand_id)
    return {"status": "started"}
```

El parámetro `force` está ahí intencionalmente: si yo (admin) sé que la quota está fresca y necesito ignorar el throttle, lo hago. Pero el default protege contra clicks accidentales y contra usuarios distintos que no se coordinan.

## Patrón 4 — el banner de scan en el frontend lee estado, no resultado

El frontend de `factory-video` no espera por `scan_brand` (que tarda minutos). Lee `ScanState` cada 3 segundos vía polling y muestra:

```
Scan running     → spinner + N de M keywords procesados
Scan quota_exceeded → banner amarillo + "Quota agotada en keyword 'X'. Reanudar mañana."
Scan done        → banner verde + total candidatos
Scan error       → banner rojo + mensaje técnico
```

Estado sin payload. El payload (candidatos) viene de un endpoint distinto. La separación importa: el banner es liviano y refresca rápido; los candidatos son pesados y se cargan cuando el banner dice "done".

## Por qué este patrón no es paranoia

La primera versión de `factory-video` no tenía nada de esto. Resultado: una vez el scan se quedó "running" 4 horas porque YouTube había cortado a las 3 horas y nadie lo sabía. La UI mostraba spinner. Yo asumí que estaba lento. La quota nunca se reseteó porque nada estaba consumiéndola — pero el estado interno tampoco.

Detectar `403 quotaExceeded` y abortar limpio cuesta 30 minutos de implementación. Descubrir que tu pipeline lleva 4 horas pegándole a una pared con la luz roja prendida cuesta una tarde.

El equivalente con LLM: si tu pipeline encadena 50 llamadas a Claude y la 23 falla por rate limit, no quieres que las 27 restantes también revienten en cadena. El mismo patrón aplica — clase de error específica, abort temprano, estado persistido para el frontend.

## Cierre

Quota awareness es un patrón de robustness de producción que rara vez aparece en tutoriales porque los tutoriales no llegan a la 9.997 unidad. Si tu pipeline depende de APIs externas con límites duros — y todas lo tienen — vale la pena dedicar 30 minutos a:

1. Distinguir errores de quota de otros errores HTTP.
2. Abortar limpio en lugar de retry bobo.
3. Persistir estado antes de cada return.
4. Throttle a nivel de caller para no quemar más rápido de lo razonable.
5. Frontend lee estado, no espera resultado.

Las herramientas que sostienen producción se ven aburridas. Es buena señal.
