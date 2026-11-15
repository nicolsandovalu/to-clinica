/**
 * Reglas de negocio puras compartidas por todas las implementaciones del
 * repositorio (SQLite y memoria), para que su comportamiento sea idéntico.
 */
import { DependenciasRepositorio, ErrorRepositorio } from './repositorio';
import {
  AceptacionPolitica,
  Apoderado,
  CambiosApoderado,
  CambiosCita,
  CambiosPaciente,
  CambiosRegistroSesion,
  Cita,
  ESTADOS_CITA,
  EntidadSync,
  EstadoCita,
  InstantaneaServidor,
  NuevaAceptacionPolitica,
  NuevaCita,
  NuevoApoderado,
  NuevoPaciente,
  NuevoRegistroSesion,
  ORDEN_ENTIDADES_SYNC,
  OperacionColaSync,
  Paciente,
  RegistroSesion,
  TipoOperacionSync,
  ValorJson,
} from './tipos';

export const PATRON_TELEFONO = /^\+569\d{8}$/;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalido(campo: string, motivo: string): ErrorRepositorio {
  return new ErrorRepositorio('validacion', `Campo "${campo}" inválido: ${motivo}.`);
}

function textoObligatorio(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw invalido(campo, 'es obligatorio');
  }
  return valor.trim();
}

function textoLibre(valor: unknown, campo: string): string {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw invalido(campo, 'debe ser texto');
  return valor;
}

function identificador(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw invalido(campo, 'es obligatorio');
  return valor;
}

function uuid(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !PATRON_UUID.test(valor)) {
    throw invalido(campo, 'debe ser un UUID');
  }
  return valor.toLowerCase();
}

function uuidOpcional(valor: unknown, campo: string): string | null {
  return valor === undefined || valor === null ? null : uuid(valor, campo);
}

function telefono(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !PATRON_TELEFONO.test(valor)) {
    throw invalido('telefono', 'debe tener el formato +569XXXXXXXX');
  }
  return valor;
}

function fechaNacimiento(valor: unknown): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor !== 'string' || !PATRON_FECHA.test(valor)) {
    throw invalido('fecha_nacimiento', 'debe tener el formato AAAA-MM-DD');
  }
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
    throw invalido('fecha_nacimiento', 'no es una fecha real');
  }
  return valor;
}

/** Normaliza a ISO 8601 UTC para que el orden de texto coincida con el cronológico. */
function instante(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || valor.length === 0) throw invalido(campo, 'es obligatorio');
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) throw invalido(campo, 'no es una fecha y hora válida');
  return fecha.toISOString();
}

function estadoCita(valor: unknown): EstadoCita {
  const encontrado = ESTADOS_CITA.find((estado) => estado === valor);
  if (encontrado === undefined) throw invalido('estado', 'valor no permitido');
  return encontrado;
}

function booleano(valor: unknown, campo: string): boolean {
  if (typeof valor !== 'boolean') throw invalido(campo, 'debe ser verdadero o falso');
  return valor;
}

// ---------- Construcción de registros nuevos ----------

export function construirAceptacion(
  datos: NuevaAceptacionPolitica,
  deps: DependenciasRepositorio,
): AceptacionPolitica {
  return {
    id: deps.generarUuid(),
    usuaria_id: datos.usuaria_id ?? null,
    version: textoObligatorio(datos.version, 'version'),
    aceptada_en: deps.ahora(),
    estado_sync: 'pendiente',
  };
}

export function construirApoderado(datos: NuevoApoderado, deps: DependenciasRepositorio): Apoderado {
  return {
    id: deps.generarUuid(),
    propietaria_id: identificador(datos.propietaria_id, 'propietaria_id'),
    nombre: textoObligatorio(datos.nombre, 'nombre'),
    telefono: telefono(datos.telefono),
    estado_sync: 'pendiente',
  };
}

export function construirPaciente(datos: NuevoPaciente, deps: DependenciasRepositorio): Paciente {
  const ahora = deps.ahora();
  return {
    id: deps.generarUuid(),
    propietaria_id: identificador(datos.propietaria_id, 'propietaria_id'),
    apoderado_id: datos.apoderado_id ?? null,
    nombre: textoObligatorio(datos.nombre, 'nombre'),
    fecha_nacimiento: fechaNacimiento(datos.fecha_nacimiento),
    antecedentes: textoLibre(datos.antecedentes, 'antecedentes'),
    motivo_consulta: textoLibre(datos.motivo_consulta, 'motivo_consulta'),
    archivado: false,
    creado_en: ahora,
    modificado_en: ahora,
    estado_sync: 'pendiente',
  };
}

export function construirCita(datos: NuevaCita, deps: DependenciasRepositorio): Cita {
  const ahora = deps.ahora();
  return {
    id: deps.generarUuid(),
    paciente_id: identificador(datos.paciente_id, 'paciente_id'),
    fecha_hora: instante(datos.fecha_hora, 'fecha_hora'),
    estado: estadoCita(datos.estado ?? 'pendiente'),
    creado_en: ahora,
    modificado_en: ahora,
    estado_sync: 'pendiente',
  };
}

export function construirRegistroSesion(
  datos: NuevoRegistroSesion,
  deps: DependenciasRepositorio,
): RegistroSesion {
  const ahora = deps.ahora();
  return {
    id: deps.generarUuid(),
    cita_id: identificador(datos.cita_id, 'cita_id'),
    observaciones: textoLibre(datos.observaciones, 'observaciones'),
    objetivos_cumplidos: textoLibre(datos.objetivos_cumplidos, 'objetivos_cumplidos'),
    retroalimentacion_familia: textoLibre(
      datos.retroalimentacion_familia,
      'retroalimentacion_familia',
    ),
    archivado: false,
    creado_en: ahora,
    modificado_en: ahora,
    estado_sync: 'pendiente',
  };
}

// ---------- Aplicación de cambios ----------

export function aplicarCambiosApoderado(actual: Apoderado, cambios: CambiosApoderado): Apoderado {
  return {
    ...actual,
    nombre: cambios.nombre === undefined ? actual.nombre : textoObligatorio(cambios.nombre, 'nombre'),
    telefono: cambios.telefono === undefined ? actual.telefono : telefono(cambios.telefono),
    estado_sync: 'pendiente',
  };
}

export function aplicarCambiosPaciente(
  actual: Paciente,
  cambios: CambiosPaciente,
  deps: DependenciasRepositorio,
): Paciente {
  return {
    ...actual,
    nombre: cambios.nombre === undefined ? actual.nombre : textoObligatorio(cambios.nombre, 'nombre'),
    apoderado_id: cambios.apoderado_id === undefined ? actual.apoderado_id : cambios.apoderado_id,
    fecha_nacimiento:
      cambios.fecha_nacimiento === undefined
        ? actual.fecha_nacimiento
        : fechaNacimiento(cambios.fecha_nacimiento),
    antecedentes:
      cambios.antecedentes === undefined
        ? actual.antecedentes
        : textoLibre(cambios.antecedentes, 'antecedentes'),
    motivo_consulta:
      cambios.motivo_consulta === undefined
        ? actual.motivo_consulta
        : textoLibre(cambios.motivo_consulta, 'motivo_consulta'),
    modificado_en: deps.ahora(),
    estado_sync: 'pendiente',
  };
}

export function aplicarCambiosCita(
  actual: Cita,
  cambios: CambiosCita,
  deps: DependenciasRepositorio,
): Cita {
  return {
    ...actual,
    fecha_hora:
      cambios.fecha_hora === undefined ? actual.fecha_hora : instante(cambios.fecha_hora, 'fecha_hora'),
    estado: cambios.estado === undefined ? actual.estado : estadoCita(cambios.estado),
    modificado_en: deps.ahora(),
    estado_sync: 'pendiente',
  };
}

export function aplicarCambiosRegistroSesion(
  actual: RegistroSesion,
  cambios: CambiosRegistroSesion,
  deps: DependenciasRepositorio,
): RegistroSesion {
  return {
    ...actual,
    observaciones:
      cambios.observaciones === undefined
        ? actual.observaciones
        : textoLibre(cambios.observaciones, 'observaciones'),
    objetivos_cumplidos:
      cambios.objetivos_cumplidos === undefined
        ? actual.objetivos_cumplidos
        : textoLibre(cambios.objetivos_cumplidos, 'objetivos_cumplidos'),
    retroalimentacion_familia:
      cambios.retroalimentacion_familia === undefined
        ? actual.retroalimentacion_familia
        : textoLibre(cambios.retroalimentacion_familia, 'retroalimentacion_familia'),
    modificado_en: deps.ahora(),
    estado_sync: 'pendiente',
  };
}

export function archivar<T extends Paciente | RegistroSesion>(
  actual: T,
  deps: DependenciasRepositorio,
): T {
  return { ...actual, archivado: true, modificado_en: deps.ahora(), estado_sync: 'pendiente' };
}

// ---------- Cola de sincronización ----------

type RegistroSincronizable = { readonly id: string; readonly estado_sync: unknown } & Record<
  string,
  unknown
>;

/** Crea la operación de outbox para un registro ya guardado. Genera el `op_id`. */
export function construirOperacion(
  entidad: EntidadSync,
  operacion: TipoOperacionSync,
  registro: object,
  deps: DependenciasRepositorio,
): OperacionColaSync {
  const { estado_sync: _omitido, ...resto } = registro as RegistroSincronizable;
  const datos = resto as Record<string, ValorJson>;
  const modificadoEn = typeof datos.modificado_en === 'string' ? datos.modificado_en : deps.ahora();
  return {
    op_id: deps.generarUuid(),
    entidad,
    registro_id: String(datos.id),
    operacion,
    modificado_en: modificadoEn,
    datos,
    intentos: 0,
  };
}

/** Orden de envío: Apoderado -> Paciente -> Cita -> RegistroSesion; dentro de cada una, por antigüedad. */
export function ordenarCola(cola: readonly OperacionColaSync[]): OperacionColaSync[] {
  return cola
    .map((operacion, posicion) => ({ operacion, posicion }))
    .sort(
      (a, b) =>
        ORDEN_ENTIDADES_SYNC.indexOf(a.operacion.entidad) -
          ORDEN_ENTIDADES_SYNC.indexOf(b.operacion.entidad) || a.posicion - b.posicion,
    )
    .map(({ operacion }) => operacion);
}

/** Cantidad de eventos de `evento_sync` a conservar: entero mayor o igual a cero. */
export function validarLimiteEventos(conservar: number): number {
  if (!Number.isInteger(conservar) || conservar < 0) {
    throw invalido('conservar', 'debe ser un entero mayor o igual a cero');
  }
  return conservar;
}

// ---------- Restauración ----------

export interface InstantaneaValidada {
  readonly apoderados: Apoderado[];
  readonly pacientes: Paciente[];
  readonly citas: Cita[];
  readonly registros_sesion: RegistroSesion[];
}

function lista(valor: unknown, campo: string): Record<string, unknown>[] {
  if (!Array.isArray(valor)) throw invalido(campo, 'debe ser una lista');
  return valor.map((elemento) => {
    if (typeof elemento !== 'object' || elemento === null) {
      throw invalido(campo, 'contiene un elemento que no es un objeto');
    }
    return elemento as Record<string, unknown>;
  });
}

/**
 * Valida la respuesta del servidor (dato externo, no confiable) y comprueba la
 * integridad referencial y la unicidad antes de tocar la base local.
 */
export function validarInstantanea(instantanea: InstantaneaServidor): InstantaneaValidada {
  const origen = instantanea as unknown as Record<string, unknown>;
  if (typeof origen !== 'object' || origen === null) throw invalido('instantanea', 'debe ser un objeto');

  const apoderados = lista(origen.apoderados, 'apoderados').map(
    (a): Apoderado => ({
      id: uuid(a.id, 'apoderado.id'),
      propietaria_id: identificador(String(a.propietaria_id ?? ''), 'apoderado.propietaria_id'),
      nombre: textoObligatorio(a.nombre, 'apoderado.nombre'),
      telefono: telefono(a.telefono),
      estado_sync: 'sincronizado',
    }),
  );
  const pacientes = lista(origen.pacientes, 'pacientes').map(
    (p): Paciente => ({
      id: uuid(p.id, 'paciente.id'),
      propietaria_id: identificador(String(p.propietaria_id ?? ''), 'paciente.propietaria_id'),
      apoderado_id: uuidOpcional(p.apoderado_id, 'paciente.apoderado_id'),
      nombre: textoObligatorio(p.nombre, 'paciente.nombre'),
      fecha_nacimiento: fechaNacimiento(p.fecha_nacimiento),
      antecedentes: textoLibre(p.antecedentes, 'paciente.antecedentes'),
      motivo_consulta: textoLibre(p.motivo_consulta, 'paciente.motivo_consulta'),
      archivado: booleano(p.archivado, 'paciente.archivado'),
      creado_en: instante(p.creado_en, 'paciente.creado_en'),
      modificado_en: instante(p.modificado_en, 'paciente.modificado_en'),
      estado_sync: 'sincronizado',
    }),
  );
  const citas = lista(origen.citas, 'citas').map(
    (c): Cita => ({
      id: uuid(c.id, 'cita.id'),
      paciente_id: uuid(c.paciente_id, 'cita.paciente_id'),
      fecha_hora: instante(c.fecha_hora, 'cita.fecha_hora'),
      estado: estadoCita(c.estado),
      creado_en: instante(c.creado_en, 'cita.creado_en'),
      modificado_en: instante(c.modificado_en, 'cita.modificado_en'),
      estado_sync: 'sincronizado',
    }),
  );
  const registros = lista(origen.registros_sesion, 'registros_sesion').map(
    (r): RegistroSesion => ({
      id: uuid(r.id, 'registro_sesion.id'),
      cita_id: uuid(r.cita_id, 'registro_sesion.cita_id'),
      observaciones: textoLibre(r.observaciones, 'registro_sesion.observaciones'),
      objetivos_cumplidos: textoLibre(r.objetivos_cumplidos, 'registro_sesion.objetivos_cumplidos'),
      retroalimentacion_familia: textoLibre(
        r.retroalimentacion_familia,
        'registro_sesion.retroalimentacion_familia',
      ),
      archivado: booleano(r.archivado, 'registro_sesion.archivado'),
      creado_en: instante(r.creado_en, 'registro_sesion.creado_en'),
      modificado_en: instante(r.modificado_en, 'registro_sesion.modificado_en'),
      estado_sync: 'sincronizado',
    }),
  );

  const idsUnicos = (ids: string[], campo: string): Set<string> => {
    const conjunto = new Set(ids);
    if (conjunto.size !== ids.length) {
      throw new ErrorRepositorio('duplicado', `La restauración contiene "${campo}" repetidos.`);
    }
    return conjunto;
  };
  const idsApoderados = idsUnicos(apoderados.map((a) => a.id), 'apoderado.id');
  const idsPacientes = idsUnicos(pacientes.map((p) => p.id), 'paciente.id');
  const idsCitas = idsUnicos(citas.map((c) => c.id), 'cita.id');
  idsUnicos(registros.map((r) => r.id), 'registro_sesion.id');
  idsUnicos(registros.map((r) => r.cita_id), 'registro_sesion.cita_id');

  const referencia = (existe: boolean, campo: string): void => {
    if (!existe) throw invalido(campo, 'referencia a un registro inexistente');
  };
  pacientes.forEach((p) =>
    referencia(p.apoderado_id === null || idsApoderados.has(p.apoderado_id), 'paciente.apoderado_id'),
  );
  citas.forEach((c) => referencia(idsPacientes.has(c.paciente_id), 'cita.paciente_id'));
  registros.forEach((r) => referencia(idsCitas.has(r.cita_id), 'registro_sesion.cita_id'));

  return { apoderados, pacientes, citas, registros_sesion: registros };
}
