/** Lógica de pacientes y agenda sobre el repositorio. Sin DELETE: solo archivado lógico. */
import type { IRepositorioClinico } from '../../data/repositorio';
import type { Apoderado, Cita, Paciente, RegistroSesion } from '../../data/tipos';

export interface CitaConPaciente {
  readonly cita: Cita;
  readonly paciente: Paciente;
  readonly apoderado: Apoderado | null;
}

/** Límites [inicio, fin) del día local de `ref`, en ISO UTC. */
export function limitesDelDia(ref: Date): { desde: string; hasta: string } {
  const inicio = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const fin = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}

/** Citas del día ordenadas por `fecha_hora`, sin pacientes archivados. */
export async function listarCitasDelDia(
  repo: IRepositorioClinico,
  ref: Date = new Date(),
): Promise<CitaConPaciente[]> {
  const { desde, hasta } = limitesDelDia(ref);
  const [citas, pacientes, apoderados] = await Promise.all([
    repo.listarCitasEntre(desde, hasta),
    repo.listarPacientes(),
    repo.listarApoderados(),
  ]);
  const pacientePorId = new Map(pacientes.map((p) => [p.id, p]));
  const apoderadoPorId = new Map(apoderados.map((a) => [a.id, a]));
  const resultado: CitaConPaciente[] = [];
  for (const cita of citas) {
    const paciente = pacientePorId.get(cita.paciente_id);
    if (paciente === undefined || paciente.archivado) continue;
    const apoderado =
      paciente.apoderado_id === null ? null : (apoderadoPorId.get(paciente.apoderado_id) ?? null);
    resultado.push({ cita, paciente, apoderado });
  }
  return resultado.sort((a, b) => a.cita.fecha_hora.localeCompare(b.cita.fecha_hora));
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Búsqueda por nombre sin distinguir mayúsculas ni tildes. Vacío devuelve todos los activos. */
export function filtrarPacientes(pacientes: readonly Paciente[], consulta: string): Paciente[] {
  const q = normalizar(consulta);
  const activos = pacientes.filter((p) => !p.archivado);
  if (q.length === 0) return activos;
  return activos.filter((p) => normalizar(p.nombre).includes(q));
}

/** Orden estricto del resumen de última sesión (E3). */
export const ORDEN_RESUMEN_SESION = [
  { campo: 'objetivos_cumplidos', titulo: 'Objetivos cumplidos' },
  { campo: 'retroalimentacion_familia', titulo: 'Retroalimentación de la familia' },
  { campo: 'observaciones', titulo: 'Observaciones' },
] as const;

export interface ResumenUltimaSesion {
  readonly fecha_hora: string;
  readonly secciones: readonly { titulo: string; texto: string }[];
}

export function resumirRegistro(fechaHora: string, registro: RegistroSesion): ResumenUltimaSesion {
  return {
    fecha_hora: fechaHora,
    secciones: ORDEN_RESUMEN_SESION.map(({ campo, titulo }) => ({
      titulo,
      texto: registro[campo],
    })),
  };
}

/** `null` si el paciente no tiene sesiones registradas (no archivadas). */
export async function obtenerResumenUltimaSesion(
  repo: IRepositorioClinico,
  pacienteId: string,
): Promise<ResumenUltimaSesion | null> {
  const citas = [...(await repo.listarCitasDePaciente(pacienteId))].sort((a, b) =>
    b.fecha_hora.localeCompare(a.fecha_hora),
  );
  for (const cita of citas) {
    const registro = await repo.obtenerRegistroSesionPorCita(cita.id);
    if (registro !== null && !registro.archivado) return resumirRegistro(cita.fecha_hora, registro);
  }
  return null;
}

export interface DatosFormularioPaciente {
  readonly nombre: string;
  readonly fecha_nacimiento: string | null;
  readonly antecedentes: string;
  readonly motivo_consulta: string;
  readonly apoderado_nombre: string;
  readonly apoderado_telefono: string | null;
}

/** Crea o actualiza paciente y su apoderado (opcional). Nunca elimina. */
export async function guardarPacienteConApoderado(
  repo: IRepositorioClinico,
  propietariaId: string,
  datos: DatosFormularioPaciente,
  pacienteId?: string,
): Promise<Paciente> {
  const nombreApoderado = datos.apoderado_nombre.trim();
  const existente = pacienteId === undefined ? null : await repo.obtenerPaciente(pacienteId);
  let apoderadoId: string | null = existente?.apoderado_id ?? null;
  if (nombreApoderado.length > 0) {
    if (apoderadoId === null) {
      apoderadoId = (
        await repo.crearApoderado({
          propietaria_id: propietariaId,
          nombre: nombreApoderado,
          telefono: datos.apoderado_telefono,
        })
      ).id;
    } else {
      await repo.actualizarApoderado(apoderadoId, {
        nombre: nombreApoderado,
        telefono: datos.apoderado_telefono,
      });
    }
  }
  const campos = {
    nombre: datos.nombre.trim(),
    apoderado_id: apoderadoId,
    fecha_nacimiento: datos.fecha_nacimiento,
    antecedentes: datos.antecedentes,
    motivo_consulta: datos.motivo_consulta,
  };
  if (existente !== null && pacienteId !== undefined) {
    return repo.actualizarPaciente(pacienteId, campos);
  }
  return repo.crearPaciente({ propietaria_id: propietariaId, ...campos });
}

/** Archivado lógico: el paciente deja de listarse pero se conserva (Ley 20.584). */
export function archivarPaciente(repo: IRepositorioClinico, pacienteId: string): Promise<Paciente> {
  return repo.archivarPaciente(pacienteId);
}

/** Convierte `AAAA-MM-DD` + `HH:MM` (hora local) a ISO UTC; `null` si es inválido. */
export function combinarFechaHora(fecha: string, hora: string): string | null {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  const h = /^(\d{2}):(\d{2})$/.exec(hora.trim());
  if (f === null || h === null) return null;
  const anio = Number(f[1]);
  const mes = Number(f[2]);
  const dia = Number(f[3]);
  const hh = Number(h[1]);
  const mm = Number(h[2]);
  const d = new Date(anio, mes - 1, dia, hh, mm);
  if (
    d.getFullYear() !== anio ||
    d.getMonth() !== mes - 1 ||
    d.getDate() !== dia ||
    hh > 23 ||
    mm > 59
  ) {
    return null;
  }
  return d.toISOString();
}
