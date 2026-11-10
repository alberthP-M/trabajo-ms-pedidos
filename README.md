# Trabajo de pedidos con microservicios

Sistema distribuido para el trabajo aplicado de Microservicios. Los tres servicios del dominio evaluado son `ms-catalogo`, `ms-pedidos` y `ms-pagos`. `ms-auth` es un auxiliar de identidad para emitir JWT, separado de la saga. La implementación incluye React, Kafka, PostgreSQL, una pasarela de pagos simulada y pruebas de los flujos de confirmación y compensación.

## Arranque con Docker

1. Copiar `.env.example` a `.env` y revisar los valores.
2. Ejecutar `docker compose up --build`.
3. Abrir `http://localhost:5173`.
4. Iniciar sesión con `cliente@demo.local` / `cliente123`.

Las APIs quedan disponibles en `http://localhost:3005` (`ms-auth`), `http://localhost:3001` (`ms-catalogo`) y `http://localhost:3002` (`ms-pedidos`). `ms-pagos` consume Kafka y no se expone al frontend. La pasarela está en `http://localhost:3004`.

## Arranque local

Instalar dependencias con `npm install`. Con PostgreSQL y Kafka disponibles, usar `npm run dev:auth`, `npm run dev:ms-catalogo`, `npm run dev:ms-pedidos`, `npm run dev:ms-pagos`, `npm run dev:stub` y `npm run dev:frontend` en terminales separadas. El generador de tokens queda reservado para pruebas automatizadas.

## Usuarios semilla

- Cliente: `cliente@demo.local` / `cliente123`.
- Sucursal: `sucursal@demo.local` / `sucursal123` (`sucursal-centro`).

El frontend inicia sesión contra `ms-auth`, conserva el access token y usa el refresh token para renovar la sesión. El JWT manual sigue disponible para pruebas con `npm run tokens -- --role cliente --sub cliente-demo`.

## Escenarios de defensa

La interfaz React muestra el estado interno de la saga, un cronómetro calculado desde la creación del pedido, el historial persistido y el ID de correlación para buscar logs. Consulta el pedido automáticamente mientras esté `pendiente`. La pasarela del entorno Docker espera **1,8 s** por defecto antes de responder; `PAYMENT_TIMEOUT_MS=3500` deja margen para ese retraso.

Para ajustar la velocidad de la demostración, modifica `.env` y recrea los contenedores con `docker compose up -d --build --force-recreate`. `STUB_MIN_LATENCY_MS` fija la espera mínima, `STUB_MAX_LATENCY_MS` fija el máximo aleatorio y `PAYMENT_TIMEOUT_MS` debe superar la latencia normal si quieres mostrar una aprobación sin timeout. Por ejemplo: `STUB_MIN_LATENCY_MS=2500`, `STUB_MAX_LATENCY_MS=3000`, `PAYMENT_TIMEOUT_MS=4500`. El retardo ocurre en el stub HTTP; el frontend no simula estados ni espera artificialmente.

La [vista interactiva de los siete flujos](./docs/presentacion-flujos.html) permite reproducir cada secuencia a 1,8, 3 o 5 segundos por paso. Sus tiempos son didácticos; los tiempos reales se ven en React.

- Confirmado: `STUB_REJECT_RATE=0`, `STUB_ERROR_RATE=0`.
- Compensado: `STUB_REJECT_RATE=1` o `STUB_ERROR_RATE=1`.
- Latencia/circuit breaker: `STUB_MAX_LATENCY_MS=3000` y `PAYMENT_TIMEOUT_MS=500`.
- Respuesta perdida después de autorizar: `STUB_EXECUTE_THEN_TIMEOUT_RATE=1`; Pagos consulta por la clave idempotente.

El flujo devuelve inicialmente `pendiente`; consultar el pedido hasta `confirmado` o `rechazado`. La clave `Idempotency-Key` se conserva al repetir la misma intención de compra.

## Verificación

```powershell
npm run build
npm test
docker compose up --build
```

Consultar el plan completo en [plan.md](./plan.md) y los planes específicos por carpeta. Las decisiones sobre saga, outbox/inbox, Kafka y aislamiento de datos están documentadas allí y en `docs/`.

El guion reproducible de login, pedidos, compensación, idempotencia y fallos está en [docs/escenarios.md](./docs/escenarios.md).
