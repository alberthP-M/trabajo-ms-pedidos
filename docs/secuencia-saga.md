# Secuencias de la saga de pedidos

Estos diagramas representan el comportamiento del código actual. El sistema combina operaciones **REST/HTTP síncronas** con eventos **Kafka asíncronos**. Cada microservicio conserva sus propios datos y las integraciones importantes son idempotentes.

El estado público de un pedido es `pendiente`, `confirmado` o `rechazado`. Los pasos internos de la saga usan estados como `reservando`, `esperando_pago`, `consolidando`, `liberando`, `revirtiendo_pago`, `reversion_pendiente` y `finalizado`.

Para exponer los escenarios paso a paso y en pantalla completa, abrir [presentacion-flujos.html](presentacion-flujos.html). Los valores de stock de esa vista son ilustrativos: total inicial 20 y pedido de una unidad.

## Cómo leer los diagramas

- `->>` representa una solicitud síncrona: el emisor espera una respuesta.
- `-->>` representa la respuesta de una solicitud síncrona.
- `-)` representa publicación o entrega asíncrona mediante Kafka.
- `payments.commands.v1` transporta comandos desde `ms-pedidos` hacia `ms-pagos`.
- `payments.results.v1` transporta resultados desde `ms-pagos` hacia `ms-pedidos`.
- `outbox` guarda eventos pendientes de publicación junto con el cambio de negocio.
- `inbox` o la tabla de procesados evita aplicar dos veces el mismo `eventId`.
- El mismo `correlationId` acompaña todo el flujo y permite relacionar logs entre servicios.

| Componente | Publica | Consume |
|---|---|---|
| `ms-pedidos` | `CobroSolicitado`, `ReversionSolicitada` | `PagoAprobado`, `PagoRechazado`, `ReversionResultado` |
| `ms-pagos` | `PagoAprobado`, `PagoRechazado`, `ReversionResultado` | `CobroSolicitado`, `ReversionSolicitada` |
| `ms-catalogo` | No usa Kafka | No usa Kafka |
| `ms-auth` | No usa Kafka | No usa Kafka |
| `pasarela-stub` | No usa Kafka | No usa Kafka |

`kafka-init` únicamente crea ambos tópicos y termina correctamente. La lógica de publicación y consumo vive dentro de `ms-pedidos` y `ms-pagos`, no dentro de Kafka.

## 1. Pedido aprobado y confirmado

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant A as ms-auth
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant DI as BD Catálogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    C->>F: Iniciar sesión
    F->>A: POST /v1/auth/login
    A-->>F: 200 JWT de cliente
    F->>I: GET /v1/sucursales/{id}/menu
    I-->>F: 200 precios y availableStock

    C->>F: Crear pedido con tok_demo_aprobado
    F->>O: POST /v1/pedidos<br/>JWT + Idempotency-Key
    O->>DO: INSERT pedido<br/>pendiente / reservando
    O-->>F: 201 pedido aceptado
    Note over F,O: React consulta GET /v1/pedidos/{id}<br/>cada 800 ms mientras siga pendiente

    O->>I: POST /v1/reservas<br/>orderId + correlationId
    I->>DI: Transacción: validar ítems,<br/>precios y reservar stock
    DI-->>I: Reserva activa + total
    I-->>O: 201 reserva calculada
    Note over I: Log StockReservado

    O->>DO: Transacción: total + esperando_pago<br/>+ CobroSolicitado en outbox
    Note over O: Log CobroSolicitado
    O-)KC: Publicar CobroSolicitado
    KC-)P: Entregar al grupo ms-pagos

    P->>DP: Verificar inbox y crear<br/>transacción de pago pendiente
    P->>G: POST /authorize<br/>clave idempotente = orderId
    G->>G: Aplicar latencia y autorizar
    G-->>P: 200 approved + paymentId
    P->>DP: Transacción: pago aprobado<br/>+ PagoAprobado en outbox
    Note over P: Log PagoAprobado
    P-)KR: Publicar PagoAprobado
    KR-)O: Entregar al grupo ms-pedidos

    O->>DO: Verificar inbox<br/>internalStatus = consolidando
    O->>I: POST /v1/reservas/{id}/consolidar
    I->>DI: Descontar stock_total<br/>y stock_reserved
    DI-->>I: Reserva consolidada
    I-->>O: 201/200 consolidada
    Note over I: Log StockConsolidado

    O->>DO: Guardar confirmado / finalizado<br/>+ historial + inbox
    F->>O: GET /v1/pedidos/{id}
    O-->>F: 200 confirmado
    F->>I: GET menú actualizado
    F->>O: GET lista de pedidos
```

**Sincronía y resultado:** reservar y consolidar stock son llamadas REST síncronas. El cobro y su resultado viajan asíncronamente por Kafka. El `POST /v1/pedidos` no espera a la pasarela: devuelve el pedido `pendiente` y el frontend observa el resultado mediante polling. La aprobación del cobro por sí sola no confirma el pedido; también debe consolidarse la reserva.

**Stock:** reservar aumenta `stockReserved` y reduce `availableStock`, pero mantiene `stockTotal`. Consolidar descuenta la cantidad tanto de `stockTotal` como de `stockReserved`.

## 2. Pago rechazado y compensación de stock

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant DI as BD Catálogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    C->>F: Crear pedido con tok_reject
    F->>O: POST /v1/pedidos<br/>JWT + Idempotency-Key
    O->>DO: Guardar pendiente / reservando
    O-->>F: 201 pendiente

    O->>I: POST /v1/reservas
    I->>DI: Reservar existencias<br/>en una transacción
    DI-->>I: Reserva activa
    I-->>O: 201 reserva + total
    Note over I: Log StockReservado

    O->>DO: Guardar esperando_pago<br/>+ CobroSolicitado en outbox
    Note over O: Log CobroSolicitado
    O-)KC: Publicar CobroSolicitado
    KC-)P: Entregar al grupo ms-pagos

    P->>DP: Verificar inbox<br/>y crear pago pendiente
    P->>G: POST /authorize<br/>paymentToken = tok_reject
    G-->>P: 200 approved=false<br/>motivo del emisor simulado
    Note over P,G: Es un rechazo conocido,<br/>no un fallo técnico ni timeout

    P->>DP: Guardar rechazado<br/>+ PagoRechazado en outbox
    Note over P: Log PagoRechazado
    P-)KR: Publicar PagoRechazado
    KR-)O: Entregar al grupo ms-pedidos

    O->>DO: Verificar inbox<br/>internalStatus = liberando
    O->>I: POST /v1/reservas/{id}/liberar
    I->>DI: Reducir stock_reserved
    DI-->>I: Reserva liberada
    I-->>O: 201/200 liberada
    Note over I: Log StockLiberado

    O->>DO: Guardar rechazado / finalizado<br/>+ motivo + historial + inbox
    F->>O: GET /v1/pedidos/{id}
    O-->>F: 200 rechazado
    F->>I: GET menú actualizado
```

**Sincronía y resultado:** la reserva y la liberación son REST síncronos; `CobroSolicitado` y `PagoRechazado` son eventos Kafka asíncronos. Como la reserva nunca se consolidó, liberar solo reduce `stockReserved`; `stockTotal` no cambia y `availableStock` vuelve al valor anterior.

## 3. Stock insuficiente: rechazo antes del pago

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant DI as BD Catálogo
    participant K as Kafka
    participant P as ms-pagos

    C->>F: Pedir más unidades<br/>que availableStock
    F->>O: POST /v1/pedidos<br/>JWT + Idempotency-Key
    O->>DO: Guardar pendiente / reservando
    O-->>F: 201 pendiente

    O->>I: POST /v1/reservas<br/>todos los ítems
    I->>DI: BEGIN + bloquear productos<br/>y validar existencias

    alt Algún ítem no existe o no tiene stock
        DI-->>I: ROLLBACK completo
        I-->>O: 400/409 con motivo<br/>y total calculado cuando aplica
        Note over I: Log ReservaFallida
        O->>DO: Guardar rechazado / finalizado<br/>+ motivo + historial
        Note over O: Log ReservaRechazada
    else Todos los ítems son válidos
        DI-->>I: COMMIT reserva completa
    end

    Note over O,P: No se crea CobroSolicitado,<br/>no se publica en Kafka y ms-pagos no participa
    F->>O: GET /v1/pedidos/{id}
    O-->>F: 200 rechazado<br/>Stock insuficiente
```

**Sincronía y resultado:** este escenario termina enteramente mediante REST. La reserva de varios ítems es atómica: si uno falla, Catálogo revierte toda la transacción y no queda stock parcialmente reservado. El pedido queda `rechazado/finalizado` sin intentar ningún cobro.

## 4. Error técnico de pasarela y circuit breaker

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    C->>F: Crear pedido con tok_error
    F->>O: POST /v1/pedidos
    O-->>F: 201 pendiente
    O->>I: POST /v1/reservas
    I-->>O: 201 reserva activa
    Note over I: Log StockReservado

    O->>DO: Guardar CobroSolicitado<br/>en outbox
    Note over O: Log CobroSolicitado
    O-)KC: Publicar CobroSolicitado
    KC-)P: Entregar comando
    P->>DP: Crear pago pendiente

    loop Hasta PAYMENT_MAX_RETRIES<br/>con backoff exponencial
        P->>G: POST /authorize<br/>misma clave orderId
        G--xP: 503, error o timeout
        P->>G: GET /operations/{orderId}
        G-->>P: unknown
        P->>DP: Registrar intento,<br/>duración y error
    end

    Note over P,G: Al alcanzar CIRCUIT_FAILURE_THRESHOLD,<br/>el circuito pasa a open y evita nuevas autorizaciones
    P->>DP: Guardar rechazo técnico<br/>+ PagoRechazado en outbox
    Note over P: Log PagoRechazado<br/>motivo: circuit breaker o reintentos agotados
    P-)KR: Publicar PagoRechazado
    KR-)O: Entregar resultado

    O->>DO: internalStatus = liberando
    O->>I: POST /v1/reservas/{id}/liberar
    I-->>O: Reserva liberada
    Note over I: Log StockLiberado
    O->>DO: Guardar rechazado / finalizado<br/>+ motivo técnico

    F->>O: GET /v1/pedidos/{id}
    O-->>F: 200 rechazado<br/>con rejectionReason
```

**Sincronía y resultado:** cada intento hacia la pasarela es HTTP síncrono y tiene timeout; el comando y el resultado siguen siendo Kafka asíncronos. Los valores efectivos se configuran con `PAYMENT_MAX_RETRIES`, `PAYMENT_BACKOFF_MS`, `CIRCUIT_FAILURE_THRESHOLD`, `CIRCUIT_OPEN_MS` y `PAYMENT_TIMEOUT_MS`. En modo determinista, `tok_error` fuerza el error técnico.

## 5. Autorización ejecutada pero respuesta perdida

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant I as ms-catalogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    C->>F: Crear pedido
    F->>O: POST /v1/pedidos
    O-->>F: 201 pendiente
    O->>I: POST /v1/reservas
    I-->>O: 201 reserva activa

    O-)KC: CobroSolicitado desde outbox
    KC-)P: Entregar comando
    P->>DP: Crear transacción pendiente

    P->>G: POST /authorize<br/>Idempotency-Key = orderId
    G->>G: Ejecutar y guardar aprobación<br/>con paymentId
    G--xP: La respuesta excede<br/>PAYMENT_TIMEOUT_MS

    Note over P,G: Un timeout significa resultado incierto<br/>y no demuestra que el cobro haya fallado
    P->>G: GET /operations/{orderId}
    G-->>P: status=approved<br/>paymentId original
    P->>DP: Registrar intento<br/>aprobado-reconciliado
    P->>DP: Guardar aprobado<br/>+ PagoAprobado en outbox
    Note over P: Log PagoAprobado

    P-)KR: Publicar PagoAprobado
    KR-)O: Entregar resultado
    O->>I: POST /v1/reservas/{id}/consolidar
    I-->>O: Reserva consolidada
    Note over I: Log StockConsolidado
    O->>O: Guardar confirmado / finalizado

    F->>O: GET /v1/pedidos/{id}
    O-->>F: 200 confirmado
```

**Sincronía y resultado:** la consulta `GET /operations/{orderId}` resuelve la incertidumbre antes de repetir la autorización. Si fuera necesario repetirla, se usaría la misma clave idempotente y el stub devolvería la operación ya registrada, evitando un doble cobro. Se simula con `STUB_EXECUTE_THEN_TIMEOUT_RATE=1`.

## 6. Pago aprobado, consolidación fallida y reversión

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    Note over O,P: El flujo ya reservó stock,<br/>autorizó el pago y recibió PagoAprobado
    KR-)O: Entregar PagoAprobado
    O->>DO: Verificar inbox<br/>internalStatus = consolidando

    loop Hasta 3 intentos REST
        O->>I: POST /v1/reservas/{id}/consolidar
        I--xO: Error persistente<br/>o Catálogo no disponible
    end

    O->>DO: Transacción: internalStatus = revirtiendo_pago<br/>+ ReversionSolicitada en outbox
    Note over O: Log ReversionSolicitada
    O-)KC: Publicar ReversionSolicitada
    KC-)P: Entregar al grupo ms-pagos

    P->>DP: Verificar inbox y recuperar<br/>paymentId de la autorización
    P->>G: POST /reverse<br/>clave = reverse-{orderId}

    alt Reversión exitosa
        G-->>P: reversed=true
        P->>DP: Guardar revertido<br/>+ ReversionResultado en outbox
        P-)KR: ReversionResultado<br/>reversed=true
        KR-)O: Entregar resultado
        O->>I: POST /v1/reservas/{id}/liberar
        I-->>O: Reserva liberada
        Note over I: Log StockLiberado
        O->>DO: Guardar rechazado / finalizado<br/>Cobro revertido y reserva liberada
        F->>O: GET /v1/pedidos/{id}
        O-->>F: 200 rechazado
    else Reversión falla o expira
        G--xP: Error después de reintentos
        P->>DP: Guardar reversion_pendiente<br/>+ ReversionResultado(false) en outbox
        Note over P: Log ReversionPendiente
        P-)KR: ReversionResultado<br/>reversed=false
        KR-)O: Entregar resultado
        O->>DO: internalStatus = reversion_pendiente
        Note over O: Log ReversionPendiente<br/>estado público continúa pendiente

        loop Reconciliador cada 5 segundos
            P->>DP: Buscar reversiones pendientes
            P->>G: POST /reverse con la misma clave
        end

        G-->>P: reversed=true
        P->>DP: Guardar revertido<br/>+ nuevo ReversionResultado(true)
        P-)KR: Publicar éxito de reversión
        KR-)O: Entregar resultado
        O->>I: Liberar reserva
        I-->>O: Reserva liberada
        O->>DO: Guardar rechazado / finalizado
        F->>O: GET /v1/pedidos/{id}
        O-->>F: 200 rechazado
    end
```

**Sincronía y resultado:** la consolidación y la reversión contra la pasarela son HTTP síncronos con reintentos. `ReversionSolicitada` y `ReversionResultado` viajan asíncronamente por Kafka. Mientras no exista confirmación de la reversión, el pedido permanece públicamente `pendiente` y usa `reversion_pendiente` como estado interno; no se marca rechazado antes de recuperar el dinero y liberar la reserva.

Este fallo exacto de consolidación está cubierto por pruebas, pero no existe un token de pago que lo fuerce por sí solo: requiere simular indisponibilidad o error de Catálogo al consolidar.

## 7. Solicitudes y mensajes duplicados

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant F as Frontend React
    participant O as ms-pedidos
    participant DO as BD Pedidos
    participant I as ms-catalogo
    participant KC as Kafka commands
    participant P as ms-pagos
    participant DP as BD Pagos
    participant G as pasarela-stub
    participant KR as Kafka results

    C->>F: Crear pedido
    F->>O: POST /v1/pedidos<br/>Idempotency-Key = K
    O->>DO: Bloqueo por cliente + K<br/>guardar requestHash y orderId
    O-->>F: 201 pedido A

    Note over F,O: El cliente reintenta por timeout,<br/>doble clic o respuesta perdida
    F->>O: Repetir POST con<br/>Idempotency-Key = K
    O->>DO: Buscar cliente + K

    alt Mismo cuerpo y mismo requestHash
        DO-->>O: Pedido A ya existente
        O-->>F: Devolver el mismo pedido A
        Note over O: No inicia una segunda saga
    else Misma clave con un cuerpo diferente
        DO-->>O: requestHash diferente
        O-->>F: 400 clave reutilizada<br/>con otro pedido
    end

    Note over O,I: Si se reintenta la reserva REST,<br/>orderId también es reservationId
    O->>I: POST /v1/reservas<br/>reservationId = pedido A
    I-->>O: Devolver reserva existente<br/>sin duplicar stock_reserved

    O-)KC: CobroSolicitado eventId=E1<br/>key Kafka = orderId
    KC-)P: Entregar E1
    P->>DP: E1 no está en inbox
    P->>G: POST /authorize<br/>Idempotency-Key = orderId
    G-->>P: Resultado guardado
    P->>DP: Guardar E1 en inbox<br/>y resultado en outbox

    KC-)P: Kafka reentrega E1
    P->>DP: E1 ya existe en inbox
    Note over P: Ignorar el duplicado<br/>sin volver a aplicar el cobro

    Note over P,G: Si se repitiera la autorización con<br/>el mismo orderId, la pasarela devolvería<br/>la operación existente

    P-)KR: PagoAprobado eventId=E2
    KR-)O: Entregar E2
    O->>DO: E2 no está en inbox<br/>aplicar resultado y registrar E2
    KR-)O: Kafka reentrega E2
    O->>DO: E2 ya existe en inbox
    Note over O: Ignorar el duplicado<br/>sin consolidar dos veces
```

**Capas de idempotencia:**

1. `Idempotency-Key` identifica la intención HTTP del cliente.
2. `requestHash` impide reutilizar esa clave con un cuerpo diferente.
3. `orderId` identifica la reserva en Catálogo y la autorización en la pasarela.
4. `eventId` identifica una entrega Kafka y permite descartarla si ya está en inbox.
5. La clave Kafka es `orderId`, por lo que los eventos del mismo pedido se enrutan de forma consistente.

## Resumen de sincronía

| Integración | Tipo | Quién espera | Propósito |
|---|---|---|---|
| Frontend → `ms-auth` | REST síncrono | Frontend | Login, registro y sesión |
| Frontend → `ms-catalogo` | REST síncrono | Frontend | Sucursales, menú y mantenimiento |
| Frontend → `ms-pedidos` | REST síncrono | Frontend | Crear, listar y consultar pedidos |
| `ms-pedidos` → `ms-catalogo` | REST síncrono | `ms-pedidos` | Reservar, consolidar y liberar stock |
| `ms-pagos` → `pasarela-stub` | HTTP síncrono | `ms-pagos` | Autorizar, consultar y revertir pagos |
| `ms-pedidos` → Kafka → `ms-pagos` | Asíncrono | No hay conexión HTTP abierta | Comandos de cobro y reversión |
| `ms-pagos` → Kafka → `ms-pedidos` | Asíncrono | No hay conexión HTTP abierta | Resultados de pago y reversión |
| Frontend → `GET /v1/pedidos/{id}` | REST síncrono repetido | Frontend en cada consulta | Polling cada 800 ms hasta estado final |

La combinación permite responder rápidamente al cliente, desacoplar la parte lenta o inestable del pago y conservar compensaciones explícitas cuando una etapa posterior falla.
