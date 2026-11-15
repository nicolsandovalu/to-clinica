"""
Motor de sincronización offline (CLAUDE.md §3).

`POST /api/clinica/sincronizar/` recibe un lote de operaciones del outbox del
teléfono y responde siempre HTTP 200 con un resultado por operación, en el
mismo orden en que llegaron:

    { "operaciones": [ { op_id, entidad, registro_id, operacion, modificado_en, datos } ] }
    -> { "resultados": [ { op_id, estado, codigo_http, codigo } ] }

Estados: `aplicada`, `duplicada` (op_id ya recibido), `conflicto` (LWW: gana la
versión del servidor) y `rechazada`. Los tres primeros son definitivos y el
cliente retira la operación de su cola; una rechazada no deja ningún rastro
(ni datos ni `OperacionRecibida`) y puede reenviarse.

Reglas:
- Cada operación corre en su propia transacción atómica.
- La propietaria es siempre `request.user`; se ignora la del payload (AUZ-03).
- Un registro o una FK de otra usuaria se trata como inexistente: 404 (AUZ-02/04).
- No existe eliminación: solo `crear`, `actualizar` y `archivar` (Ley 20.584).
- LWW: se aplica la operación si su `modificado_en` es mayor o igual al guardado.
  En el empate gana la última en llegar (mayor `recibida_en`), es decir, la
  entrante. Las entidades sin `modificado_en` se resuelven por orden de llegada.
- CS-07: los logs solo llevan identificadores, entidad y códigos; nunca `datos`.
"""
import logging
import uuid

from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from cuentas.models import AceptacionPolitica

from .models import Apoderado, Cita, OperacionRecibida, Paciente, RegistroSesion

logger = logging.getLogger(__name__)

MAX_OPERACIONES_POR_LOTE = 200
ORDEN_ENTIDADES = ["aceptacion_politica", "apoderado", "paciente", "cita", "registro_sesion"]
OPERACIONES = {"crear", "actualizar", "archivar"}

APLICADA = "aplicada"
DUPLICADA = "duplicada"
CONFLICTO = "conflicto"
RECHAZADA = "rechazada"


class Rechazo(Exception):
    """La operación no se aplica; la transacción del ítem se revierte."""

    def __init__(self, codigo, codigo_http):
        super().__init__(codigo)
        self.codigo = codigo
        self.codigo_http = codigo_http


def _invalido():
    return Rechazo("validacion", status.HTTP_400_BAD_REQUEST)


def _no_encontrado():
    return Rechazo("no_encontrado", status.HTTP_404_NOT_FOUND)


# ---------- Validación de `datos` ----------
# Solo se declaran los campos que el cliente puede fijar: `id` y `propietaria`
# enviados en el payload se descartan.


class _DatosAceptacion(serializers.ModelSerializer):
    class Meta:
        model = AceptacionPolitica
        fields = ["version", "aceptada_en"]


class _DatosApoderado(serializers.ModelSerializer):
    class Meta:
        model = Apoderado
        fields = ["nombre", "telefono"]

    def validate_telefono(self, valor):
        return valor or None


class _DatosPaciente(serializers.ModelSerializer):
    apoderado_id = serializers.UUIDField(allow_null=True, required=False)

    class Meta:
        model = Paciente
        fields = [
            "apoderado_id",
            "nombre",
            "fecha_nacimiento",
            "antecedentes",
            "motivo_consulta",
            "archivado",
            "creado_en",
            "modificado_en",
        ]


class _DatosCita(serializers.ModelSerializer):
    paciente_id = serializers.UUIDField()

    class Meta:
        model = Cita
        fields = ["paciente_id", "fecha_hora", "estado", "creado_en", "modificado_en"]


class _DatosRegistroSesion(serializers.ModelSerializer):
    cita_id = serializers.UUIDField()

    class Meta:
        model = RegistroSesion
        fields = [
            "cita_id",
            "observaciones",
            "objetivos_cumplidos",
            "retroalimentacion_familia",
            "archivado",
            "creado_en",
            "modificado_en",
        ]


def _validar(serializador, datos):
    if not isinstance(datos, dict):
        raise _invalido()
    formulario = serializador(data=datos)
    if not formulario.is_valid():
        raise _invalido()
    return dict(formulario.validated_data)


def _uuid(valor):
    if not isinstance(valor, str):
        raise _invalido()
    try:
        return uuid.UUID(valor)
    except ValueError:
        raise _invalido() from None


def _instante(valor):
    if not isinstance(valor, str):
        raise _invalido()
    try:
        instante = parse_datetime(valor)
    except ValueError:
        instante = None
    if instante is None or instante.tzinfo is None:
        raise _invalido()
    return instante


# ---------- Aplicación por entidad ----------


def _propio(consulta, registro_id, usuaria, propietaria_de):
    """Registro existente (bloqueado para la transacción) o None; 404 si es de otra usuaria."""
    registro = consulta.select_for_update(of=("self",)).filter(pk=registro_id).first()
    if registro is not None and propietaria_de(registro) != usuaria.pk:
        raise _no_encontrado()
    return registro


def _guardar(modelo, existente, registro_id, valores, modificado_en, **fijos):
    """Crea el registro o lo actualiza si la operación gana por Last-Write-Wins."""
    if "modificado_en" in valores:
        valores["modificado_en"] = modificado_en
    if existente is None:
        modelo.objects.create(id=registro_id, **fijos, **valores)
        return APLICADA
    guardado = getattr(existente, "modificado_en", None)
    if guardado is not None and modificado_en < guardado:
        return CONFLICTO
    valores.pop("creado_en", None)
    for campo, valor in valores.items():
        setattr(existente, campo, valor)
    existente.save()
    return APLICADA


def _aplicar_aceptacion(usuaria, registro_id, valores, modificado_en):
    existente = _propio(AceptacionPolitica.objects, registro_id, usuaria, lambda a: a.usuaria_id)
    if existente is None:
        AceptacionPolitica.objects.create(id=registro_id, usuaria=usuaria, **valores)
    # Una aceptación es inmutable: reenviarla no la modifica.
    return APLICADA


def _aplicar_apoderado(usuaria, registro_id, valores, modificado_en):
    existente = _propio(Apoderado.objects, registro_id, usuaria, lambda a: a.propietaria_id)
    return _guardar(Apoderado, existente, registro_id, valores, modificado_en, propietaria=usuaria)


def _aplicar_paciente(usuaria, registro_id, valores, modificado_en):
    apoderado_id = valores.get("apoderado_id")
    if apoderado_id is not None:
        if not Apoderado.objects.filter(pk=apoderado_id, propietaria=usuaria).exists():
            raise _no_encontrado()
    existente = _propio(Paciente.objects, registro_id, usuaria, lambda p: p.propietaria_id)
    return _guardar(Paciente, existente, registro_id, valores, modificado_en, propietaria=usuaria)


def _aplicar_cita(usuaria, registro_id, valores, modificado_en):
    if not Paciente.objects.filter(pk=valores["paciente_id"], propietaria=usuaria).exists():
        raise _no_encontrado()
    existente = _propio(
        Cita.objects.select_related("paciente"),
        registro_id,
        usuaria,
        lambda c: c.paciente.propietaria_id,
    )
    return _guardar(Cita, existente, registro_id, valores, modificado_en)


def _aplicar_registro_sesion(usuaria, registro_id, valores, modificado_en):
    cita_id = valores["cita_id"]
    if not Cita.objects.filter(pk=cita_id, paciente__propietaria=usuaria).exists():
        raise _no_encontrado()
    existente = _propio(
        RegistroSesion.objects.select_related("cita__paciente"),
        registro_id,
        usuaria,
        lambda r: r.cita.paciente.propietaria_id,
    )
    if RegistroSesion.objects.filter(cita_id=cita_id).exclude(pk=registro_id).exists():
        raise Rechazo("duplicado", status.HTTP_409_CONFLICT)
    return _guardar(RegistroSesion, existente, registro_id, valores, modificado_en)


ENTIDADES = {
    "aceptacion_politica": (_DatosAceptacion, _aplicar_aceptacion),
    "apoderado": (_DatosApoderado, _aplicar_apoderado),
    "paciente": (_DatosPaciente, _aplicar_paciente),
    "cita": (_DatosCita, _aplicar_cita),
    "registro_sesion": (_DatosRegistroSesion, _aplicar_registro_sesion),
}


def _aplicar(usuaria, item):
    if not isinstance(item, dict):
        raise _invalido()
    op_id = _uuid(item.get("op_id"))
    entidad = item.get("entidad")
    operacion = item.get("operacion")
    if not isinstance(entidad, str) or entidad not in ENTIDADES or operacion not in OPERACIONES:
        raise _invalido()
    registro_id = _uuid(item.get("registro_id"))
    modificado_en = _instante(item.get("modificado_en"))

    recibida = OperacionRecibida.objects.filter(pk=op_id).first()
    if recibida is not None:
        if recibida.propietaria_id != usuaria.pk:
            raise _invalido()
        return DUPLICADA
    # Si otra petición registra el mismo op_id a la vez, la restricción de clave
    # primaria aborta esta transacción y el reintento del cliente la ve duplicada.
    OperacionRecibida.objects.create(id=op_id, propietaria=usuaria)

    serializador, aplicar = ENTIDADES[entidad]
    valores = _validar(serializador, item.get("datos"))
    if operacion == "archivar":
        if "archivado" not in serializador.Meta.fields:
            raise _invalido()
        valores["archivado"] = True
    return aplicar(usuaria, registro_id, valores, modificado_en)


def procesar_operacion(usuaria, item):
    """Aplica una operación en su propia transacción y devuelve su resultado."""
    op_id = item.get("op_id") if isinstance(item, dict) else None
    eco = op_id if isinstance(op_id, str) else None
    try:
        with transaction.atomic():
            estado = _aplicar(usuaria, item)
    except Rechazo as rechazo:
        codigo, codigo_http = rechazo.codigo, rechazo.codigo_http
    except IntegrityError:
        codigo, codigo_http = "integridad", status.HTTP_409_CONFLICT
    else:
        return {"op_id": eco, "estado": estado, "codigo_http": status.HTTP_200_OK, "codigo": None}
    return {"op_id": eco, "estado": RECHAZADA, "codigo_http": codigo_http, "codigo": codigo}


def _prioridad(item):
    entidad = item.get("entidad") if isinstance(item, dict) else None
    if isinstance(entidad, str) and entidad in ORDEN_ENTIDADES:
        return ORDEN_ENTIDADES.index(entidad)
    return len(ORDEN_ENTIDADES)


class SincronizarView(APIView):
    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "options"]

    def post(self, request):
        cuerpo = request.data
        operaciones = cuerpo.get("operaciones") if isinstance(cuerpo, dict) else None
        if not isinstance(operaciones, list) or len(operaciones) > MAX_OPERACIONES_POR_LOTE:
            return Response({"detail": "Lote inválido."}, status=status.HTTP_400_BAD_REQUEST)

        # Se procesa en orden de dependencias (Apoderado -> Paciente -> Cita ->
        # RegistroSesion) aunque el lote llegue desordenado; `sorted` es estable,
        # así que dentro de cada entidad se respeta el orden de envío.
        resultados = [None] * len(operaciones)
        for posicion in sorted(range(len(operaciones)), key=lambda i: _prioridad(operaciones[i])):
            resultados[posicion] = procesar_operacion(request.user, operaciones[posicion])

        conteo = {estado: 0 for estado in (APLICADA, DUPLICADA, CONFLICTO, RECHAZADA)}
        for resultado in resultados:
            conteo[resultado["estado"]] += 1
        logger.info(
            "sincronizar usuaria=%s operaciones=%d aplicadas=%d duplicadas=%d "
            "conflictos=%d rechazadas=%d",
            request.user.pk,
            len(resultados),
            conteo[APLICADA],
            conteo[DUPLICADA],
            conteo[CONFLICTO],
            conteo[RECHAZADA],
        )
        return Response({"resultados": resultados})


class RestaurarView(APIView):
    """Copia completa de los datos de la usuaria (incluye archivados) para un teléfono nuevo."""

    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "options"]

    def get(self, request):
        usuaria = request.user
        apoderados = Apoderado.objects.filter(propietaria=usuaria).order_by("id")
        pacientes = Paciente.objects.filter(propietaria=usuaria).order_by("creado_en", "id")
        citas = Cita.objects.filter(paciente__propietaria=usuaria).order_by("fecha_hora", "id")
        registros = RegistroSesion.objects.filter(cita__paciente__propietaria=usuaria).order_by(
            "creado_en", "id"
        )
        logger.info("restaurar usuaria=%s", usuaria.pk)
        return Response(
            {
                "apoderados": list(
                    apoderados.values("id", "propietaria_id", "nombre", "telefono")
                ),
                "pacientes": list(
                    pacientes.values(
                        "id",
                        "propietaria_id",
                        "apoderado_id",
                        "nombre",
                        "fecha_nacimiento",
                        "antecedentes",
                        "motivo_consulta",
                        "archivado",
                        "creado_en",
                        "modificado_en",
                    )
                ),
                "citas": list(
                    citas.values(
                        "id", "paciente_id", "fecha_hora", "estado", "creado_en", "modificado_en"
                    )
                ),
                "registros_sesion": list(
                    registros.values(
                        "id",
                        "cita_id",
                        "observaciones",
                        "objetivos_cumplidos",
                        "retroalimentacion_familia",
                        "archivado",
                        "creado_en",
                        "modificado_en",
                    )
                ),
            }
        )
