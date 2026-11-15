/**
 * Falla cerrada en la interfaz: el contenido clínico (los `children` de
 * `CompuertaAcceso`) solo existe en el árbol cuando la fase es `desbloqueada`.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { CompuertaAcceso, ProveedorAcceso } from '../src/modules/acceso/ContextoAcceso';
import type { GestorAcceso } from '../src/modules/acceso/gestorAcceso';
import { EMAIL, EntornoAcceso, PASSWORD, crearEntornoAcceso, gestorConSesion } from './ayudas/acceso';

const DATO_CLINICO = 'Paciente: dato clínico confidencial';

async function montar(gestor: GestorAcceso) {
  await render(
    <ProveedorAcceso gestor={gestor}>
      <CompuertaAcceso>
        <Text>{DATO_CLINICO}</Text>
      </CompuertaAcceso>
    </ProveedorAcceso>,
  );
}

let entorno: EntornoAcceso;

beforeEach(() => {
  entorno = crearEntornoAcceso();
});

afterEach(() => {
  entorno.destruir();
});

describe('CompuertaAcceso', () => {
  it('recorre política -> inicio de sesión -> contenido, sin mostrar datos antes de tiempo', async () => {
    await montar(entorno.crearGestor());

    // 1. Política de Privacidad: bloquea todo lo demás.
    expect(await screen.findByTestId('pantalla-politica')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();
    expect(screen.queryByTestId('pantalla-acceso')).toBeNull();

    // El botón no funciona hasta marcar la casilla (aceptación explícita).
    const aceptar = screen.getByRole('button', { name: 'Aceptar y continuar' });
    expect(aceptar).toBeDisabled();
    await fireEvent.press(aceptar);
    expect(screen.getByTestId('pantalla-politica')).toBeTruthy();
    expect(await entorno.repositorio.listarColaSync()).toEqual([]);

    await fireEvent.press(screen.getByRole('checkbox', { name: /acepto la Política de Privacidad/ }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar y continuar' }));

    // 2. Inicio de sesión.
    expect(await screen.findByTestId('pantalla-acceso')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText('Correo electrónico'), EMAIL);
    await fireEvent.changeText(screen.getByLabelText('Contraseña'), 'incorrecta');
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();

    await fireEvent.changeText(screen.getByLabelText(/^Contraseña/), PASSWORD);
    await fireEvent.press(screen.getByRole('button', { name: 'Iniciar sesión' }));

    // 3. Contenido.
    expect(await screen.findByText(DATO_CLINICO)).toBeTruthy();
  });

  it('el campo de contraseña oculta lo escrito', async () => {
    const gestor = entorno.crearGestor();
    await gestor.iniciar();
    await gestor.aceptarPolitica();
    await montar(gestor);
    expect((await screen.findByLabelText('Contraseña')).props.secureTextEntry).toBe(true);
  });

  it('al abrir con sesión iniciada pide desbloqueo y no monta el contenido hasta lograrlo', async () => {
    await gestorConSesion(entorno);
    entorno.autenticador.resultado = { ok: false, motivo: 'cancelada' };
    await montar(entorno.crearGestor());

    expect(await screen.findByTestId('pantalla-bloqueo')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();
    // La pantalla de bloqueo lanza el diálogo biométrico por sí sola.
    expect(entorno.autenticador.intentos).toBe(1);

    entorno.autenticador.resultado = { ok: true };
    await fireEvent.press(screen.getByRole('button', { name: 'Desbloquear' }));

    expect(await screen.findByText(DATO_CLINICO)).toBeTruthy();
    expect(screen.queryByTestId('pantalla-bloqueo')).toBeNull();
  });

  it('al bloquearse por segundo plano desmonta el contenido clínico', async () => {
    const gestor = await gestorConSesion(entorno);
    entorno.autenticador.resultado = { ok: false, motivo: 'cancelada' };
    await montar(gestor);
    expect(await screen.findByText(DATO_CLINICO)).toBeTruthy();

    await act(async () => {
      gestor.alCambiarEstadoApp('background');
      entorno.reloj.ahora += 60_000;
      gestor.alCambiarEstadoApp('active');
    });

    expect(await screen.findByTestId('pantalla-bloqueo')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();
  });

  it('al bloquearse por inactividad desmonta el contenido clínico', async () => {
    const gestor = await gestorConSesion(entorno);
    entorno.autenticador.resultado = { ok: false, motivo: 'cancelada' };
    await montar(gestor);
    expect(await screen.findByText(DATO_CLINICO)).toBeTruthy();

    await act(async () => {
      entorno.reloj.ahora += 5 * 60_000;
      gestor.registrarActividad();
    });

    expect(await screen.findByTestId('pantalla-bloqueo')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();
  });

  it('al cerrar sesión vuelve al inicio de sesión sin contenido', async () => {
    const gestor = await gestorConSesion(entorno);
    await montar(gestor);
    expect(await screen.findByText(DATO_CLINICO)).toBeTruthy();

    await act(async () => {
      await gestor.cerrarSesion();
    });

    expect(await screen.findByTestId('pantalla-acceso')).toBeTruthy();
    expect(screen.queryByText(DATO_CLINICO)).toBeNull();
  });
});
