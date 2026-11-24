/** Dictado con errores visibles, espera larga del login y piezas del rediseño. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { TIEMPO_MAXIMO_LOGIN_MS, crearClienteApi } from '../src/modules/acceso/api';
import type { MotorDictado, OyentesMotorDictado } from '../src/modules/registro/dictado';
import { mensajeErrorDictado } from '../src/modules/registro/dictado';
import { Registro } from '../src/pantallas/Registro';
import { Avatar, iniciales } from '../src/ui/componentes';
import { crearRepositorioMemoria } from './ayudas/entorno';

function motorQueFalla(codigo: string): MotorDictado {
  let oyentes: OyentesMotorDictado | null = null;
  return {
    soportaOnDevice: () => true,
    pedirPermisos: async () => true,
    iniciar: () => {
      // El motor real avisa del error de forma asíncrona, después de arrancar.
      setTimeout(() => oyentes?.error(codigo), 0);
    },
    detener: () => undefined,
    suscribir: (o) => {
      oyentes = o;
      return () => {
        oyentes = null;
      };
    },
  };
}

describe('dictado: errores visibles', () => {
  it('traduce los códigos del reconocedor a mensajes claros', () => {
    expect(mensajeErrorDictado('language-not-supported')).toContain('español sin conexión');
    expect(mensajeErrorDictado('not-allowed')).toContain('micrófono');
    expect(mensajeErrorDictado('no-speech')).toContain('No se escuchó');
    expect(mensajeErrorDictado('aborted')).toBe('');
    expect(mensajeErrorDictado('otro-codigo')).toContain('otro-codigo');
  });

  it('muestra el aviso cuando el reconocedor falla y el teclado sigue disponible', async () => {
    const repo = crearRepositorioMemoria();
    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio', antecedentes: '' });
    const cita = await repo.crearCita({ paciente_id: paciente.id, fecha_hora: '2026-03-02T15:00:00.000Z' });
    await render(
      <Registro
        repositorio={repo}
        citaId={cita.id}
        alVerSiguiente={jest.fn()}
        motorDictado={motorQueFalla('language-not-supported')}
      />,
    );
    await screen.findByText('Paciente Ficticio');
    await fireEvent.press(screen.getByRole('button', { name: 'Dictar Observaciones' }));
    await waitFor(() => expect(screen.getByTestId('error-dictado')).toBeTruthy());
    expect(screen.getByText(/español sin conexión/)).toBeTruthy();
    await act(async () => undefined);
    await fireEvent.changeText(screen.getByTestId('campo-observaciones'), 'texto a mano');
    expect(screen.getByTestId('campo-observaciones').props.value).toBe('texto a mano');
  });
});

describe('login con servidor dormido', () => {
  it('espera hasta 60 s antes de rendirse', () => {
    expect(TIEMPO_MAXIMO_LOGIN_MS).toBe(60_000);
  });

  it('el cliente usa ese tiempo en el temporizador del login', async () => {
    jest.useFakeTimers();
    const espiar = jest.spyOn(global, 'setTimeout');
    const fetchFalso = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: 't', usuaria: { id: 1, email: 'a@b.cl' } }),
    })) as unknown as typeof fetch;
    const api = crearClienteApi({ urlBase: 'https://api.ejemplo.cl', fetch: fetchFalso });
    await api.login('a@b.cl', 'x');
    expect(espiar.mock.calls.some(([, ms]) => ms === TIEMPO_MAXIMO_LOGIN_MS)).toBe(true);
    espiar.mockRestore();
    jest.useRealTimers();
  });
});

describe('avatar con iniciales', () => {
  it('calcula iniciales de uno, dos o más nombres', () => {
    expect(iniciales('Tomás Ficticio')).toBe('TF');
    expect(iniciales('Sofía')).toBe('S');
    expect(iniciales('  ana maría pérez  ')).toBe('AP');
    expect(iniciales('   ')).toBe('?');
  });

  it('se oculta del lector de pantalla (el nombre ya está en el texto)', async () => {
    await render(<Avatar nombre="Martín Prueba" />);
    expect(screen.queryByRole('text', { name: 'MP' })).toBeNull();
    expect(screen.getByText('MP', { includeHiddenElements: true })).toBeTruthy();
  });
});
