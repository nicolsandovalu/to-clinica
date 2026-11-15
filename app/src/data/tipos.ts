/**
 * Tipos del modelo de datos local (CLAUDE.md §3).
 * Los `id` son UUID v4 generados en el cliente, idénticos en SQLite y PostgreSQL.
 * Las fechas son cadenas ISO 8601 en UTC.
 */

export type EstadoSync = 'pendiente' | 'sincronizado';

export const ESTADOS_CITA = ['pendiente', 'confirmada', 'cancelada', 'sin_respuesta'] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

/** Orden estricto de envío al servidor (la aceptación de política no depende de nada). */
export const ORDEN_ENTIDADES_SYNC = [
  'aceptacion_politica',
  'apoderado',
  'paciente',
  'cita',
  'registro_sesion',
] as const;
export type EntidadSync = (typeof ORDEN_ENTIDADES_SYNC)[number];

/** No existe operación de eliminación: solo archivado lógico (Ley 20.584). */
export type TipoOperacionSync = 'crear' | 'actualizar' | 'archivar';

export interface AceptacionPolitica {
  readonly id: string;
  /** `null` si se aceptó antes de iniciar sesión; el servidor asigna la usuaria del token. */
  readonly usuaria_id: string | null;
  readonly version: string;
  readonly aceptada_en: string;
  readonly estado_sync: EstadoSync;
}

export interface Apoderado {
  readonly id: string;
  readonly propietaria_id: string;
  readonly nombre: string;
  /** Formato `+569XXXXXXXX` o `null`. */
  readonly telefono: string | null;
  readonly estado_sync: EstadoSync;
}

export interface Paciente {
  readonly id: string;
  readonly propietaria_id: string;
  readonly apoderado_id: string | null;
  readonly nombre: string;
  /** Fecha `AAAA-MM-DD` o `null`. */
  readonly fecha_nacimiento: string | null;
  readonly antecedentes: string;
  readonly motivo_consulta: string;
  readonly archivado: boolean;
  readonly creado_en: string;
  readonly modificado_en: string;
  readonly estado_sync: EstadoSync;
}

export interface Cita {
  readonly id: string;
  readonly paciente_id: string;
  readonly fecha_hora: string;
  readonly estado: EstadoCita;
  readonly creado_en: string;
  readonly modificado_en: string;
  readonly estado_sync: EstadoSync;
}

export interface RegistroSesion {
  readonly id: string;
  readonly cita_id: string;
  readonly observaciones: string;
  readonly objetivos_cumplidos: string;
  readonly retroalimentacion_familia: string;
  readonly archivado: boolean;
  readonly creado_en: string;
  readonly modificado_en: string;
  readonly estado_sync: EstadoSync;
}

export type ValorJson = string | number | boolean | null;

/** Fila de `cola_sync` (outbox). `datos` es el registro completo sin `estado_sync`. */
export interface OperacionColaSync {
  readonly op_id: string;
  readonly entidad: EntidadSync;
  readonly registro_id: string;
  readonly operacion: TipoOperacionSync;
  readonly modificado_en: string;
  readonly datos: Readonly<Record<string, ValorJson>>;
  readonly intentos: number;
}

export type TipoEventoSync = 'envio_ok' | 'envio_error' | 'conflicto' | 'restauracion';

/**
 * Fila de `evento_sync`. Solo metadatos: deliberadamente no hay ningún campo de
 * texto libre para que sea imposible registrar contenido clínico (CS-07).
 */
export interface EventoSync {
  readonly evento_id: string;
  readonly tipo: TipoEventoSync;
  readonly entidad: EntidadSync | null;
  readonly registro_id: string | null;
  readonly op_id: string | null;
  readonly codigo_http: number | null;
  readonly ocurrido_en: string;
}

// ---------- Datos de entrada ----------

export interface NuevaAceptacionPolitica {
  readonly version: string;
  readonly usuaria_id?: string | null;
}

export interface NuevoApoderado {
  readonly propietaria_id: string;
  readonly nombre: string;
  readonly telefono?: string | null;
}
export type CambiosApoderado = Partial<Pick<Apoderado, 'nombre' | 'telefono'>>;

export interface NuevoPaciente {
  readonly propietaria_id: string;
  readonly nombre: string;
  readonly apoderado_id?: string | null;
  readonly fecha_nacimiento?: string | null;
  readonly antecedentes?: string;
  readonly motivo_consulta?: string;
}
export type CambiosPaciente = Partial<
  Pick<Paciente, 'nombre' | 'apoderado_id' | 'fecha_nacimiento' | 'antecedentes' | 'motivo_consulta'>
>;

export interface NuevaCita {
  readonly paciente_id: string;
  readonly fecha_hora: string;
  readonly estado?: EstadoCita;
}
export type CambiosCita = Partial<Pick<Cita, 'fecha_hora' | 'estado'>>;

export interface NuevoRegistroSesion {
  readonly cita_id: string;
  readonly observaciones?: string;
  readonly objetivos_cumplidos?: string;
  readonly retroalimentacion_familia?: string;
}
export type CambiosRegistroSesion = Partial<
  Pick<RegistroSesion, 'observaciones' | 'objetivos_cumplidos' | 'retroalimentacion_familia'>
>;

export type NuevoEventoSync = Omit<EventoSync, 'evento_id' | 'ocurrido_en'>;

/**
 * Resultado por operación de `POST /api/clinica/sincronizar/`.
 * `aplicada`, `duplicada` y `conflicto` (LWW: ganó el servidor) son definitivos;
 * una `rechazada` permanece en la cola local.
 */
export const ESTADOS_RESULTADO_SYNC = ['aplicada', 'duplicada', 'conflicto', 'rechazada'] as const;
export type EstadoResultadoSync = (typeof ESTADOS_RESULTADO_SYNC)[number];

export interface ResultadoOperacionSync {
  readonly op_id: string | null;
  readonly estado: EstadoResultadoSync;
  readonly codigo_http: number;
}

/** Copia completa de los datos de la usuaria entregada por el servidor al restaurar. */
export interface InstantaneaServidor {
  readonly apoderados: readonly Omit<Apoderado, 'estado_sync'>[];
  readonly pacientes: readonly Omit<Paciente, 'estado_sync'>[];
  readonly citas: readonly Omit<Cita, 'estado_sync'>[];
  readonly registros_sesion: readonly Omit<RegistroSesion, 'estado_sync'>[];
}
