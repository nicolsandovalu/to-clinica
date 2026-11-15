import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { ESTADOS_CITA } from '../src/data/tipos';
import {
  BannerConexion,
  BotonPrimario,
  BotonSecundario,
  CHIPS_ESTADO_CITA,
  CampoTexto,
  ChipEstado,
  ChipEstadoCita,
  Tarjeta,
  mensajeBannerConexion,
} from '../src/ui/componentes';
import {
  AREA_TACTIL_MINIMA,
  CONTRASTE_MINIMO,
  PARES_CONTRASTE,
  colores,
  razonContraste,
} from '../src/ui/tema';

/** Los íconos son decorativos (ocultos al lector de pantalla), pero deben estar en pantalla. */
const OCULTOS = { includeHiddenElements: true };

type Estilo = Parameters<typeof StyleSheet.flatten>[0];
const estiloDe = (elemento: { props: Record<string, unknown> }) =>
  StyleSheet.flatten(elemento.props.style as Estilo) as Record<string, unknown>;

describe('tema', () => {
  it('calcula la razón de contraste WCAG', () => {
    expect(razonContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(razonContraste('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(razonContraste('#777777', '#FFFFFF')).toBeLessThan(CONTRASTE_MINIMO);
  });

  it('usa los colores base definidos', () => {
    expect(colores).toMatchObject({ primario: '#155E75', fondo: '#F7F8FA', texto: '#1F2937' });
  });

  it.each(PARES_CONTRASTE.map(([texto, fondo]) => [texto, fondo] as [string, string]))(
    'el par %s sobre %s tiene contraste >= 4.5:1',
    (texto, fondo) => {
      expect(razonContraste(texto, fondo)).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
    },
  );

  it('el área táctil mínima es de 48 px', () => {
    expect(AREA_TACTIL_MINIMA).toBe(48);
  });
});

describe('botones', () => {
  it.each([
    ['BotonPrimario', BotonPrimario],
    ['BotonSecundario', BotonSecundario],
  ])('%s: rol, etiqueta, área táctil y pulsación', async (_nombre, Boton) => {
    const alPresionar = jest.fn();
    await render(<Boton titulo="Guardar" onPress={alPresionar} />);

    const boton = screen.getByRole('button', { name: 'Guardar' });
    expect(estiloDe(boton).minHeight).toBeGreaterThanOrEqual(48);
    expect(estiloDe(boton).minWidth).toBeGreaterThanOrEqual(48);
    await fireEvent.press(boton);
    expect(alPresionar).toHaveBeenCalledTimes(1);
  });

  it('deshabilitado o cargando no responde y lo informa al lector de pantalla', async () => {
    const alPresionar = jest.fn();
    await render(
      <>
        <BotonPrimario titulo="Uno" onPress={alPresionar} deshabilitado />
        <BotonSecundario titulo="Dos" onPress={alPresionar} cargando />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Uno' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Dos' }));

    expect(alPresionar).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Uno' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dos' })).toBeBusy();
  });

  it('admite una etiqueta accesible distinta del título', async () => {
    await render(<BotonPrimario titulo="+" onPress={() => undefined} accessibilityLabel="Agregar paciente" />);
    expect(screen.getByRole('button', { name: 'Agregar paciente' })).toBeTruthy();
  });
});

describe('CampoTexto', () => {
  it('usa la etiqueta visible como nombre accesible y respeta el área táctil', async () => {
    const alCambiar = jest.fn();
    await render(<CampoTexto etiqueta="Nombre" value="" onChangeText={alCambiar} />);

    expect(screen.getByText('Nombre')).toBeTruthy();
    const campo = screen.getByLabelText('Nombre');
    expect(estiloDe(campo).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent.changeText(campo, 'Ana');
    expect(alCambiar).toHaveBeenCalledWith('Ana');
  });

  it('el error se muestra con ícono y texto, y se anuncia', async () => {
    await render(<CampoTexto etiqueta="Teléfono" value="123" error="Formato inválido" />);

    expect(screen.getByText('Formato inválido')).toBeTruthy();
    expect(screen.getByText('⚠', OCULTOS)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText('Teléfono. Error: Formato inválido')).toBeTruthy();
  });
});

describe('Tarjeta', () => {
  it('como contenedor no es interactiva', async () => {
    await render(
      <Tarjeta>
        <Text>Contenido</Text>
      </Tarjeta>,
    );
    expect(screen.getByText('Contenido')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('pulsable: es un botón con etiqueta y área táctil mínima', async () => {
    const alPresionar = jest.fn();
    await render(
      <Tarjeta onPress={alPresionar} accessibilityLabel="Abrir ficha">
        <Text>Contenido</Text>
      </Tarjeta>,
    );
    const tarjeta = screen.getByRole('button', { name: 'Abrir ficha' });
    expect(estiloDe(tarjeta).minHeight).toBeGreaterThanOrEqual(48);
    await fireEvent.press(tarjeta);
    expect(alPresionar).toHaveBeenCalled();
  });
});

describe('estados: siempre ícono + texto', () => {
  it('ChipEstado muestra ambos y expone el estado en su etiqueta', async () => {
    await render(<ChipEstado variante="exito" icono="✓" texto="Sincronizado" />);
    expect(screen.getByText('✓', OCULTOS)).toBeTruthy();
    expect(screen.getByText('Sincronizado')).toBeTruthy();
    expect(screen.getByLabelText('Estado: Sincronizado')).toBeTruthy();
  });

  it('cada estado de cita tiene texto e ícono propios (distinguibles sin color)', async () => {
    const iconos = ESTADOS_CITA.map((estado) => CHIPS_ESTADO_CITA[estado].icono);
    const textos = ESTADOS_CITA.map((estado) => CHIPS_ESTADO_CITA[estado].texto);
    expect(new Set(iconos).size).toBe(ESTADOS_CITA.length);
    expect(new Set(textos).size).toBe(ESTADOS_CITA.length);
    expect(iconos.every((icono) => icono.length > 0)).toBe(true);

    await render(<ChipEstadoCita estado="sin_respuesta" />);
    expect(screen.getByText('Sin respuesta')).toBeTruthy();
    expect(screen.getByText('?', OCULTOS)).toBeTruthy();
  });

  it.each([
    [{ conectado: false, pendientes: 3 }, '⚠', /Sin conexión\. 3 cambios guardados/],
    [{ conectado: false, pendientes: 0 }, '⚠', /Sin conexión\. Puedes seguir trabajando/],
    [{ conectado: true, pendientes: 1 }, '↻', /Sincronizando 1 cambio…/],
    [{ conectado: true, pendientes: 0 }, '✓', /Todo sincronizado\./],
  ])('BannerConexion %o', async (props, icono, texto) => {
    await render(<BannerConexion {...props} />);
    expect(screen.getByText(icono, OCULTOS)).toBeTruthy();
    expect(screen.getByText(texto)).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText(mensajeBannerConexion(props))).toBeTruthy();
  });
});
