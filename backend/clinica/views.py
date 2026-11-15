"""
ViewSets CRUD de las entidades clínicas.

- AUZ-01/02: autenticación obligatoria y querysets filtrados por la propietaria;
  un ID ajeno responde 404, nunca 403 ni 200.
- AUZ-03: la propietaria la asigna el servidor.
- AUZ-05: sin `delete` (conservación mínima de 15 años, Ley 20.584); se archiva
  con `PATCH {"archivado": true}`.
"""
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import Apoderado, Cita, Paciente, RegistroSesion
from .serializers import (
    ApoderadoSerializer,
    CitaSerializer,
    PacienteSerializer,
    RegistroSesionSerializer,
)


class ViewSetPropio(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "put", "patch"]
    modelo = None
    # Ruta ORM hasta la propietaria: "propietaria", "paciente__propietaria", ...
    filtro_propietaria = "propietaria"

    def get_queryset(self):
        return self.modelo.objects.filter(
            **{self.filtro_propietaria: self.request.user}
        ).order_by("pk")


class ApoderadoViewSet(ViewSetPropio):
    modelo = Apoderado
    serializer_class = ApoderadoSerializer

    def perform_create(self, serializer):
        serializer.save(propietaria=self.request.user)


class PacienteViewSet(ViewSetPropio):
    modelo = Paciente
    serializer_class = PacienteSerializer

    def perform_create(self, serializer):
        serializer.save(propietaria=self.request.user)


class CitaViewSet(ViewSetPropio):
    modelo = Cita
    filtro_propietaria = "paciente__propietaria"
    serializer_class = CitaSerializer


class RegistroSesionViewSet(ViewSetPropio):
    modelo = RegistroSesion
    filtro_propietaria = "cita__paciente__propietaria"
    serializer_class = RegistroSesionSerializer
