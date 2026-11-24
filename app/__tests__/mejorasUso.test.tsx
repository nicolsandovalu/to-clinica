/** Mejoras de uso: fechas flexibles, aviso de sincronización temporal y registro directo desde la ficha. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { normalizarFecha } from '../src/modules/pacientes-agenda/validaciones';
import { Pacientes } from '../src/pantallas/Pacientes';
import { BannerConexion, TIEMPO_AVISO_SINCRONIZADO_MS } from '../src/ui/componentes';
import { crearRepositorioMemoria } from './ayudas/entorno';

describe('normalizarFecha', () => {
  it.each([
    ['1996-11-19', '1996-11-19'],
    ['19-11-1996', '1996-11-19'],
    ['19/11/1996', '1996-11-19'],
    ['9.3.2020', '2020-03-09'],
    ['  05-01-2026  ', '2026-01-05'],
  ])('acepta %s', (entrada, esperado) => {
    expect(normalizarFecha(entrada)).toBe(esperado);
  });

  it.each(['31-02-2026', '2026-13-01', '19-11', 'ayer', '', '1996/11/19'])('rechaza %s', (entrada) => {
    expect(normalizarFecha(entrada)).toBeNull();
  });
});

describe('BannerConexion: «Todo sincronizado» no se queda pegado', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('se oculta solo cuando todo está al día', async () => {
    await render(<BannerConexion conectado pendientes={0} />);
    expect(screen.getByText(/Todo sincronizado/)).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(TIEMPO_AVISO_SINCRONIZADO_MS + 100);
    });
    expect(screen.queryByText(/Todo sincronizado/)).toBeNull();
  });

  it('el aviso de pendientes y el de sin conexión no se ocultan', async () => {
    const { rerender } = await render(<BannerConexion conectado pendientes={2} />);
    await act(async () => {
      jest.advanceTimersByTime(TIEMPO_AVISO_SINCRONIZADO_MS * 3);
    });
    expect(screen.getByText(/Sincronizando 2 cambios/)).toBeTruthy();
    await rerender(<BannerConexion conectado={false} pendientes={0} />);
    await act(async () => {
      jest.advanceTimersByTime(TIEMPO_AVISO_SINCRONIZADO_MS * 3);
    });
    expect(screen.getByText(/Sin conexión/)).toBeTruthy();
  });

  it('vuelve a mostrarse tras sincronizar de nuevo', async () => {
    const { rerender } = await render(<BannerConexion conectado pendientes={0} />);
    await act(async () => {
      jest.advanceTimersByTime(TIEMPO_AVISO_SINCRONIZADO_MS + 100);
    });
    expect(screen.queryByText(/Todo sincronizado/)).toBeNull();
    await rerender(<BannerConexion conectado pendientes={1} />);
    expect(screen.getByText(/Sincronizando 1 cambio/)).toBeTruthy();
    await rerender(<BannerConexion conectado pendientes={0} />);
    expect(screen.getByText(/Todo sincronizado/)).toBeTruthy();
  });
});

describe('Ficha del paciente: registrar sesión ahora', () => {
  it('ofrece el atajo para dictar y lo invoca con el paciente', async () => {
    const repo = crearRepositorioMemoria();
    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio' });
    const registrarAhora = jest.fn();
    await render(
      <Pacientes
        repositorio={repo}
        alNuevoPaciente={jest.fn()}
        alEditar={jest.fn()}
        alAgendar={jest.fn()}
        alHistorial={jest.fn()}
        alBorrador={jest.fn()}
        alRegistrarAhora={registrarAhora}
      />,
    );
    fireEvent.press(await screen.findByTestId(`paciente-${paciente.id}`));
    fireEvent.press(await screen.findByTestId('ficha-registrar-ahora'));
    expect(registrarAhora).toHaveBeenCalledWith(paciente.id);
  });

  it('sin la acción no muestra el atajo', async () => {
    const repo = crearRepositorioMemoria();
    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio' });
    await render(
      <Pacientes
        repositorio={repo}
        alNuevoPaciente={jest.fn()}
        alEditar={jest.fn()}
        alAgendar={jest.fn()}
        alHistorial={jest.fn()}
        alBorrador={jest.fn()}
      />,
    );
    fireEvent.press(await screen.findByTestId(`paciente-${paciente.id}`));
    await screen.findByText('Agendar cita');
    expect(screen.queryByTestId('ficha-registrar-ahora')).toBeNull();
  });
});
