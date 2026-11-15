#!/usr/bin/env bash
# Build de Render: dependencias, verificación de despliegue y migraciones.
set -o errexit

pip install --upgrade pip
pip install -r requirements.txt
python manage.py check --deploy
python manage.py migrate --noinput
