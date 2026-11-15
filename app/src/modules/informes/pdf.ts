/**
 * Informe PDF local (E5/C4). Solo compila texto ya dictado o escrito por la
 * terapeuta: no hay IA ni redacción automática. El PDF se genera y comparte en
 * el dispositivo con `expo-print` y `expo-sharing`; nunca se sube al servidor.
 * Ningún texto clínico se escribe en consola (CS-07).
 */
import type { IRepositorioClinico } from '../../data/repositorio';
import type { Paciente } from '../../data/tipos';
import { listarHistorial, type EntradaHistorial } from '../registro/servicio';

export const TEXTO_SIN_SESIONES_RANGO = 'No hay sesiones registradas en el rango seleccionado';

export const CATEGORIAS_EVOLUCION = [
  { clave: 'observaciones', titulo: 'Observaciones' },
  { clave: 'objetivos_cumplidos', titulo: 'Objetivos cumplidos' },
  { clave: 'retroalimentacion_familia', titulo: 'Retroalimentación de la familia' },
] as const;
export type CategoriaEvolucion = (typeof CATEGORIAS_EVOLUCION)[number]['clave'];

/** Secciones que la terapeuta completa a mano; parten vacías. */
export const SECCIONES_EDITABLES = [
  { clave: 'evaluacion', titulo: 'Evaluación' },
  { clave: 'diagnostico_ocupacional', titulo: 'Diagnóstico ocupacional' },
  { clave: 'recomendaciones', titulo: 'Recomendaciones' },
] as const;
export type SeccionEditable = (typeof SECCIONES_EDITABLES)[number]['clave'];

export type CampoTextoBorrador = 'antecedentes' | 'motivo_consulta' | SeccionEditable;

export interface ItemEvolucion {
  /** Id del registro de sesión de origen. */
  readonly id: string;
  readonly fecha_hora: string;
  readonly texto: string;
}

export interface BorradorInforme {
  readonly paciente_nombre: string;
  readonly fecha_nacimiento: string | null;
  readonly profesional: string;
  readonly fecha_inicio: string;
  readonly fecha_fin: string;
  readonly emitido_en: string;
  readonly total_sesiones: number;
  readonly antecedentes: string;
  readonly motivo_consulta: string;
  readonly evolucion: Readonly<Record<CategoriaEvolucion, readonly ItemEvolucion[]>>;
  readonly evaluacion: string;
  readonly diagnostico_ocupacional: string;
  readonly recomendaciones: string;
}

// ---------- Escape HTML (CS-03) ----------

const ENTIDADES_HTML: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa `& < > " '`. Debe aplicarse a TODA variable interpolada en el HTML. */
export function escaparHtml(texto: string): string {
  return texto.replace(/[&<>"']/g, (caracter) => ENTIDADES_HTML[caracter] ?? caracter);
}

// ---------- Rango de fechas ----------

export const MENSAJES_RANGO = {
  formato: 'Usa el formato AAAA-MM-DD en las fechas.',
  orden: 'La fecha de inicio no puede ser posterior a la fecha de fin.',
} as const;

function parsearDia(fecha: string): { anio: number; mes: number; dia: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha.trim());
  if (m === null) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(anio, mes - 1, dia);
  if (d.getFullYear() !== anio || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return { anio, mes, dia };
}

/** `null` si el rango es válido; si no, el mensaje para la usuaria. */
export function validarRango(fechaInicio: string, fechaFin: string): string | null {
  const a = parsearDia(fechaInicio);
  const b = parsearDia(fechaFin);
  if (a === null || b === null) return MENSAJES_RANGO.formato;
  const ini = new Date(a.anio, a.mes - 1, a.dia).getTime();
  const fin = new Date(b.anio, b.mes - 1, b.dia).getTime();
  return ini > fin ? MENSAJES_RANGO.orden : null;
}

/** Sesiones cuya cita cae entre ambos días (hora local, extremos incluidos), de la más antigua a la más reciente. */
export function filtrarSesionesPorRango(
  entradas: readonly EntradaHistorial[],
  fechaInicio: string,
  fechaFin: string,
): EntradaHistorial[] {
  if (validarRango(fechaInicio, fechaFin) !== null) return [];
  const a = parsearDia(fechaInicio);
  const b = parsearDia(fechaFin);
  if (a === null || b === null) return [];
  const desde = new Date(a.anio, a.mes - 1, a.dia).getTime();
  const hasta = new Date(b.anio, b.mes - 1, b.dia + 1).getTime();
  return entradas
    .filter((e) => {
      const t = new Date(e.cita.fecha_hora).getTime();
      return t >= desde && t < hasta;
    })
    .sort((x, y) => x.cita.fecha_hora.localeCompare(y.cita.fecha_hora));
}

// ---------- Compilación del borrador ----------

export interface OpcionesCompilacion {
  readonly paciente: Paciente;
  readonly entradas: readonly EntradaHistorial[];
  readonly fechaInicio: string;
  readonly fechaFin: string;
  readonly profesional: string;
  readonly ahora?: () => string;
}

/**
 * Arma el borrador con el texto existente, sin modificarlo. Devuelve `null`
 * si no hay sesiones en el rango (la pantalla deshabilita el PDF).
 */
export function compilarBorrador(o: OpcionesCompilacion): BorradorInforme | null {
  const sesiones = filtrarSesionesPorRango(o.entradas, o.fechaInicio, o.fechaFin);
  if (sesiones.length === 0) return null;
  const items = (clave: CategoriaEvolucion): ItemEvolucion[] =>
    sesiones
      .filter((e) => e.registro[clave].trim().length > 0)
      .map((e) => ({ id: e.registro.id, fecha_hora: e.cita.fecha_hora, texto: e.registro[clave] }));
  return {
    paciente_nombre: o.paciente.nombre,
    fecha_nacimiento: o.paciente.fecha_nacimiento,
    profesional: o.profesional,
    fecha_inicio: o.fechaInicio.trim(),
    fecha_fin: o.fechaFin.trim(),
    emitido_en: (o.ahora ?? (() => new Date().toISOString()))(),
    total_sesiones: sesiones.length,
    antecedentes: o.paciente.antecedentes,
    motivo_consulta: o.paciente.motivo_consulta,
    evolucion: {
      observaciones: items('observaciones'),
      objetivos_cumplidos: items('objetivos_cumplidos'),
      retroalimentacion_familia: items('retroalimentacion_familia'),
    },
    evaluacion: '',
    diagnostico_ocupacional: '',
    recomendaciones: '',
  };
}

/** Carga el historial activo del paciente y compila el borrador del rango. */
export async function compilarBorradorDePaciente(
  repo: IRepositorioClinico,
  pacienteId: string,
  fechaInicio: string,
  fechaFin: string,
  profesional: string,
): Promise<BorradorInforme | null> {
  const paciente = await repo.obtenerPaciente(pacienteId);
  if (paciente === null || paciente.archivado) return null;
  const entradas = await listarHistorial(repo, pacienteId);
  return compilarBorrador({ paciente, entradas, fechaInicio, fechaFin, profesional });
}

// ---------- Edición previa a exportar ----------

export function editarCampo(
  borrador: BorradorInforme,
  campo: CampoTextoBorrador,
  texto: string,
): BorradorInforme {
  return { ...borrador, [campo]: texto };
}

export function editarItem(
  borrador: BorradorInforme,
  categoria: CategoriaEvolucion,
  id: string,
  texto: string,
): BorradorInforme {
  return {
    ...borrador,
    evolucion: {
      ...borrador.evolucion,
      [categoria]: borrador.evolucion[categoria].map((i) => (i.id === id ? { ...i, texto } : i)),
    },
  };
}

/** Quita el texto solo del informe; el registro clínico original no se toca. */
export function eliminarItem(
  borrador: BorradorInforme,
  categoria: CategoriaEvolucion,
  id: string,
): BorradorInforme {
  return {
    ...borrador,
    evolucion: {
      ...borrador.evolucion,
      [categoria]: borrador.evolucion[categoria].filter((i) => i.id !== id),
    },
  };
}

// ---------- HTML ----------

/** Fecha local `DD-MM-AAAA` a partir de un ISO UTC o `AAAA-MM-DD`. */
export function formatearFecha(valor: string): string {
  const solo = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (solo !== null) return `${solo[3]}-${solo[2]}-${solo[1]}`;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function parrafos(texto: string): string {
  const limpio = texto.trim();
  if (limpio.length === 0) return '<p class="vacio">—</p>';
  return `<p>${escaparHtml(limpio).replace(/\r?\n/g, '<br/>')}</p>`;
}

function seccion(titulo: string, cuerpo: string): string {
  return `<section><h2>${escaparHtml(titulo)}</h2>${cuerpo}</section>`;
}

const ESTILOS = `
  body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 12pt; margin: 24px; }
  h1 { font-size: 18pt; margin: 0 0 4px; }
  h2 { font-size: 14pt; border-bottom: 1px solid #444; padding-bottom: 2px; margin-top: 20px; }
  h3 { font-size: 12pt; margin: 12px 0 4px; }
  .meta { color: #333; margin: 2px 0; }
  .fecha { font-weight: bold; }
  .vacio { color: #555; }
`;

/** Genera el HTML del informe. Toda variable interpolada pasa por `escaparHtml()`. */
export function construirHtml(b: BorradorInforme): string {
  const encabezado = [
    `<h1>Informe de terapia ocupacional</h1>`,
    `<p class="meta">Paciente: ${escaparHtml(b.paciente_nombre)}</p>`,
    b.fecha_nacimiento === null
      ? ''
      : `<p class="meta">Fecha de nacimiento: ${escaparHtml(formatearFecha(b.fecha_nacimiento))}</p>`,
    `<p class="meta">Profesional: ${escaparHtml(b.profesional)}</p>`,
    `<p class="meta">Período: ${escaparHtml(formatearFecha(b.fecha_inicio))} al ${escaparHtml(
      formatearFecha(b.fecha_fin),
    )} (${escaparHtml(String(b.total_sesiones))} sesiones)</p>`,
    `<p class="meta">Emitido el ${escaparHtml(formatearFecha(b.emitido_en))}</p>`,
  ].join('');

  const evolucion = CATEGORIAS_EVOLUCION.map(({ clave, titulo }) => {
    const items = b.evolucion[clave];
    const cuerpo =
      items.length === 0
        ? '<p class="vacio">—</p>'
        : items
            .map(
              (i) =>
                `<p><span class="fecha">${escaparHtml(formatearFecha(i.fecha_hora))}</span><br/>${escaparHtml(
                  i.texto.trim(),
                ).replace(/\r?\n/g, '<br/>')}</p>`,
            )
            .join('');
    return `<h3>${escaparHtml(titulo)}</h3>${cuerpo}`;
  }).join('');

  const cuerpo = [
    `<header>${encabezado}</header>`,
    seccion('Antecedentes', parrafos(b.antecedentes)),
    seccion('Motivo de consulta', parrafos(b.motivo_consulta)),
    seccion('Evolución cronológica', evolucion),
    ...SECCIONES_EDITABLES.map(({ clave, titulo }) => seccion(titulo, parrafos(b[clave]))),
  ].join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Informe</title><style>${ESTILOS}</style></head><body>${cuerpo}</body></html>`;
}

// ---------- Generación y envío local ----------

export interface DependenciasPdf {
  /** Escribe el HTML a un PDF local y devuelve su ruta. */
  readonly imprimirAArchivo: (html: string) => Promise<string>;
  readonly compartirDisponible: () => Promise<boolean>;
  readonly compartir: (uri: string) => Promise<void>;
}

export const dependenciasPdfExpo: DependenciasPdf = {
  imprimirAArchivo: async (html) => {
    const Print = await import('expo-print');
    return (await Print.printToFileAsync({ html })).uri;
  },
  compartirDisponible: async () => (await import('expo-sharing')).isAvailableAsync(),
  compartir: async (uri) => {
    const Sharing = await import('expo-sharing');
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  },
};

export type ResultadoPdf = 'compartido' | 'no_disponible';

/** Genera el PDF en el teléfono y abre el menú de compartir. No hay ninguna llamada de red. */
export async function generarYCompartirPdf(
  borrador: BorradorInforme,
  deps: DependenciasPdf = dependenciasPdfExpo,
): Promise<ResultadoPdf> {
  if (borrador.total_sesiones === 0) throw new Error('No hay sesiones para exportar.');
  const uri = await deps.imprimirAArchivo(construirHtml(borrador));
  if (!(await deps.compartirDisponible())) return 'no_disponible';
  await deps.compartir(uri);
  return 'compartido';
}
