from django.urls import path

from .sync import RestaurarView, SincronizarView

app_name = "clinica"

urlpatterns = [
    path("sincronizar/", SincronizarView.as_view(), name="sincronizar"),
    path("restaurar/", RestaurarView.as_view(), name="restaurar"),
]
