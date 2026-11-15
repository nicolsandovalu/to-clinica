import re

from django.core.exceptions import ValidationError


class ValidadorComplejidad:
    """AUT-01: mínimo 8 caracteres con mayúscula, minúscula, número y carácter especial."""

    LARGO_MINIMO = 8

    def validate(self, password, user=None):
        errores = []
        if len(password) < self.LARGO_MINIMO:
            errores.append(f"Debe tener al menos {self.LARGO_MINIMO} caracteres.")
        if not re.search(r"[A-ZÁÉÍÓÚÑÜ]", password):
            errores.append("Debe incluir una letra mayúscula.")
        if not re.search(r"[a-záéíóúñü]", password):
            errores.append("Debe incluir una letra minúscula.")
        if not re.search(r"\d", password):
            errores.append("Debe incluir un número.")
        if not re.search(r"[^\w\s]|_", password):
            errores.append("Debe incluir un carácter especial.")
        if errores:
            raise ValidationError(errores, code="password_sin_complejidad")

    def get_help_text(self):
        return (
            "La contraseña debe tener al menos 8 caracteres, con mayúscula, minúscula, "
            "número y un carácter especial."
        )
