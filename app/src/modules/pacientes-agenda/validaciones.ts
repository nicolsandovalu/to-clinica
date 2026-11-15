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
