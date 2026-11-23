/** E2 Agenda (HU-04, HU-06): citas del día por hora, estado en un toque y confirmación por WhatsApp. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import { Agenda, MENSAJE_ERROR_AGENDA, TEXTO_SIN_TELEFONO } from '../src/pantallas/Agenda';
import { crearRepositorioMemoria } from './ayudas/entorno';

const DIA = new Date(2026, 2, 2, 9, 0, 0);
const HORA_TARDE = new Date(2026, 2, 2, 15, 30, 0).toISOString();
const HORA_MANANA = new Date(2026, 2, 2, 10, 0, 0).toISOString();

async function prepararAgenda() {
  const repo = crearRepositorioMemoria();
  const apoderado = await repo.crearApoderado({
    propietaria_id: '1',
    nombre: 'Apoderada Ficticia',
    telefono: '+56912345678',
  });
  const conTelefono = await repo.crearPaciente({
    propietaria_id: '1',
    nombre: 'Paciente Con Teléfono',
    apoderado_id: apoderado.id,
  });
  const sinTelefono = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Sin Teléfono' });
  const citaTarde = await repo.crearCita({ paciente_id: conTelefono.id, fecha_hora: HORA_TARDE });
  const citaManana = await repo.crearCita({ paciente_id: sinTelefono.id, fecha_hora: HORA_MANANA });
  return { repo, citaTarde, citaManana };
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('pantalla Agenda', () => {
  it('lista las citas del día ordenadas por hora', async () => {
    const { repo, citaManana, citaTarde } = await prepararAgenda();
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    expect(await screen.findByTestId(`cita-${citaManana.id}`)).toBeTruthy();
    const textos = screen.getAllByText(/·/).map((n) => String(n.props.children.join('')));
    expect(textos[0]).toContain('Paciente Sin Teléfono');
    expect(textos[1]).toContain('Paciente Con Teléfono');
    expect(screen.getByTestId(`cita-${citaTarde.id}`)).toBeTruthy();
  });

  it('sin citas muestra «No hay citas para hoy.»', async () => {
    await render(<Agenda repositorio={crearRepositorioMemoria()} alRegistrarSesion={jest.fn()} dia={DIA} />);
    expect(await screen.findByText('No hay citas para hoy.')).toBeTruthy();
  });

  it('«Registrar sesión» lleva a la cita elegida en un toque', async () => {
    const { repo, citaTarde } = await prepararAgenda();
    const alRegistrarSesion = jest.fn();
    await render(<Agenda repositorio={repo} alRegistrarSesion={alRegistrarSesion} dia={DIA} />);

    await fireEvent.press(await screen.findByTestId(`registrar-${citaTarde.id}`));
    expect(alRegistrarSesion).toHaveBeenCalledWith(citaTarde.id);
  });

  it('con teléfono válido abre WhatsApp con un mensaje sin datos clínicos', async () => {
    const { repo, citaTarde } = await prepararAgenda();
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    abrir.mockClear();
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    await fireEvent.press(await screen.findByTestId(`confirmar-${citaTarde.id}`));
    await waitFor(() => expect(abrir).toHaveBeenCalledTimes(1));
    const enlace = String(abrir.mock.calls[0]?.[0]);
    expect(enlace.startsWith('https://wa.me/56912345678?text=')).toBe(true);
    expect(decodeURIComponent(enlace)).toContain('Paciente Con Teléfono');
  });

  it('sin teléfono el botón queda deshabilitado y se muestra el aviso', async () => {
    const { repo, citaManana } = await prepararAgenda();
    const abrir = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    abrir.mockClear();
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    const boton = await screen.findByTestId(`confirmar-${citaManana.id}`);
    expect(boton).toBeDisabled();
    expect(screen.getByText(TEXTO_SIN_TELEFONO)).toBeTruthy();
    await fireEvent.press(boton);
    expect(abrir).not.toHaveBeenCalled();
  });

  it('si WhatsApp no se puede abrir, informa el error', async () => {
    const { repo, citaTarde } = await prepararAgenda();
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('sin WhatsApp'));
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    await fireEvent.press(await screen.findByTestId(`confirmar-${citaTarde.id}`));
    expect(await screen.findByText('No se pudo abrir WhatsApp en este teléfono.')).toBeTruthy();
  });

  it('cambia el estado de la cita con un toque y lo persiste', async () => {
    const { repo, citaTarde } = await prepararAgenda();
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    const chips = await screen.findAllByTestId('estado-confirmada');
    const chipTarde = chips[1];
    expect(chipTarde).toBeDefined();
    if (chipTarde !== undefined) await fireEvent.press(chipTarde);
    await waitFor(async () => expect((await repo.obtenerCita(citaTarde.id))?.estado).toBe('confirmada'));
  });

  it('si falla la carga muestra el mensaje genérico de la agenda', async () => {
    const repo = crearRepositorioMemoria();
    jest.spyOn(repo, 'listarCitasEntre').mockRejectedValue(new Error('detalle interno'));
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);

    expect(await screen.findByText(MENSAJE_ERROR_AGENDA)).toBeTruthy();
    expect(screen.queryByText(/detalle interno/)).toBeNull();
  });
});
