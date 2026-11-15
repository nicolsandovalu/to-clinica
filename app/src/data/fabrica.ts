/**
 * Único punto donde la capa de datos toca los módulos nativos de Expo.
 * Requiere el plugin `expo-sqlite` con `useSQLCipher: true` (ver app.json).
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

import type { AlmacenSeguro } from './almacenSeguro';
import type { DependenciasRepositorio, IRepositorioClinico } from './repositorio';
import { RepositorioSQLite } from './repositorioSQLite';

const NOMBRE_BASE_DATOS = 'to_clinica.db';

/** Los secretos no salen del dispositivo ni viajan en respaldos de la nube. */
const OPCIONES_SECURE_STORE: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const almacenSeguroExpo: AlmacenSeguro = {
  obtener: (clave) => SecureStore.getItemAsync(clave, OPCIONES_SECURE_STORE),
  guardar: (clave, valor) => SecureStore.setItemAsync(clave, valor, OPCIONES_SECURE_STORE),
  eliminar: (clave) => SecureStore.deleteItemAsync(clave, OPCIONES_SECURE_STORE),
};

export const dependenciasReales: DependenciasRepositorio = {
  generarUuid: () => Crypto.randomUUID(),
  ahora: () => new Date().toISOString(),
};

export function crearRepositorioSQLite(): IRepositorioClinico {
  return new RepositorioSQLite({
    ...dependenciasReales,
    almacenSeguro: almacenSeguroExpo,
    generarBytesAleatorios: (cantidad) => Crypto.getRandomBytesAsync(cantidad),
    abrirBaseDatos: () => SQLite.openDatabaseAsync(NOMBRE_BASE_DATOS),
  });
}
