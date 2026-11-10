# ADR 001 — tres bounded contexts

## Decisión

Separar Catálogo, Pedidos y Pagos en tres aplicaciones NestJS con bases aisladas.

## Motivo

El enunciado exige tres servicios independientes y el dominio tiene tres responsabilidades con reglas de consistencia diferentes. El aislamiento permite demostrar que ningún servicio consulta las tablas de otro.

## Consecuencia

Las operaciones cruzadas requieren REST o eventos y la consistencia es eventual; se debe mantener una saga y pruebas de compensación.
