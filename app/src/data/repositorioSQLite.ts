import Constants from 'expo-constants';
import { AlmacenSeguro, CLAVES_ALMACEN } from './almacenSeguro';
import { SENTENCIAS_ESQUEMA } from './esquema';
import {
  aplicarCambiosApoderado,
  aplicarCambiosCita,
  aplicarCambiosPaciente,
  aplicarCambiosRegistroSesion,
  archivar,
  construirAceptacion,
  construirApoderado,
  construirCita,
  construirOperacion,
  construirPaciente,
  construirRegistroSesion,
  ordenarCola,
  validarInstantanea,
  validarLimiteEventos,
} from './reglas';
import { DependenciasRepositorio, ErrorRepositorio, IRepositorioClinico } from './repositorio';
import { ORDEN_ENTIDADES_SYNC } from './tipos';
import type {
  AceptacionPolitica,
  Apoderado,
  CambiosApoderado,
  CambiosCita,
  CambiosPaciente,
  CambiosRegistroSesion,
  Cita,
  EntidadSync,
  EstadoCita,
  EstadoSync,
  EventoSync,
  InstantaneaServidor,
  NuevaAceptacionPolitica,
  NuevaCita,
  NuevoApoderado,
  NuevoEventoSync,
  NuevoPaciente,
  NuevoRegistroSesion,
  OperacionColaSync,
  Paciente,
  RegistroSesion,
  TipoOperacionSync,
} from './tipos';

export type ParametroSQL = string | number | null;

/** Subconjunto de `expo-sqlite` que usa el repositorio (permite sustituirlo en pruebas). */
export interface ConexionSQL {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, parametros: ParametroSQL[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, parametros: ParametroSQL[]): Promise<T | null>;
  getAllAsync<T>(sql: string, parametros: ParametroSQL[]): Promise<T[]>;
}

export interface BaseDatosSQL extends ConexionSQL {
  withExclusiveTransactionAsync(tarea: (tx: ConexionSQL) => Promise<void>): Promise<void>;
  /** Transacción sobre la conexión principal (ya con la clave SQLCipher aplicada). */
  withTransactionAsync?(tarea: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export interface DependenciasSQLite extends DependenciasRepositorio {
  /** Abre el archivo de base de datos (compilado con SQLCipher). */
  readonly abrirBaseDatos: () => Promise<BaseDatosSQL>;
  readonly almacenSeguro: AlmacenSeguro;
  /** Debe devolver bytes criptográficamente aleatorios. */
  readonly generarBytesAleatorios: (cantidad: number) => Promise<Uint8Array>;
}

const BYTES_CLAVE = 32; // 256 bits
const PATRON_CLAVE = /^[0-9a-f]{64}$/;

type Fila = Record<string, ParametroSQL>;

const aBooleano = (valor: ParametroSQL | undefined): boolean => valor === 1;

function filaAAceptacion(f: Fila): AceptacionPolitica {
  return {
    id: String(f.id),
    usuaria_id: f.usuaria_id === null ? null : String(f.usuaria_id),
    version: String(f.version),
    aceptada_en: String(f.aceptada_en),
    estado_sync: f.estado_sync as EstadoSync,
  };
}

function filaAApoderado(f: Fila): Apoderado {
  return {
    id: String(f.id),
    propietaria_id: String(f.propietaria_id),
    nombre: String(f.nombre),
    telefono: f.telefono === null ? null : String(f.telefono),
    estado_sync: f.estado_sync as EstadoSync,
  };
}

function filaAPaciente(f: Fila): Paciente {
  return {
    id: String(f.id),
    propietaria_id: String(f.propietaria_id),
    apoderado_id: f.apoderado_id === null ? null : String(f.apoderado_id),
    nombre: String(f.nombre),
    fecha_nacimiento: f.fecha_nacimiento === null ? null : String(f.fecha_nacimiento),
    antecedentes: String(f.antecedentes),
    motivo_consulta: String(f.motivo_consulta),
    archivado: aBooleano(f.archivado),
    creado_en: String(f.creado_en),
    modificado_en: String(f.modificado_en),
    estado_sync: f.estado_sync as EstadoSync,
  };
}

function filaACita(f: Fila): Cita {
  return {
    id: String(f.id),
    paciente_id: String(f.paciente_id),
    fecha_hora: String(f.fecha_hora),
    estado: f.estado as EstadoCita,
    creado_en: String(f.creado_en),
    modificado_en: String(f.modificado_en),
    estado_sync: f.estado_sync as EstadoSync,
  };
}

function filaARegistro(f: Fila): RegistroSesion {
  return {
    id: String(f.id),
    cita_id: String(f.cita_id),
    observaciones: String(f.observaciones),
    objetivos_cumplidos: String(f.objetivos_cumplidos),
    retroalimentacion_familia: String(f.retroalimentacion_familia),
    archivado: aBooleano(f.archivado),
    creado_en: String(f.creado_en),
    modificado_en: String(f.modificado_en),
    estado_sync: f.estado_sync as EstadoSync,
  };
}

function aParametro(valor: unknown): ParametroSQL {
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'string' || typeof valor === 'number' || valor === null) return valor;
  throw new ErrorRepositorio('validacion', 'Tipo de dato no admitido por la base local.');
}

function noEncontrado(entidad: EntidadSync): ErrorRepositorio {
  return new ErrorRepositorio('no_encontrado', `No existe el registro de "${entidad}" indicado.`);
}

function aHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Repositorio sobre `expo-sqlite` cifrado con SQLCipher.
 * La clave (256 bits aleatorios) se genera en el primer inicio y vive solo en
 * `expo-secure-store`. Si el binario no trae SQLCipher, `inicializar` falla en
 * vez de guardar datos clínicos sin cifrar.
 *
 * Los nombres de tabla y columna de las sentencias provienen siempre de
 * constantes del código; todos los valores van como parámetros enlazados.
 */
export class RepositorioSQLite implements IRepositorioClinico {
  private bd: BaseDatosSQL | null = null;

  constructor(private readonly deps: DependenciasSQLite) {}

  // ---------- Apertura y cifrado ----------

  private async obtenerOCrearClave(): Promise<string> {
    const { almacenSeguro, generarBytesAleatorios } = this.deps;
    const guardada = await almacenSeguro.obtener(CLAVES_ALMACEN.claveBaseDatos);
    if (guardada !== null) {
      if (!PATRON_CLAVE.test(guardada)) {
        throw new ErrorRepositorio('cifrado_no_disponible', 'La clave de cifrado guardada es inválida.');
      }
      return guardada;
    }
    const bytes = await generarBytesAleatorios(BYTES_CLAVE);
    if (bytes.length !== BYTES_CLAVE) {
      throw new ErrorRepositorio('cifrado_no_disponible', 'No se pudo generar la clave de cifrado.');
    }
    const clave = aHex(bytes);
    await almacenSeguro.guardar(CLAVES_ALMACEN.claveBaseDatos, clave);
    return clave;
  }

  async inicializar(): Promise<void> {
    if (this.bd !== null) return;
    const clave = await this.obtenerOCrearClave();
    const bd = await this.deps.abrirBaseDatos();
    try {
      // Debe ser la primera sentencia sobre la conexión. Clave en formato crudo de SQLCipher.
      // Solo en Expo Go (desarrollo) se tolera la ausencia de SQLCipher; en builds nativos
      // y producción se mantiene el fallo cerrado.
      const enExpoGo = Constants.executionEnvironment === 'storeClient';
      let sqlcipherOmitido = false;
      try {
        await bd.execAsync(`PRAGMA key = "x'${clave}'";`);
      } catch (errorClave) {
        if (!enExpoGo) throw errorClave;
        sqlcipherOmitido = true;
      }
      if (!sqlcipherOmitido) {
        const cifrado = await bd.getFirstAsync<{ cipher_version: string | null }>(
          'PRAGMA cipher_version;',
          [],
        );
        if (!cifrado?.cipher_version) {
          if (!enExpoGo) {
            throw new ErrorRepositorio(
              'cifrado_no_disponible',
              'SQLCipher no está disponible: no se guardarán datos sin cifrar.',
            );
          }
          sqlcipherOmitido = true;
        }
      }
      if (sqlcipherOmitido) {
        // Sin datos clínicos en el mensaje (CS-07). Aviso único solo de desarrollo (Expo Go).
        // eslint-disable-next-line no-console
        console.warn('Expo Go: SQLCipher no disponible, usando SQLite estándar (solo desarrollo).');
      } else {
        try {
          await bd.getFirstAsync('SELECT count(*) AS total FROM sqlite_master;', []);
        } catch {
          throw new ErrorRepositorio(
            'cifrado_no_disponible',
            'No se pudo abrir la base de datos local con la clave del dispositivo.',
          );
        }
      }
      await bd.execAsync('PRAGMA foreign_keys = ON;');
      for (const sentencia of SENTENCIAS_ESQUEMA) {
        await bd.execAsync(`${sentencia};`);
      }
    } catch (error) {
      await bd.closeAsync().catch(() => undefined);
      throw error;
    }
    this.bd = bd;
  }

  async cerrar(): Promise<void> {
    const bd = this.bd;
    this.bd = null;
    if (bd !== null) await bd.closeAsync();
  }

  private conexion(): BaseDatosSQL {
    if (this.bd === null) {
      throw new ErrorRepositorio('no_inicializado', 'El repositorio no ha sido inicializado.');
    }
    return this.bd;
  }

  private async transaccion<T>(tarea: (tx: ConexionSQL) => Promise<T>): Promise<T> {
    let resultado: T | undefined;
    const bd = this.conexion();
    if (bd.withTransactionAsync) {
      // La transacción exclusiva abre otra conexión sin `PRAGMA key` (SQLCipher) ni
      // `foreign_keys`, y las escrituras fallan en Android. Se usa la conexión principal.
      await bd.withTransactionAsync(async () => {
        resultado = await tarea(bd);
      });
    } else {
      await bd.withExclusiveTransactionAsync(async (tx) => {
        resultado = await tarea(tx);
      });
    }
    return resultado as T;
  }

  // ---------- Utilidades SQL ----------

  private async insertar(tx: ConexionSQL, tabla: EntidadSync, registro: object): Promise<void> {
    const columnas = Object.keys(registro);
    const valores = Object.values(registro).map(aParametro);
    await tx.runAsync(
      `INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`,
      valores,
    );
  }

  private async reemplazar(
    tx: ConexionSQL,
    tabla: EntidadSync,
    registro: { readonly id: string },
  ): Promise<void> {
    const columnas = Object.keys(registro).filter((columna) => columna !== 'id');
    const valores = columnas.map((columna) =>
      aParametro((registro as Record<string, unknown>)[columna]),
    );
    await tx.runAsync(
      `UPDATE ${tabla} SET ${columnas.map((columna) => `${columna} = ?`).join(', ')} WHERE id = ?`,
      [...valores, registro.id],
    );
  }

  private async encolar(
    tx: ConexionSQL,
    entidad: EntidadSync,
    operacion: TipoOperacionSync,
    registro: object,
  ): Promise<void> {
    const { op_id: opId, ...documento } = construirOperacion(entidad, operacion, registro, this.deps);
    await tx.runAsync('INSERT INTO cola_sync (op_id, documento) VALUES (?, ?)', [
      opId,
      JSON.stringify(documento),
    ]);
  }

  private async porId(c: ConexionSQL, tabla: EntidadSync, id: string): Promise<Fila | null> {
    return c.getFirstAsync<Fila>(`SELECT * FROM ${tabla} WHERE id = ?`, [id]);
  }

  private async exigirApoderado(tx: ConexionSQL, id: string | null): Promise<void> {
    if (id !== null && (await this.porId(tx, 'apoderado', id)) === null) {
      throw noEncontrado('apoderado');
    }
  }

  private async contarClinicos(c: ConexionSQL): Promise<number> {
    const fila = await c.getFirstAsync<{ total: number }>(
      `SELECT (SELECT count(*) FROM apoderado) + (SELECT count(*) FROM paciente)
            + (SELECT count(*) FROM cita) + (SELECT count(*) FROM registro_sesion) AS total`,
      [],
    );
    return fila?.total ?? 0;
  }

  async estaVacio(): Promise<boolean> {
    return (await this.contarClinicos(this.conexion())) === 0;
  }

  // ---------- Política ----------

  registrarAceptacionPolitica(datos: NuevaAceptacionPolitica): Promise<AceptacionPolitica> {
    return this.transaccion(async (tx) => {
      const aceptacion = construirAceptacion(datos, this.deps);
      await this.insertar(tx, 'aceptacion_politica', aceptacion);
      await this.encolar(tx, 'aceptacion_politica', 'crear', aceptacion);
      return aceptacion;
    });
  }

  async obtenerAceptacionPolitica(version: string): Promise<AceptacionPolitica | null> {
    const fila = await this.conexion().getFirstAsync<Fila>(
      'SELECT * FROM aceptacion_politica WHERE version = ? ORDER BY aceptada_en DESC LIMIT 1',
      [version],
    );
    return fila === null ? null : filaAAceptacion(fila);
  }

  // ---------- Apoderados ----------

  crearApoderado(datos: NuevoApoderado): Promise<Apoderado> {
    return this.transaccion(async (tx) => {
      const apoderado = construirApoderado(datos, this.deps);
      await this.insertar(tx, 'apoderado', apoderado);
      await this.encolar(tx, 'apoderado', 'crear', apoderado);
      return apoderado;
    });
  }

  actualizarApoderado(id: string, cambios: CambiosApoderado): Promise<Apoderado> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'apoderado', id);
      if (fila === null) throw noEncontrado('apoderado');
      const apoderado = aplicarCambiosApoderado(filaAApoderado(fila), cambios);
      await this.reemplazar(tx, 'apoderado', apoderado);
      await this.encolar(tx, 'apoderado', 'actualizar', apoderado);
      return apoderado;
    });
  }

  async obtenerApoderado(id: string): Promise<Apoderado | null> {
    const fila = await this.porId(this.conexion(), 'apoderado', id);
    return fila === null ? null : filaAApoderado(fila);
  }

  async listarApoderados(): Promise<Apoderado[]> {
    const filas = await this.conexion().getAllAsync<Fila>('SELECT * FROM apoderado', []);
    return filas.map(filaAApoderado).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // ---------- Pacientes ----------

  crearPaciente(datos: NuevoPaciente): Promise<Paciente> {
    return this.transaccion(async (tx) => {
      const paciente = construirPaciente(datos, this.deps);
      await this.exigirApoderado(tx, paciente.apoderado_id);
      await this.insertar(tx, 'paciente', paciente);
      await this.encolar(tx, 'paciente', 'crear', paciente);
      return paciente;
    });
  }

  actualizarPaciente(id: string, cambios: CambiosPaciente): Promise<Paciente> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'paciente', id);
      if (fila === null) throw noEncontrado('paciente');
      const paciente = aplicarCambiosPaciente(filaAPaciente(fila), cambios, this.deps);
      await this.exigirApoderado(tx, paciente.apoderado_id);
      await this.reemplazar(tx, 'paciente', paciente);
      await this.encolar(tx, 'paciente', 'actualizar', paciente);
      return paciente;
    });
  }

  archivarPaciente(id: string): Promise<Paciente> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'paciente', id);
      if (fila === null) throw noEncontrado('paciente');
      const paciente = archivar(filaAPaciente(fila), this.deps);
      await this.reemplazar(tx, 'paciente', paciente);
      await this.encolar(tx, 'paciente', 'archivar', paciente);
      return paciente;
    });
  }

  async obtenerPaciente(id: string): Promise<Paciente | null> {
    const fila = await this.porId(this.conexion(), 'paciente', id);
    return fila === null ? null : filaAPaciente(fila);
  }

  async listarPacientes(opciones?: { incluirArchivados?: boolean }): Promise<Paciente[]> {
    const filtro = opciones?.incluirArchivados === true ? '' : 'WHERE archivado = 0';
    const filas = await this.conexion().getAllAsync<Fila>(`SELECT * FROM paciente ${filtro}`, []);
    return filas.map(filaAPaciente).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // ---------- Citas ----------

  crearCita(datos: NuevaCita): Promise<Cita> {
    return this.transaccion(async (tx) => {
      const cita = construirCita(datos, this.deps);
      if ((await this.porId(tx, 'paciente', cita.paciente_id)) === null) {
        throw noEncontrado('paciente');
      }
      await this.insertar(tx, 'cita', cita);
      await this.encolar(tx, 'cita', 'crear', cita);
      return cita;
    });
  }

  actualizarCita(id: string, cambios: CambiosCita): Promise<Cita> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'cita', id);
      if (fila === null) throw noEncontrado('cita');
      const cita = aplicarCambiosCita(filaACita(fila), cambios, this.deps);
      await this.reemplazar(tx, 'cita', cita);
      await this.encolar(tx, 'cita', 'actualizar', cita);
      return cita;
    });
  }

  async obtenerCita(id: string): Promise<Cita | null> {
    const fila = await this.porId(this.conexion(), 'cita', id);
    return fila === null ? null : filaACita(fila);
  }

  async listarCitasEntre(desde: string, hasta: string): Promise<Cita[]> {
    const filas = await this.conexion().getAllAsync<Fila>(
      'SELECT * FROM cita WHERE fecha_hora >= ? AND fecha_hora < ? ORDER BY fecha_hora',
      [new Date(desde).toISOString(), new Date(hasta).toISOString()],
    );
    return filas.map(filaACita);
  }

  async listarCitasDePaciente(pacienteId: string): Promise<Cita[]> {
    const filas = await this.conexion().getAllAsync<Fila>(
      'SELECT * FROM cita WHERE paciente_id = ? ORDER BY fecha_hora',
      [pacienteId],
    );
    return filas.map(filaACita);
  }

  // ---------- Registros de sesión ----------

  crearRegistroSesion(datos: NuevoRegistroSesion): Promise<RegistroSesion> {
    return this.transaccion(async (tx) => {
      const registro = construirRegistroSesion(datos, this.deps);
      if ((await this.porId(tx, 'cita', registro.cita_id)) === null) throw noEncontrado('cita');
      const existente = await tx.getFirstAsync<Fila>(
        'SELECT id FROM registro_sesion WHERE cita_id = ?',
        [registro.cita_id],
      );
      if (existente !== null) {
        throw new ErrorRepositorio('duplicado', 'La cita ya tiene un registro de sesión.');
      }
      await this.insertar(tx, 'registro_sesion', registro);
      await this.encolar(tx, 'registro_sesion', 'crear', registro);
      return registro;
    });
  }

  actualizarRegistroSesion(id: string, cambios: CambiosRegistroSesion): Promise<RegistroSesion> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'registro_sesion', id);
      if (fila === null) throw noEncontrado('registro_sesion');
      const registro = aplicarCambiosRegistroSesion(filaARegistro(fila), cambios, this.deps);
      await this.reemplazar(tx, 'registro_sesion', registro);
      await this.encolar(tx, 'registro_sesion', 'actualizar', registro);
      return registro;
    });
  }

  archivarRegistroSesion(id: string): Promise<RegistroSesion> {
    return this.transaccion(async (tx) => {
      const fila = await this.porId(tx, 'registro_sesion', id);
      if (fila === null) throw noEncontrado('registro_sesion');
      const registro = archivar(filaARegistro(fila), this.deps);
      await this.reemplazar(tx, 'registro_sesion', registro);
      await this.encolar(tx, 'registro_sesion', 'archivar', registro);
      return registro;
    });
  }

  async obtenerRegistroSesion(id: string): Promise<RegistroSesion | null> {
    const fila = await this.porId(this.conexion(), 'registro_sesion', id);
    return fila === null ? null : filaARegistro(fila);
  }

  async obtenerRegistroSesionPorCita(citaId: string): Promise<RegistroSesion | null> {
    const fila = await this.conexion().getFirstAsync<Fila>(
      'SELECT * FROM registro_sesion WHERE cita_id = ?',
      [citaId],
    );
    return fila === null ? null : filaARegistro(fila);
  }

  // ---------- Sincronización ----------

  async listarColaSync(): Promise<OperacionColaSync[]> {
    const filas = await this.conexion().getAllAsync<{ op_id: string; documento: string }>(
      'SELECT op_id, documento FROM cola_sync ORDER BY rowid',
      [],
    );
    return ordenarCola(
      filas.map((fila) => ({
        ...(JSON.parse(fila.documento) as Omit<OperacionColaSync, 'op_id'>),
        op_id: fila.op_id,
      })),
    );
  }

  confirmarOperacionSync(opId: string): Promise<void> {
    return this.transaccion(async (tx) => {
      const fila = await tx.getFirstAsync<{ documento: string }>(
        'SELECT documento FROM cola_sync WHERE op_id = ?',
        [opId],
      );
      if (fila === null) return;
      const { entidad, registro_id: registroId } = JSON.parse(fila.documento) as OperacionColaSync;
      if (!ORDEN_ENTIDADES_SYNC.includes(entidad)) {
        throw new ErrorRepositorio('validacion', 'Operación de cola con entidad desconocida.');
      }
      await tx.runAsync('DELETE FROM cola_sync WHERE op_id = ?', [opId]);
      const restantes = await tx.getFirstAsync<{ total: number }>(
        `SELECT count(*) AS total FROM cola_sync
          WHERE json_extract(documento, '$.entidad') = ?
            AND json_extract(documento, '$.registro_id') = ?`,
        [entidad, registroId],
      );
      if ((restantes?.total ?? 0) > 0) return;
      await tx.runAsync(`UPDATE ${entidad} SET estado_sync = 'sincronizado' WHERE id = ?`, [
        registroId,
      ]);
    });
  }

  registrarIntentoFallido(opId: string): Promise<void> {
    return this.transaccion(async (tx) => {
      await tx.runAsync(
        `UPDATE cola_sync
            SET documento = json_set(documento, '$.intentos', json_extract(documento, '$.intentos') + 1)
          WHERE op_id = ?`,
        [opId],
      );
    });
  }

  registrarEventoSync(evento: NuevoEventoSync): Promise<EventoSync> {
    return this.transaccion(async (tx) => {
      // Se copian solo los campos de metadatos conocidos: nunca contenido clínico.
      const documento: Omit<EventoSync, 'evento_id'> = {
        tipo: evento.tipo,
        entidad: evento.entidad,
        registro_id: evento.registro_id,
        op_id: evento.op_id,
        codigo_http: evento.codigo_http,
        ocurrido_en: this.deps.ahora(),
      };
      const eventoId = this.deps.generarUuid();
      await tx.runAsync('INSERT INTO evento_sync (evento_id, documento) VALUES (?, ?)', [
        eventoId,
        JSON.stringify(documento),
      ]);
      return { evento_id: eventoId, ...documento };
    });
  }

  async listarEventosSync(): Promise<EventoSync[]> {
    const filas = await this.conexion().getAllAsync<{ evento_id: string; documento: string }>(
      'SELECT evento_id, documento FROM evento_sync ORDER BY rowid',
      [],
    );
    return filas.map((fila) => ({
      ...(JSON.parse(fila.documento) as Omit<EventoSync, 'evento_id'>),
      evento_id: fila.evento_id,
    }));
  }

  limpiarEventosSync(conservar: number): Promise<number> {
    return this.transaccion(async (tx) => {
      const limite = validarLimiteEventos(conservar);
      const contar = async (): Promise<number> =>
        (await tx.getFirstAsync<{ total: number }>('SELECT count(*) AS total FROM evento_sync', []))
          ?.total ?? 0;
      const antes = await contar();
      await tx.runAsync(
        `DELETE FROM evento_sync
          WHERE rowid NOT IN (SELECT rowid FROM evento_sync ORDER BY rowid DESC LIMIT ?)`,
        [limite],
      );
      return antes - (await contar());
    });
  }

  restaurarDesdeServidor(instantanea: InstantaneaServidor): Promise<void> {
    return this.transaccion(async (tx) => {
      if ((await this.contarClinicos(tx)) > 0) {
        throw new ErrorRepositorio('no_vacio', 'Solo se puede restaurar sobre un repositorio vacío.');
      }
      const datos = validarInstantanea(instantanea);
      for (const apoderado of datos.apoderados) await this.insertar(tx, 'apoderado', apoderado);
      for (const paciente of datos.pacientes) await this.insertar(tx, 'paciente', paciente);
      for (const cita of datos.citas) await this.insertar(tx, 'cita', cita);
      for (const registro of datos.registros_sesion) {
        await this.insertar(tx, 'registro_sesion', registro);
      }
    });
  }
}
