"""Pruebas del motor de sincronización: orden, idempotencia, LWW, propiedad y restauración."""
import uuid

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from clinica.models import Apoderado, Cita, OperacionRecibida, Paciente, RegistroSesion
from cuentas.models import AceptacionPolitica

URL_SINCRONIZAR = "/api/clinica/sincronizar/"
URL_RESTAURAR = "/api/clinica/restaurar/"

T0 = "2026-03-02T12:00:00.000Z"
T1 = "2026-03-02T12:05:00.000Z"
T2 = "2026-03-02T12:10:00.000Z"

TEXTO_CLINICO = "CONTENIDO-CLINICO-SECRETO"


def nuevo_id():
    return str(uuid.uuid4())


def operacion(entidad, registro_id, datos, modificado_en=T0, tipo="crear", op_id=None):
    return {
        "op_id": op_id or nuevo_id(),
        "entidad": entidad,
        "registro_id": registro_id,
        "operacion": tipo,
        "modificado_en": modificado_en,
        "datos": {"id": registro_id, **datos},
    }


def datos_apoderado(**cambios):
    return {"nombre": "Apoderada Uno", "telefono": "+56912345678", **cambios}


def datos_paciente(**cambios):
    return {
        "apoderado_id": None,
        "nombre": "Paciente Uno",
        "fecha_nacimiento": "2018-05-04",
        "antecedentes": "",
        "motivo_consulta": "",
        "archivado": False,
        "creado_en": T0,
        "modificado_en": T0,
        **cambios,
    }


def datos_cita(paciente_id, **cambios):
    return {
        "paciente_id": paciente_id,
        "fecha_hora": "2026-03-03T15:00:00.000Z",
        "estado": "pendiente",
        "creado_en": T0,
        "modificado_en": T0,
        **cambios,
    }


def datos_registro(cita_id, **cambios):
    return {
        "cita_id": cita_id,
        "observaciones": "",
        "objetivos_cumplidos": "",
        "retroalimentacion_familia": "",
        "archivado": False,
        "creado_en": T0,
        "modificado_en": T0,
        **cambios,
    }


@override_settings(SECURE_SSL_REDIRECT=False)
class BaseSync(APITestCase):
    @classmethod
    def setUpTestData(cls):
        Usuaria = get_user_model()
        cls.usuaria = Usuaria.objects.create_user("terapeuta@ejemplo.cl", "Clave#Segura1")
        cls.otra = Usuaria.objects.create_user("otra@ejemplo.cl", "Clave#Segura2")
        cls.token = Token.objects.create(user=cls.usuaria)
        cls.token_otra = Token.objects.create(user=cls.otra)

    def setUp(self):
        self.autenticar(self.token)

    def autenticar(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def enviar(self, *operaciones):
        respuesta = self.client.post(
            URL_SINCRONIZAR, {"operaciones": list(operaciones)}, format="json"
        )
        self.assertEqual(respuesta.status_code, 200)
        return respuesta.json()["resultados"]

    def enviar_una(self, op):
        return self.enviar(op)[0]

    def crear_paciente(self, **cambios):
        paciente_id = nuevo_id()
        resultado = self.enviar_una(operacion("paciente", paciente_id, datos_paciente(**cambios)))
        self.assertEqual(resultado["estado"], "aplicada")
        return paciente_id

    def crear_cita(self, paciente_id):
        cita_id = nuevo_id()
        resultado = self.enviar_una(operacion("cita", cita_id, datos_cita(paciente_id)))
        self.assertEqual(resultado["estado"], "aplicada")
        return cita_id


class AutenticacionSyncTests(BaseSync):
    def test_sin_token_responde_401(self):
        self.client.credentials()
        self.assertEqual(self.client.post(URL_SINCRONIZAR, {}, format="json").status_code, 401)
        self.assertEqual(self.client.get(URL_RESTAURAR).status_code, 401)

    def test_no_admite_sesion_ni_autenticacion_basica(self):
        self.client.credentials()
        self.client.force_login(self.usuaria)
        self.assertEqual(self.client.get(URL_RESTAURAR).status_code, 401)

    def test_no_existe_delete_ni_otros_metodos(self):
        self.assertEqual(self.client.delete(URL_SINCRONIZAR).status_code, 405)
        self.assertEqual(self.client.get(URL_SINCRONIZAR).status_code, 405)
        self.assertEqual(self.client.delete(URL_RESTAURAR).status_code, 405)
        self.assertEqual(self.client.post(URL_RESTAURAR, {}, format="json").status_code, 405)

    def test_lote_mal_formado_responde_400(self):
        for cuerpo in ({}, {"operaciones": "x"}, [], {"operaciones": [{}] * 201}):
            respuesta = self.client.post(URL_SINCRONIZAR, cuerpo, format="json")
            self.assertEqual(respuesta.status_code, 400)


class OrdenSyncTests(BaseSync):
    def test_lote_completo_en_orden_crea_todas_las_entidades(self):
        apoderado_id, paciente_id, cita_id, registro_id = (nuevo_id() for _ in range(4))
        resultados = self.enviar(
            operacion("apoderado", apoderado_id, datos_apoderado()),
            operacion("paciente", paciente_id, datos_paciente(apoderado_id=apoderado_id)),
            operacion("cita", cita_id, datos_cita(paciente_id)),
            operacion("registro_sesion", registro_id, datos_registro(cita_id)),
        )
        self.assertEqual([r["estado"] for r in resultados], ["aplicada"] * 4)
        self.assertEqual([r["codigo_http"] for r in resultados], [200] * 4)
        paciente = Paciente.objects.get(pk=paciente_id)
        self.assertEqual(str(paciente.apoderado_id), apoderado_id)
        self.assertEqual(paciente.propietaria, self.usuaria)
        self.assertEqual(str(RegistroSesion.objects.get(pk=registro_id).cita_id), cita_id)

    def test_lote_desordenado_se_procesa_en_orden_de_dependencias(self):
        apoderado_id, paciente_id, cita_id, registro_id = (nuevo_id() for _ in range(4))
        ops = [
            operacion("registro_sesion", registro_id, datos_registro(cita_id)),
            operacion("cita", cita_id, datos_cita(paciente_id)),
            operacion("paciente", paciente_id, datos_paciente(apoderado_id=apoderado_id)),
            operacion("apoderado", apoderado_id, datos_apoderado()),
        ]
        resultados = self.enviar(*ops)
        self.assertEqual([r["estado"] for r in resultados], ["aplicada"] * 4)
        # Los resultados conservan el orden en que se enviaron las operaciones.
        self.assertEqual([r["op_id"] for r in resultados], [op["op_id"] for op in ops])
        self.assertTrue(RegistroSesion.objects.filter(pk=registro_id).exists())

    def test_operaciones_de_un_mismo_registro_se_aplican_en_orden_de_envio(self):
        paciente_id = nuevo_id()
        resultados = self.enviar(
            operacion("paciente", paciente_id, datos_paciente(nombre="Primero")),
            operacion(
                "paciente", paciente_id, datos_paciente(nombre="Segundo"), T1, "actualizar"
            ),
            operacion("paciente", paciente_id, datos_paciente(nombre="Segundo"), T2, "archivar"),
        )
        self.assertEqual([r["estado"] for r in resultados], ["aplicada"] * 3)
        paciente = Paciente.objects.get(pk=paciente_id)
        self.assertEqual(paciente.nombre, "Segundo")
        self.assertTrue(paciente.archivado)

    def test_hijo_sin_padre_se_rechaza_sin_afectar_al_resto(self):
        paciente_id = nuevo_id()
        huerfana = operacion("cita", nuevo_id(), datos_cita(nuevo_id()))
        resultados = self.enviar(
            huerfana, operacion("paciente", paciente_id, datos_paciente())
        )
        self.assertEqual(resultados[0]["estado"], "rechazada")
        self.assertEqual(resultados[0]["codigo_http"], 404)
        self.assertEqual(resultados[1]["estado"], "aplicada")
        self.assertEqual(Cita.objects.count(), 0)
        # La rechazada no queda registrada: puede reenviarse cuando exista el paciente.
        self.assertFalse(OperacionRecibida.objects.filter(pk=huerfana["op_id"]).exists())


class IdempotenciaSyncTests(BaseSync):
    def test_reenviar_el_mismo_op_id_responde_200_sin_duplicar(self):
        paciente_id = nuevo_id()
        op = operacion("paciente", paciente_id, datos_paciente())
        self.assertEqual(self.enviar_una(op)["estado"], "aplicada")

        repetida = self.enviar_una(op)

        self.assertEqual(repetida["estado"], "duplicada")
        self.assertEqual(repetida["codigo_http"], 200)
        self.assertEqual(Paciente.objects.count(), 1)
        self.assertEqual(OperacionRecibida.objects.count(), 1)
        recibida = OperacionRecibida.objects.get(pk=op["op_id"])
        self.assertEqual(recibida.propietaria, self.usuaria)
        self.assertIsNotNone(recibida.recibida_en)

    def test_un_op_id_repetido_no_vuelve_a_aplicar_datos_distintos(self):
        paciente_id = nuevo_id()
        op = operacion("paciente", paciente_id, datos_paciente(nombre="Original"))
        self.enviar_una(op)
        alterada = {**op, "modificado_en": T2, "datos": datos_paciente(nombre="Alterado")}

        self.assertEqual(self.enviar_una(alterada)["estado"], "duplicada")
        self.assertEqual(Paciente.objects.get(pk=paciente_id).nombre, "Original")

    def test_op_id_repetido_dentro_del_mismo_lote(self):
        paciente_id = nuevo_id()
        op = operacion("paciente", paciente_id, datos_paciente())
        resultados = self.enviar(op, op)
        self.assertEqual([r["estado"] for r in resultados], ["aplicada", "duplicada"])
        self.assertEqual(Paciente.objects.count(), 1)

    def test_operacion_rechazada_se_puede_corregir_y_reenviar_con_el_mismo_op_id(self):
        paciente_id = nuevo_id()
        op = operacion("paciente", paciente_id, datos_paciente(nombre=""))
        rechazada = self.enviar_una(op)
        self.assertEqual((rechazada["estado"], rechazada["codigo_http"]), ("rechazada", 400))
        self.assertEqual(OperacionRecibida.objects.count(), 0)
        self.assertEqual(Paciente.objects.count(), 0)

        corregida = {**op, "datos": datos_paciente(nombre="Ahora sí")}
        self.assertEqual(self.enviar_una(corregida)["estado"], "aplicada")

    def test_op_id_de_otra_usuaria_no_se_reutiliza(self):
        op = operacion("paciente", nuevo_id(), datos_paciente())
        self.enviar_una(op)
        self.autenticar(self.token_otra)
        ajena = operacion("paciente", nuevo_id(), datos_paciente(), op_id=op["op_id"])

        self.assertEqual(self.enviar_una(ajena)["estado"], "rechazada")
        self.assertEqual(Paciente.objects.filter(propietaria=self.otra).count(), 0)


class LwwSyncTests(BaseSync):
    def test_gana_la_modificacion_mas_reciente(self):
        paciente_id = self.crear_paciente(nombre="Inicial")
        nueva = operacion(
            "paciente", paciente_id, datos_paciente(nombre="Reciente"), T2, "actualizar"
        )
        self.assertEqual(self.enviar_una(nueva)["estado"], "aplicada")
        paciente = Paciente.objects.get(pk=paciente_id)
        self.assertEqual(paciente.nombre, "Reciente")
        self.assertEqual(paciente.modificado_en.isoformat(), "2026-03-02T12:10:00+00:00")

    def test_una_modificacion_mas_antigua_pierde_y_no_cambia_nada(self):
        paciente_id = self.crear_paciente(nombre="Inicial")
        self.enviar_una(
            operacion("paciente", paciente_id, datos_paciente(nombre="Reciente"), T2, "actualizar")
        )
        vieja = operacion(
            "paciente", paciente_id, datos_paciente(nombre="Atrasada"), T1, "actualizar"
        )

        resultado = self.enviar_una(vieja)

        self.assertEqual(resultado["estado"], "conflicto")
        paciente = Paciente.objects.get(pk=paciente_id)
        self.assertEqual(paciente.nombre, "Reciente")
        self.assertEqual(paciente.modificado_en.isoformat(), "2026-03-02T12:10:00+00:00")
        # El conflicto es definitivo: reenviarla no la reprocesa.
        self.assertEqual(self.enviar_una(vieja)["estado"], "duplicada")

    def test_en_el_empate_gana_la_ultima_en_llegar(self):
        paciente_id = self.crear_paciente(nombre="Inicial")
        primera = operacion(
            "paciente", paciente_id, datos_paciente(nombre="Llegó primero"), T1, "actualizar"
        )
        segunda = operacion(
            "paciente", paciente_id, datos_paciente(nombre="Llegó después"), T1, "actualizar"
        )
        self.assertEqual(self.enviar_una(primera)["estado"], "aplicada")
        self.assertEqual(self.enviar_una(segunda)["estado"], "aplicada")

        self.assertEqual(Paciente.objects.get(pk=paciente_id).nombre, "Llegó después")
        recibidas = OperacionRecibida.objects.order_by("recibida_en")
        self.assertEqual(str(recibidas.last().pk), segunda["op_id"])

    def test_lww_tambien_rige_para_citas_y_registros(self):
        cita_id = self.crear_cita(self.crear_paciente())
        registro_id = nuevo_id()
        self.enviar(
            operacion("cita", cita_id, self._cita(cita_id, "confirmada"), T2, "actualizar"),
            operacion("registro_sesion", registro_id, datos_registro(cita_id), T2),
        )
        resultados = self.enviar(
            operacion("cita", cita_id, self._cita(cita_id, "cancelada"), T1, "actualizar"),
            operacion(
                "registro_sesion",
                registro_id,
                datos_registro(cita_id, observaciones="atrasada"),
                T1,
                "actualizar",
            ),
        )
        self.assertEqual([r["estado"] for r in resultados], ["conflicto", "conflicto"])
        self.assertEqual(Cita.objects.get(pk=cita_id).estado, "confirmada")
        self.assertEqual(RegistroSesion.objects.get(pk=registro_id).observaciones, "")

    def _cita(self, cita_id, estado):
        paciente_id = str(Cita.objects.get(pk=cita_id).paciente_id)
        return datos_cita(paciente_id, estado=estado)

    def test_actualizar_no_altera_la_fecha_de_creacion(self):
        paciente_id = self.crear_paciente()
        self.enviar_una(
            operacion("paciente", paciente_id, datos_paciente(creado_en=T2), T2, "actualizar")
        )
        creado = Paciente.objects.get(pk=paciente_id).creado_en
        self.assertEqual(creado.isoformat(), "2026-03-02T12:00:00+00:00")


class PropiedadSyncTests(BaseSync):
    def test_la_propietaria_del_payload_se_ignora(self):
        paciente_id = nuevo_id()
        datos = datos_paciente(propietaria_id=self.otra.pk, propietaria=self.otra.pk)
        self.assertEqual(
            self.enviar_una(operacion("paciente", paciente_id, datos))["estado"], "aplicada"
        )
        self.assertEqual(Paciente.objects.get(pk=paciente_id).propietaria, self.usuaria)

        apoderado_id = nuevo_id()
        self.enviar_una(
            operacion("apoderado", apoderado_id, datos_apoderado(propietaria_id=self.otra.pk))
        )
        self.assertEqual(Apoderado.objects.get(pk=apoderado_id).propietaria, self.usuaria)

    def test_fk_de_otra_usuaria_se_trata_como_inexistente(self):
        apoderado_id = nuevo_id()
        paciente_id = self.crear_paciente()
        cita_id = self.crear_cita(paciente_id)
        self.enviar_una(operacion("apoderado", apoderado_id, datos_apoderado()))

        self.autenticar(self.token_otra)
        resultados = self.enviar(
            operacion("paciente", nuevo_id(), datos_paciente(apoderado_id=apoderado_id)),
            operacion("cita", nuevo_id(), datos_cita(paciente_id)),
            operacion("registro_sesion", nuevo_id(), datos_registro(cita_id)),
        )

        self.assertEqual([r["estado"] for r in resultados], ["rechazada"] * 3)
        self.assertEqual([r["codigo_http"] for r in resultados], [404] * 3)
        self.assertEqual(Paciente.objects.filter(propietaria=self.otra).count(), 0)
        self.assertEqual(Cita.objects.count(), 1)
        self.assertEqual(RegistroSesion.objects.count(), 0)

    def test_registro_de_otra_usuaria_no_se_puede_modificar_ni_archivar(self):
        paciente_id = self.crear_paciente(nombre="Mío")
        cita_id = self.crear_cita(paciente_id)
        paciente_otra = self._paciente_de_otra()

        resultados = self._como_otra(
            operacion(
                "paciente", paciente_id, datos_paciente(nombre="Robado"), T2, "actualizar"
            ),
            operacion("paciente", paciente_id, datos_paciente(), T2, "archivar"),
            operacion("cita", cita_id, datos_cita(paciente_otra, estado="cancelada"), T2),
        )

        self.assertEqual([r["codigo_http"] for r in resultados], [404] * 3)
        paciente = Paciente.objects.get(pk=paciente_id)
        self.assertEqual((paciente.nombre, paciente.archivado), ("Mío", False))
        self.assertEqual(paciente.propietaria, self.usuaria)
        cita = Cita.objects.get(pk=cita_id)
        self.assertEqual((cita.estado, str(cita.paciente_id)), ("pendiente", paciente_id))

    def _paciente_de_otra(self):
        self.autenticar(self.token_otra)
        paciente_id = self.crear_paciente(nombre="De otra")
        self.autenticar(self.token)
        return paciente_id

    def _como_otra(self, *operaciones):
        self.autenticar(self.token_otra)
        try:
            return self.enviar(*operaciones)
        finally:
            self.autenticar(self.token)

    def test_no_existe_operacion_de_eliminacion(self):
        paciente_id = self.crear_paciente()
        for tipo in ("eliminar", "delete", "", None):
            resultado = self.enviar_una(
                operacion("paciente", paciente_id, datos_paciente(), T2, tipo or "x")
                | {"operacion": tipo}
            )
            self.assertEqual((resultado["estado"], resultado["codigo_http"]), ("rechazada", 400))
        self.assertTrue(Paciente.objects.filter(pk=paciente_id, archivado=False).exists())

    def test_archivar_marca_archivado_sin_borrar(self):
        paciente_id = self.crear_paciente()
        archivar = operacion(
            "paciente", paciente_id, datos_paciente(archivado=False), T1, "archivar"
        )
        self.assertEqual(self.enviar_una(archivar)["estado"], "aplicada")
        self.assertTrue(Paciente.objects.get(pk=paciente_id).archivado)
        # Una cita no tiene archivado: la operación no aplica.
        cita_id = self.crear_cita(paciente_id)
        resultado = self.enviar_una(
            operacion("cita", cita_id, datos_cita(paciente_id), T1, "archivar")
        )
        self.assertEqual(resultado["estado"], "rechazada")

    def test_una_cita_admite_un_solo_registro_de_sesion(self):
        cita_id = self.crear_cita(self.crear_paciente())
        primero = operacion("registro_sesion", nuevo_id(), datos_registro(cita_id))
        segundo = operacion("registro_sesion", nuevo_id(), datos_registro(cita_id))
        resultados = self.enviar(primero, segundo)
        self.assertEqual(resultados[0]["estado"], "aplicada")
        self.assertEqual(resultados[1]["estado"], "rechazada")
        self.assertEqual(resultados[1]["codigo_http"], 409)
        self.assertEqual(RegistroSesion.objects.count(), 1)

    def test_datos_invalidos_se_rechazan_por_item(self):
        paciente_id = self.crear_paciente()
        invalidas = [
            operacion("apoderado", nuevo_id(), datos_apoderado(telefono="12345")),
            operacion("cita", nuevo_id(), datos_cita(paciente_id, estado="inventado")),
            operacion("paciente", "no-es-uuid", datos_paciente()),
            operacion("paciente", nuevo_id(), datos_paciente(), modificado_en="ayer"),
            operacion("paciente", nuevo_id(), datos_paciente(), modificado_en=T0[:-1]),
            operacion("desconocida", nuevo_id(), {}),
            {**operacion("paciente", nuevo_id(), datos_paciente()), "datos": "texto"},
            {**operacion("paciente", nuevo_id(), datos_paciente()), "op_id": "x"},
            "no es un objeto",
        ]
        valida = operacion("apoderado", nuevo_id(), datos_apoderado(telefono=None))
        resultados = self.enviar(*invalidas, valida)
        self.assertEqual([r["estado"] for r in resultados[:-1]], ["rechazada"] * len(invalidas))
        self.assertEqual([r["codigo_http"] for r in resultados[:-1]], [400] * len(invalidas))
        self.assertEqual(resultados[-1]["estado"], "aplicada")
        self.assertEqual(Apoderado.objects.count(), 1)
        self.assertEqual(OperacionRecibida.objects.count(), 2)

    def test_aceptacion_de_politica_se_asigna_a_la_usuaria_del_token(self):
        aceptacion_id = nuevo_id()
        datos = {"usuaria_id": None, "version": "1.0", "aceptada_en": T0}
        op = operacion("aceptacion_politica", aceptacion_id, datos)
        self.assertEqual(self.enviar_una(op)["estado"], "aplicada")
        aceptacion = AceptacionPolitica.objects.get(pk=aceptacion_id)
        self.assertEqual((aceptacion.usuaria, aceptacion.version), (self.usuaria, "1.0"))


class LogsSyncTests(BaseSync):
    def test_los_logs_no_contienen_datos_clinicos(self):
        paciente_id = nuevo_id()
        with self.assertLogs("clinica", level="DEBUG") as capturados:
            self.enviar(
                operacion(
                    "paciente",
                    paciente_id,
                    datos_paciente(nombre=TEXTO_CLINICO, antecedentes=TEXTO_CLINICO),
                ),
                operacion("cita", nuevo_id(), datos_cita(nuevo_id(), estado=TEXTO_CLINICO)),
                {"op_id": TEXTO_CLINICO, "entidad": TEXTO_CLINICO, "datos": TEXTO_CLINICO},
            )
            self.client.get(URL_RESTAURAR)
        salida = "\n".join(capturados.output)
        self.assertIn("aplicadas=1", salida)
        self.assertIn("rechazadas=2", salida)
        self.assertNotIn(TEXTO_CLINICO, salida)
        self.assertNotIn(paciente_id, salida)

    def test_la_respuesta_de_un_rechazo_no_repite_los_datos_enviados(self):
        rechazable = operacion("paciente", nuevo_id(), {"nombre": "", "x": TEXTO_CLINICO})
        respuesta = self.client.post(URL_SINCRONIZAR, {"operaciones": [rechazable]}, format="json")
        self.assertNotIn(TEXTO_CLINICO, respuesta.content.decode())


class RestaurarTests(BaseSync):
    def test_devuelve_todos_los_datos_propios_incluidos_los_archivados(self):
        apoderado_id, paciente_id, cita_id, registro_id = (nuevo_id() for _ in range(4))
        self.enviar(
            operacion("apoderado", apoderado_id, datos_apoderado()),
            operacion("paciente", paciente_id, datos_paciente(apoderado_id=apoderado_id)),
            operacion("cita", cita_id, datos_cita(paciente_id)),
            operacion(
                "registro_sesion", registro_id, datos_registro(cita_id, observaciones="obs")
            ),
            operacion(
                "paciente",
                paciente_id,
                datos_paciente(apoderado_id=apoderado_id),
                T1,
                "archivar",
            ),
        )

        respuesta = self.client.get(URL_RESTAURAR)

        self.assertEqual(respuesta.status_code, 200)
        cuerpo = respuesta.json()
        self.assertEqual(
            sorted(cuerpo), ["apoderados", "citas", "pacientes", "registros_sesion"]
        )
        self.assertEqual(
            cuerpo["apoderados"],
            [
                {
                    "id": apoderado_id,
                    "propietaria_id": self.usuaria.pk,
                    "nombre": "Apoderada Uno",
                    "telefono": "+56912345678",
                }
            ],
        )
        [paciente] = cuerpo["pacientes"]
        self.assertEqual(paciente["id"], paciente_id)
        self.assertEqual(paciente["apoderado_id"], apoderado_id)
        self.assertEqual(paciente["fecha_nacimiento"], "2018-05-04")
        self.assertTrue(paciente["archivado"])
        self.assertEqual(paciente["modificado_en"], "2026-03-02T12:05:00Z")
        [cita] = cuerpo["citas"]
        self.assertEqual((cita["id"], cita["paciente_id"]), (cita_id, paciente_id))
        self.assertEqual(cita["estado"], "pendiente")
        [registro] = cuerpo["registros_sesion"]
        self.assertEqual((registro["id"], registro["cita_id"]), (registro_id, cita_id))
        self.assertEqual(registro["observaciones"], "obs")

    def test_no_incluye_datos_de_otras_usuarias(self):
        paciente_id = self.crear_paciente(nombre=TEXTO_CLINICO)
        cita_id = self.crear_cita(paciente_id)
        self.enviar_una(operacion("registro_sesion", nuevo_id(), datos_registro(cita_id)))
        self.enviar_una(operacion("apoderado", nuevo_id(), datos_apoderado()))

        self.autenticar(self.token_otra)
        respuesta = self.client.get(URL_RESTAURAR)

        self.assertEqual(
            respuesta.json(),
            {"apoderados": [], "pacientes": [], "citas": [], "registros_sesion": []},
        )
        self.assertNotIn(TEXTO_CLINICO, respuesta.content.decode())
