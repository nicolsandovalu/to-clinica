/** Piezas de maquetación compartidas por las pantallas. */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ESCALA_FUENTE_MAXIMA, colores, espaciado, tipografia } from '../ui/tema';

export function Pantalla({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <ScrollView
      style={estilos.fondo}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

export function Titulo({ children }: { children: string }) {
  return (
    <Text style={estilos.titulo} accessibilityRole="header" maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
      {children}
    </Text>
  );
}

export function Subtitulo({ children }: { children: string }) {
  return (
    <Text
      style={estilos.subtitulo}
      accessibilityRole="header"
      maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
    >
      {children}
    </Text>
  );
}

export function Parrafo({ children }: { children: React.ReactNode }) {
  return (
    <Text style={estilos.parrafo} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
      {children}
    </Text>
  );
}

/** Mensaje de error anunciado por el lector de pantalla; ícono + texto. */
export function MensajeError({ mensaje }: { mensaje: string | null }) {
  if (mensaje === null) return null;
  return (
    <View style={estilos.error} accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text
        style={estilos.textoError}
        accessibilityElementsHidden
        importantForAccessibility="no"
        maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
      >
        ⚠
      </Text>
      <Text style={[estilos.textoError, estilos.flexible]} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
        {mensaje}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: colores.fondo },
  contenido: {
    flexGrow: 1,
    padding: espaciado.xl,
    paddingTop: espaciado.xxl * 2,
    gap: espaciado.l,
  },
  titulo: { ...tipografia.titulo, color: colores.texto },
  subtitulo: { ...tipografia.subtitulo, color: colores.texto },
  parrafo: { ...tipografia.cuerpo, color: colores.texto },
  error: {
    flexDirection: 'row',
    gap: espaciado.s,
    padding: espaciado.m,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colores.error,
    backgroundColor: colores.errorFondo,
  },
  textoError: { ...tipografia.cuerpo, color: colores.error },
  flexible: { flex: 1 },
});
