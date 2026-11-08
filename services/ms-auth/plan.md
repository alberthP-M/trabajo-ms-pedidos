# Plan local — ms-auth

## Responsabilidad

`ms-auth` es el microservicio de identidad del sistema. Gestiona usuarios, credenciales, roles y sesiones. No contiene lógica de pedidos, catálogo ni pagos.

## Persistencia

- Base lógica: `auth_db`.
- `users`: correo, hash de contraseña `scrypt`, rol, sucursal y estado.
- `refresh_tokens`: hashes de refresh tokens, expiración y revocación.
- Las contraseñas y refresh tokens nunca se almacenan en claro.
- En desarrollo se siembran un cliente y una sucursal demo.

## API

- `POST /v1/auth/register`: crea un cliente.
- `POST /v1/auth/login`: valida credenciales y devuelve access token JWT y refresh token.
- `POST /v1/auth/refresh`: rota el refresh token y devuelve una nueva sesión.
- `POST /v1/auth/logout`: revoca el refresh token.
- `GET /v1/auth/me`: devuelve el usuario del access token.
- `GET /health/live` y `GET /health/ready`: operación.

## JWT

El access token usa `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` y `ACCESS_TOKEN_TTL`. Sus claims principales son `sub`, `email`, `role` y opcionalmente `branchId`. `ms-catalogo` y `ms-pedidos` verifican el token localmente. Los tokens internos de servicio usan `SERVICE_JWT_SECRET` y no se exponen al navegador.

## Configuración

- Puerto Docker: `3005`.
- `DATABASE_URL` apunta a `auth_db`.
- `SEED_CLIENT_PASSWORD` y `SEED_BRANCH_PASSWORD` solo deben contener valores de desarrollo en `.env`.
- En producción se deben reemplazar secretos, limitar CORS y preferir claves asimétricas/JWKS.

## Pruebas y aceptación

- Login correcto devuelve access y refresh tokens.
- Contraseña incorrecta devuelve `401`.
- Registro duplicado devuelve `409`.
- Refresh rota el token anterior.
- Logout invalida el refresh token.
- Un JWT vencido, mal firmado o de otra audiencia es rechazado.
- El frontend inicia sesión contra este servicio antes de consultar catálogo o crear pedidos.
