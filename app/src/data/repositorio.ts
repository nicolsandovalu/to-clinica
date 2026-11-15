import type {
  AceptacionPolitica,
  Apoderado,
  CambiosApoderado,
  CambiosCita,
  CambiosPaciente,
  CambiosRegistroSesion,
  Cita,
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
} from './tipos';

export type CodigoErrorRepositorio =
  | 'validacion'
  | 'no_encontrado'
  | 'duplicado'
  | 'no_vacio'
  | 'cifrado_no_disponible'
  | 'no_inicializado';

/** Los mensajes nunca incluyen contenido clínico: solo nombres de campo y entidad. */
export class ErrorRepositorio extends Error {
  readonly codigo: CodigoErrorRepositorio;

  constructor(codigo: CodigoErrorRepositorio, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRepositorio';
    this.codigo = codigo;
  }
}

/** Dependencias inyectables para poder probar sin módulos nativos. */
export interface DependenciasRepositorio {
  /** Debe devolver un UUID v4. */
  readonly generarUuid: () => string;
  /** Instante actual en ISO 8601 UTC. */
  readonly ahora: () => string;
}

/**
 * Contrato único de acceso a datos de la app (patrón Repositorio).
 *
 * Reglas que toda implementación debe cumplir:
 * - Cada método de escritura clínica es atómico: guarda el registro con
 *   `estado_sync = 'pendiente'` e inserta, en la MISMA transacción, una fila en
 *   `cola_sync` con un `op_id` UUID v4. Si algo falla no queda ni lo uno ni lo otro.
 * - No existe eliminación física de entidades clínicas; solo `archivarPaciente`
 *   y `archivarRegistroSesion`.
 */
export interface IRepositorioClinico {
  inicializar(): Promise<void>;
  cerrar(): Promise<void>;
  /** `true` si no hay ningún dato clínico (apoderados, pacientes, citas, registros). */
  estaVacio(): Promise<boolean>;

  registrarAceptacionPolitica(datos: NuevaAceptacionPolitica): Promise<AceptacionPolitica>;
  obtenerAceptacionPolitica(version: string): Promise<AceptacionPolitica | null>;

  crearApoderado(datos: NuevoApoderado): Promise<Apoderado>;
  actualizarApoderado(id: string, cambios: CambiosApoderado): Promise<Apoderado>;
  obtenerApoderado(id: string): Promise<Apoderado | null>;
  listarApoderados(): Promise<Apoderado[]>;

  crearPaciente(datos: NuevoPaciente): Promise<Paciente>;
  actualizarPaciente(id: string, cambios: CambiosPaciente): Promise<Paciente>;
  archivarPaciente(id: string): Promise<Paciente>;
  obtenerPaciente(id: string): Promise<Paciente | null>;
  /** Ordenados por nombre. Los archivados solo se incluyen si se pide. */
  listarPacientes(opciones?: { incluirArchivados?: boolean }): Promise<Paciente[]>;

  crearCita(datos: NuevaCita): Promise<Cita>;
  actualizarCita(id: string, cambios: CambiosCita): Promise<Cita>;
  obtenerCita(id: string): Promise<Cita | null>;
  /** Citas con `desde <= fecha_hora < hasta`, ordenadas por fecha. */
  listarCitasEntre(desde: string, hasta: string): Promise<Cita[]>;
  listarCitasDePaciente(pacienteId: string): Promise<Cita[]>;

  crearRegistroSesion(datos: NuevoRegistroSesion): Promise<RegistroSesion>;
  actualizarRegistroSesion(id: string, cambios: CambiosRegistroSesion): Promise<RegistroSesion>;
  archivarRegistroSesion(id: string): Promise<RegistroSesion>;
  obtenerRegistroSesion(id: string): Promise<RegistroSesion | null>;
  obtenerRegistroSesionPorCita(citaId: string): Promise<RegistroSesion | null>;

  /** Cola pendiente en orden de envío: por entidad (§3) y luego por antigüedad. */
  listarColaSync(): Promise<OperacionColaSync[]>;
  /**
   * El servidor aceptó la operación: se retira de la cola y, si el registro no
   * tiene más operaciones pendientes, pasa a `estado_sync = 'sincronizado'`.
   */
  confirmarOperacionSync(opId: string): Promise<void>;
  registrarIntentoFallido(opId: string): Promise<void>;

  registrarEventoSync(evento: NuevoEventoSync): Promise<EventoSync>;
  listarEventosSync(): Promise<EventoSync[]>;
  /**
   * Conserva solo los `conservar` eventos más recientes y devuelve cuántos eliminó.
   * `evento_sync` es un diario técnico sin contenido clínico, por eso sí admite borrado.
   */
  limpiarEventosSync(conservar: number): Promise<number>;

  /**
   * Carga la copia del servidor en un repositorio vacío (dispositivo nuevo).
   * Atómica; los registros quedan `sincronizado` y no se encola nada.
   * Falla con `no_vacio` si ya hay datos clínicos locales.
   */
  restaurarDesdeServidor(instantanea: InstantaneaServidor): Promise<void>;
}
