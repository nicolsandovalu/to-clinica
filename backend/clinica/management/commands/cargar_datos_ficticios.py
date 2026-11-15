"""
Carga datos CLÍNICOS FICTICIOS para desarrollo y demostraciones.

    python manage.py cargar_datos_ficticios --cantidad 5

Crea (si no existe) la usuaria de demostración y `N` pacientes con apoderado,
citas y registros de sesión inventados. Con `DEBUG=False` se niega, salvo
`--forzar`, para no mezclar datos ficticios con historias clínicas reales.
"""
import random
import secrets
import uuid
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from clinica.models import ESTADOS_CITA, Apoderado, Cita, Paciente, RegistroSesion

NOMBRES = ["Sofía", "Mateo", "Isidora", "Benjamín", "Emilia", "Tomás", "Antonia", "Joaquín"]
APELLIDOS = ["Ficticio Rojas", "Ficticio Soto", "Ficticio Muñoz", "Ficticio Díaz", "Ficticio Vera"]
MOTIVOS = [
    "Dato ficticio: dificultades de coordinación motora fina.",
    "Dato ficticio: integración sensorial.",
    "Dato ficticio: apoyo en autonomía de la vida diaria.",
]
OBSERVACIONES = [
    "Dato ficticio: buena disposición durante la sesión.",
    "Dato ficticio: se distrae con estímulos del entorno.",
    "Dato ficticio: completa la actividad con apoyo verbal.",
]
SESIONES_POR_PACIENTE = 3
EMAIL_DEMO = "demo@ejemplo.cl"


class Command(BaseCommand):
    help = "Carga pacientes, citas y registros de sesión FICTICIOS para desarrollo."

    def add_arguments(self, parser):
        parser.add_argument("--cantidad", type=int, default=5, help="Pacientes a crear (1-200).")
        parser.add_argument("--email", default=EMAIL_DEMO, help="Correo de la usuaria demo.")
        parser.add_argument(
            "--forzar", action="store_true", help="Permite ejecutar con DEBUG=False."
        )
        parser.add_argument("--semilla", type=int, default=None, help="Semilla (datos repetibles).")

    def handle(self, *args, **opciones):
        cantidad = opciones["cantidad"]
        if not 1 <= cantidad <= 200:
            raise CommandError("--cantidad debe estar entre 1 y 200.")
        if not settings.DEBUG and not opciones["forzar"]:
            raise CommandError("DEBUG=False: usa --forzar solo en una instancia de demostración.")

        azar = random.Random(opciones["semilla"])
        Usuaria = get_user_model()
        usuaria = Usuaria.objects.filter(email=opciones["email"]).first()
        if usuaria is None:
            # Contraseña aleatoria que cumple ValidadorComplejidad; se muestra una sola vez.
            clave = f"{secrets.token_urlsafe(12)}aA1!"
            usuaria = Usuaria.objects.create_user(opciones["email"], clave)
            self.stdout.write(f"Usuaria de demostración creada: {usuaria.email} / {clave}")

        ahora = timezone.now()
        for i in range(cantidad):
            apoderado = Apoderado.objects.create(
                id=uuid.uuid4(),
                propietaria=usuaria,
                nombre=f"Apoderado Ficticio {i + 1}",
                telefono=f"+56900000{azar.randint(100, 999)}",
            )
            paciente = Paciente.objects.create(
                id=uuid.uuid4(),
                propietaria=usuaria,
                apoderado=apoderado,
                nombre=f"{azar.choice(NOMBRES)} {azar.choice(APELLIDOS)}",
                fecha_nacimiento=date.today() - timedelta(days=365 * azar.randint(3, 12)),
                antecedentes="Dato ficticio: sin antecedentes relevantes.",
                motivo_consulta=azar.choice(MOTIVOS),
                creado_en=ahora,
                modificado_en=ahora,
            )
            for j in range(SESIONES_POR_PACIENTE):
                fecha = ahora - timedelta(days=7 * (SESIONES_POR_PACIENTE - j))
                cita = Cita.objects.create(
                    id=uuid.uuid4(),
                    paciente=paciente,
                    fecha_hora=fecha,
                    estado=azar.choice(ESTADOS_CITA),
                    creado_en=ahora,
                    modificado_en=ahora,
                )
                RegistroSesion.objects.create(
                    id=uuid.uuid4(),
                    cita=cita,
                    observaciones=azar.choice(OBSERVACIONES),
                    objetivos_cumplidos="Dato ficticio: objetivo parcialmente logrado.",
                    retroalimentacion_familia="Dato ficticio: la familia practica en casa.",
                    creado_en=ahora,
                    modificado_en=ahora,
                )
        self.stdout.write(self.style.SUCCESS(f"{cantidad} pacientes ficticios creados."))
