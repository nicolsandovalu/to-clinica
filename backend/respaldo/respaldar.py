"""
Respaldo cifrado de PostgreSQL: `pg_dump` + AES-256-GCM.

Uso (la clave nunca se pasa por argumentos; solo por variable de entorno):

    RESPALDO_CLAVE_HEX=<64 hex> DATABASE_URL=postgres://... \
        python respaldo/respaldar.py --salida respaldos/
    RESPALDO_CLAVE_HEX=<64 hex> python respaldo/respaldar.py \
        --descifrar respaldos/respaldo-AAAAmmdd-HHMMSS.enc --salida volcado.dump

Genera la clave con:  python -c "import secrets; print(secrets.token_hex(32))"

Formato del `.enc`:  MAGIA (5 B) | nonce (12 B) | texto cifrado + etiqueta GCM (16 B).
La contraseña de la base de datos se entrega a `pg_dump` por variables PG*, no por
la línea de comandos, para no exponerla en la lista de procesos. No se imprime
ningún dato clínico. Los `.enc` están excluidos de Git (.gitignore).
"""
import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIA = b"TOCL1"
LARGO_NONCE = 12
LARGO_CLAVE = 32
VARIABLE_CLAVE = "RESPALDO_CLAVE_HEX"


class ErrorRespaldo(Exception):
    pass


def leer_clave(entorno=None):
    """Devuelve la clave de 32 bytes desde `RESPALDO_CLAVE_HEX` (64 caracteres hex)."""
    entorno = os.environ if entorno is None else entorno
    texto = (entorno.get(VARIABLE_CLAVE) or "").strip()
    try:
        clave = bytes.fromhex(texto)
    except ValueError:
        clave = b""
    if len(clave) != LARGO_CLAVE:
        raise ErrorRespaldo(f"{VARIABLE_CLAVE} debe tener 64 caracteres hexadecimales (32 bytes).")
    return clave


def cifrar(datos, clave):
    if len(clave) != LARGO_CLAVE:
        raise ErrorRespaldo("La clave debe tener 32 bytes.")
    nonce = os.urandom(LARGO_NONCE)  # único por respaldo; nunca se reutiliza con la misma clave
    return MAGIA + nonce + AESGCM(clave).encrypt(nonce, datos, MAGIA)


def descifrar(blob, clave):
    """Lanza `ErrorRespaldo` si el archivo está alterado o la clave es incorrecta."""
    if len(clave) != LARGO_CLAVE:
        raise ErrorRespaldo("La clave debe tener 32 bytes.")
    if not blob.startswith(MAGIA) or len(blob) < len(MAGIA) + LARGO_NONCE + 16:
        raise ErrorRespaldo("El archivo no es un respaldo válido.")
    nonce = blob[len(MAGIA):len(MAGIA) + LARGO_NONCE]
    try:
        return AESGCM(clave).decrypt(nonce, blob[len(MAGIA) + LARGO_NONCE:], MAGIA)
    except Exception as error:  # InvalidTag: clave errónea o datos modificados
        raise ErrorRespaldo("No se pudo descifrar: clave incorrecta o archivo alterado.") from error


def entorno_pg(url_base_datos, base=None):
    """Variables PG* para `pg_dump` a partir de `DATABASE_URL`."""
    partes = urlparse(url_base_datos)
    if partes.scheme not in ("postgres", "postgresql") or not partes.path.lstrip("/"):
        raise ErrorRespaldo("DATABASE_URL debe ser una URL de PostgreSQL.")
    entorno = dict(os.environ if base is None else base)
    entorno.update(
        PGHOST=partes.hostname or "",
        PGPORT=str(partes.port or 5432),
        PGUSER=unquote(partes.username or ""),
        PGPASSWORD=unquote(partes.password or ""),
        PGDATABASE=partes.path.lstrip("/"),
    )
    return entorno


def volcar(url_base_datos, ejecutar=subprocess.run):
    """Ejecuta `pg_dump` (formato custom) y devuelve los bytes del volcado."""
    comando = ["pg_dump", "--format=custom", "--no-owner", "--no-privileges"]
    try:
        resultado = ejecutar(
            comando, env=entorno_pg(url_base_datos), capture_output=True, check=False
        )
    except FileNotFoundError as error:
        raise ErrorRespaldo("No se encontró `pg_dump` en el sistema.") from error
    if resultado.returncode != 0:
        # stderr puede nombrar tablas pero nunca trae filas; aun así no se reenvía.
        raise ErrorRespaldo(f"pg_dump terminó con código {resultado.returncode}.")
    return resultado.stdout


def respaldar(url_base_datos, directorio, clave, ejecutar=subprocess.run, ahora=None):
    volcado = volcar(url_base_datos, ejecutar)
    instante = (ahora or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S")
    destino = Path(directorio)
    destino.mkdir(parents=True, exist_ok=True)
    archivo = destino / f"respaldo-{instante}.enc"
    archivo.write_bytes(cifrar(volcado, clave))
    return archivo


def principal(argv=None, entorno=None):
    analizador = argparse.ArgumentParser(
        description="Respaldo cifrado (AES-256-GCM) de PostgreSQL."
    )
    analizador.add_argument(
        "--salida", default="respaldos", help="Directorio (o archivo al descifrar)."
    )
    analizador.add_argument(
        "--descifrar", metavar="ARCHIVO", help="Descifra un .enc en lugar de respaldar."
    )
    args = analizador.parse_args(argv)
    entorno = os.environ if entorno is None else entorno
    try:
        clave = leer_clave(entorno)
        if args.descifrar:
            datos = descifrar(Path(args.descifrar).read_bytes(), clave)
            Path(args.salida).write_bytes(datos)
            print(f"Volcado descifrado en {args.salida}")
        else:
            url = entorno.get("DATABASE_URL", "")
            if not url:
                raise ErrorRespaldo("Falta la variable de entorno DATABASE_URL.")
            print(f"Respaldo cifrado creado: {respaldar(url, args.salida, clave)}")
    except ErrorRespaldo as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(principal())
