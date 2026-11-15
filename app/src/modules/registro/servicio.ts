/** Registro de sesión e historial sobre el repositorio local. Sin DELETE: solo archivado lógico. */
import { ErrorRepositorio, type IRepositorioClinico } from '../../data/repositorio';
import type { Cita, EstadoSync, Paciente, RegistroSesion } from '../../data/tipos';

export interface CamposSesion {
  readonly observaciones: string;
  readonly objetivos_cumplidos: string;
  readonly retroalimentacion_familia: string;
}

export const CAMPOS_VACIOS: CamposSesion = {
  observaciones: '',
  objetivos_cumplidos: '',
  retroalimentacion_familia: '',
};

export interface ContextoRegistro {
  readonly cita: Cita;
  readonly paciente: Paciente;
  /** Registro ya existente de la cita (relación 1 a 1), o `null` si aún no hay. */
  readonly registro: RegistroSesion | null;
}

/** Carga cita, paciente y registro previo; `null` si la cita o el paciente no existen. */
export async function cargarContextoRegistro(
  repo: IRepositorioClinico,
  citaId: string,
): Promise<ContextoRegistro | null> {
  const cita = await repo.obtenerCita(citaId);
  if (cita === null) return null;
  const paciente = await repo.obtenerPaciente(cita.paciente_id);
  if (paciente === null) return null;
  const registro = await repo.obtenerRegistroSesionPorCita(citaId);
  return { cita, paciente, registro: registro !== null && !registro.archivado ? registro : null };
}

/**
 * Guarda la sesión de una cita: crea el registro o, si ya existe, lo edita.
 * El repositorio encola la operación en `cola_sync` en la misma transacción.
 */
export async function guardarSesion(
  repo: IRepositorioClinico,
  citaId: string,
  campos: CamposSesion,
): Promise<RegistroSesion> {
  const existente = await repo.obtenerRegistroSesionPorCita(citaId);
  if (existente !== null) return repo.actualizarRegistroSesion(existente.id, campos);
  try {
    return await repo.crearRegistroSesion({ cita_id: citaId, ...campos });
  } catch (error) {
    // Carrera: otro guardado creó el registro entre la lectura y la escritura.
    if (error instanceof ErrorRepositorio && error.codigo === 'duplicado') {
      const creado = await repo.obtenerRegistroSesionPorCita(citaId);
      if (creado !== null) return repo.actualizarRegistroSesion(creado.id, campos);
    }
    throw error;
  }
}

export interface EntradaHistorial {
  readonly registro: RegistroSesion;
  readonly cita: Cita;
  readonly estado_sync: EstadoSync;
}

/** Sesiones activas (no archivadas) del paciente, de la más reciente a la más antigua por `creado_en`. */
export async function listarHistorial(
  repo: IRepositorioClinico,
  pacienteId: string,
): Promise<EntradaHistorial[]> {
  const citas = await repo.listarCitasDePaciente(pacienteId);
  const entradas: EntradaHistorial[] = [];
  for (const cita of citas) {
    const registro = await repo.obtenerRegistroSesionPorCita(cita.id);
    if (registro === null || registro.archivado) continue;
    entradas.push({ registro, cita, estado_sync: registro.estado_sync });
  }
  return entradas.sort((a, b) => b.registro.creado_en.localeCompare(a.registro.creado_en));
}

/** Edita una sesión histórica: actualiza `modificado_en` y encola en `cola_sync`. */
export function editarSesionHistorica(
  repo: IRepositorioClinico,
  registroId: string,
  campos: CamposSesion,
): Promise<RegistroSesion> {
  return repo.actualizarRegistroSesion(registroId, campos);
}
