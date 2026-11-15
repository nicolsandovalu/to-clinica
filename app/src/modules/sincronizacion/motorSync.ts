/**
 * Motor de sincronización offline (CLAUDE.md §3), independiente de React.
 *
 * Lee `cola_sync` en el orden estricto Apoderado -> Paciente -> Cita ->
 * RegistroSesion (el que entrega `listarColaSync`) y la envía por lotes a
 * `POST /api/clinica/sincronizar/`. Cada operación aceptada (HTTP 200) se
 * retira de la cola y su registro pasa a `estado_sync = 'sincronizado'`.
 * Si un envío falla, el ciclo se detiene para no romper el orden, se anota un
 * evento con metadatos en `evento_sync` y se reintenta con espera exponencial.
 *
 * CS-07: aquí no se registra ni se expone contenido clínico; los eventos y el
 * estado público solo llevan identificadores, códigos y contadores.
 */
import type { IRepositorioClinico } from '../../data/repositorio';
import type {
  InstantaneaServidor,
  OperacionColaSync,
  ResultadoOperacionSync,
} from '../../data/tipos';
import { ErrorApi } from '../acceso/api';
import { restaurarDesdeServidor } from './restauracion';

export { restaurarDesdeServidor } from './restauracion';

export const TAMANO_LOTE_SYNC = 50;
export const ESPERA_BASE_REINTENTO_MS = 5_000;
export const ESPERA_MAXIMA_REINTENTO_MS = 5 * 60_000;
/** Eventos de `evento_sync` que se conservan tras cada ciclo. */
export const MAX_EVENTOS_SYNC = 200;

/** Parte del cliente HTTP que usa el motor (ver `ClienteApi`). El tiempo máximo es de 120 s. */
export interface ApiSync {
  enviarOperaciones(
    token: string,
    operaciones: readonly OperacionColaSync[],
  ): Promise<ResultadoOperacionSync[]>;
  descargarInstantanea(token: string): Promise<InstantaneaServidor>;
}

/** Fuente del estado de la red; en el dispositivo es `@react-native-community/netinfo`. */
export interface MonitorRed {
  /** Llama al oyente con el estado actual y con cada cambio. Devuelve la función para cancelar. */
  suscribir(oyente: (conectado: boolean) => void): () => void;
}

/** Programa una tarea diferida y devuelve la función que la cancela. */
export type Programador = (tarea: () => void, esperaMs: number) => () => void;

export type ErrorSincronizacion =
  /** Sin respuesta del servidor (sin red o superó el tiempo máximo). */
  | 'red'
  | 'servidor'
  | 'limite'
  /** El servidor rechazó el token: hay que volver a iniciar sesión. No se reintenta sola. */
  | 'no_autorizado'
  /** El servidor rechazó una o más operaciones, que siguen en la cola. */
  | 'rechazo'
  /** Falló el almacenamiento local. */
  | 'interno';

export interface EstadoSincronizacion {
  readonly conectado: boolean;
  readonly sincronizando: boolean;
  /** Registros distintos con cambios que aún no llegan al servidor. */
  readonly pendientes: number;
  readonly ultimoError: ErrorSincronizacion | null;
  /** Texto para la usuaria, p. ej. «Sin conexión: 3 registros pendientes». */
  readonly mensaje: string;
}

export interface DependenciasMotorSync {
  readonly repositorio: IRepositorioClinico;
  readonly api: ApiSync;
  readonly red: MonitorRed;
  /** Token de sesión vigente, o `null` si no hay sesión (no se envía nada). */
  readonly obtenerToken: () => Promise<string | null>;
  readonly programar?: Programador;
  readonly tamanoLote?: number;
}

export function mensajeSincronizacion(
  estado: Pick<EstadoSincronizacion, 'conectado' | 'sincronizando' | 'pendientes'>,
): string {
  const { conectado, sincronizando, pendientes } = estado;
  const registros = pendientes === 1 ? '1 registro pendiente' : `${pendientes} registros pendientes`;
  if (!conectado) return pendientes > 0 ? `Sin conexión: ${registros}` : 'Sin conexión';
  if (pendientes === 0) return 'Todo sincronizado';
  return sincronizando ? `Sincronizando: ${registros}` : `Por sincronizar: ${registros}`;
}

/** Espera antes del reintento número `fallos` (1, 2, 3...): 5 s, 10 s, 20 s... hasta 5 min. */
export function esperaReintentoMs(fallos: number): number {
  const exponente = Math.min(Math.max(fallos, 1) - 1, 20);
  return Math.min(ESPERA_BASE_REINTENTO_MS * 2 ** exponente, ESPERA_MAXIMA_REINTENTO_MS);
}

const programarConTemporizador: Programador = (tarea, esperaMs) => {
  const temporizador = setTimeout(tarea, esperaMs);
  return () => clearTimeout(temporizador);
};

function tipoDeError(error: unknown): ErrorSincronizacion {
  if (!(error instanceof ErrorApi)) return 'interno';
  // `credenciales` solo lo produce el login; aquí no debería ocurrir.
  return error.tipo === 'credenciales' ? 'servidor' : error.tipo;
}

export class MotorSync {
  private estado: EstadoSincronizacion;
  private readonly oyentes = new Set<() => void>();
  private readonly programar: Programador;
  private readonly tamanoLote: number;
  private cancelarRed: (() => void) | null = null;
  private cancelarReintento: (() => void) | null = null;
  private ciclo: Promise<void> | null = null;
  /** Se pidió sincronizar mientras había un ciclo en curso. */
  private repetir = false;
  private fallosSeguidos = 0;

  constructor(private readonly deps: DependenciasMotorSync) {
    this.programar = deps.programar ?? programarConTemporizador;
    this.tamanoLote = Math.max(1, deps.tamanoLote ?? TAMANO_LOTE_SYNC);
    const inicial = { conectado: false, sincronizando: false, pendientes: 0 };
    this.estado = { ...inicial, ultimoError: null, mensaje: mensajeSincronizacion(inicial) };
  }

  // ---------- Suscripción (compatible con useSyncExternalStore) ----------

  readonly suscribir = (oyente: () => void): (() => void) => {
    this.oyentes.add(oyente);
    return () => {
      this.oyentes.delete(oyente);
    };
  };

  readonly obtenerEstado = (): EstadoSincronizacion => this.estado;

  private actualizar(cambios: Partial<Omit<EstadoSincronizacion, 'mensaje'>>): void {
    const siguiente = { ...this.estado, ...cambios };
    const mensaje = mensajeSincronizacion(siguiente);
    const igual =
      siguiente.conectado === this.estado.conectado &&
      siguiente.sincronizando === this.estado.sincronizando &&
      siguiente.pendientes === this.estado.pendientes &&
      siguiente.ultimoError === this.estado.ultimoError;
    if (igual) return;
    this.estado = { ...siguiente, mensaje };
    this.oyentes.forEach((oyente) => oyente());
  }

  // ---------- Ciclo de vida ----------

  /** Empieza a escuchar la red y sincroniza en cuanto haya conexión. */
  iniciar(): void {
    if (this.cancelarRed !== null) return;
    this.cancelarRed = this.deps.red.suscribir((conectado) => this.alCambiarRed(conectado));
    void this.refrescarPendientes();
  }

  detener(): void {
    this.cancelarRed?.();
    this.cancelarRed = null;
    this.descartarReintento();
    this.repetir = false;
  }

  private get activo(): boolean {
    return this.cancelarRed !== null;
  }

  private alCambiarRed(conectado: boolean): void {
    if (conectado === this.estado.conectado) return;
    this.actualizar({ conectado });
    this.descartarReintento();
    if (conectado) {
      // Al recuperar la red se reintenta de inmediato, sin esperar el backoff.
      this.fallosSeguidos = 0;
      void this.sincronizar();
    }
  }

  private descartarReintento(): void {
    this.cancelarReintento?.();
    this.cancelarReintento = null;
  }

  private programarReintento(): void {
    this.descartarReintento();
    if (!this.activo || !this.estado.conectado) return;
    this.fallosSeguidos += 1;
    this.cancelarReintento = this.programar(() => {
      this.cancelarReintento = null;
      void this.sincronizar();
    }, esperaReintentoMs(this.fallosSeguidos));
  }

  // ---------- Acciones ----------

  /** Llamar tras cada escritura local: actualiza el contador y envía si hay conexión. */
  async notificarCambioLocal(): Promise<void> {
    await this.refrescarPendientes();
    if (this.cancelarReintento === null) await this.sincronizar();
  }

  /**
   * Envía la cola pendiente. Nunca rechaza: el resultado queda en el estado.
   * Si ya hay un ciclo en curso se espera ese mismo y luego se repite una vez.
   */
  sincronizar(): Promise<void> {
    if (this.ciclo !== null) {
      this.repetir = true;
      return this.ciclo;
    }
    const ciclo = this.ejecutarCiclo().finally(() => {
      this.ciclo = null;
      const repetir = this.repetir && this.cancelarReintento === null && this.activo;
      this.repetir = false;
      if (repetir && this.estado.ultimoError === null) void this.sincronizar();
    });
    this.ciclo = ciclo;
    return ciclo;
  }

  /** Se resuelve cuando no queda ningún ciclo de envío en curso. */
  async enReposo(): Promise<void> {
    while (this.ciclo !== null) await this.ciclo;
  }

  /**
   * Restauración completa en un dispositivo nuevo (repositorio local vacío):
   * descarga la copia del servidor y la carga de forma atómica.
   */
  async restaurarDesdeServidor(): Promise<void> {
    const token = await this.deps.obtenerToken();
    if (token === null) throw new ErrorApi('no_autorizado');
    await restaurarDesdeServidor(this.deps.api, this.deps.repositorio, token);
    await this.refrescarPendientes();
  }

  // ---------- Interno ----------

  private async refrescarPendientes(): Promise<void> {
    try {
      const cola = await this.deps.repositorio.listarColaSync();
      const registros = new Set(cola.map((op) => `${op.entidad}:${op.registro_id}`));
      this.actualizar({ pendientes: registros.size });
    } catch {
      // El contador se actualizará en el próximo ciclo.
    }
  }

  private async ejecutarCiclo(): Promise<void> {
    this.descartarReintento();
    if (!this.estado.conectado) {
      await this.refrescarPendientes();
      return;
    }
    let error: ErrorSincronizacion | null = null;
    this.actualizar({ sincronizando: true });
    try {
      const token = await this.deps.obtenerToken();
      if (token !== null) error = await this.enviarCola(token);
    } catch {
      error = 'interno';
    }
    try {
      await this.deps.repositorio.limpiarEventosSync(MAX_EVENTOS_SYNC);
    } catch {
      // La limpieza se repetirá en el próximo ciclo.
    }
    await this.refrescarPendientes();
    this.actualizar({ sincronizando: false, ultimoError: error });
    if (error === null) {
      this.fallosSeguidos = 0;
    } else if (error !== 'no_autorizado') {
      this.programarReintento();
    }
  }

  /** Envía lote a lote hasta vaciar la cola. Devuelve el error que detuvo el envío, si lo hubo. */
  private async enviarCola(token: string): Promise<ErrorSincronizacion | null> {
    const { repositorio, api } = this.deps;
    /** Rechazadas en este ciclo: siguen en la cola pero no se reenvían hasta el próximo. */
    const rechazadas = new Set<string>();
    for (;;) {
      const cola = await repositorio.listarColaSync();
      const lote = cola.filter((op) => !rechazadas.has(op.op_id)).slice(0, this.tamanoLote);
      if (lote.length === 0) break;
      // Corte de red a mitad de ciclo: no se intenta el siguiente lote.
      if (!this.estado.conectado) return 'red';

      let resultados: ResultadoOperacionSync[];
      try {
        resultados = await api.enviarOperaciones(token, lote);
        if (resultados.length !== lote.length) throw new ErrorApi('servidor', 200);
      } catch (error) {
        // Fallo del lote completo: nada se confirma y el orden de la cola se conserva.
        for (const op of lote) await repositorio.registrarIntentoFallido(op.op_id);
        await repositorio.registrarEventoSync({
          tipo: 'envio_error',
          entidad: null,
          registro_id: null,
          op_id: null,
          codigo_http: error instanceof ErrorApi ? error.codigoHttp : null,
        });
        return tipoDeError(error);
      }

      for (const [posicion, op] of lote.entries()) {
        const resultado = resultados[posicion];
        const metadatos = { entidad: op.entidad, registro_id: op.registro_id, op_id: op.op_id };
        if (resultado === undefined || resultado.estado === 'rechazada') {
          rechazadas.add(op.op_id);
          await repositorio.registrarIntentoFallido(op.op_id);
          await repositorio.registrarEventoSync({
            ...metadatos,
            tipo: 'envio_error',
            codigo_http: resultado?.codigo_http ?? null,
          });
          continue;
        }
        await repositorio.confirmarOperacionSync(op.op_id);
        if (resultado.estado === 'conflicto') {
          await repositorio.registrarEventoSync({
            ...metadatos,
            tipo: 'conflicto',
            codigo_http: resultado.codigo_http,
          });
        }
      }
      await this.refrescarPendientes();
    }
    return rechazadas.size > 0 ? 'rechazo' : null;
  }
}
