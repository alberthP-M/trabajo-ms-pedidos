# ADR 003 — outbox, inbox y pasarela inestable

## Decisión

Registrar el cambio local y el evento outbox en la misma transacción; confirmar el offset Kafka después del efecto durable. Pagos aplica timeout, backoff, circuit breaker y consulta de operación incierta.

## Motivo

Evita perder solicitudes entre PostgreSQL y Kafka, evita efectos duplicados ante reentrega y permite distinguir un rechazo conocido de una autorización que ocurrió antes de perder la respuesta.

## Consecuencia

El código incluye publicadores y reconciliación periódica. Una saga puede permanecer temporalmente en `revirtiendo_pago` o `liberando`, pero siempre conserva un paso recuperable y un motivo trazable.
