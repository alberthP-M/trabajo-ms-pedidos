# ADR 002 — Kafka y saga orquestada

## Decisión

Pedidos coordina la saga. Solicita y recibe el resultado del cobro mediante Kafka con los topics versionados `payments.commands.v1` y `payments.results.v1`.

## Motivo

El cobro no debe bloquear el API de pedidos cuando la pasarela está lenta o caída. Kafka desacopla el proceso y retiene eventos para reintentos. Pedidos conserva la secuencia del negocio y puede liberar/consolidar stock con conocimiento del resultado.

## Consecuencia

La entrega puede repetirse. Se usan clave `orderId`, `eventId`, inbox, outbox, commits manuales y operaciones idempotentes. Kafka no hace que una API externa sea exactamente una vez, por lo que Pagos reconcilia por clave de idempotencia.
