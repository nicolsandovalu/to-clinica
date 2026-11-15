/** Conexión del `MotorSync` con React. */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { AlmacenSeguro, CLAVES_ALMACEN } from '../../data/almacenSeguro';
import type { IRepositorioClinico } from '../../data/repositorio';
import { monitorRedNetInfo } from './monitorRed';
import { ApiSync, EstadoSincronizacion, MotorSync } from './motorSync';

export interface OpcionesMotorSync {
  readonly repositorio: IRepositorioClinico;
  readonly api: ApiSync;
  readonly almacenSeguro: AlmacenSeguro;
}

/** Motor real del dispositivo: red vía NetInfo y token desde el almacén seguro. */
export function crearMotorSync({ repositorio, api, almacenSeguro }: OpcionesMotorSync): MotorSync {
  return new MotorSync({
    repositorio,
    api,
    red: monitorRedNetInfo,
    obtenerToken: () => almacenSeguro.obtener(CLAVES_ALMACEN.token),
  });
}

export interface ValorSincronizacion extends EstadoSincronizacion {
  /** Fuerza un envío de la cola pendiente. */
  readonly sincronizarAhora: () => Promise<void>;
  /** Llamar tras guardar un cambio local para actualizar el contador y enviarlo. */
  readonly notificarCambioLocal: () => Promise<void>;
  /** Restauración completa desde el servidor (dispositivo nuevo). Rechaza si falla. */
  readonly restaurarDesdeServidor: () => Promise<void>;
}

/**
 * Mantiene el motor activo mientras el componente está montado y expone su
 * estado (`conectado`, `pendientes`, `mensaje`...). Montarlo solo con la app
 * desbloqueada: al volver a primer plano reintenta el envío.
 */
export function useSincronizacion(motor: MotorSync): ValorSincronizacion {
  const estado = useSyncExternalStore(motor.suscribir, motor.obtenerEstado);

  useEffect(() => {
    motor.iniciar();
    const suscripcion = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active') void motor.sincronizar();
    });
    return () => {
      suscripcion.remove();
      motor.detener();
    };
  }, [motor]);

  const sincronizarAhora = useCallback(() => motor.sincronizar(), [motor]);
  const notificarCambioLocal = useCallback(() => motor.notificarCambioLocal(), [motor]);
  const restaurar = useCallback(() => motor.restaurarDesdeServidor(), [motor]);

  return { ...estado, sincronizarAhora, notificarCambioLocal, restaurarDesdeServidor: restaurar };
}
