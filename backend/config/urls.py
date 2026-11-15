from django.conf import settings
from django.urls import include, path
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def salud(request):
    """Comprobación de vida para el despliegue. Público y sin datos."""
    return Response({"estado": "ok"})


urlpatterns = [
    path("salud/", salud, name="salud"),
    path("api/cuentas/", include("cuentas.urls")),
    path("api/clinica/", include("clinica.urls")),
]

# AUZ-06: el panel de administración no se publica con DEBUG=False.
if settings.DEBUG:
    from django.contrib import admin

    urlpatterns.append(path("admin/", admin.site.urls))
