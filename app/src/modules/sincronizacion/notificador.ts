/**
 * Decorador del repositorio: tras cada escritura clínica avisa al motor de
 * sincronización para que actualice el contador y envíe la cola. El motor usa
 * el repositorio sin decorar, de modo que sus propias escrituras no lo disparan.
 */
import type { IRepositorioClinico } from '../../data/repositorio';

/** Métodos de escritura clínica (el repositorio no tiene eliminación física). */
export const PREFIJOS_ESCRITURA_CLINICA = /^(crear|actualizar|archivar)/;

export function conNotificacionDeCambios(
  repositorio: IRepositorioClinico,
  notificar: () => Promise<void> | void,
): IRepositorioClinico {
  return new Proxy(repositorio, {
    get(destino, propiedad, receptor) {
      const valor: unknown = Reflect.get(destino, propiedad, receptor);
      if (
        typeof propiedad !== 'string' ||
        typeof valor !== 'function' ||
        !PREFIJOS_ESCRITURA_CLINICA.test(propiedad)
      ) {
        return typeof valor === 'function' ? valor.bind(destino) : valor;
      }
      return async (...args: unknown[]) => {
        const resultado: unknown = await valor.apply(destino, args);
        try {
          await notificar();
        } catch {
          // El aviso no debe hacer fallar un guardado ya confirmado.
        }
        return resultado;
      };
    },
  });
}
