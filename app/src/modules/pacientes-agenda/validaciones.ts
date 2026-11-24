/** Validaciones del módulo pacientes-agenda (sin dependencias de React ni de módulos nativos). */

export const PATRON_TELEFONO_CHILENO = /^\+569\d{8}$/;

export const MENSAJE_TELEFONO_INVALIDO = 'Ingresa un teléfono con formato +569XXXXXXXX.';

export interface ResultadoTelefono {
  readonly valido: boolean;
  /** Teléfono sin espacios externos; `null` si estaba vacío o es inválido. */
  readonly telefono: string | null;
  readonly error: string | null;
}

/**
 * Limpia los espacios externos y valida `^\+569\d{8}$`.
 * El teléfono es opcional: vacío es válido y se normaliza a `null`.
 */
export function normalizarYValidarTelefonoChileno(
  entrada: string | null | undefined,
): ResultadoTelefono {
  const limpio = (entrada ?? '').trim();
  if (limpio.length === 0) return { valido: true, telefono: null, error: null };
  if (!PATRON_TELEFONO_CHILENO.test(limpio)) {
    return { valido: false, telefono: null, error: MENSAJE_TELEFONO_INVALIDO };
  }
  return { valido: true, telefono: limpio, error: null };
}

/**
 * Acepta AAAA-MM-DD, DD-MM-AAAA, DD/MM/AAAA o DD.MM.AAAA y devuelve AAAA-MM-DD.
 * `null` si el formato no se reconoce o la fecha no existe (p. ej. 31-02-2026).
 */
export function normalizarFecha(entrada: string): string | null {
  const t = entrada.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const local = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  let partes: [number, number, number];
  if (iso !== null) partes = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local !== null) partes = [Number(local[3]), Number(local[2]), Number(local[1])];
  else return null;
  const [anio, mes, dia] = partes;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null;
  }
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
