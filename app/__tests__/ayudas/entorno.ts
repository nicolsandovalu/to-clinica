/** Utilidades compartidas por las pruebas. */
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { AlmacenSeguroMemoria } from '../../src/data/almacenSeguro';
import type { DependenciasRepositorio } from '../../src/data/repositorio';
import { RepositorioMemoria } from '../../src/data/repositorioMemoria';
import {
  BaseDatosSQL,
  ConexionSQL,
  ParametroSQL,
  RepositorioSQLite,
} from '../../src/data/repositorioSQLite';

export const PATRON_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface DependenciasPrueba extends DependenciasRepositorio {
  /** Hace que la n-ésima llamada siguiente a `generarUuid` (1 = la próxima) lance un error. */
  fallarUuidEnLlamada(numero: number): void;
}

/** Reloj determinista (avanza 1 s por lectura) y UUID v4 reales con fallo inyectable. */
export function crearDependencias(): DependenciasPrueba {
  let instante = Date.parse('2026-03-02T12:00:00.000Z');
  let llamadasHastaFallo = 0;
  return {
    ahora: () => {
      instante += 1000;
      return new Date(instante).toISOString();
    },
    generarUuid: () => {
      if (llamadasHastaFallo > 0) {
        llamadasHastaFallo -= 1;
        if (llamadasHastaFallo === 0) throw new Error('fallo simulado al generar UUID');
      }
      return randomUUID();
    },
    fallarUuidEnLlamada: (numero) => {
      llamadasHastaFallo = numero;
    },
  };
}

export interface BaseDatosPrueba extends BaseDatosSQL {
  /** Sentencias recibidas por `execAsync`, en orden. */
  readonly sentenciasExec: string[];
  /** Acceso directo al motor, para verificar restricciones saltándose el repositorio. */
  readonly motor: DatabaseSync;
}

/**
 * Sustituto de `expo-sqlite` sobre el SQLite real de Node (`node:sqlite`): las
 * pruebas ejecutan el mismo SQL y el mismo esquema que el dispositivo. Lo único
 * simulado es SQLCipher (`PRAGMA key` y `PRAGMA cipher_version`).
 */
export function crearBaseDatosPrueba(opciones?: { conCifrado?: boolean }): BaseDatosPrueba {
  const motor = new DatabaseSync(':memory:');
  const sentenciasExec: string[] = [];
  const conexion: ConexionSQL = {
    async execAsync(sql) {
      sentenciasExec.push(sql);
      if (/^PRAGMA key\b/i.test(sql)) return;
      motor.exec(sql);
    },
    async runAsync(sql, parametros) {
      motor.prepare(sql).run(...parametros);
    },
    async getFirstAsync<T>(sql: string, parametros: ParametroSQL[]) {
      if (/PRAGMA cipher_version/i.test(sql)) {
        return (opciones?.conCifrado === false ? null : { cipher_version: '4.6.1 simulado' }) as T;
      }
      const fila = motor.prepare(sql).get(...parametros);
      return fila === undefined ? null : ({ ...fila } as T);
    },
    async getAllAsync<T>(sql: string, parametros: ParametroSQL[]) {
      return motor.prepare(sql).all(...parametros).map((fila) => ({ ...fila })) as T[];
    },
  };
  return {
    ...conexion,
    sentenciasExec,
    motor,
    async withExclusiveTransactionAsync(tarea) {
      motor.exec('BEGIN EXCLUSIVE');
      try {
        await tarea(conexion);
        motor.exec('COMMIT');
      } catch (error) {
        motor.exec('ROLLBACK');
        throw error;
      }
    },
    async closeAsync() {
      motor.close();
    },
  };
}

export function crearRepositorioMemoria(deps: DependenciasRepositorio = crearDependencias()) {
  return new RepositorioMemoria(deps);
}

export function crearRepositorioSQLitePrueba(deps: DependenciasRepositorio = crearDependencias()) {
  const baseDatos = crearBaseDatosPrueba();
  const almacenSeguro = new AlmacenSeguroMemoria();
  const repositorio = new RepositorioSQLite({
    ...deps,
    almacenSeguro,
    abrirBaseDatos: async () => baseDatos,
    generarBytesAleatorios: async (cantidad) => crypto.getRandomValues(new Uint8Array(cantidad)),
  });
  return { repositorio, baseDatos, almacenSeguro };
}
