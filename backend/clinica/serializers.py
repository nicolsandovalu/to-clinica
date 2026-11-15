"""
Serializers de la API REST. La propietaria nunca se lee del payload (AUZ-03) y
toda relación (`apoderado`, `paciente`, `cita`) se valida contra los datos de
`request.user` (AUZ-04): una relación ajena se trata como inexistente.
"""
import uuid

from django.utils import timezone
from rest_framework import serializers

from .models import Apoderado, Cita, Paciente, RegistroSesion


class RelacionPropia(serializers.PrimaryKeyRelatedField):
    """FK cuyo queryset se restringe a los registros de la usuaria autenticada."""

    def __init__(self, filtro_propietaria, **kwargs):
        self.filtro_propietaria = filtro_propietaria
        super().__init__(**kwargs)

    def get_queryset(self):
        solicitud = self.context.get("request")
        if solicitud is None or not solicitud.user.is_authenticated:
            return self.queryset.none()
        return self.queryset.filter(**{self.filtro_propietaria: solicitud.user})


class BaseSerializer(serializers.ModelSerializer):
    """`id` lo genera el cliente (UUID v4) y no se puede cambiar después."""

    id = serializers.UUIDField(required=False)

    def validate_id(self, valor):
        if self.instance is not None and valor != self.instance.pk:
            raise serializers.ValidationError("El identificador no se puede modificar.")
        return valor

    def create(self, validated_data):
        validated_data.setdefault("id", uuid.uuid4())
        if self.Meta.model.objects.filter(pk=validated_data["id"]).exists():
            raise serializers.ValidationError({"id": "Identificador no disponible."})
        ahora = timezone.now()
        campos = {f.name for f in self.Meta.model._meta.get_fields()}
        for nombre in ("creado_en", "modificado_en"):
            if nombre in campos:
                validated_data[nombre] = ahora
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop("id", None)
        if hasattr(instance, "modificado_en"):
            validated_data["modificado_en"] = timezone.now()
        return super().update(instance, validated_data)


class ApoderadoSerializer(BaseSerializer):
    class Meta:
        model = Apoderado
        fields = ["id", "nombre", "telefono"]

    def validate_telefono(self, valor):
        return valor or None


class PacienteSerializer(BaseSerializer):
    apoderado = RelacionPropia(
        filtro_propietaria="propietaria",
        queryset=Apoderado.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Paciente
        fields = [
            "id",
            "apoderado",
            "nombre",
            "fecha_nacimiento",
            "antecedentes",
            "motivo_consulta",
            "archivado",
            "creado_en",
            "modificado_en",
        ]
        read_only_fields = ["creado_en", "modificado_en"]


class CitaSerializer(BaseSerializer):
    paciente = RelacionPropia(
        filtro_propietaria="propietaria", queryset=Paciente.objects.all()
    )

    class Meta:
        model = Cita
        fields = ["id", "paciente", "fecha_hora", "estado", "creado_en", "modificado_en"]
        read_only_fields = ["creado_en", "modificado_en"]


class RegistroSesionSerializer(BaseSerializer):
    cita = RelacionPropia(
        filtro_propietaria="paciente__propietaria", queryset=Cita.objects.all()
    )

    class Meta:
        model = RegistroSesion
        fields = [
            "id",
            "cita",
            "observaciones",
            "objetivos_cumplidos",
            "retroalimentacion_familia",
            "archivado",
            "creado_en",
            "modificado_en",
        ]
        read_only_fields = ["creado_en", "modificado_en"]

    def validate_cita(self, valor):
        if self.instance is not None:
            if valor != self.instance.cita:
                raise serializers.ValidationError("La cita de un registro no se puede cambiar.")
            return valor
        if RegistroSesion.objects.filter(cita=valor).exists():
            raise serializers.ValidationError("Esta cita ya tiene un registro de sesión.")
        return valor
