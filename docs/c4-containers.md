# C4 — contenedores

```mermaid
flowchart LR
  React[Frontend React] --> Auth[ms-auth / NestJS]
  React --> Catalogo[ms-catalogo / NestJS]
  React --> Pedidos[ms-pedidos / NestJS]
  Auth --> DBA[(PostgreSQL Auth)]
  Pedidos -- REST --> Catalogo
  Pedidos -- commands --> Kafka[(Kafka)]
  Kafka -- commands --> Pagos[ms-pagos / NestJS]
  Pagos -- results --> Kafka
  Pagos --> Stub[Pasarela stub]
  Catalogo --> DBC[(PostgreSQL Catálogo)]
  Pedidos --> DBP[(PostgreSQL Pedidos)]
  Pagos --> DBPay[(PostgreSQL Pagos)]
```

Cada servicio tiene su almacén y despliegue propio. `ms-auth` es propietario de usuarios y sesiones; `ms-pedidos` es el coordinador de la saga; Kafka transporta la solicitud y el resultado del cobro; `ms-catalogo` es el propietario del stock y `ms-pagos` el propietario del cobro.
