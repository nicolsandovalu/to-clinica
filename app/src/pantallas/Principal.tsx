/**
 * Navegación principal tras desbloquear: Agenda (E2), Pacientes/Ficha (E3),
 * Registro (E4), Historial, Borrador (E5) y Formularios (C2/C3).
 * El banner global muestra el estado de sincronización (`useSincronizacion`).
 */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { IRepositorioClinico } from '../data/repositorio';
import type { GestorAcceso, EstadoAcceso } from '../modules/acceso/gestorAcceso';
import type { MotorSync } from '../modules/sincronizacion/motorSync';
import { conNotificacionDeCambios } from '../modules/sincronizacion/notificador';
import { useSincronizacion } from '../modules/sincronizacion/useSincronizacion';
import { BannerConexion, BotonSecundario } from '../ui/componentes';
import { colores, espaciado } from '../ui/tema';
import { Agenda } from './Agenda';
import { Borrador } from './Borrador';
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
  return pantalla(contenido);

  function pantalla(cuerpo: React.ReactNode) {
    return (
      <View style={estilos.raiz} testID="principal">
        <View style={estilos.banner}>
          <BannerConexion conectado={sync.conectado} pendientes={sync.pendientes} />
        </View>
        <View style={estilos.cuerpo}>{cuerpo}</View>
        <View style={estilos.barra} accessibilityRole="tablist">
          <BotonSecundario titulo="Agenda" onPress={irAgenda} style={estilos.opcion} testID="nav-agenda" />
          <BotonSecundario titulo="Pacientes" onPress={irPacientes} style={estilos.opcion} testID="nav-pacientes" />
          <BotonSecundario
            titulo="Informe"
            onPress={() => setRuta({ pantalla: 'borrador' })}
            style={estilos.opcion}
            testID="nav-informe"
          />
          <BotonSecundario
            titulo="Salir"
            accessibilityLabel="Cerrar sesión"
            onPress={() => void gestor.cerrarSesion()}
            style={estilos.opcion}
            testID="nav-salir"
          />
        </View>
      </View>
    );
  }
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colores.fondo },
  banner: { paddingTop: espaciado.xxl + espaciado.l, paddingHorizontal: espaciado.l },
  cuerpo: { flex: 1 },
  barra: {
    flexDirection: 'row',
    gap: espaciado.s,
    padding: espaciado.s,
    borderTopWidth: 1,
    borderTopColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  opcion: { flex: 1, paddingHorizontal: espaciado.xs },
});
