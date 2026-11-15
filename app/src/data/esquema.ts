/**
 * Esquema local. Restricciones e índices equivalentes a los de PostgreSQL (CLAUDE.md §3).
 * Los disparadores `sin_borrado_*` impiden el DELETE físico de entidades clínicas
 * incluso si algún código futuro lo intentara (Ley 20.584: conservación 15 años).
 */
const ESTADO_SYNC = `estado_sync TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_sync IN ('pendiente', 'sincronizado'))`;

const TABLAS_SIN_BORRADO = ['aceptacion_politica', 'apoderado', 'paciente', 'cita', 'registro_sesion'];

export const SENTENCIAS_ESQUEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS aceptacion_politica (
    id TEXT PRIMARY KEY NOT NULL,
    usuaria_id TEXT,
    version TEXT NOT NULL CHECK (length(trim(version)) > 0),
    aceptada_en TEXT NOT NULL,
    ${ESTADO_SYNC}
  )`,
  `CREATE TABLE IF NOT EXISTS apoderado (
    id TEXT PRIMARY KEY NOT NULL,
    propietaria_id TEXT NOT NULL,
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    telefono TEXT CHECK (
      telefono IS NULL
      OR (length(telefono) = 12 AND telefono GLOB '+569[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
    ),
    ${ESTADO_SYNC}
  )`,
  `CREATE TABLE IF NOT EXISTS paciente (
    id TEXT PRIMARY KEY NOT NULL,
    propietaria_id TEXT NOT NULL,
    apoderado_id TEXT REFERENCES apoderado (id),
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    fecha_nacimiento TEXT,
    antecedentes TEXT NOT NULL DEFAULT '',
    motivo_consulta TEXT NOT NULL DEFAULT '',
    archivado INTEGER NOT NULL DEFAULT 0 CHECK (archivado IN (0, 1)),
    creado_en TEXT NOT NULL,
    modificado_en TEXT NOT NULL,
    ${ESTADO_SYNC}
  )`,
  `CREATE INDEX IF NOT EXISTS paciente_propietaria_nombre ON paciente (propietaria_id, nombre)`,
  `CREATE TABLE IF NOT EXISTS cita (
    id TEXT PRIMARY KEY NOT NULL,
    paciente_id TEXT NOT NULL REFERENCES paciente (id),
    fecha_hora TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'pendiente'
      CHECK (estado IN ('pendiente', 'confirmada', 'cancelada', 'sin_respuesta')),
    creado_en TEXT NOT NULL,
    modificado_en TEXT NOT NULL,
    ${ESTADO_SYNC}
  )`,
  `CREATE INDEX IF NOT EXISTS cita_fecha_hora ON cita (fecha_hora)`,
  `CREATE INDEX IF NOT EXISTS cita_paciente_fecha_hora ON cita (paciente_id, fecha_hora)`,
  `CREATE TABLE IF NOT EXISTS registro_sesion (
    id TEXT PRIMARY KEY NOT NULL,
    cita_id TEXT NOT NULL UNIQUE REFERENCES cita (id),
    observaciones TEXT NOT NULL DEFAULT '',
    objetivos_cumplidos TEXT NOT NULL DEFAULT '',
    retroalimentacion_familia TEXT NOT NULL DEFAULT '',
    archivado INTEGER NOT NULL DEFAULT 0 CHECK (archivado IN (0, 1)),
    creado_en TEXT NOT NULL,
    modificado_en TEXT NOT NULL,
    ${ESTADO_SYNC}
  )`,
  `CREATE TABLE IF NOT EXISTS cola_sync (
    op_id TEXT PRIMARY KEY NOT NULL,
    documento TEXT NOT NULL CHECK (json_valid(documento))
  )`,
  `CREATE TABLE IF NOT EXISTS evento_sync (
    evento_id TEXT PRIMARY KEY NOT NULL,
    documento TEXT NOT NULL CHECK (json_valid(documento))
  )`,
  ...TABLAS_SIN_BORRADO.map(
    (tabla) => `CREATE TRIGGER IF NOT EXISTS sin_borrado_${tabla} BEFORE DELETE ON ${tabla}
    BEGIN SELECT RAISE(ABORT, 'eliminacion fisica prohibida: usar archivado logico'); END`,
  ),
];
