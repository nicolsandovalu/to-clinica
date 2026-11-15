from django.conf import settings
from django.urls import include, path

urlpatterns = [
    path("api/clinica/", include("clinica.urls")),
]

# AUZ-06: el panel de administración no se publica con DEBUG=False.
if settings.DEBUG:
    from django.contrib import admin

    urlpatterns.append(path("admin/", admin.site.urls))
