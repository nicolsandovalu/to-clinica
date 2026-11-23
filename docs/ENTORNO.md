# TO Clínica — Configuración del entorno y despliegue

Guía paso a paso para levantar el proyecto en desarrollo, verificarlo y desplegar el backend en Render (plan gratuito) con la base de datos en Neon (PostgreSQL).
Cada paso indica si **se ejecutó y verificó** (✔) o si **queda pendiente de ejecutar** (⏳). No se dan por hechos pasos que no se han ejecutado.

## 1. Requisitos

| Herramienta | Versión usada | Para qué |
|---|---|---|
| Node.js | 22 o superior | App (Expo SDK 58) |
| Python | 3.13 (`PYTHON_VERSION=3.13.7` en `render.yaml`) | Backend Django |
| Git | cualquiera reciente | Control de versiones (repositorio en GitHub) |
| Cuenta Expo y EAS CLI | — | Compilar la app (⏳) |
| Cuenta Render | plan gratuito | Hospedar el backend (⏳) |
| Cuenta Neon | plan gratuito | Base PostgreSQL (⏳) |
| Teléfono Android | con bloqueo de pantalla configurado | Pruebas manuales (⏳) |

## 2. Estructura del repositorio

```
to-clinica/
  app/        React Native + Expo (TypeScript estricto)
  backend/    Python + Django + Django REST Framework
  docs/       Esta guía
  render.yaml Blueprint de Render (web service; la base está en Neon)
```

## 3. Backend en local ✔ (ejecutado el 23-11-2026)

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env     # completar valores; NUNCA versionar .env
```

Variables mínimas para desarrollo local (en `.env` o en la terminal):

| Variable | Valor en desarrollo | Notas |
|---|---|---|
| `DJANGO_SECRET_KEY` | cualquier cadena larga | Obligatoria: sin ella el servidor no arranca |
| `DJANGO_DEBUG` | `1` | Habilita SQLite local, `/admin/` y desactiva la redirección a HTTPS |

Con `DJANGO_DEBUG=0` (producción) también se exigen `DATABASE_URL` (PostgreSQL) y `DJANGO_ALLOWED_HOSTS`. La conexión a PostgreSQL fuerza TLS (`sslmode=require`), comprueba conexiones inactivas (Neon suspende el cómputo sin uso) y, con el host `-pooler`, desactiva los cursores del lado del servidor (pruebas en `tests/test_base_datos.py`).

```bash
python manage.py migrate
python manage.py cargar_datos_ficticios --cantidad 5   # solo datos inventados
python manage.py runserver
```

### Verificación del backend ✔

```bash
python manage.py test            # 94 pruebas, todas aprobadas
flake8 .                         # 0 errores
coverage run manage.py test && coverage report   # cobertura total 98 %
python manage.py check --deploy  # con variables de producción (ver sección 5)
```

## 4. App en local

```bash
cd app
npm install        # tras actualizar el repositorio, para instalar expo-constants
cp .env.example .env
# EXPO_PUBLIC_API_URL = URL HTTPS del backend (ver sección 5)
```

### Verificación de la app ✔

```bash
npm test -- --coverage   # 12 suites en total; ver resultados al final de este documento
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
```

### Ejecución en el teléfono ⏳

La app usa módulos nativos (`expo-sqlite` con SQLCipher, `expo-speech-recognition`), por lo que **no funciona completa en Expo Go**: en Expo Go la base local cae a SQLite sin cifrar (solo desarrollo, deja un aviso en consola). Para probar dictado y cifrado se necesita un *development build*:

```bash
cd app
npx expo run:android      # con el teléfono conectado por USB y depuración USB activada
```

> Pendiente: el repositorio no incluye `eas.json`. Para compilar con EAS Build hay que ejecutar `eas build:configure` y definir el perfil `development`. No se ha ejecutado ninguna compilación.

## 5. Despliegue: base en Neon y backend en Render (plan gratuito) ⏳

Arquitectura: app móvil (EAS Build) → API Django en Render → PostgreSQL en Neon.

### 5.1 Base de datos en Neon

1. Crear un proyecto en Neon (el informe EV2 indica la región São Paulo) y una base `to_clinica`.
2. En el panel, **Connect**: copiar dos cadenas de conexión:
   - **con pooler** (host con `-pooler`): para `DATABASE_URL` en Render.
   - **directa** (sin `-pooler`): para respaldos con `pg_dump` y para tareas administrativas.
3. Ambas deben terminar en `?sslmode=require`; la aplicación lo exige igualmente.

### 5.2 Backend en Render

`render.yaml` define un *web service* Python (`rootDir: backend`, build con `bash build.sh`, arranque con `gunicorn config.wsgi:application`, health check en `/salud/`). Ya no declara base de datos propia.

1. Subir los cambios a GitHub (`git push`).
2. En Render: **New → Blueprint**, conectar el repositorio y seleccionar `render.yaml`.
3. Render pide los secretos marcados `sync: false`:
   - `DATABASE_URL`: cadena **con pooler** de Neon.
   - `DJANGO_ALLOWED_HOSTS`: el dominio que Render asigne (por ejemplo `to-clinica-api.onrender.com`).
   - `RESPALDO_CLAVE_HEX`: clave AES-256 de 64 hex. Generar con `python -c "import secrets; print(secrets.token_hex(32))"` y **guardarla fuera del repositorio**.
   `DJANGO_SECRET_KEY` se genera sola.
4. Esperar el primer despliegue. `build.sh` instala dependencias, ejecuta `check --deploy` y aplica migraciones; si algo falla, el despliegue se detiene.
5. Comprobar `https://<dominio>/salud/` → `{"estado": "ok"}`.
6. En `app/.env` definir `EXPO_PUBLIC_API_URL=https://<dominio>` y reconstruir la app.

> No verificado: que las migraciones de `build.sh` funcionen a través del host `-pooler` de Neon (PgBouncer). Si fallaran, usar temporalmente la cadena directa en `DATABASE_URL`.

### Cuenta de la terapeuta ⏳ (decisión pendiente)

La API no tiene registro público: la cuenta debe crearse desde el servidor (`python manage.py createsuperuser`). El plan gratuito de Render no ofrece terminal en el servicio, por lo que hay que definir cómo crear la cuenta (por ejemplo, ejecutar el comando en un equipo local con `DATABASE_URL` apuntando a la cadena directa de Neon). **No verificado.** La contraseña debe cumplir la política: mínimo 8 caracteres con mayúscula, minúscula, número y carácter especial.

### Limitaciones conocidas del plan gratuito

| Aspecto | Efecto | Fuente |
|---|---|---|
| Servicio web gratuito | Se suspende tras inactividad; el primer acceso tarda en reactivarse (la app tolera hasta 120 s) | Comentario de `render.yaml` y RNF-02 |
| Plan gratuito de Neon | El cómputo se suspende sin uso y se reactiva al conectar (primer acceso más lento); límites de almacenamiento y retención según el plan vigente. **No verificado**: revisar condiciones en el sitio de Neon antes de usar datos clínicos reales | Documentación de Neon (pendiente de contrastar) |

> Decisión (23-11-2026): base en Neon, coherente con el informe EV2; `render.yaml` ya no usa la base de Render.

## 6. Respaldo cifrado ⏳

```bash
RESPALDO_CLAVE_HEX=<64 hex> DATABASE_URL=<cadena directa de Neon, sin -pooler> python respaldo/respaldar.py --salida respaldos/
RESPALDO_CLAVE_HEX=<64 hex> python respaldo/respaldar.py --descifrar respaldos/respaldo-AAAAmmdd-HHMMSS.enc --salida volcado.dump
```

Requiere `pg_dump` instalado, con versión igual o superior a la del servidor PostgreSQL de Neon (no verificado). El script se probó con pruebas automáticas (`tests/test_infraestructura.py`); no se ha ejecutado contra una base real. Los `.enc` están excluidos de Git.

## 7. Seguridad del repositorio

- `.env`, `.env.*` (salvo `.env.example`), `*.sqlite3`, `*.sql`, `*.enc`, `*.pem` y `*.key` están en `.gitignore`.
- Antes de cada commit: `git status` para confirmar que no hay secretos ni bases de datos en el área de preparación.
