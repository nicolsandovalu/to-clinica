"""Pruebas de seguridad de la API: AUZ-01..06 y AUT-01..06 (OWASP Top 10:2025)."""
import importlib
import uuid

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.urls import clear_url_caches, resolve, reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from clinica.models import Apoderado, Cita, Paciente, RegistroSesion

URL_LOGIN = "/api/cuentas/login/"
URL_LOGOUT = "/api/cuentas/logout/"
T0 = "2026-03-02T12:00:00Z"
CLAVE_A = "Clave#Segura1"
CLAVE_B = "Clave#Segura2"
GENERICO = "Correo o contraseña incorrectos."

RECURSOS = ["apoderados", "pacientes", "citas", "registros"]


def url(recurso, pk=None):
    base = f"/api/clinica/{recurso}/"
    return base if pk is None else f"{base}{pk}/"


@override_settings(SECURE_SSL_REDIRECT=False)
class BaseSeguridad(APITestCase):
    @classmethod
    def setUpTestData(cls):
        Usuaria = get_user_model()
        cls.a = Usuaria.objects.create_user("a@ejemplo.cl", CLAVE_A)
        cls.b = Usuaria.objects.create_user("b@ejemplo.cl", CLAVE_B)
        cls.token_a = Token.objects.create(user=cls.a)
        cls.token_b = Token.objects.create(user=cls.b)
        # Datos de B: ninguna petición de A debe poder verlos ni tocarlos.
        cls.apoderado_b = Apoderado.objects.create(propietaria=cls.b, nombre="Apoderado B")
        cls.paciente_b = Paciente.objects.create(
            propietaria=cls.b, nombre="Paciente B", creado_en=T0, modificado_en=T0
        )
        cls.cita_b = Cita.objects.create(
            paciente=cls.paciente_b, fecha_hora=T0, creado_en=T0, modificado_en=T0
        )
        cls.registro_b = RegistroSesion.objects.create(
            cita=cls.cita_b, observaciones="SECRETO-DE-B", creado_en=T0, modificado_en=T0
        )
        cls.ids_b = {
            "apoderados": cls.apoderado_b.pk,
            "pacientes": cls.paciente_b.pk,
            "citas": cls.cita_b.pk,
            "registros": cls.registro_b.pk,
        }

    def setUp(self):
        cache.clear()  # reinicia el límite de tasa de login

    def como(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")


class AutenticacionObligatoriaTests(BaseSeguridad):
    """AUZ-01: sin token válido, 401 en toda la API (excepto login y /salud/)."""

    def rutas_protegidas(self):
        rutas = [url(r) for r in RECURSOS] + [url(r, self.ids_b[r]) for r in RECURSOS]
        rutas += ["/api/clinica/sincronizar/", "/api/clinica/restaurar/", URL_LOGOUT]
        return rutas

    def test_sin_token_responde_401(self):
        for ruta in self.rutas_protegidas():
            for metodo in ("get", "post"):
                with self.subTest(ruta=ruta, metodo=metodo):
                    respuesta = getattr(self.client, metodo)(ruta, {}, format="json")
                    self.assertEqual(respuesta.status_code, 401)

    def test_token_invalido_responde_401(self):
        self.client.credentials(HTTP_AUTHORIZATION="Token " + "0" * 40)
        for recurso in RECURSOS:
            with self.subTest(recurso=recurso):
                self.assertEqual(self.client.get(url(recurso)).status_code, 401)

    def test_sesion_de_django_no_autentica_la_api(self):
        """AUT-06: solo TokenAuthentication; una cookie de sesión no sirve."""
        self.client.force_login(self.a)
        self.assertEqual(self.client.get(url("pacientes")).status_code, 401)

    def test_delete_sin_token_es_401_y_no_405(self):
        """La autenticación va antes que el método: no se filtra qué rutas existen."""
        ruta = url("pacientes", self.ids_b["pacientes"])
        self.assertEqual(self.client.delete(ruta).status_code, 401)


class AislamientoEntreUsuariasTests(BaseSeguridad):
    """AUZ-02: un ID ajeno devuelve 404 (nunca 403 ni 200)."""

    def setUp(self):
        super().setUp()
        self.como(self.token_a)

    def test_get_de_id_ajeno_es_404(self):
        for recurso in RECURSOS:
            with self.subTest(recurso=recurso):
                respuesta = self.client.get(url(recurso, self.ids_b[recurso]))
                self.assertEqual(respuesta.status_code, 404)
                self.assertNotIn("SECRETO-DE-B", respuesta.content.decode())

    def test_patch_y_put_de_id_ajeno_es_404_y_no_modifican(self):
        for recurso in RECURSOS:
            for metodo in ("patch", "put"):
                with self.subTest(recurso=recurso, metodo=metodo):
                    respuesta = getattr(self.client, metodo)(
                        url(recurso, self.ids_b[recurso]), {"nombre": "Hackeado"}, format="json"
                    )
                    self.assertEqual(respuesta.status_code, 404)
        self.paciente_b.refresh_from_db()
        self.assertEqual(self.paciente_b.nombre, "Paciente B")

    def test_listados_solo_incluyen_lo_propio(self):
        propio = self.client.post(url("pacientes"), {"nombre": "Paciente A"}, format="json").json()
        respuesta = self.client.get(url("pacientes"))
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual([p["id"] for p in respuesta.json()], [propio["id"]])
        for recurso in ("apoderados", "citas", "registros"):
            with self.subTest(recurso=recurso):
                self.assertEqual(self.client.get(url(recurso)).json(), [])

    def test_quien_es_duena_si_ve_su_recurso(self):
        self.como(self.token_b)
        for recurso in RECURSOS:
            with self.subTest(recurso=recurso):
                respuesta = self.client.get(url(recurso, self.ids_b[recurso]))
                self.assertEqual(respuesta.status_code, 200)

    def test_id_inexistente_tambien_es_404(self):
        self.assertEqual(self.client.get(url("pacientes", uuid.uuid4())).status_code, 404)


class AsignacionYRelacionesTests(BaseSeguridad):
    """AUZ-03 / AUZ-04: la propietaria la fija el servidor y las FK deben ser propias."""

    def setUp(self):
        super().setUp()
        self.como(self.token_a)

    def test_propietaria_del_payload_se_ignora(self):
        respuesta = self.client.post(
            url("pacientes"),
            {"nombre": "Mío", "propietaria": self.b.pk, "propietaria_id": self.b.pk},
            format="json",
        )
        self.assertEqual(respuesta.status_code, 201)
        paciente = Paciente.objects.get(pk=respuesta.json()["id"])
        self.assertEqual(paciente.propietaria, self.a)
        self.assertNotIn("propietaria", respuesta.json())

    def test_paciente_ajeno_en_cita_es_rechazado(self):
        respuesta = self.client.post(
            url("citas"), {"paciente": str(self.paciente_b.pk), "fecha_hora": T0}, format="json"
        )
        self.assertEqual(respuesta.status_code, 400)
        otras = Cita.objects.filter(paciente=self.paciente_b).exclude(pk=self.cita_b.pk)
        self.assertFalse(otras.exists())

    def test_cita_ajena_en_registro_es_rechazada(self):
        respuesta = self.client.post(
            url("registros"), {"cita": str(self.cita_b.pk), "observaciones": "x"}, format="json"
        )
        self.assertEqual(respuesta.status_code, 400)

    def test_apoderado_ajeno_en_paciente_es_rechazado(self):
        respuesta = self.client.post(
            url("pacientes"),
            {"nombre": "P", "apoderado": str(self.apoderado_b.pk)},
            format="json",
        )
        self.assertEqual(respuesta.status_code, 400)

    def test_no_se_puede_reasignar_a_paciente_ajeno_al_editar(self):
        propio = self.client.post(url("pacientes"), {"nombre": "A"}, format="json").json()
        cita = self.client.post(
            url("citas"), {"paciente": propio["id"], "fecha_hora": T0}, format="json"
        ).json()
        respuesta = self.client.patch(
            url("citas", cita["id"]), {"paciente": str(self.paciente_b.pk)}, format="json"
        )
        self.assertEqual(respuesta.status_code, 400)

    def test_flujo_propio_completo_y_archivado_logico(self):
        paciente = self.client.post(url("pacientes"), {"nombre": "Ana"}, format="json").json()
        cita = self.client.post(
            url("citas"), {"paciente": paciente["id"], "fecha_hora": T0}, format="json"
        ).json()
        registro = self.client.post(
            url("registros"), {"cita": cita["id"], "observaciones": "ok"}, format="json"
        )
        self.assertEqual(registro.status_code, 201)
        repetido = self.client.post(url("registros"), {"cita": cita["id"]}, format="json")
        self.assertEqual(repetido.status_code, 400)
        archivado = self.client.patch(
            url("pacientes", paciente["id"]), {"archivado": True}, format="json"
        )
        self.assertEqual(archivado.status_code, 200)
        self.assertTrue(Paciente.objects.get(pk=paciente["id"]).archivado)

    def test_id_de_cliente_se_respeta_y_no_se_puede_cambiar_ni_duplicar(self):
        nuevo = str(uuid.uuid4())
        creado = self.client.post(url("pacientes"), {"id": nuevo, "nombre": "A"}, format="json")
        self.assertEqual(creado.status_code, 201)
        self.assertEqual(creado.json()["id"], nuevo)
        cambio = self.client.patch(
            url("pacientes", nuevo), {"id": str(uuid.uuid4())}, format="json"
        )
        self.assertEqual(cambio.status_code, 400)
        # Reutilizar el id de otra usuaria no revela ni pisa su registro.
        ajeno = self.client.post(
            url("pacientes"), {"id": str(self.paciente_b.pk), "nombre": "Pisado"}, format="json"
        )
        self.assertEqual(ajeno.status_code, 400)
        self.paciente_b.refresh_from_db()
        self.assertEqual(self.paciente_b.nombre, "Paciente B")

    def test_telefono_de_apoderado_se_valida(self):
        malo = self.client.post(
            url("apoderados"), {"nombre": "X", "telefono": "12345"}, format="json"
        )
        self.assertEqual(malo.status_code, 400)
        bueno = self.client.post(
            url("apoderados"), {"nombre": "X", "telefono": "+56912345678"}, format="json"
        )
        self.assertEqual(bueno.status_code, 201)
        vacio = self.client.post(url("apoderados"), {"nombre": "Y", "telefono": ""}, format="json")
        self.assertIsNone(vacio.json()["telefono"])


class SinEliminacionTests(BaseSeguridad):
    """AUZ-05: DELETE no existe en ninguna entidad clínica (405)."""

    def test_delete_responde_405_y_conserva_los_datos(self):
        self.como(self.token_b)
        for recurso in RECURSOS:
            with self.subTest(recurso=recurso):
                respuesta = self.client.delete(url(recurso, self.ids_b[recurso]))
                self.assertEqual(respuesta.status_code, 405)
        self.assertTrue(Paciente.objects.filter(pk=self.paciente_b.pk).exists())
        self.assertTrue(RegistroSesion.objects.filter(pk=self.registro_b.pk).exists())

    def test_delete_de_id_ajeno_tambien_es_405_sin_filtrar_existencia(self):
        self.como(self.token_a)
        ruta = url("pacientes", self.ids_b["pacientes"])
        self.assertEqual(self.client.delete(ruta).status_code, 405)
        self.assertEqual(self.client.delete(url("pacientes", uuid.uuid4())).status_code, 405)

    def test_delete_sobre_la_coleccion_es_405(self):
        self.como(self.token_a)
        for recurso in RECURSOS:
            with self.subTest(recurso=recurso):
                self.assertEqual(self.client.delete(url(recurso)).status_code, 405)

    def test_metodos_permitidos_declarados(self):
        from clinica.views import ViewSetPropio

        self.assertEqual(ViewSetPropio.http_method_names, ["get", "post", "put", "patch"])


class AdminYSaludTests(BaseSeguridad):
    def test_salud_es_publico(self):
        respuesta = self.client.get("/salud/")
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json(), {"estado": "ok"})

    def test_salud_no_expone_datos(self):
        self.assertEqual(set(self.client.get("/salud/").json()), {"estado"})

    def test_admin_no_se_publica_con_debug_false(self):
        import config.urls

        with override_settings(DEBUG=False):
            try:
                importlib.reload(config.urls)
                clear_url_caches()
                self.assertEqual(self.client.get("/admin/").status_code, 404)
            finally:
                importlib.reload(config.urls)
                clear_url_caches()

    def test_admin_se_publica_solo_con_debug_true(self):
        import config.urls

        with override_settings(DEBUG=True):
            try:
                importlib.reload(config.urls)
                clear_url_caches()
                self.assertEqual(resolve("/admin/").app_name, "admin")
            finally:
                importlib.reload(config.urls)
                clear_url_caches()

    def test_rutas_con_nombre(self):
        self.assertEqual(reverse("salud"), "/salud/")


class LoginTests(BaseSeguridad):
    def intentar(self, email, password):
        return self.client.post(URL_LOGIN, {"email": email, "password": password}, format="json")

    def test_login_correcto_devuelve_token_y_usuaria(self):
        respuesta = self.intentar("a@ejemplo.cl", CLAVE_A)
        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(cuerpo["token"], self.token_a.key)
        self.assertEqual(cuerpo["usuaria"], {"id": self.a.pk, "email": "a@ejemplo.cl"})
        self.assertNotIn("password", respuesta.content.decode())

    def test_error_generico_igual_para_clave_mala_y_correo_inexistente(self):
        mala = self.intentar("a@ejemplo.cl", "otra-clave")
        inexistente = self.intentar("nadie@ejemplo.cl", CLAVE_A)
        self.assertEqual(mala.status_code, 400)
        self.assertEqual(inexistente.status_code, 400)
        self.assertEqual(mala.json(), {"detail": GENERICO})
        self.assertEqual(inexistente.json(), mala.json())

    def test_cuerpo_invalido_recibe_el_mismo_error_generico(self):
        for cuerpo in ({}, {"email": "a@ejemplo.cl"}, {"email": 1, "password": 2}, [1, 2]):
            with self.subTest(cuerpo=cuerpo):
                respuesta = self.client.post(URL_LOGIN, cuerpo, format="json")
                self.assertEqual(respuesta.status_code, 400)
                self.assertEqual(respuesta.json(), {"detail": GENERICO})

    def test_usuaria_inactiva_no_ingresa(self):
        self.a.is_active = False
        self.a.save()
        self.assertEqual(self.intentar("a@ejemplo.cl", CLAVE_A).json(), {"detail": GENERICO})

    def test_rate_limit_5_por_minuto_responde_429(self):
        for _ in range(5):
            self.assertEqual(self.intentar("a@ejemplo.cl", "mala").status_code, 400)
        bloqueada = self.intentar("a@ejemplo.cl", "mala")
        self.assertEqual(bloqueada.status_code, 429)
        # Una vez excedido el límite, ni siquiera la clave correcta entra.
        self.assertEqual(self.intentar("a@ejemplo.cl", CLAVE_A).status_code, 429)

    def test_login_solo_acepta_post(self):
        self.assertEqual(self.client.get(URL_LOGIN).status_code, 405)


class LogoutTests(BaseSeguridad):
    def test_logout_revoca_el_token(self):
        self.como(self.token_a)
        self.assertEqual(self.client.get(url("pacientes")).status_code, 200)
        self.assertEqual(self.client.post(URL_LOGOUT).status_code, 204)
        self.assertFalse(Token.objects.filter(user=self.a).exists())
        # El mismo token ya no sirve.
        self.assertEqual(self.client.get(url("pacientes")).status_code, 401)

    def test_logout_no_afecta_a_otras_usuarias(self):
        self.como(self.token_a)
        self.client.post(URL_LOGOUT)
        self.assertTrue(Token.objects.filter(user=self.b).exists())

    def test_se_puede_volver_a_iniciar_sesion(self):
        self.como(self.token_a)
        self.client.post(URL_LOGOUT)
        self.client.credentials()
        respuesta = self.client.post(
            URL_LOGIN, {"email": "a@ejemplo.cl", "password": CLAVE_A}, format="json"
        )
        self.assertEqual(respuesta.status_code, 200)
        self.como(Token.objects.get(user=self.a))
        self.assertEqual(self.client.get(url("pacientes")).status_code, 200)
