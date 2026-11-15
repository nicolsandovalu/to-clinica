/**
 * Componentes base accesibles (WCAG 2.2 AA):
 * - área táctil mínima de 48x48 en todo elemento interactivo;
 * - `accessibilityRole` y `accessibilityLabel` explícitos;
 * - los estados se comunican con ícono + texto, nunca solo con color.
 * Los íconos son glifos decorativos ocultos al lector de pantalla: el texto lleva el significado.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import type { EstadoCita } from '../data/tipos';
import {
  AREA_TACTIL_MINIMA,
  ESCALA_FUENTE_MAXIMA,
  VarianteSemantica,
  colores,
  coloresSemanticos,
  espaciado,
  radios,
  tipografia,
} from './tema';

function Icono({ glifo, color }: { glifo: string; color: string }) {
  return (
    <Text
      style={[estilos.icono, { color }]}
      accessibilityElementsHidden
      importantForAccessibility="no"
      maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
    >
      {glifo}
    </Text>
  );
}

// ---------- Botones ----------

interface PropsBoton {
  readonly titulo: string;
  readonly onPress: () => void;
  /** Por defecto se usa `titulo`. */
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly deshabilitado?: boolean;
  /** Muestra un indicador de progreso y bloquea el botón. */
  readonly cargando?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

function Boton({ variante, ...props }: PropsBoton & { variante: 'primario' | 'secundario' }) {
  const inactivo = props.deshabilitado === true || props.cargando === true;
  const esPrimario = variante === 'primario';
  const colorTexto = inactivo
    ? colores.deshabilitadoTexto
    : esPrimario
      ? colores.sobrePrimario
      : colores.primario;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.titulo}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={{ disabled: inactivo, busy: props.cargando === true }}
      testID={props.testID}
      style={({ pressed }) => [
        estilos.boton,
        esPrimario ? estilos.botonPrimario : estilos.botonSecundario,
        pressed && (esPrimario ? estilos.botonPrimarioPresionado : estilos.botonSecundarioPresionado),
        inactivo && estilos.botonInactivo,
        props.style,
      ]}
    >
      {props.cargando === true ? <ActivityIndicator color={colorTexto} /> : null}
      <Text
        style={[estilos.textoBoton, { color: colorTexto }]}
        maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
      >
        {props.titulo}
      </Text>
    </Pressable>
  );
}

export function BotonPrimario(props: PropsBoton) {
  return <Boton {...props} variante="primario" />;
}

export function BotonSecundario(props: PropsBoton) {
  return <Boton {...props} variante="secundario" />;
}

// ---------- Campo de texto ----------

interface PropsCampoTexto extends Omit<TextInputProps, 'style' | 'accessibilityLabel'> {
  /** Etiqueta visible; también es el nombre accesible del campo. */
  readonly etiqueta: string;
  readonly error?: string | null;
  readonly ayuda?: string;
}

export function CampoTexto({ etiqueta, error, ayuda, ...resto }: PropsCampoTexto) {
  const [enfocado, setEnfocado] = useState(false);
  const hayError = typeof error === 'string' && error.length > 0;
  return (
    <View style={estilos.campo}>
      <Text style={estilos.etiqueta} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
        {etiqueta}
      </Text>
      <TextInput
        {...resto}
        accessibilityLabel={hayError ? `${etiqueta}. Error: ${error}` : etiqueta}
        accessibilityHint={ayuda}
        placeholderTextColor={colores.textoSecundario}
        maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
        onFocus={(evento) => {
          setEnfocado(true);
          resto.onFocus?.(evento);
        }}
        onBlur={(evento) => {
          setEnfocado(false);
          resto.onBlur?.(evento);
        }}
        style={[
          estilos.entrada,
          resto.multiline === true && estilos.entradaMultilinea,
          enfocado && estilos.entradaEnfocada,
          hayError && estilos.entradaConError,
        ]}
      />
      {hayError ? (
        <View style={estilos.filaMensaje} accessible accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Icono glifo="⚠" color={colores.error} />
          <Text style={estilos.textoError} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
            {error}
          </Text>
        </View>
      ) : ayuda !== undefined ? (
        <Text style={estilos.textoAyuda} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
          {ayuda}
        </Text>
      ) : null}
    </View>
  );
}

// ---------- Tarjeta ----------

interface PropsTarjeta {
  readonly children: React.ReactNode;
  /** Si se indica, la tarjeta completa es un botón y `accessibilityLabel` es obligatorio. */
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

export function Tarjeta(props: PropsTarjeta) {
  if (props.onPress === undefined) {
    return (
      <View style={[estilos.tarjeta, props.style]} testID={props.testID}>
        {props.children}
      </View>
    );
  }
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      testID={props.testID}
      style={({ pressed }) => [estilos.tarjeta, pressed && estilos.tarjetaPresionada, props.style]}
    >
      {props.children}
    </Pressable>
  );
}

// ---------- Chip de estado ----------

interface PropsChipEstado {
  readonly variante: VarianteSemantica;
  /** Glifo que acompaña siempre al texto. */
  readonly icono: string;
  readonly texto: string;
}

export function ChipEstado({ variante, icono, texto }: PropsChipEstado) {
  const { texto: color, fondo } = coloresSemanticos[variante];
  return (
    <View
      style={[estilos.chip, { backgroundColor: fondo, borderColor: color }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Estado: ${texto}`}
    >
      <Icono glifo={icono} color={color} />
      <Text style={[estilos.textoChip, { color }]} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
        {texto}
      </Text>
    </View>
  );
}

export const CHIPS_ESTADO_CITA: Record<EstadoCita, PropsChipEstado> = {
  pendiente: { variante: 'advertencia', icono: '◷', texto: 'Pendiente' },
  confirmada: { variante: 'exito', icono: '✓', texto: 'Confirmada' },
  cancelada: { variante: 'error', icono: '✕', texto: 'Cancelada' },
  sin_respuesta: { variante: 'neutro', icono: '?', texto: 'Sin respuesta' },
};

export function ChipEstadoCita({ estado }: { estado: EstadoCita }) {
  return <ChipEstado {...CHIPS_ESTADO_CITA[estado]} />;
}

// ---------- Banner de conexión ----------

interface PropsBannerConexion {
  readonly conectado: boolean;
  /** Cambios guardados localmente que aún no llegan al servidor. */
  readonly pendientes: number;
}

export function mensajeBannerConexion({ conectado, pendientes }: PropsBannerConexion): string {
  const cambios = pendientes === 1 ? '1 cambio' : `${pendientes} cambios`;
  if (!conectado) {
    return pendientes > 0
      ? `Sin conexión. ${cambios} guardados en este teléfono; se enviarán al reconectar.`
      : 'Sin conexión. Puedes seguir trabajando; todo se guarda en este teléfono.';
  }
  return pendientes > 0 ? `Sincronizando ${cambios}…` : 'Todo sincronizado.';
}

export function BannerConexion(props: PropsBannerConexion) {
  const variante: VarianteSemantica = !props.conectado
    ? 'advertencia'
    : props.pendientes > 0
      ? 'info'
      : 'exito';
  const icono = !props.conectado ? '⚠' : props.pendientes > 0 ? '↻' : '✓';
  const { texto: color, fondo } = coloresSemanticos[variante];
  const mensaje = mensajeBannerConexion(props);
  return (
    <View
      style={[estilos.banner, { backgroundColor: fondo, borderColor: color }]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={mensaje}
    >
      <Icono glifo={icono} color={color} />
      <Text style={[estilos.textoBanner, { color }]} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
        {mensaje}
      </Text>
    </View>
  );
}

const estilos = StyleSheet.create({
  icono: { ...tipografia.cuerpoDestacado },
  boton: {
    minHeight: AREA_TACTIL_MINIMA,
    minWidth: AREA_TACTIL_MINIMA,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: espaciado.s,
    paddingHorizontal: espaciado.xl,
    paddingVertical: espaciado.m,
    borderRadius: radios.m,
    borderWidth: 2,
  },
  botonPrimario: { backgroundColor: colores.primario, borderColor: colores.primario },
  botonPrimarioPresionado: {
    backgroundColor: colores.primarioPresionado,
    borderColor: colores.primarioPresionado,
  },
  botonSecundario: { backgroundColor: colores.superficie, borderColor: colores.primario },
  botonSecundarioPresionado: { backgroundColor: colores.infoFondo },
  botonInactivo: {
    backgroundColor: colores.deshabilitadoFondo,
    borderColor: colores.deshabilitadoFondo,
  },
  textoBoton: { ...tipografia.cuerpoDestacado, textAlign: 'center' },
  campo: { gap: espaciado.xs },
  etiqueta: { ...tipografia.etiqueta, color: colores.texto },
  entrada: {
    ...tipografia.cuerpo,
    minHeight: AREA_TACTIL_MINIMA,
    paddingHorizontal: espaciado.m,
    paddingVertical: espaciado.m,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: radios.s,
    backgroundColor: colores.superficie,
    color: colores.texto,
  },
  entradaMultilinea: { minHeight: AREA_TACTIL_MINIMA * 2, textAlignVertical: 'top' },
  entradaEnfocada: { borderColor: colores.foco, borderWidth: 2 },
  entradaConError: { borderColor: colores.error, borderWidth: 2 },
  filaMensaje: { flexDirection: 'row', alignItems: 'flex-start', gap: espaciado.xs },
  textoError: { ...tipografia.auxiliar, color: colores.error, flex: 1 },
  textoAyuda: { ...tipografia.auxiliar, color: colores.textoSecundario },
  tarjeta: {
    minHeight: AREA_TACTIL_MINIMA,
    padding: espaciado.l,
    borderRadius: radios.l,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    gap: espaciado.s,
  },
  tarjetaPresionada: { backgroundColor: colores.infoFondo },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: espaciado.xs,
    paddingHorizontal: espaciado.m,
    paddingVertical: espaciado.xs,
    borderRadius: radios.completo,
    borderWidth: 1,
  },
  textoChip: { ...tipografia.etiqueta },
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: espaciado.s,
    paddingHorizontal: espaciado.l,
    paddingVertical: espaciado.m,
    borderBottomWidth: 1,
  },
  textoBanner: { ...tipografia.auxiliar, flex: 1 },
});
