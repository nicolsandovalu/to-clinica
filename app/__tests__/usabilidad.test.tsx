/** Mejoras de usabilidad: pestaña activa, fecha de la agenda y guías cuando no hay datos. */
import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Agenda, formatearDia } from '../src/pantallas/Agenda';
import { Pacientes, TEXTO_SIN_RESULTADOS } from '../src/pantallas/Pacientes';
import { seccionDe } from '../src/pantallas/Principal';
import { crearRepositorioMemoria } from './ayudas/entorno';

const DIA = new Date(2026, 10, 23, 9, 0, 0); // lunes 23 de noviembre de 2026

describe('pestaña activa de la barra inferior', () => {
  it('cada pantalla pertenece a una pestaña', () => {
    expect(seccionDe({ pantalla: 'agenda' })).toBe('agenda');
    expect(seccionDe({ pantalla: 'registro', citaId: 'c' })).toBe('agenda');
    expect(seccionDe({ pantalla: 'pacientes' })).toBe('pacientes');
    expect(seccionDe({ pantalla: 'historial', pacienteId: 'p' })).toBe('pacientes');
    expect(seccionDe({ pantalla: 'formPaciente' })).toBe('pacientes');
    expect(seccionDe({ pantalla: 'formCita', pacienteId: 'p' })).toBe('pacientes');
    expect(seccionDe({ pantalla: 'borrador' })).toBe('informe');
  });
});

describe('Agenda: fecha y guía', () => {
  it('formatea el día en español con inicial mayúscula', () => {
    expect(formatearDia(DIA)).toMatch(/^Lunes,? 23 de noviembre/);
  });

  it('muestra la fecha del día y cuenta las citas', async () => {
    const repo = crearRepositorioMemoria();
    const paciente = await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio' });
    await repo.crearCita({ paciente_id: paciente.id, fecha_hora: new Date(2026, 10, 23, 10, 0, 0).toISOString() });
    await render(<Agenda repositorio={repo} alRegistrarSesion={jest.fn()} dia={DIA} />);
    const fecha = await screen.findByText(/1 cita/);
    expect(fecha.props.children.join('')).toMatch(/Lunes,? 23 de noviembre \(1 cita\)/);
  });

  it('sin citas explica cómo agendar y ofrece ir a Pacientes', async () => {
    const irAPacientes = jest.fn();
    await render(
      <Agenda
        repositorio={crearRepositorioMemoria()}
        alRegistrarSesion={jest.fn()}
        alIrAPacientes={irAPacientes}
        dia={DIA}
      />,
    );
    expect(await screen.findByText('No hay citas para hoy.')).toBeTruthy();
    expect(screen.getByText(/Para agendar una, abre un paciente/)).toBeTruthy();
    fireEvent.press(screen.getByTestId('agenda-ir-pacientes'));
    expect(irAPacientes).toHaveBeenCalledTimes(1);
  });

  it('sin la acción de navegación no muestra el botón', async () => {
    await render(<Agenda repositorio={crearRepositorioMemoria()} alRegistrarSesion={jest.fn()} dia={DIA} />);
    await screen.findByText('No hay citas para hoy.');
    expect(screen.queryByTestId('agenda-ir-pacientes')).toBeNull();
  });
});

describe('Pacientes: guía y contexto', () => {
  const props = (repositorio: ReturnType<typeof crearRepositorioMemoria>) => ({
    repositorio,
    alNuevoPaciente: jest.fn(),
    alEditar: jest.fn(),
    alAgendar: jest.fn(),
    alHistorial: jest.fn(),
    alBorrador: jest.fn(),
  });

  it('sin pacientes indica cómo crear el primero', async () => {
    await render(<Pacientes {...props(crearRepositorioMemoria())} />);
    expect(await screen.findByText('Aún no hay pacientes.')).toBeTruthy();
    expect(screen.getByText(/Pulsa «Nuevo paciente»/)).toBeTruthy();
  });

  it('una búsqueda sin coincidencias solo dice «Sin resultados»', async () => {
    const repo = crearRepositorioMemoria();
    await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio' });
    await render(<Pacientes {...props(repo)} />);
    await screen.findByText('Paciente Ficticio');
    fireEvent.changeText(screen.getByLabelText('Buscar paciente'), 'zzz');
    expect(await screen.findByText(TEXTO_SIN_RESULTADOS)).toBeTruthy();
    expect(screen.queryByText(/Pulsa «Nuevo paciente»/)).toBeNull();
  });

  it('la lista muestra el nombre del apoderado bajo cada paciente', async () => {
    const repo = crearRepositorioMemoria();
    const apoderado = await repo.crearApoderado({
      propietaria_id: '1',
      nombre: 'Apoderada Ficticia',
      telefono: '+56912345678',
    });
    await repo.crearPaciente({ propietaria_id: '1', nombre: 'Paciente Ficticio', apoderado_id: apoderado.id });
    await render(<Pacientes {...props(repo)} />);
    expect(await screen.findByText('Apoderado: Apoderada Ficticia')).toBeTruthy();
  });
});
