# CLAUDE.md — Especificación Técnica y Reglas de Seguridad: TO Clínica

## 1. Contexto y Alcance del Proyecto (MVP)
- **Propósito:** Aplicación móvil de gestión clínica asistida por voz para una terapeuta ocupacional (usuaria única / Product Owner) en Chile, diseñada para registrar sesiones en **≤ 90 segundos** entre pacientes.
- **Arquitectura:** **Local-First (Offline-First)**. La app móvil lee y escribe SIEMPRE en una base SQLite local cifrada. Un módulo de sincronización replica los cambios vía API REST a un backend propio en Python/Django con PostgreSQL.
- **Restricción estricta de alcance (Won't Have / Prohibido):**
  - NO implementar IA generativa en la nube ni redactar contenido clínico automático (el borrador solo compila texto ya dictado).
  - NO enviar ni almacenar archivos de audio en ningún lado.
  - NO crear cuentas ni acceso para apoderados (solo reciben mensajes externos vía enlace `wa.me`).
  - NO implementar operación `DELETE` en ninguna entidad clínica (solo archivado lógico `archivado = True` para cumplir conservación mínima de 15 años según Ley 20.584).

## 2. Stack Tecnológico y Estructura Obligatoria
- `to-clinica/app/`: React Native + Expo SDK 58 (TypeScript modo estricto)
  - `src/pantallas/`: E1 Acceso, E2 Agenda, E3 Ficha, E4 Registro, E5 Borrador, C1-C4
  - `src/modules/acceso/`: Auth, biometría/PIN (`expo-local-authentication`), bloqueo por inactividad
  - `src/modules/pacientes-agenda/`: CRUD pacientes, apoderados, citas, enlace `wa.me`
  - `src/modules/registro/`: Dictado on-device (`expo-speech-recognition`) + fallback teclado
  - `src/modules/informes/`: Compilador borrador + PDF local (`expo-print`, `expo-sharing`)
  - `src/modules/sincronizacion/`: Cola outbox JSON, netinfo, reintentos, restauración
  - `src/data/`: Patrón Repositorio: SQLite + SQLCipher (clave en `expo-secure-store`)
  - `src/ui/`: `tema.ts` (contraste >= 4.5:1) y `componentes.tsx` (WCAG 2.2 AA)
  - `__tests__/`: Jest (cobertura >= 70% en Registro, Sincronización e Informes)
- `to-clinica/backend/`: Python 3.13 + Django + Django REST Framework
  - `cuentas/`: Modelo Usuaria, ValidadorComplejidad, ScopedRateThrottle (5/min)
  - `clinica/`: Modelos, serializers, views (permiso por propietaria), sync
  - `respaldo/`: Script `pg_dump` cifrado con AES-256-GCM
  - `tests/`: APITestCase + `coverage.py`

## 3. Modelo de Datos e Idempotencia
- **Claves primarias:** UUID v4 generados en el cliente (`id`), idénticos en SQLite y PostgreSQL.
- **Entidades:**
  1. `Usuaria` (Django User: `id`, `email` único, `password` hash PBKDF2).
  2. `AceptacionPolitica` (`id` UUID, `usuaria_id`, `version`, `aceptada_en`).
  3. `Apoderado` (`id` UUID, `propietaria_id`, `nombre`, `telefono` opcional validado con `^\+569\d{8}$`).
  4. `Paciente` (`id` UUID, `propietaria_id`, `apoderado_id` opcional, `nombre` obligatorio, `fecha_nacimiento`, `antecedentes`, `motivo_consulta`, `archivado` bool default False, `creado_en`, `modificado_en`).
  5. `Cita` (`id` UUID, `paciente_id`, `fecha_hora`, `estado` en `['pendiente', 'confirmada', 'cancelada', 'sin_respuesta']`, `creado_en`, `modificado_en`).
  6. `RegistroSesion` (`id` UUID, `cita_id` OneToOne/UNIQUE, `observaciones`, `objetivos_cumplidos`, `retroalimentacion_familia`, `archivado` bool default False, `creado_en`, `modificado_en`).
  7. `OperacionRecibida` (solo servidor: `id` = `op_id` UUID, `propietaria_id`, `recibida_en`).
- **Tablas locales adicionales en SQLite:**
  - Agregar columna `estado_sync` (`'pendiente' | 'sincronizado'`) en tablas locales.
  - `cola_sync` (`op_id` TEXT PK, `documento` JSON con entidad, `registro_id`, `operacion`, `modificado_en`, `datos`, `intentos`).
  - `evento_sync` (`evento_id` TEXT PK, `documento` JSON con metadatos SIN contenido clínico).
- **Reglas de Sincronización:**
  - Orden estricto de envío: `Apoderado` -> `Paciente` -> `Cita` -> `RegistroSesion`.
  - Idempotencia: si `op_id` ya existe en `OperacionRecibida`, responder HTTP 200 sin duplicar.
  - Resolución de conflictos: Last-Write-Wins (LWW) comparando `modificado_en` (desempate por `recibida_en` en servidor).

## 4. Reglas Obligatorias de Seguridad (OWASP Top 10:2025 & MASVS)
- **AUZ-01 / AUZ-02:** `IsAuthenticated` global en DRF. Todos los querysets filtran por `propietaria=request.user`. Acceder a un ID ajeno debe devolver **404** (nunca 403 ni 200).
- **AUZ-03 / AUZ-04:** El servidor asigna `propietaria=request.user` al crear (ignorar cualquier `propietaria` enviada en el payload). Validar en serializers que `paciente` y `cita` pertenezcan a `request.user`.
- **AUZ-05 / AUZ-06:** `http_method_names = ["get", "post", "put", "patch"]` (sin `delete`). No publicar `/admin/` cuando `DEBUG=False`.
- **AUT-01 a AUT-06:** Contraseña >= 8 caracteres con mayúscula, minúscula, número y carácter especial (`ValidadorComplejidad`). Rate limit en login: `5/min` (`ScopedRateThrottle`). Error de login genérico: `"Correo o contraseña incorrectos."`. Autenticación solo por `TokenAuthentication` en cabecera `Authorization` (deshabilitar `SessionAuthentication` en la API para evitar CSRF).
- **AUT-07 / AUT-08:** Bloqueo biométrico/PIN local (`expo-local-authentication`) al abrir, tras **5 minutos** de inactividad o **60 segundos** en segundo plano. Bloquear acceso hasta aceptar Política de Privacidad (guardando versión y fecha).
- **CS-03 / CS-05 / CS-07 / CS-08:**
  - Escapar todo texto clínico con `escaparHtml()` antes de generar HTML para `expo-print`.
  - Codificar mensajes de WhatsApp con `encodeURIComponent()` sin incluir datos clínicos.
  - Cero datos clínicos en `console.log`, logs de servidor o `evento_sync`.
  - `DEBUG=False`, `SECURE_SSL_REDIRECT=True`, secretos solo en variables de entorno.

## 5. Estándares de Calidad y Definición de Terminado (DoD)
- Python: 0 errores con `flake8` (max-line-length 100/120).
- App: TypeScript estricto (`tsc --noEmit` sin errores) y 0 errores de `eslint`.
- No dar por terminada ninguna tarea sin escribir y ejecutar sus pruebas unitarias/seguridad correspondientes (`manage.py test` y `npm test`).