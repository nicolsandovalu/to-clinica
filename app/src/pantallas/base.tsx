/** Piezas de maquetación compartidas por las pantallas. */
import React, { createContext, useContext } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ESCALA_FUENTE_MAXIMA, colores, espaciado, tipografia } from '../ui/tema';

/** `true` dentro de la navegación principal, donde el banner superior ya respeta el margen del sistema. */
export const ContextoDentroDePrincipal = createContext(false);

export function Pantalla({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const dentro = useContext(ContextoDentroDePrincipal);
  const margenes = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={estilos.fondo} behavior="padding">
      <ScrollView
        style={estilos.fondo}
        contentContainerStyle={[estilos.contenido, { paddingTop: dentro ? espaciado.l : margenes.top + espaciado.xxl }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        testID={testID}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
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
