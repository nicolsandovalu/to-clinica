/** Adaptador de `@react-native-community/netinfo` al contrato `MonitorRed` del motor. */
import NetInfo from '@react-native-community/netinfo';

import type { MonitorRed } from './motorSync';

/**
 * Hay conexión si el dispositivo tiene red y no se sabe que internet sea
 * inalcanzable (`isInternetReachable` es `null` mientras se comprueba).
 */
export function hayConexion(estado: {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  return estado.isConnected === true && estado.isInternetReachable !== false;
}

export const monitorRedNetInfo: MonitorRed = {
  suscribir: (oyente) => NetInfo.addEventListener((estado) => oyente(hayConexion(estado))),
};
