"""
Configuración de TO Clínica. Todos los secretos provienen de variables de
entorno (CS-08); ver `.env.example`.
"""
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "") == "1"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Falta la variable de entorno DJANGO_SECRET_KEY.")

ALLOWED_HOSTS = [h for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h]
# Render publica el host del servicio en esta variable.
if os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(os.environ["RENDER_EXTERNAL_HOSTNAME"])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "rest_framework",
    "rest_framework.authtoken",
    "cuentas",
    "clinica",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# Parámetros de la URL que se pasan a libpq. Neon exige TLS y a veces `channel_binding`.
PARAMETROS_URL_PERMITIDOS = ("sslmode", "channel_binding")


def configuracion_postgres(url):
    """
    Configuración de Django a partir de `DATABASE_URL` (Neon u otro PostgreSQL).

    - TLS obligatorio: `sslmode=require` por defecto (Neon rechaza conexiones sin TLS).
    - `CONN_HEALTH_CHECKS`: Neon suspende el cómputo sin uso; Django descarta la
      conexión cerrada y abre otra en lugar de fallar.
    - El host con `-pooler` usa PgBouncer en modo transacción, que no admite cursores
      del lado del servidor.
    """
    partes = urlparse(url)
    consulta = parse_qs(partes.query)
    opciones = {"sslmode": "require"}
    for clave in PARAMETROS_URL_PERMITIDOS:
        if clave in consulta and consulta[clave]:
            opciones[clave] = consulta[clave][0]
    host = partes.hostname or ""
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": partes.path.lstrip("/"),
        "USER": unquote(partes.username or ""),
        "PASSWORD": unquote(partes.password or ""),
        "HOST": host,
        "PORT": str(partes.port or ""),
        "OPTIONS": opciones,
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "DISABLE_SERVER_SIDE_CURSORS": "-pooler" in host,
    }


def _base_de_datos():
    url = os.environ.get("DATABASE_URL", "")
    if url:
        return configuracion_postgres(url)
    if DEBUG:
        # Solo desarrollo y pruebas locales; producción exige PostgreSQL.
        return {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
    raise ImproperlyConfigured("Falta la variable de entorno DATABASE_URL.")


DATABASES = {"default": _base_de_datos()}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "cuentas.Usuaria"
# AUT-01: complejidad exigida a toda contraseña nueva (createsuperuser, admin, etc.).
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "cuentas.validators.ValidadorComplejidad"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.PBKDF2PasswordHasher"]

REST_FRAMEWORK = {
    # AUT-06: solo token en la cabecera Authorization (sin sesión, sin CSRF).
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    # AUZ-01: autenticación obligatoria en toda la API.
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    # AUT-02: 5 intentos de login por minuto.
    "DEFAULT_THROTTLE_RATES": {"login": "5/min"},
    # Saltos de proxy de confianza (Render) para identificar la IP real en el límite de tasa.
    "NUM_PROXIES": int(os.environ.get("DJANGO_NUM_PROXIES", "1")),
}

LANGUAGE_CODE = "es-cl"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# CS-08
SECURE_SSL_REDIRECT = not DEBUG
# El health check del despliegue puede llegar por HTTP interno.
SECURE_REDIRECT_EXEMPT = [r"^salud/$"]
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000

# CS-07: los registros de servidor solo llevan metadatos (ver clinica/sync.py).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"consola": {"class": "logging.StreamHandler"}},
    "loggers": {"clinica": {"handlers": ["consola"], "level": "INFO"}},
}
