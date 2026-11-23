"""Conexión a PostgreSQL (Neon): TLS, comprobación de conexión y uso del pooler."""
from django.test import SimpleTestCase

from config.settings import configuracion_postgres

URL_DIRECTA = "postgresql://usuaria:clave%40x@ep-ejemplo-123.sa-east-1.aws.neon.tech/to_clinica"
URL_POOLER = "postgresql://usuaria:clave@ep-ejemplo-123-pooler.sa-east-1.aws.neon.tech/to_clinica"


class ConfiguracionPostgresTests(SimpleTestCase):
    def test_extrae_los_datos_de_la_url_y_decodifica_la_clave(self):
        cfg = configuracion_postgres(URL_DIRECTA)
        self.assertEqual(cfg["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(cfg["NAME"], "to_clinica")
        self.assertEqual(cfg["USER"], "usuaria")
        self.assertEqual(cfg["PASSWORD"], "clave@x")
        self.assertEqual(cfg["HOST"], "ep-ejemplo-123.sa-east-1.aws.neon.tech")

    def test_tls_obligatorio_aunque_la_url_no_lo_indique(self):
        self.assertEqual(configuracion_postgres(URL_DIRECTA)["OPTIONS"], {"sslmode": "require"})

    def test_respeta_sslmode_y_channel_binding_de_la_url(self):
        cfg = configuracion_postgres(URL_DIRECTA + "?sslmode=verify-full&channel_binding=require")
        self.assertEqual(
            cfg["OPTIONS"], {"sslmode": "verify-full", "channel_binding": "require"}
        )

    def test_ignora_parametros_desconocidos(self):
        cfg = configuracion_postgres(URL_DIRECTA + "?sslmode=require&options=-c%20x%3Dy")
        self.assertEqual(cfg["OPTIONS"], {"sslmode": "require"})

    def test_comprueba_conexiones_inactivas(self):
        cfg = configuracion_postgres(URL_DIRECTA)
        self.assertTrue(cfg["CONN_HEALTH_CHECKS"])
        self.assertEqual(cfg["CONN_MAX_AGE"], 60)

    def test_cursores_del_servidor_solo_se_desactivan_con_pooler(self):
        self.assertFalse(configuracion_postgres(URL_DIRECTA)["DISABLE_SERVER_SIDE_CURSORS"])
        self.assertTrue(configuracion_postgres(URL_POOLER)["DISABLE_SERVER_SIDE_CURSORS"])

    def test_puerto_explicito(self):
        cfg = configuracion_postgres("postgres://u:c@localhost:5433/bd")
        self.assertEqual(cfg["PORT"], "5433")
