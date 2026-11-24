/**
 * Navegación principal tras desbloquear: Agenda (E2), Pacientes/Ficha (E3),
 * Registro (E4), Historial, Borrador (E5) y Formularios (C2/C3).
 * El banner global muestra el estado de sincronización (`useSincronizacion`).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IRepositorioClinico } from '../data/repositorio';
import type { GestorAcceso, EstadoAcceso } from '../modules/acceso/gestorAcceso';
import type { MotorSync } from '../modules/sincronizacion/motorSync';
import { conNotificacionDeCambios } from '../modules/sincronizacion/notificador';
import { useSincronizacion } from '../modules/sincronizacion/useSincronizacion';
import { BannerConexion } from '../ui/componentes';
import { AREA_TACTIL_MINIMA, ESCALA_FUENTE_MAXIMA, colores, espaciado, radios } from '../ui/tema';
import { Agenda } from './Agenda';
import { Borrador } from './Borrador';
import { ContextoDentroDePrincipal } from './base';
import { FormularioCita, FormularioPaciente } from './Formularios';
import { Historial } from './Historial';
import { Pacientes } from './Pacientes';
import { Registro } from './Registro';

export type Ruta =
  | { readonly pantalla: 'agenda' }
  | { readonly pantalla: 'pacientes' }
  | { readonly pantalla: 'registro'; readonly citaId: string }
  | { readonly pantalla: 'historial'; readonly pacienteId: string }
  | { readonly pantalla: 'borrador'; readonly pacienteId?: string }
  | { readonly pantalla: 'formPaciente'; readonly pacienteId?: string }
  | { readonly pantalla: 'formCita'; readonly pacienteId: string };

export interface PropsPrincipal {
  readonly repositorio: IRepositorioClinico;
  readonly motor: MotorSync;
  readonly gestor: GestorAcceso;
  readonly sesion: NonNullable<EstadoAcceso['sesion']>;
  readonly rutaInicial?: Ruta;
}

export function Principal({ repositorio, motor, gestor, sesion, rutaInicial }: PropsPrincipal) {
  const [ruta, setRuta] = useState<Ruta>(rutaInicial ?? { pantalla: 'agenda' });
  const margenes = useSafeAreaInsets();
  const sync = useSincronizacion(motor);
  const { notificarCambioLocal } = sync;
  const repo = useMemo(
    () => conNotificacionDeCambios(repositorio, notificarCambioLocal),
    [repositorio, notificarCambioLocal],
  );

  const irAgenda = () => setRuta({ pantalla: 'agenda' });
  const irPacientes = () => setRuta({ pantalla: 'pacientes' });

  let contenido: React.ReactNode;
  switch (ruta.pantalla) {
    case 'agenda':
      contenido = (
        <Agenda
          repositorio={repo}
          alRegistrarSesion={(citaId) => setRuta({ pantalla: 'registro', citaId })}
          alIrAPacientes={irPacientes}
        />
      );
      break;
    case 'pacientes':
      contenido = (
        <Pacientes
          repositorio={repo}
          alNuevoPaciente={() => setRuta({ pantalla: 'formPaciente' })}
          alEditar={(pacienteId) => setRuta({ pantalla: 'formPaciente', pacienteId })}
          alAgendar={(pacienteId) => setRuta({ pantalla: 'formCita', pacienteId })}
          alRegistrarAhora={(pacienteId) => {
            void repo
              .crearCita({ paciente_id: pacienteId, fecha_hora: new Date().toISOString() })
              .then((cita) => setRuta({ pantalla: 'registro', citaId: cita.id }));
          }}
          alHistorial={(pacienteId) => setRuta({ pantalla: 'historial', pacienteId })}
          alBorrador={(pacienteId) => setRuta({ pantalla: 'borrador', pacienteId })}
        />
      );
      break;
    case 'registro':
      contenido = <Registro repositorio={repo} citaId={ruta.citaId} alVerSiguiente={irAgenda} />;
      break;
    case 'historial':
      contenido = <Historial repositorio={repo} pacienteId={ruta.pacienteId} alVolver={irPacientes} />;
      break;
    case 'borrador':
      contenido = (
        <Borrador
          repositorio={repo}
          pacienteId={ruta.pacienteId}
          profesional={sesion.email}
          alVolver={irPacientes}
        />
      );
      break;
    case 'formPaciente':
      contenido = (
        <FormularioPaciente
          repositorio={repo}
          propietariaId={sesion.usuaria_id}
          pacienteId={ruta.pacienteId}
          alTerminar={irPacientes}
          alCancelar={irPacientes}
        />
      );
      break;
    case 'formCita':
      contenido = (
        <FormularioCita
          repositorio={repo}
          pacienteId={ruta.pacienteId}
          alTerminar={irAgenda}
          alVolver={irPacientes}
        />
      );
      break;
  }
  const seccion = seccionDe(ruta);
  return pantalla(contenido);

  function pantalla(cuerpo: React.ReactNode) {
    return (
      <ContextoDentroDePrincipal.Provider value>
      <View style={estilos.raiz} testID="principal">
        <View style={[estilos.banner, { paddingTop: Math.max(margenes.top, espaciado.xxl) + espaciado.s }]}>
          <BannerConexion conectado={sync.conectado} pendientes={sync.pendientes} />
        </View>
        <View style={estilos.cuerpo}>{cuerpo}</View>
        <View
          style={[estilos.barra, { paddingBottom: espaciado.s + margenes.bottom }]}
          accessibilityRole="tablist"
        >
          <Pestana titulo="Agenda" glifo="▦" activa={seccion === 'agenda'} onPress={irAgenda} testID="nav-agenda" />
          <Pestana
            titulo="Pacientes"
            glifo="☺"
            activa={seccion === 'pacientes'}
            onPress={irPacientes}
            testID="nav-pacientes"
          />
          <Pestana
            titulo="Informe"
            glifo="▤"
            activa={seccion === 'informe'}
            onPress={() => setRuta({ pantalla: 'borrador' })}
            testID="nav-informe"
          />
          <Pestana
            titulo="Salir"
            accessibilityLabel="Cerrar sesión"
            glifo="⏻"
            activa={false}
            onPress={() => void gestor.cerrarSesion()}
            testID="nav-salir"
          />
        </View>
      </View>
      </ContextoDentroDePrincipal.Provider>
    );
  }
}

type Seccion = 'agenda' | 'pacientes' | 'informe';

/** Pestaña de la barra inferior a la que pertenece cada pantalla (la activa se resalta). */
export function seccionDe(ruta: Ruta): Seccion {
  switch (ruta.pantalla) {
    case 'agenda':
    case 'registro':
      return 'agenda';
    case 'borrador':
      return 'informe';
    default:
      return 'pacientes';
  }
}

function Pestana({
  titulo,
  glifo,
  activa,
  onPress,
  testID,
  accessibilityLabel,
}: {
  titulo: string;
  glifo: string;
  activa: boolean;
  onPress: () => void;
  testID: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? titulo}
      accessibilityState={{ selected: activa }}
      testID={testID}
      style={estilos.opcion}
    >
      <View style={[estilos.icono, activa && estilos.iconoActivo]}>
        <Text
          style={[estilos.glifo, activa && estilos.glifoActivo]}
          accessibilityElementsHidden
          importantForAccessibility="no"
          maxFontSizeMultiplier={ESCALA_FUENTE_MAXIMA}
        >
          {glifo}
        </Text>
      </View>
      <Text
        style={[estilos.etiquetaPestana, activa && estilos.etiquetaActiva]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
        {titulo}
      </Text>
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colores.fondo },
  banner: { paddingHorizontal: espaciado.l },
  cuerpo: { flex: 1 },
  barra: {
    flexDirection: 'row',
    paddingTop: espaciado.s,
    paddingHorizontal: espaciado.s,
    borderTopWidth: 1,
    borderTopColor: colores.bordeSuave,
    backgroundColor: colores.superficie,
  },
  opcion: { flex: 1, minHeight: AREA_TACTIL_MINIMA, alignItems: 'center', gap: 2 },
  icono: {
    width: 56,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radios.completo,
  },
  iconoActivo: { backgroundColor: colores.avatarFondo },
  glifo: { fontSize: 18, lineHeight: 22, color: colores.textoSecundario },
  glifoActivo: { color: colores.primario },
  etiquetaPestana: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: colores.textoSecundario },
  etiquetaActiva: { fontWeight: '700', color: colores.primario },
});
