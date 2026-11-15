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
import type {
  AceptacionPolitica,
  Apoderado,
  CambiosApoderado,
  CambiosCita,
  CambiosPaciente,
  CambiosRegistroSesion,
  Cita,
  EntidadSync,
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

interface Estado {
  aceptacion_politica: Map<string, AceptacionPolitica>;
  apoderado: Map<string, Apoderado>;
  paciente: Map<string, Paciente>;
  cita: Map<string, Cita>;
  registro_sesion: Map<string, RegistroSesion>;
  cola: OperacionColaSync[];
  eventos: EventoSync[];
}

function estadoVacio(): Estado {
  return {
    aceptacion_politica: new Map(),
    apoderado: new Map(),
    paciente: new Map(),
    cita: new Map(),
    registro_sesion: new Map(),
    cola: [],
    eventos: [],
  };
}

/** Los registros son inmutables, así que basta copiar los contenedores. */
function copiar(estado: Estado): Estado {
  return {
    aceptacion_politica: new Map(estado.aceptacion_politica),
    apoderado: new Map(estado.apoderado),
    paciente: new Map(estado.paciente),
    cita: new Map(estado.cita),
    registro_sesion: new Map(estado.registro_sesion),
    cola: [...estado.cola],
    eventos: [...estado.eventos],
  };
}

function noEncontrado(entidad: EntidadSync): ErrorRepositorio {
  return new ErrorRepositorio('no_encontrado', `No existe el registro de "${entidad}" indicado.`);
}

/**
 * Implementación en memoria con el mismo comportamiento transaccional que la
 * de SQLite. Se usa en las pruebas de Jest, que no pueden cargar módulos nativos.
 */
export class RepositorioMemoria implements IRepositorioClinico {
  private estado: Estado = estadoVacio();

  constructor(private readonly deps: DependenciasRepositorio) {}

  /**
   * Ejecuta la tarea sobre una copia y solo la confirma si termina sin error
   * (equivalente a BEGIN/COMMIT/ROLLBACK). La tarea es síncrona, así que dos
   * transacciones nunca se intercalan.
   */
  private transaccion<T>(tarea: (borrador: Estado) => T): Promise<T> {
    try {
      const borrador = copiar(this.estado);
      const resultado = tarea(borrador);
      this.estado = borrador;
      return Promise.resolve(resultado);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private encolar(
    borrador: Estado,
    entidad: EntidadSync,
    operacion: TipoOperacionSync,
    registro: object,
  ): void {
    borrador.cola.push(construirOperacion(entidad, operacion, registro, this.deps));
  }

  private exigirApoderado(borrador: Estado, id: string | null): void {
    if (id !== null && !borrador.apoderado.has(id)) throw noEncontrado('apoderado');
  }

  async inicializar(): Promise<void> {}

  async cerrar(): Promise<void> {}

  async estaVacio(): Promise<boolean> {
    const { apoderado, paciente, cita, registro_sesion } = this.estado;
    return apoderado.size + paciente.size + cita.size + registro_sesion.size === 0;
  }

  // ---------- Política ----------

  registrarAceptacionPolitica(datos: NuevaAceptacionPolitica): Promise<AceptacionPolitica> {
    return this.transaccion((borrador) => {
      const aceptacion = construirAceptacion(datos, this.deps);
      borrador.aceptacion_politica.set(aceptacion.id, aceptacion);
      this.encolar(borrador, 'aceptacion_politica', 'crear', aceptacion);
      return aceptacion;
    });
  }

  async obtenerAceptacionPolitica(version: string): Promise<AceptacionPolitica | null> {
    const coincidencias = [...this.estado.aceptacion_politica.values()]
      .filter((a) => a.version === version)
      .sort((a, b) => b.aceptada_en.localeCompare(a.aceptada_en));
    return coincidencias[0] ?? null;
  }

  // ---------- Apoderados ----------

  crearApoderado(datos: NuevoApoderado): Promise<Apoderado> {
    return this.transaccion((borrador) => {
      const apoderado = construirApoderado(datos, this.deps);
      borrador.apoderado.set(apoderado.id, apoderado);
      this.encolar(borrador, 'apoderado', 'crear', apoderado);
      return apoderado;
    });
  }

  actualizarApoderado(id: string, cambios: CambiosApoderado): Promise<Apoderado> {
    return this.transaccion((borrador) => {
      const actual = borrador.apoderado.get(id);
      if (!actual) throw noEncontrado('apoderado');
      const apoderado = aplicarCambiosApoderado(actual, cambios);
      borrador.apoderado.set(id, apoderado);
      this.encolar(borrador, 'apoderado', 'actualizar', apoderado);
      return apoderado;
    });
  }

  async obtenerApoderado(id: string): Promise<Apoderado | null> {
    return this.estado.apoderado.get(id) ?? null;
  }

  async listarApoderados(): Promise<Apoderado[]> {
    return [...this.estado.apoderado.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // ---------- Pacientes ----------

  crearPaciente(datos: NuevoPaciente): Promise<Paciente> {
    return this.transaccion((borrador) => {
      const paciente = construirPaciente(datos, this.deps);
      this.exigirApoderado(borrador, paciente.apoderado_id);
      borrador.paciente.set(paciente.id, paciente);
      this.encolar(borrador, 'paciente', 'crear', paciente);
      return paciente;
    });
  }

  actualizarPaciente(id: string, cambios: CambiosPaciente): Promise<Paciente> {
    return this.transaccion((borrador) => {
      const actual = borrador.paciente.get(id);
      if (!actual) throw noEncontrado('paciente');
      const paciente = aplicarCambiosPaciente(actual, cambios, this.deps);
      this.exigirApoderado(borrador, paciente.apoderado_id);
      borrador.paciente.set(id, paciente);
      this.encolar(borrador, 'paciente', 'actualizar', paciente);
      return paciente;
    });
  }

  archivarPaciente(id: string): Promise<Paciente> {
    return this.transaccion((borrador) => {
      const actual = borrador.paciente.get(id);
      if (!actual) throw noEncontrado('paciente');
      const paciente = archivar(actual, this.deps);
      borrador.paciente.set(id, paciente);
      this.encolar(borrador, 'paciente', 'archivar', paciente);
      return paciente;
    });
  }

  async obtenerPaciente(id: string): Promise<Paciente | null> {
    return this.estado.paciente.get(id) ?? null;
  }

  async listarPacientes(opciones?: { incluirArchivados?: boolean }): Promise<Paciente[]> {
    return [...this.estado.paciente.values()]
      .filter((p) => opciones?.incluirArchivados === true || !p.archivado)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // ---------- Citas ----------

  crearCita(datos: NuevaCita): Promise<Cita> {
    return this.transaccion((borrador) => {
      const cita = construirCita(datos, this.deps);
      if (!borrador.paciente.has(cita.paciente_id)) throw noEncontrado('paciente');
      borrador.cita.set(cita.id, cita);
      this.encolar(borrador, 'cita', 'crear', cita);
      return cita;
    });
  }

  actualizarCita(id: string, cambios: CambiosCita): Promise<Cita> {
    return this.transaccion((borrador) => {
      const actual = borrador.cita.get(id);
      if (!actual) throw noEncontrado('cita');
      const cita = aplicarCambiosCita(actual, cambios, this.deps);
      borrador.cita.set(id, cita);
      this.encolar(borrador, 'cita', 'actualizar', cita);
      return cita;
    });
  }

  async obtenerCita(id: string): Promise<Cita | null> {
    return this.estado.cita.get(id) ?? null;
  }

  async listarCitasEntre(desde: string, hasta: string): Promise<Cita[]> {
    const inicio = new Date(desde).toISOString();
    const fin = new Date(hasta).toISOString();
    return [...this.estado.cita.values()]
      .filter((c) => c.fecha_hora >= inicio && c.fecha_hora < fin)
      .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
  }

  async listarCitasDePaciente(pacienteId: string): Promise<Cita[]> {
    return [...this.estado.cita.values()]
      .filter((c) => c.paciente_id === pacienteId)
      .sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
  }

  // ---------- Registros de sesión ----------

  crearRegistroSesion(datos: NuevoRegistroSesion): Promise<RegistroSesion> {
    return this.transaccion((borrador) => {
      const registro = construirRegistroSesion(datos, this.deps);
      if (!borrador.cita.has(registro.cita_id)) throw noEncontrado('cita');
      for (const existente of borrador.registro_sesion.values()) {
        if (existente.cita_id === registro.cita_id) {
          throw new ErrorRepositorio('duplicado', 'La cita ya tiene un registro de sesión.');
        }
      }
      borrador.registro_sesion.set(registro.id, registro);
      this.encolar(borrador, 'registro_sesion', 'crear', registro);
      return registro;
    });
  }

  actualizarRegistroSesion(id: string, cambios: CambiosRegistroSesion): Promise<RegistroSesion> {
    return this.transaccion((borrador) => {
      const actual = borrador.registro_sesion.get(id);
      if (!actual) throw noEncontrado('registro_sesion');
      const registro = aplicarCambiosRegistroSesion(actual, cambios, this.deps);
      borrador.registro_sesion.set(id, registro);
      this.encolar(borrador, 'registro_sesion', 'actualizar', registro);
      return registro;
    });
  }

  archivarRegistroSesion(id: string): Promise<RegistroSesion> {
    return this.transaccion((borrador) => {
      const actual = borrador.registro_sesion.get(id);
      if (!actual) throw noEncontrado('registro_sesion');
      const registro = archivar(actual, this.deps);
      borrador.registro_sesion.set(id, registro);
      this.encolar(borrador, 'registro_sesion', 'archivar', registro);
      return registro;
    });
  }

  async obtenerRegistroSesion(id: string): Promise<RegistroSesion | null> {
    return this.estado.registro_sesion.get(id) ?? null;
  }

  async obtenerRegistroSesionPorCita(citaId: string): Promise<RegistroSesion | null> {
    for (const registro of this.estado.registro_sesion.values()) {
      if (registro.cita_id === citaId) return registro;
    }
    return null;
  }

  // ---------- Sincronización ----------

  async listarColaSync(): Promise<OperacionColaSync[]> {
    return ordenarCola(this.estado.cola);
  }

  confirmarOperacionSync(opId: string): Promise<void> {
    return this.transaccion((borrador) => {
      const operacion = borrador.cola.find((op) => op.op_id === opId);
      if (!operacion) return;
      borrador.cola = borrador.cola.filter((op) => op.op_id !== opId);
      const quedanPendientes = borrador.cola.some(
        (op) => op.entidad === operacion.entidad && op.registro_id === operacion.registro_id,
      );
      if (quedanPendientes) return;
      const tabla: Map<string, { estado_sync: string }> = borrador[operacion.entidad];
      const registro = tabla.get(operacion.registro_id);
      if (registro) tabla.set(operacion.registro_id, { ...registro, estado_sync: 'sincronizado' });
    });
  }

  registrarIntentoFallido(opId: string): Promise<void> {
    return this.transaccion((borrador) => {
      borrador.cola = borrador.cola.map((op) =>
        op.op_id === opId ? { ...op, intentos: op.intentos + 1 } : op,
      );
    });
  }

  registrarEventoSync(evento: NuevoEventoSync): Promise<EventoSync> {
    return this.transaccion((borrador) => {
      const completo: EventoSync = {
        evento_id: this.deps.generarUuid(),
        tipo: evento.tipo,
        entidad: evento.entidad,
        registro_id: evento.registro_id,
        op_id: evento.op_id,
        codigo_http: evento.codigo_http,
        ocurrido_en: this.deps.ahora(),
      };
      borrador.eventos.push(completo);
      return completo;
    });
  }

  async listarEventosSync(): Promise<EventoSync[]> {
    return [...this.estado.eventos];
  }

  limpiarEventosSync(conservar: number): Promise<number> {
    return this.transaccion((borrador) => {
      const limite = validarLimiteEventos(conservar);
      const total = borrador.eventos.length;
      borrador.eventos = limite === 0 ? [] : borrador.eventos.slice(-limite);
      return total - borrador.eventos.length;
    });
  }

  restaurarDesdeServidor(instantanea: InstantaneaServidor): Promise<void> {
    return this.transaccion((borrador) => {
      const vacio =
        borrador.apoderado.size +
          borrador.paciente.size +
          borrador.cita.size +
          borrador.registro_sesion.size ===
        0;
      if (!vacio) {
        throw new ErrorRepositorio('no_vacio', 'Solo se puede restaurar sobre un repositorio vacío.');
      }
      const datos = validarInstantanea(instantanea);
      datos.apoderados.forEach((a) => borrador.apoderado.set(a.id, a));
      datos.pacientes.forEach((p) => borrador.paciente.set(p.id, p));
      datos.citas.forEach((c) => borrador.cita.set(c.id, c));
      datos.registros_sesion.forEach((r) => borrador.registro_sesion.set(r.id, r));
    });
  }
}
