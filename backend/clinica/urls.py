from django.urls import path
from rest_framework.routers import SimpleRouter

from .sync import RestaurarView, SincronizarView
from .views import (
    ApoderadoViewSet,
    CitaViewSet,
    PacienteViewSet,
    RegistroSesionViewSet,
)

app_name = "clinica"

router = SimpleRouter()
router.register("apoderados", ApoderadoViewSet, basename="apoderado")
router.register("pacientes", PacienteViewSet, basename="paciente")
router.register("citas", CitaViewSet, basename="cita")
router.register("registros", RegistroSesionViewSet, basename="registro")

urlpatterns = [
    path("sincronizar/", SincronizarView.as_view(), name="sincronizar"),
    path("restaurar/", RestaurarView.as_view(), name="restaurar"),
    *router.urls,
]
