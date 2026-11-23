/** E4 Registro de sesión (HU-01): dictado por campo, edición manual, guardado y aviso sin dictado. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import type { MotorDictado, OyentesMotorDictado } from '../src/modules/registro/dictado';
import { AVISO_DICTADO_NO_DISPONIBLE } from '../src/modules/registro/dictado';
import {
  MENSAJE_ERROR_CARGA_REGISTRO,
  MENSAJE_ERROR_REGISTRO,
  Registro,
  TEXTO_SESION_GUARDADA,
} from '../src/pantallas/Registro';
import { crearRepositorioMemoria } from './ayudas/entorno';

interface MotorFalso extends MotorDictado {
  emitir(texto: string): void;
  readonly iniciado: jest.Mock;
}

function crearMotorFalso(opciones?: { onDevice?: boolean; permisos?: boolean }): MotorFalso {
  let oyentes: OyentesMotorDictado | null = null;
  const iniciado = jest.fn();
  return {
    iniciado,
    soportaOnDevice: () => opciones?.onDevice ?? true,
    pedirPermisos: async () => opciones?.permisos ?? true,
    iniciar: (o) => iniciado(o),
    detener: () => oyentes?.fin(),
    suscribir: (o) => {
      oyentes = o;
      return () => {
        oyentes = null;
      };
    },
    emitir: (texto) => oyentes?.resultado(texto),
  };
}

async function prepararCita() {
  const repo = crearRepositorioMemoria();
  const paciente = await repo.crearPaciente({
    propietaria_id: '1',
    nombre: 'Paciente Ficticio',
    antecedentes: 'Antecedente de prueba',
  });
  const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-02T15:00:00.000Z' });
  return { repo, cita };
}

describe('pantalla Registro', () => {
  it('muestra los tres campos con su botón de dictado y el paciente de la cita', async () => {
    const { repo, cita } = await prepararCita();
    await render(<Registro repositorio={repo} citaId={cita.id} alVerSiguiente={jest.fn()} motorDictado={crearMotorFalso()} />);

    expect(await screen.findByText('Paciente Ficticio')).toBeTruthy();
    expect(screen.getByTestId('campo-observaciones')).toBeTruthy();
    expect(screen.getByTestId('campo-objetivos_cumplidos')).toBeTruthy();
    expect(screen.getByTestId('campo-retroalimentacion_familia')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dictar Observaciones' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dictar Objetivos cumplidos' })).toBeTruthy();
  });

  it('dicta en el campo elegido, permite editar, guarda y confirma con «Sesión guardada»', async () => {
    const { repo, cita } = await prepararCita();
    const motor = crearMotorFalso();
    const alVerSiguiente = jest.fn();
    await render(<Registro repositorio={repo} citaId={cita.id} alVerSiguiente={alVerSiguiente} motorDictado={motor} />);
    await screen.findByText('Paciente Ficticio');

    await fireEvent.press(screen.getByRole('button', { name: 'Dictar Observaciones' }));
    await waitFor(() => expect(motor.iniciado).toHaveBeenCalledTimes(1));
    expect(motor.iniciado.mock.calls[0][0]).toMatchObject({
      requiresOnDeviceRecognition: true,
      recordingOptions: { persist: false },
    });
    await act(async () => motor.emitir('Buena disposición'));
    expect(screen.getByTestId('campo-observaciones').props.value).toBe('Buena disposición');

    await fireEvent.changeText(screen.getByTestId('campo-objetivos_cumplidos'), 'Agarre trípode');
    expect(screen.queryByText(TEXTO_SESION_GUARDADA)).toBeNull();
    await fireEvent.press(screen.getByTestId('guardar-sesion'));

    expect(await screen.findByText(TEXTO_SESION_GUARDADA)).toBeTruthy();
    const guardado = await repo.obtenerRegistroSesionPorCita(cita.id);
    expect(guardado).toMatchObject({ observaciones: 'Buena disposición', objetivos_cumplidos: 'Agarre trípode' });

    await fireEvent.press(screen.getByTestId('ver-siguiente'));
    expect(alVerSiguiente).toHaveBeenCalledTimes(1);
  });

  it('sin motor de dictado avisa y deja el teclado disponible', async () => {
    const { repo, cita } = await prepararCita();
    await render(<Registro repositorio={repo} citaId={cita.id} alVerSiguiente={jest.fn()} motorDictado={null} />);
    await screen.findByText('Paciente Ficticio');

    await fireEvent.press(screen.getByRole('button', { name: 'Dictar Observaciones' }));
    expect(await screen.findByText(AVISO_DICTADO_NO_DISPONIBLE)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('campo-observaciones'), 'Escrito a mano');
    expect(screen.getByTestId('campo-observaciones').props.value).toBe('Escrito a mano');
  });

  it('alterna la vista de antecedentes del paciente', async () => {
    const { repo, cita } = await prepararCita();
    await render(<Registro repositorio={repo} citaId={cita.id} alVerSiguiente={jest.fn()} motorDictado={crearMotorFalso()} />);
    await screen.findByText('Paciente Ficticio');

    expect(screen.queryByTestId('antecedentes')).toBeNull();
    await fireEvent.press(screen.getByTestId('alternar-antecedentes'));
    expect(screen.getByText('Antecedente de prueba')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('alternar-antecedentes'));
    expect(screen.queryByTestId('antecedentes')).toBeNull();
  });

  it('una cita inexistente muestra el error y no permite guardar', async () => {
    const { repo } = await prepararCita();
    await render(
      <Registro repositorio={repo} citaId="00000000-0000-4000-8000-000000000000" alVerSiguiente={jest.fn()} motorDictado={crearMotorFalso()} />,
    );
    expect(await screen.findByText(MENSAJE_ERROR_CARGA_REGISTRO)).toBeTruthy();
    expect(screen.getByTestId('guardar-sesion')).toBeDisabled();
  });

  it('si el guardado falla, muestra un mensaje genérico y no confirma', async () => {
    const { repo, cita } = await prepararCita();
    jest.spyOn(repo, 'crearRegistroSesion').mockRejectedValue(new Error('fallo interno con detalle'));
    await render(<Registro repositorio={repo} citaId={cita.id} alVerSiguiente={jest.fn()} motorDictado={crearMotorFalso()} />);
    await screen.findByText('Paciente Ficticio');

    await fireEvent.press(screen.getByTestId('guardar-sesion'));
    expect(await screen.findByText(MENSAJE_ERROR_REGISTRO)).toBeTruthy();
    expect(screen.queryByText(TEXTO_SESION_GUARDADA)).toBeNull();
    expect(screen.queryByText(/detalle/)).toBeNull();
  });
});
