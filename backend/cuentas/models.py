import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class GestorUsuaria(BaseUserManager):
    use_in_migrations = True

    def _crear(self, email, password, **extra):
        if not email:
            raise ValueError("El correo es obligatorio.")
        usuaria = self.model(email=self.normalize_email(email), **extra)
        usuaria.set_password(password)
        usuaria.save(using=self._db)
        return usuaria

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._crear(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra["is_staff"] = True
        extra["is_superuser"] = True
        return self._crear(email, password, **extra)


class Usuaria(AbstractUser):
    """Terapeuta. Se identifica por su correo (único)."""

    username = None
    email = models.EmailField(unique=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = GestorUsuaria()


class AceptacionPolitica(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    usuaria = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="aceptaciones"
    )
    version = models.CharField(max_length=20)
    aceptada_en = models.DateTimeField()
