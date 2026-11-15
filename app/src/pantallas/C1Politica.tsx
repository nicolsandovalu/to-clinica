/** C1 — Política de Privacidad. Bloquea la app hasta la aceptación explícita (AUT-08). */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SECCIONES_POLITICA, VERSION_POLITICA } from '../modules/acceso/politica';
import { BotonPrimario, Tarjeta } from '../ui/componentes';
import { AREA_TACTIL_MINIMA, ESCALA_FUENTE_MAXIMA, colores, espaciado, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Subtitulo, Titulo } from './base';

interface Props {
  readonly ocupada: boolean;
  readonly error: string | null;
  readonly alAceptar: () => void;
}

export function C1Politica({ ocupada, error, alAceptar }: Props) {
  const [marcada, setMarcada] = useState(false);
  return (
    <Pantalla testID="pantalla-politica">
      <Titulo>Política de Privacidad</Titulo>
      <Parrafo>
        Versión {VERSION_POLITICA}. Para usar la aplicación debes leer y aceptar esta política.
      </Parrafo>
      {SECCIONES_POLITICA.map((seccion) => (
        <Tarjeta key={seccion.titulo}>
          <Subtitulo>{seccion.titulo}</Subtitulo>
          {seccion.parrafos.map((parrafo) => (
            <Parrafo key={parrafo}>{parrafo}</Parrafo>
          ))}
        </Tarjeta>
      ))}
      <Pressable
        onPress={() => setMarcada((valor) => !valor)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: marcada }}
        accessibilityLabel="He leído y acepto la Política de Privacidad"
        style={estilos.casilla}
        testID="casilla-politica"
      >
        <View style={[estilos.caja, marcada && estilos.cajaMarcada]}>
          <Text style={estilos.marca} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {marcada ? '✓' : ''}
          </Text>
        </View>
        <Text style={estilos.textoCasilla} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
          He leído y acepto la Política de Privacidad
        </Text>
      </Pressable>
      <MensajeError mensaje={error} />
      <BotonPrimario
        titulo="Aceptar y continuar"
        onPress={alAceptar}
        deshabilitado={!marcada}
        cargando={ocupada}
        accessibilityHint={marcada ? undefined : 'Primero marca la casilla de aceptación'}
        testID="boton-aceptar-politica"
      />
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  casilla: {
    minHeight: AREA_TACTIL_MINIMA,
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.m,
  },
  caja: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderColor: colores.borde,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colores.superficie,
  },
  cajaMarcada: { backgroundColor: colores.primario, borderColor: colores.primario },
  marca: { ...tipografia.cuerpoDestacado, color: colores.sobrePrimario },
  textoCasilla: { ...tipografia.cuerpo, color: colores.texto, flex: 1 },
});
