"""Validador de contraseñas, respaldo cifrado y carga de datos ficticios."""
import io
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings

from clinica.models import Apoderado, Cita, Paciente, RegistroSesion
from cuentas.validators import ValidadorComplejidad

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from respaldo import respaldar  # noqa: E402

CLAVE_HEX = "ab" * 32


class ValidadorComplejidadTests(SimpleTestCase):
    def test_acepta_clave_compleja(self):
        ValidadorComplejidad().validate("Abcdef1!")
        ValidadorComplejidad().validate("Ñandú_2026")

    def test_rechaza_cada_requisito_faltante(self):
        casos = {
            "Ab1!": "8 caracteres",
            "abcdefg1!": "mayúscula",
            "ABCDEFG1!": "minúscula",
            "Abcdefgh!": "número",
            "Abcdefg12": "especial",
        }
        for clave, texto in casos.items():
            with self.subTest(clave=clave):
                with self.assertRaises(ValidationError) as ctx:
                    ValidadorComplejidad().validate(clave)
                self.assertIn(texto, " ".join(ctx.exception.messages))

    def test_acumula_todos_los_errores(self):
        with self.assertRaises(ValidationError) as ctx:
            ValidadorComplejidad().validate("abc")
        self.assertEqual(len(ctx.exception.messages), 4)

    def test_texto_de_ayuda(self):
        self.assertIn("8 caracteres", ValidadorComplejidad().get_help_text())

    def test_esta_activo_en_la_configuracion(self):
        with self.assertRaises(ValidationError):
            validate_password("todaminuscula")
        validate_password("Valida#2026x")


class CifradoRespaldoTests(SimpleTestCase):
    clave = bytes.fromhex(CLAVE_HEX)

    def test_ida_y_vuelta(self):
        secreto = b"PGDMP contenido clinico de prueba"
        blob = respaldar.cifrar(secreto, self.clave)
        self.assertTrue(blob.startswith(respaldar.MAGIA))
        self.assertNotIn(b"clinico", blob)
        self.assertEqual(respaldar.descifrar(blob, self.clave), secreto)

    def test_nonce_distinto_en_cada_respaldo(self):
        self.assertNotEqual(
            respaldar.cifrar(b"x", self.clave), respaldar.cifrar(b"x", self.clave)
        )

    def test_dato_alterado_se_detecta(self):
        blob = bytearray(respaldar.cifrar(b"datos", self.clave))
        blob[-1] ^= 1
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.descifrar(bytes(blob), self.clave)

    def test_clave_incorrecta_falla(self):
        blob = respaldar.cifrar(b"datos", self.clave)
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.descifrar(blob, bytes.fromhex("cd" * 32))

    def test_archivo_invalido_o_clave_corta(self):
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.descifrar(b"no-es-un-respaldo", self.clave)
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.cifrar(b"x", b"corta")
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.descifrar(b"x", b"corta")

    def test_leer_clave(self):
        self.assertEqual(respaldar.leer_clave({"RESPALDO_CLAVE_HEX": CLAVE_HEX}), self.clave)
        for malo in ("", "zz" * 32, "ab" * 16, "ab" * 33):
            with self.subTest(valor=malo):
                with self.assertRaises(respaldar.ErrorRespaldo):
                    respaldar.leer_clave({"RESPALDO_CLAVE_HEX": malo})
        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.leer_clave({})


class VolcadoRespaldoTests(SimpleTestCase):
    URL = "postgres://usuario:p%40ss@db.interno:6543/to_clinica"

    def test_entorno_pg_no_pone_la_clave_en_argumentos(self):
        entorno = respaldar.entorno_pg(self.URL, base={})
        self.assertEqual(entorno["PGPASSWORD"], "p@ss")
        self.assertEqual(entorno["PGHOST"], "db.interno")
        self.assertEqual(entorno["PGPORT"], "6543")
        self.assertEqual(entorno["PGDATABASE"], "to_clinica")

    def test_url_no_postgres_se_rechaza(self):
        for url in ("mysql://u:p@h/db", "postgres://u:p@h/", ""):
            with self.subTest(url=url):
                with self.assertRaises(respaldar.ErrorRespaldo):
                    respaldar.entorno_pg(url, base={})

    def ejecutor(self, codigo=0, salida=b"VOLCADO"):
        llamadas = []

        def ejecutar(comando, **kwargs):
            llamadas.append((comando, kwargs))
            return subprocess.CompletedProcess(comando, codigo, stdout=salida, stderr=b"")

        ejecutar.llamadas = llamadas
        return ejecutar

    def test_respaldar_cifra_el_volcado_en_un_enc(self):
        ejecutar = self.ejecutor()
        with TemporaryDirectory() as tmp:
            archivo = respaldar.respaldar(
                self.URL,
                tmp,
                bytes.fromhex(CLAVE_HEX),
                ejecutar=ejecutar,
                ahora=datetime(2026, 3, 2, 12, 0, 5, tzinfo=timezone.utc),
            )
            self.assertEqual(archivo.name, "respaldo-20260302-120005.enc")
            self.assertEqual(
                respaldar.descifrar(archivo.read_bytes(), bytes.fromhex(CLAVE_HEX)), b"VOLCADO"
            )
        comando, kwargs = ejecutar.llamadas[0]
        self.assertEqual(comando[0], "pg_dump")
        self.assertNotIn("p@ss", " ".join(comando))
        self.assertEqual(kwargs["env"]["PGPASSWORD"], "p@ss")

    def test_pg_dump_con_error_no_deja_archivo(self):
        with TemporaryDirectory() as tmp:
            with self.assertRaises(respaldar.ErrorRespaldo):
                respaldar.respaldar(
                    self.URL, tmp, bytes.fromhex(CLAVE_HEX), ejecutar=self.ejecutor(1)
                )
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_pg_dump_inexistente(self):
        def falta(*args, **kwargs):
            raise FileNotFoundError

        with self.assertRaises(respaldar.ErrorRespaldo):
            respaldar.volcar(self.URL, ejecutar=falta)

    def test_cli_respalda_y_descifra(self):
        entorno = {"RESPALDO_CLAVE_HEX": CLAVE_HEX, "DATABASE_URL": self.URL}
        with TemporaryDirectory() as tmp:
            with mock.patch.object(respaldar, "volcar", return_value=b"DUMP"):
                with mock.patch("sys.stdout", new=io.StringIO()):
                    self.assertEqual(respaldar.principal(["--salida", tmp], entorno), 0)
            archivo = next(Path(tmp).glob("*.enc"))
            destino = Path(tmp) / "volcado.dump"
            with mock.patch("sys.stdout", new=io.StringIO()):
                codigo = respaldar.principal(
                    ["--descifrar", str(archivo), "--salida", str(destino)], entorno
                )
            self.assertEqual(codigo, 0)
            self.assertEqual(destino.read_bytes(), b"DUMP")

    def test_cli_falla_sin_clave_o_sin_base(self):
        with mock.patch("sys.stderr", new=io.StringIO()):
            self.assertEqual(respaldar.principal([], {}), 1)
            self.assertEqual(respaldar.principal([], {"RESPALDO_CLAVE_HEX": CLAVE_HEX}), 1)


class CargarDatosFicticiosTests(TestCase):
    def ejecutar(self, *args):
        salida = io.StringIO()
        call_command("cargar_datos_ficticios", *args, stdout=salida)
        return salida.getvalue()

    @override_settings(DEBUG=True)
    def test_crea_la_cantidad_pedida_con_todas_las_entidades(self):
        salida = self.ejecutar("--cantidad", "4", "--semilla", "1")
        self.assertIn("4 pacientes", salida)
        self.assertEqual(Paciente.objects.count(), 4)
        self.assertEqual(Apoderado.objects.count(), 4)
        self.assertEqual(Cita.objects.count(), 12)
        self.assertEqual(RegistroSesion.objects.count(), 12)
        usuaria = get_user_model().objects.get(email="demo@ejemplo.cl")
        self.assertEqual(Paciente.objects.filter(propietaria=usuaria).count(), 4)
        for paciente in Paciente.objects.all():
            self.assertTrue(paciente.antecedentes.startswith("Dato ficticio"))
        for apoderado in Apoderado.objects.all():
            self.assertRegex(apoderado.telefono, r"^\+569\d{8}$")

    @override_settings(DEBUG=True)
    def test_la_clave_generada_cumple_la_complejidad_y_solo_se_muestra_al_crear(self):
        salida = self.ejecutar("--cantidad", "1")
        clave = salida.split(" / ")[1].splitlines()[0].strip()
        ValidadorComplejidad().validate(clave)
        self.assertTrue(get_user_model().objects.get(email="demo@ejemplo.cl").check_password(clave))
        self.assertNotIn(" / ", self.ejecutar("--cantidad", "1"))

    @override_settings(DEBUG=True)
    def test_cantidad_fuera_de_rango(self):
        for valor in ("0", "201", "-1"):
            with self.subTest(valor=valor):
                with self.assertRaises(CommandError):
                    self.ejecutar("--cantidad", valor)

    @override_settings(DEBUG=False)
    def test_se_niega_con_debug_false_salvo_forzar(self):
        with self.assertRaises(CommandError):
            self.ejecutar("--cantidad", "1")
        self.assertEqual(Paciente.objects.count(), 0)
        self.ejecutar("--cantidad", "1", "--forzar")
        self.assertEqual(Paciente.objects.count(), 1)
