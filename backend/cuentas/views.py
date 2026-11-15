import logging

from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

MENSAJE_LOGIN_GENERICO = "Correo o contraseña incorrectos."


class LoginView(APIView):
    """
    `POST /api/cuentas/login/` con `{email, password}` -> `{token, usuaria: {id, email}}`.

    AUT-02: límite de 5 intentos por minuto (`ScopedRateThrottle`, ámbito `login`).
    AUT-03: un único mensaje de error, sin distinguir correo inexistente de clave errónea.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"
    http_method_names = ["post", "options"]

    def post(self, request):
        datos = request.data if isinstance(request.data, dict) else {}
        email = datos.get("email")
        password = datos.get("password")
        usuaria = None
        if isinstance(email, str) and isinstance(password, str) and email and password:
            usuaria = authenticate(request, username=email.strip(), password=password)
        if usuaria is None or not usuaria.is_active:
            # CS-07: nunca se registra el correo ni la contraseña intentados.
            logger.info("login rechazado")
            return Response(
                {"detail": MENSAJE_LOGIN_GENERICO}, status=status.HTTP_400_BAD_REQUEST
            )
        token, _ = Token.objects.get_or_create(user=usuaria)
        return Response({"token": token.key, "usuaria": {"id": usuaria.pk, "email": usuaria.email}})


class LogoutView(APIView):
    """`POST /api/cuentas/logout/`: revoca (elimina) el token con el que se llamó."""

    permission_classes = [IsAuthenticated]
    http_method_names = ["post", "options"]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
