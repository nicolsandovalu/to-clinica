"""
Modelo clínico (CLAUDE.md §3). Los `id` son UUID v4 generados en el cliente.
Ninguna relación usa CASCADE: no existe eliminación física (Ley 20.584).
"""
import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

ESTADOS_CITA = ["pendiente", "confirmada", "cancelada", "sin_respuesta"]
validar_telefono = RegexValidator(
    r"^\+569\d{8}\Z", "El teléfono debe tener el formato +569XXXXXXXX."
)


class Apoderado(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    propietaria = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="apoderados"
    )
    nombre = models.CharField(max_length=200)
    telefono = models.CharField(
        max_length=12, null=True, blank=True, validators=[validar_telefono]
    )


class Paciente(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    propietaria = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="pacientes"
    )
    apoderado = models.ForeignKey(
        Apoderado, null=True, blank=True, on_delete=models.PROTECT, related_name="pacientes"
    )
    nombre = models.CharField(max_length=200)
    fecha_nacimiento = models.DateField(null=True, blank=True)
    antecedentes = models.TextField(blank=True, default="")
    motivo_consulta = models.TextField(blank=True, default="")
    archivado = models.BooleanField(default=False)
    creado_en = models.DateTimeField()
    modificado_en = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["propietaria", "nombre"])]


class Cita(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    paciente = models.ForeignKey(Paciente, on_delete=models.PROTECT, related_name="citas")
    fecha_hora = models.DateTimeField()
    estado = models.CharField(
        max_length=20, choices=[(e, e) for e in ESTADOS_CITA], default="pendiente"
    )
    creado_en = models.DateTimeField()
    modificado_en = models.DateTimeField()

    class Meta:
        indexes = [models.Index(fields=["paciente", "fecha_hora"])]


class RegistroSesion(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    cita = models.OneToOneField(Cita, on_delete=models.PROTECT, related_name="registro")
    observaciones = models.TextField(blank=True, default="")
    objetivos_cumplidos = models.TextField(blank=True, default="")
    retroalimentacion_familia = models.TextField(blank=True, default="")
    archivado = models.BooleanField(default=False)
    creado_en = models.DateTimeField()
    modificado_en = models.DateTimeField()


class OperacionRecibida(models.Model):
    """Registro de idempotencia: `id` es el `op_id` generado por el cliente."""

    id = models.UUIDField(primary_key=True, editable=False)
    propietaria = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="operaciones_recibidas"
    )
    recibida_en = models.DateTimeField(auto_now_add=True)
