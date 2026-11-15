/**
 * Conexión del `GestorAcceso` con React.
 * `CompuertaAcceso` es el único punto que decide si el contenido clínico se
 * monta: mientras la fase no sea `desbloqueada`, `children` ni siquiera se
 * renderiza (falla cerrada).
 */
import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { C1Politica } from '../../pantallas/C1Politica';
import {
  E1Acceso,
  PantallaBloqueo,
  PantallaCarga,
  PantallaRestauracion,
} from '../../pantallas/E1Acceso';
import { colores } from '../../ui/tema';
import type { EstadoAcceso, GestorAcceso } from './gestorAcceso';

interface ValorContexto {
  readonly gestor: GestorAcceso;
  readonly estado: EstadoAcceso;
  /** `false` mientras la app está en segundo plano o en el selector de apps. */
  readonly enPrimerPlano: boolean;
}

const Contexto = createContext<ValorContexto | null>(null);

export function useAcceso(): ValorContexto {
  const valor = useContext(Contexto);
  if (valor === null) throw new Error('useAcceso debe usarse dentro de ProveedorAcceso.');
  return valor;
}

export function ProveedorAcceso({ gestor, children }: { gestor: GestorAcceso; children: React.ReactNode }) {
  const estado = useSyncExternalStore(gestor.suscribir, gestor.obtenerEstado);
  const [enPrimerPlano, setEnPrimerPlano] = useState(AppState.currentState !== 'background');

  useEffect(() => {
    void gestor.iniciar();
    const suscripcion = AppState.addEventListener('change', (estadoApp) => {
      setEnPrimerPlano(estadoApp === 'active');
      gestor.alCambiarEstadoApp(estadoApp);
    });
    return () => suscripcion.remove();
  }, [gestor]);

  return (
    <Contexto.Provider value={{ gestor, estado, enPrimerPlano }}>
      <View
        style={estilos.raiz}
        // Cualquier toque cuenta como actividad; no captura el gesto.
        onStartShouldSetResponderCapture={() => {
          gestor.registrarActividad();
          return false;
        }}
      >
        {children}
      </View>
    </Contexto.Provider>
  );
}

export function CompuertaAcceso({ children }: { children: React.ReactNode }) {
  const { gestor, estado, enPrimerPlano } = useAcceso();
  const { fase, ocupada, error } = estado;

  switch (fase) {
    case 'desbloqueada':
      return (
        <View style={estilos.raiz}>
          {children}
          {/* Tapa el contenido en el selector de aplicaciones sin desmontarlo. */}
          {enPrimerPlano ? null : <View style={estilos.cortina} testID="cortina-privacidad" />}
        </View>
      );
    case 'politica_pendiente':
      return <C1Politica ocupada={ocupada} error={error} alAceptar={() => void gestor.aceptarPolitica()} />;
    case 'sin_sesion':
      return (
        <E1Acceso
          ocupada={ocupada}
          error={error}
          alIniciarSesion={(email, password) => void gestor.iniciarSesion(email, password)}
        />
      );
    case 'restaurando':
    case 'restauracion_fallida':
      return (
        <PantallaRestauracion
          fallida={fase === 'restauracion_fallida'}
          ocupada={ocupada}
          error={error}
          alReintentar={() => void gestor.reintentarRestauracion()}
          alCerrarSesion={() => void gestor.cerrarSesion()}
        />
      );
    case 'bloqueada':
      return (
        <PantallaBloqueo
          ocupada={ocupada}
          error={error}
          alDesbloquear={() => void gestor.desbloquear()}
          alCerrarSesion={() => void gestor.cerrarSesion()}
        />
      );
    case 'cargando':
    case 'error_inicio':
      return <PantallaCarga error={error} alReintentar={() => void gestor.iniciar()} />;
  }
}

const estilos = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colores.fondo },
  cortina: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colores.fondo,
  },
});
