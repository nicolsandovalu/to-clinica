/**
 * Enlace `wa.me` para solicitar confirmación de una cita (CS-05).
 * El mensaje contiene SOLO saludo, nombre del paciente y fecha/hora: cero datos clínicos.
 */
import { normalizarYValidarTelefonoChileno } from './validaciones';

function dos(n: number): string {
  return String(n).padStart(2, '0');
}

/** `dd/mm/aaaa a las HH:MM` en hora local del dispositivo. */
export function formatearFechaHoraCita(fechaHora: Date | string): string {
  const fecha = typeof fechaHora === 'string' ? new Date(fechaHora) : fechaHora;
  return (
    `${dos(fecha.getDate())}/${dos(fecha.getMonth() + 1)}/${fecha.getFullYear()}` +
    ` a las ${dos(fecha.getHours())}:${dos(fecha.getMinutes())}`
  );
}

export function construirMensajeConfirmacion(
  nombrePaciente: string,
  fechaHoraCita: Date | string,
): string {
  return (
    `Hola, le escribo para confirmar la cita de ${nombrePaciente.trim()} ` +
    `el ${formatearFechaHoraCita(fechaHoraCita)}. ¿Nos confirma su asistencia?`
  );
}

/** Devuelve `null` si el teléfono falta o no es válido (la UI deshabilita el botón). */
export function construirEnlaceConfirmacionWhatsApp(
  telefono: string | null | undefined,
  nombrePaciente: string,
  fechaHoraCita: Date | string,
): string | null {
  const { valido, telefono: normalizado } = normalizarYValidarTelefonoChileno(telefono);
  if (!valido || normalizado === null) return null;
  const numeroSinMas = normalizado.slice(1);
  const texto = encodeURIComponent(construirMensajeConfirmacion(nombrePaciente, fechaHoraCita));
  return `https://wa.me/${numeroSinMas}?text=${texto}`;
}
