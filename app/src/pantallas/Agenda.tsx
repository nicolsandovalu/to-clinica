/** E2 — Agenda: citas del día, estado editable en 1 toque, registro de sesión y confirmación por WhatsApp. */
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import { ESTADOS_CITA, EstadoCita } from '../data/tipos';
import { CitaConPaciente, listarCitasDelDia } from '../modules/pacientes-agenda/servicio';
import {
  construirEnlaceConfirmacionWhatsApp,
  formatearFechaHoraCita,
} from '../modules/pacientes-agenda/whatsapp';
import {
  BotonPrimario,
  BotonSecundario,
  Avatar,
  CHIPS_ESTADO_CITA,
  ChipEstado,
  Tarjeta,
} from '../ui/componentes';
import { AREA_TACTIL_MINIMA, ESCALA_FUENTE_MAXIMA, colores, espaciado, tipografia } from '../ui/tema';
import { MensajeError, Pantalla, Parrafo, Titulo } from './base';

export const TEXTO_SIN_TELEFONO = 'Agregar teléfono del apoderado';
export const MENSAJE_ERROR_AGENDA = 'No se pudo actualizar la agenda. Inténtalo de nuevo.';

export interface PropsAgenda {
  readonly repositorio: IRepositorioClinico;
  /** Navega a E4 (Registro de sesión) para la cita indicada. */
  readonly alRegistrarSesion: (citaId: string) => void;
  /** Día a mostrar; por defecto hoy. */
  readonly dia?: Date;
  /** Lleva a la lista de pacientes, desde donde se agendan las citas. */
  readonly alIrAPacientes?: () => void;
}

/** Fecha larga en español, por ejemplo «lunes 23 de noviembre». */
export function formatearDia(dia: Date): string {
  const texto = dia.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function horaLocal(fechaHora: string): string {
  return formatearFechaHoraCita(fechaHora).split(' a las ')[1] ?? '';
}

function SelectorEstado({
  actual,
  alCambiar,
  nombrePaciente,
}: {
  actual: EstadoCita;
  alCambiar: (estado: EstadoCita) => void;
  nombrePaciente: string;
}) {
  return (
    <View style={estilos.chips} accessibilityRole="radiogroup">
      {ESTADOS_CITA.map((estado) => {
        const seleccionado = estado === actual;
        return (
          <Pressable
            key={estado}
            onPress={() => {
              if (!seleccionado) alCambiar(estado);
            }}
            accessibilityRole="radio"
            accessibilityLabel={`${CHIPS_ESTADO_CITA[estado].texto}, cita de ${nombrePaciente}`}
            accessibilityState={{ selected: seleccionado }}
            testID={`estado-${estado}`}
            style={[estilos.chipTactil, seleccionado && estilos.chipSeleccionado]}
          >
            <ChipEstado {...CHIPS_ESTADO_CITA[estado]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function Agenda({ repositorio, alRegistrarSesion, dia, alIrAPacientes }: PropsAgenda) {
  const [citas, setCitas] = useState<CitaConPaciente[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let activo = true;
    listarCitasDelDia(repositorio, dia)
      .then((lista) => {
        if (!activo) return;
        setCitas(lista);
        setError(null);
      })
      .catch(() => {
        if (activo) setError(MENSAJE_ERROR_AGENDA);
      });
    return () => {
      activo = false;
    };
  }, [repositorio, dia, recarga]);

  const cambiarEstado = async (citaId: string, estado: EstadoCita) => {
    try {
      await repositorio.actualizarCita(citaId, { estado });
      setRecarga((n) => n + 1);
    } catch {
      setError(MENSAJE_ERROR_AGENDA);
    }
  };

  const solicitarConfirmacion = async (item: CitaConPaciente) => {
    const enlace = construirEnlaceConfirmacionWhatsApp(
      item.apoderado?.telefono,
      item.paciente.nombre,
      item.cita.fecha_hora,
    );
    if (enlace === null) return;
    try {
      await Linking.openURL(enlace);
    } catch {
      setError('No se pudo abrir WhatsApp en este teléfono.');
    }
  };

  return (
    <Pantalla testID="pantalla-agenda">
      <Titulo>Agenda de hoy</Titulo>
      <Text style={estilos.fecha} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA} testID="fecha-agenda">
        {formatearDia(dia ?? new Date())}
        {citas.length > 0 ? ` (${citas.length === 1 ? '1 cita' : `${citas.length} citas`})` : ''}
      </Text>
      <MensajeError mensaje={error} />
      {citas.length === 0 ? (
        <>
          <Parrafo>No hay citas para hoy.</Parrafo>
          <Parrafo>Para agendar una, abre un paciente y pulsa «Agendar cita».</Parrafo>
          {alIrAPacientes !== undefined ? (
            <BotonSecundario titulo="Ir a pacientes" onPress={alIrAPacientes} testID="agenda-ir-pacientes" />
          ) : null}
        </>
      ) : null}
      {citas.map((item) => {
        const tieneTelefono = construirEnlaceConfirmacionWhatsApp(
          item.apoderado?.telefono,
          item.paciente.nombre,
          item.cita.fecha_hora,
        ) !== null;
        return (
          <Tarjeta key={item.cita.id} testID={`cita-${item.cita.id}`}>
            <View style={estilos.encabezadoCita}>
              <Avatar nombre={item.paciente.nombre} />
              <Text style={[estilos.hora, estilos.flexible]} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                {horaLocal(item.cita.fecha_hora)} · {item.paciente.nombre}
              </Text>
            </View>
            <SelectorEstado
              actual={item.cita.estado}
              nombrePaciente={item.paciente.nombre}
              alCambiar={(estado) => void cambiarEstado(item.cita.id, estado)}
            />
            <BotonPrimario
              titulo="Registrar sesión"
              accessibilityLabel={`Registrar sesión de ${item.paciente.nombre}`}
              onPress={() => alRegistrarSesion(item.cita.id)}
              testID={`registrar-${item.cita.id}`}
            />
            {tieneTelefono ? (
              <BotonSecundario
                titulo="Solicitar confirmación"
                accessibilityLabel={`Solicitar confirmación a ${item.paciente.nombre} por WhatsApp`}
                onPress={() => void solicitarConfirmacion(item)}
                testID={`confirmar-${item.cita.id}`}
              />
            ) : (
              <>
                <BotonSecundario
                  titulo="Solicitar confirmación"
                  accessibilityHint={TEXTO_SIN_TELEFONO}
                  deshabilitado
                  onPress={() => undefined}
                  testID={`confirmar-${item.cita.id}`}
                />
                <Text style={estilos.aviso} maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}>
                  {TEXTO_SIN_TELEFONO}
                </Text>
              </>
            )}
          </Tarjeta>
        );
      })}
    </Pantalla>
  );
}

const estilos = StyleSheet.create({
  aviso: { ...tipografia.auxiliar, color: colores.textoSecundario },
  fecha: { ...tipografia.cuerpo, color: colores.textoSecundario },
  hora: { ...tipografia.subtitulo, color: colores.texto },
  encabezadoCita: { flexDirection: 'row', alignItems: 'center', gap: espaciado.m },
  flexible: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espaciado.s },
  chipTactil: {
    minHeight: AREA_TACTIL_MINIMA,
    justifyContent: 'center',
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  chipSeleccionado: { borderColor: colores.foco },
});
